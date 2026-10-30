const CORS={'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'authorization, x-client-info, apikey, content-type','Access-Control-Allow-Methods':'GET, POST, PUT, DELETE, OPTIONS'}
const j=(d:unknown,s=200)=>new Response(JSON.stringify(d),{status:s,headers:{...CORS,'Content-Type':'application/json'}})
const e=(m:string,s=400)=>j({error:m},s)

async function encryptEntitySecret(entitySecret:string,publicKeyPem:string):Promise<string>{
  const pem=publicKeyPem.replace(/-----BEGIN PUBLIC KEY-----|-----END PUBLIC KEY-----|\n/g,'')
  const keyBytes=Uint8Array.from(atob(pem),c=>c.charCodeAt(0))
  const publicKey=await crypto.subtle.importKey('spki',keyBytes.buffer,{name:'RSA-OAEP',hash:'SHA-256'},false,['encrypt'])
  const secretBytes=new Uint8Array(entitySecret.match(/.{2}/g)!.map(h=>parseInt(h,16)))
  const encrypted=await crypto.subtle.encrypt({name:'RSA-OAEP'},publicKey,secretBytes)
  return btoa(String.fromCharCode(...new Uint8Array(encrypted)))
}
async function circlePost(path:string,body:unknown){
  const apiKey=Deno.env.get('CIRCLE_API_KEY')!
  const entitySecret=Deno.env.get('CIRCLE_ENTITY_SECRET')!
  const pkRes=await fetch('https://api.circle.com/v1/w3s/config/entity/publicKey',{headers:{'Authorization':`Bearer ${apiKey}`}})
  const pkData=await pkRes.json() as{data:{publicKey:string}}
  const ciphertext=await encryptEntitySecret(entitySecret,pkData.data.publicKey)
  const r=await fetch(`https://api.circle.com/v1${path}`,{method:'POST',headers:{'Authorization':`Bearer ${apiKey}`,'Content-Type':'application/json'},body:JSON.stringify({...body as object,entitySecretCiphertext:ciphertext})})
  return r.json()
}
async function waitForTx(txId:string):Promise<{state:string;txHash?:string}>{
  const apiKey=Deno.env.get('CIRCLE_API_KEY')!
  for(let i=0;i<30;i++){
    await new Promise(r=>setTimeout(r,2000))
    const r=await fetch(`https://api.circle.com/v1/w3s/developer/transactions/${txId}`,{headers:{'Authorization':`Bearer ${apiKey}`}})
    const d=await r.json() as{data:{transaction:{state:string;txHash?:string}}}
    const tx=d.data?.transaction
    if(!tx)continue
    if(tx.state==='COMPLETE')return{state:'COMPLETE',txHash:tx.txHash}
    if(['FAILED','DENIED','CANCELLED'].includes(tx.state))return{state:tx.state}
  }
  return{state:'TIMEOUT'}
}
Deno.serve(async(req)=>{
  if(req.method==='OPTIONS')return new Response(null,{status:204,headers:CORS})
  try{
    const{walletId,contractAddress,abiFunctionSignature,abiParameters}=await req.json() as{walletId?:string;contractAddress?:string;abiFunctionSignature?:string;abiParameters?:string[]}
    if(!walletId||!contractAddress||!abiFunctionSignature)return e('walletId, contractAddress, abiFunctionSignature required')
    const txRes=await circlePost('/w3s/developer/transactions/contractExecution',{walletId,contractAddress,abiFunctionSignature,abiParameters:(abiParameters??[]).map(String),fee:{type:'level',config:{feeLevel:'MEDIUM'}},idempotencyKey:crypto.randomUUID()})
    const txId=txRes.data?.id
    if(!txId)throw new Error(txRes.message??'No txId')
    const result=await waitForTx(txId)
    if(result.state!=='COMPLETE')throw new Error(`Transaction ${result.state}`)
    return j({txId,txHash:result.txHash})
  }catch(err2){return e(err2 instanceof Error?err2.message:'Server error',500)}
})