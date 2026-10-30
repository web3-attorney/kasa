const CORS={'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'authorization, x-client-info, apikey, content-type','Access-Control-Allow-Methods':'GET, POST, PUT, DELETE, OPTIONS'}
const j=(d:unknown,s=200)=>new Response(JSON.stringify(d),{status:s,headers:{...CORS,'Content-Type':'application/json'}})
const e=(m:string,s=400)=>j({error:m},s)
async function waitTx(txId:string){
  for(let i=0;i<30;i++){
    await new Promise(r=>setTimeout(r,2000))
    const r=await fetch(`https://api.circle.com/v1/w3s/transactions/${txId}`,{headers:{'Authorization':`Bearer ${Deno.env.get('CIRCLE_API_KEY')}`}})
    const d=await r.json() as{data?:{transaction?:{state?:string;txHash?:string}}}
    const st=d.data?.transaction?.state
    if(st==='COMPLETE')return{state:'COMPLETE',txHash:d.data!.transaction!.txHash??''}
    if(['FAILED','DENIED','CANCELLED'].includes(st??''))return{state:st,txHash:''}
  }
  return{state:'TIMEOUT',txHash:''}
}
Deno.serve(async(req)=>{
  if(req.method==='OPTIONS')return new Response(null,{status:204,headers:CORS})
  try{
    const{walletId,contractAddress,abiFunctionSignature,abiParameters}=await req.json() as{walletId?:string;contractAddress?:string;abiFunctionSignature?:string;abiParameters?:string[]}
    if(!walletId||!contractAddress||!abiFunctionSignature)return e('walletId, contractAddress, abiFunctionSignature required')
    const txRes=await fetch(`https://api.circle.com/v1/w3s/developer/transactions/contractExecution`,{method:'POST',headers:{'Authorization':`Bearer ${Deno.env.get('CIRCLE_API_KEY')}`,'Content-Type':'application/json'},body:JSON.stringify({walletId,contractAddress,abiFunctionSignature,abiParameters:(abiParameters??[]).map(String),fee:{type:'level',config:{feeLevel:'MEDIUM'}},idempotencyKey:crypto.randomUUID()})})
    const txData=await txRes.json() as{data?:{id?:string}}
    const txId=txData.data?.id
    if(!txId)throw new Error('No txId')
    const result=await waitTx(txId)
    return j({txId,txHash:result.txHash,state:result.state})
  }catch(err2){return e(err2 instanceof Error?err2.message:'Server error',500)}
})