// Autosave watcher — triggered by pg_cron every minute
// Checks all active autosave plans:
// 1. If plan matured (endTime passed) → auto-withdraw
// 2. Inbound deposit tracking is done client-side via tx-history polling
const CORS={'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'authorization, x-client-info, apikey, content-type','Access-Control-Allow-Methods':'GET, POST, PUT, DELETE, OPTIONS'}
const j=(d:unknown,s=200)=>new Response(JSON.stringify(d),{status:s,headers:{...CORS,'Content-Type':'application/json'}})

async function encryptEntitySecret(entitySecret:string,publicKeyPem:string):Promise<string>{
  const pem=publicKeyPem.replace(/-----BEGIN PUBLIC KEY-----|-----END PUBLIC KEY-----|\s+/g,'')
  const t=atob(pem)
  const kb=new Uint8Array(t.length)
  for(let a=0;a<t.length;a++) kb[a]=t.codePointAt(a) as number
  const key=await crypto.subtle.importKey('spki',kb.buffer,{name:'RSA-OAEP',hash:'SHA-256'},false,['encrypt'])
  const cleanSecret=entitySecret.trim().replace(/\s+/g,'')
  const sb=new Uint8Array(cleanSecret.length/2)
  for(let i=0;i<cleanSecret.length;i+=2) sb[i/2]=parseInt(cleanSecret.slice(i,i+2),16)
  const enc=await crypto.subtle.encrypt({name:'RSA-OAEP'},key,sb)
  return btoa(Array.from(new Uint8Array(enc),b=>String.fromCodePoint(b)).join(''))
}

async function circleContractCall(walletId:string,contractAddress:string,abiFunctionSignature:string,abiParameters:string[],apiKey:string,entitySecret:string):Promise<string|null>{
  const pkRes=await fetch('https://api.circle.com/v1/w3s/config/entity/publicKey',{headers:{'Authorization':`Bearer ${apiKey}`}})
  const pkData=await pkRes.json() as{data?:{publicKey:string}}
  if(!pkData.data?.publicKey)return null
  const ciphertext=await encryptEntitySecret(entitySecret,pkData.data.publicKey)
  const r=await fetch('https://api.circle.com/v1/w3s/developer/transactions/contractExecution',{
    method:'POST',
    headers:{'Authorization':`Bearer ${apiKey}`,'Content-Type':'application/json'},
    body:JSON.stringify({idempotencyKey:crypto.randomUUID(),entitySecretCiphertext:ciphertext,walletId,contractAddress,abiFunctionSignature,abiParameters,feeLevel:'MEDIUM'})
  })
  const d=await r.json() as{data?:{id:string}}
  return d.data?.id??null
}

Deno.serve(async(req)=>{
  if(req.method==='OPTIONS')return new Response(null,{status:204,headers:CORS})
  try{
    const SB_URL=Deno.env.get('SUPABASE_URL')!
    const SB_KEY=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    const CIRCLE_KEY=Deno.env.get('CIRCLE_API_KEY')!
    const ENTITY_SECRET=Deno.env.get('CIRCLE_ENTITY_SECRET')!
    const SAVINGS=Deno.env.get('VITE_SAVINGS_ADDRESS')!
    const sbH={'apikey':SB_KEY,'Authorization':`Bearer ${SB_KEY}`,'Content-Type':'application/json','Accept':'application/json'}

    // Fetch all active, non-deactivated plans with endTime set
    const r=await fetch(`${SB_URL}/rest/v1/autosave_plans?active=eq.true&user_deactivated=eq.false`,{headers:sbH})
    const plans=await r.json() as{wallet_id:string;wallet_address:string;end_time:number;savings_percent:number}[]

    const now=Date.now()
    const results:string[]=[]

    for(const plan of plans){
      if(plan.end_time>0&&plan.end_time<now){
        // Plan matured — auto-withdraw
        try{
          const txId=await circleContractCall(plan.wallet_id,SAVINGS,'withdraw(address)',[plan.wallet_address],CIRCLE_KEY,ENTITY_SECRET)
          // Mark plan as deactivated
          await fetch(`${SB_URL}/rest/v1/autosave_plans?wallet_id=eq.${encodeURIComponent(plan.wallet_id)}`,{
            method:'PATCH',headers:sbH,
            body:JSON.stringify({active:false,user_deactivated:true,updated_at:now})
          })
          // Record in tx_history
          if(txId){
            await fetch(`${SB_URL}/rest/v1/tx_history`,{method:'POST',headers:{...sbH,'Prefer':'resolution=merge-duplicates'},
              body:JSON.stringify({wallet_id:plan.wallet_id,tx_hash:txId,direction:'save',amount:'auto-withdraw',counterparty:SAVINGS,memo:'Auto-withdraw on maturity',timestamp:now})
            })
          }
          results.push(`matured:${plan.wallet_id}:${txId??'no-tx'}`)
        }catch(err){
          results.push(`error:${plan.wallet_id}:${err instanceof Error?err.message:'unknown'}`)
        }
      }
    }
    return j({processed:results.length,results})
  }catch(err){
    return j({error:err instanceof Error?err.message:'Failed'},500)
  }
})
