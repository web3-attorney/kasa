const CORS={'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'authorization, x-client-info, apikey, content-type','Access-Control-Allow-Methods':'GET, POST, PUT, DELETE, OPTIONS'}
const j=(d:unknown,s=200)=>new Response(JSON.stringify(d),{status:s,headers:{...CORS,'Content-Type':'application/json'}})
const e=(m:string,s=400)=>j({error:m},s)
Deno.serve(async(req)=>{
  if(req.method==='OPTIONS')return new Response(null,{status:204,headers:CORS})
  const SB_URL=Deno.env.get('SUPABASE_URL')!,SB_KEY=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  const h={'apikey':SB_KEY,'Authorization':`Bearer ${SB_KEY}`,'Content-Type':'application/json','Accept':'application/json'}
  const url=new URL(req.url)
  try{
    if(req.method==='GET'){
      const wId=url.searchParams.get('walletId')
      if(!wId)return e('walletId required')
      const r=await fetch(`${SB_URL}/rest/v1/spend_limits?wallet_id=eq.${encodeURIComponent(wId)}&limit=1`,{headers:h})
      const rows=await r.json() as Record<string,unknown>[]
      if(!rows[0])return j({dailyLimitUsdc:0,spentToday:0,resetAt:Date.now()+86400_000})
      const d=rows[0]
      if(Date.now()>(d.reset_at as number)){
        await fetch(`${SB_URL}/rest/v1/spend_limits?wallet_id=eq.${encodeURIComponent(wId)}`,{method:'PATCH',headers:h,body:JSON.stringify({spent_today:0,reset_at:Date.now()+86400_000})})
        return j({dailyLimitUsdc:d.daily_limit_usdc,spentToday:0,resetAt:Date.now()+86400_000})
      }
      return j({dailyLimitUsdc:d.daily_limit_usdc,spentToday:d.spent_today,resetAt:d.reset_at})
    }
    if(req.method==='POST'){
      const{walletId,dailyLimitUsdc}=await req.json() as{walletId?:string;dailyLimitUsdc?:number}
      if(!walletId||dailyLimitUsdc===undefined)return e('missing fields')
      await fetch(`${SB_URL}/rest/v1/spend_limits`,{method:'POST',headers:{...h,'Prefer':'resolution=merge-duplicates'},body:JSON.stringify({wallet_id:walletId,daily_limit_usdc:dailyLimitUsdc,spent_today:0,reset_at:Date.now()+86400_000})})
      return j({ok:true})
    }
    return e('Method not allowed',405)
  }catch(err2){return e(err2 instanceof Error?err2.message:'Failed',500)}
})