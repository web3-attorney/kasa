const CORS={'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'authorization, x-client-info, apikey, content-type','Access-Control-Allow-Methods':'GET, POST, PUT, DELETE, OPTIONS'}
const j=(d:unknown,s=200)=>new Response(JSON.stringify(d),{status:s,headers:{...CORS,'Content-Type':'application/json'}})
const USDC='0x3600000000000000000000000000000000000000'

async function encryptEntitySecret(entitySecret:string,publicKeyPem:string):Promise<string>{
  const pem=publicKeyPem.replace(/-----BEGIN PUBLIC KEY-----|-----END PUBLIC KEY-----|\s+/g,'')
  const t=atob(pem)
  const keyBytes=new Uint8Array(t.length)
  for(let a=0;a<t.length;a++) keyBytes[a]=t.codePointAt(a) as number
  const publicKey=await crypto.subtle.importKey('spki',keyBytes.buffer,{name:'RSA-OAEP',hash:'SHA-256'},false,['encrypt'])
  const cleanSecret=entitySecret.trim().replace(/\s+/g,'')
  const secretBytes=new Uint8Array(cleanSecret.length/2)
  for(let i=0;i<cleanSecret.length;i+=2) secretBytes[i/2]=parseInt(cleanSecret.slice(i,i+2),16)
  const encrypted=await crypto.subtle.encrypt({name:'RSA-OAEP'},publicKey,secretBytes)
  return btoa(Array.from(new Uint8Array(encrypted),b=>String.fromCodePoint(b)).join(''))
}

Deno.serve(async(req)=>{
  if(req.method==='OPTIONS')return new Response(null,{status:204,headers:CORS})
  try{
    const{walletId,toAddress,amount,memo}=await req.json() as{walletId?:string;toAddress?:string;amount?:string;memo?:string}
    if(!walletId||!toAddress||!amount)return j({error:'walletId, toAddress, amount required'},400)

    const apiKey=Deno.env.get('CIRCLE_API_KEY')!
    const entitySecret=Deno.env.get('CIRCLE_ENTITY_SECRET')!

    const pkRes=await fetch('https://api.circle.com/v1/w3s/config/entity/publicKey',{headers:{'Authorization':`Bearer ${apiKey}`}})
    const pkData=await pkRes.json() as{data?:{publicKey:string};message?:string}
    if(!pkData.data?.publicKey) return j({error:'Failed to get public key',detail:pkData},500)

    const ciphertext=await encryptEntitySecret(entitySecret,pkData.data.publicKey)
    const units=BigInt(Math.round(parseFloat(amount)*1_000_000)).toString()

    const txRes=await fetch('https://api.circle.com/v1/w3s/developer/transactions/contractExecution',{
      method:'POST',
      headers:{'Authorization':`Bearer ${apiKey}`,'Content-Type':'application/json'},
      body:JSON.stringify({
        idempotencyKey:crypto.randomUUID(),
        entitySecretCiphertext:ciphertext,
        walletId,
        contractAddress:USDC,
        abiFunctionSignature:'transfer(address,uint256)',
        abiParameters:[toAddress,units],
        feeLevel:'MEDIUM'
      })
    })
    const txData=await txRes.json() as{data?:{id:string};code?:number;message?:string;errors?:unknown[]}
    if(!txData.data?.id) return j({error:txData.message??'No txId',detail:txData},400)

    // Return txId immediately — frontend polls /tx-status for completion
    const txId=txData.data.id

    // Record as pending in Supabase
    const SB_URL=Deno.env.get('SUPABASE_URL')!,SB_KEY=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    await fetch(`${SB_URL}/rest/v1/tx_history`,{method:'POST',headers:{'apikey':SB_KEY,'Authorization':`Bearer ${SB_KEY}`,'Content-Type':'application/json','Prefer':'resolution=merge-duplicates'},
      body:JSON.stringify({wallet_id:walletId,tx_hash:txId,direction:'out',amount,counterparty:toAddress,memo:memo??'',timestamp:Date.now()})})

    return j({txId,pending:true})
  }catch(err){
    return j({error:err instanceof Error?err.message:'Server error'},500)
  }
})
