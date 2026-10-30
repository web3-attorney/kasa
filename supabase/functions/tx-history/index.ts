const CORS={'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'authorization, x-client-info, apikey, content-type','Access-Control-Allow-Methods':'GET, POST, PUT, DELETE, OPTIONS'}
const j=(d:unknown,s=200)=>new Response(JSON.stringify(d),{status:s,headers:{...CORS,'Content-Type':'application/json'}})
const e=(m:string,s=400)=>j({error:m},s)
Deno.serve(async(req)=>{
  if(req.method==='OPTIONS')return new Response(null,{status:204,headers:CORS})
  try{
    const url=new URL(req.url)
    const walletId=url.searchParams.get('walletId')
    if(!walletId)return e('walletId required')
    const SB_URL=Deno.env.get('SUPABASE_URL')!,SB_KEY=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    const r=await fetch(`${SB_URL}/rest/v1/tx_history?wallet_id=eq.${encodeURIComponent(walletId)}&order=timestamp.desc&limit=200`,{headers:{'apikey':SB_KEY,'Authorization':`Bearer ${SB_KEY}`,'Accept':'application/json'}})
    const rows=await r.json() as Record<string,unknown>[]
    return j(rows.map(r2=>({txHash:r2.tx_hash,direction:r2.direction,amount:r2.amount,counterparty:r2.counterparty,memo:r2.memo,label:r2.label,timestamp:r2.timestamp})))
  }catch(err2){return e(err2 instanceof Error?err2.message:'Failed',500)}
})