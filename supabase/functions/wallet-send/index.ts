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

async function waitForTxHash(txId:string,apiKey:string,timeoutMs=30000):Promise<string|null>{
  const deadline=Date.now()+timeoutMs
  while(Date.now()<deadline){
    await new Promise(r=>setTimeout(r,2000))
    try{
      const r=await fetch(`https://api.circle.com/v1/w3s/transactions/${txId}`,{
        headers:{'Authorization':`Bearer ${apiKey}`}
      })
      const d=await r.json() as{data?:{transaction?:{state:string;txHash?:string}}}
      const tx=d.data?.transaction
      if(!tx) continue
      if(tx.txHash) return tx.txHash
      if(tx.state==='FAILED'||tx.state==='CANCELLED'||tx.state==='DENIED') return null
    }catch{ continue }
  }
  return null
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

    const txId=txData.data.id
    const SB_URL=Deno.env.get('SUPABASE_URL')!,SB_KEY=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

    // Poll for real onchain hash (Arc finalises in ~1s so this usually resolves in 2-4s)
    const txHash=await waitForTxHash(txId,apiKey,30000)

    // Record in Supabase with real hash (or txId as fallback)
    const hashToStore=txHash??txId
    await fetch(`${SB_URL}/rest/v1/tx_history`,{method:'POST',headers:{'apikey':SB_KEY,'Authorization':`Bearer ${SB_KEY}`,'Content-Type':'application/json','Prefer':'resolution=merge-duplicates'},
      body:JSON.stringify({wallet_id:walletId,tx_hash:hashToStore,direction:'out',amount,counterparty:toAddress,memo:memo??'',timestamp:Date.now()})})

    return j({txId,txHash:txHash??undefined,pending:!txHash})
  }catch(err){
    return j({error:err instanceof Error?err.message:'Server error'},500)
  }
})
