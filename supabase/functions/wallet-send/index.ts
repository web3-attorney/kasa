const CORS={'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'authorization, x-client-info, apikey, content-type','Access-Control-Allow-Methods':'GET, POST, PUT, DELETE, OPTIONS'}
const j=(d:unknown,s=200)=>new Response(JSON.stringify(d),{status:s,headers:{...CORS,'Content-Type':'application/json'}})
const e=(m:string,s=400)=>j({error:m},s)
const USDC='0x3600000000000000000000000000000000000000'
async function circlePost(path:string,body:unknown){
  const r=await fetch(`https://api.circle.com/v1${path}`,{method:'POST',headers:{'Authorization':`Bearer ${Deno.env.get('CIRCLE_API_KEY')}`,'Content-Type':'application/json'},body:JSON.stringify(body)})
  return r.json() as Promise<{data?:{id?:string};code?:number;message?:string}>
}
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
    const{walletId,toAddress,amount,memo}=await req.json() as{walletId?:string;toAddress?:string;amount?:string;memo?:string}
    if(!walletId||!toAddress||!amount)return e('walletId, toAddress, amount required')
    const units=BigInt(Math.round(parseFloat(amount)*1_000_000))
    const to32=toAddress.toLowerCase().replace('0x','').padStart(64,'0')
    const amt32=units.toString(16).padStart(64,'0')
    const txRes=await circlePost('/w3s/developer/transactions/contractExecution',{walletId,contractAddress:USDC,callData:`0xa9059cbb${to32}${amt32}`,fee:{type:'level',config:{feeLevel:'MEDIUM'}},idempotencyKey:crypto.randomUUID()})
    const txId=txRes.data?.id
    if(!txId)throw new Error('No txId from Circle')
    const result=await waitTx(txId)
    if(result.state!=='COMPLETE')throw new Error(`Transaction ${result.state}`)
    const SB_URL=Deno.env.get('SUPABASE_URL')!,SB_KEY=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    await fetch(`${SB_URL}/rest/v1/tx_history`,{method:'POST',headers:{'apikey':SB_KEY,'Authorization':`Bearer ${SB_KEY}`,'Content-Type':'application/json','Prefer':'resolution=ignore-duplicates'},body:JSON.stringify({wallet_id:walletId,tx_hash:result.txHash??txId,direction:'out',amount,counterparty:toAddress,memo:memo??'',timestamp:Date.now()})})
    return j({txId,txHash:result.txHash})
  }catch(err2){return e(err2 instanceof Error?err2.message:'Server error',500)}
})