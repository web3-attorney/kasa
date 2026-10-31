const CORS={'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'authorization, x-client-info, apikey, content-type','Access-Control-Allow-Methods':'GET, POST, PUT, DELETE, OPTIONS'}
const j=(d:unknown,s=200)=>new Response(JSON.stringify(d),{status:s,headers:{...CORS,'Content-Type':'application/json'}})
const e=(m:string,s=400)=>j({error:m},s)
Deno.serve(async(req)=>{
  if(req.method==='OPTIONS')return new Response(null,{status:204,headers:CORS})
  const SB_URL=Deno.env.get('SUPABASE_URL')!,SB_KEY=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  const sbH={'apikey':SB_KEY,'Authorization':`Bearer ${SB_KEY}`,'Content-Type':'application/json','Accept':'application/json'}
  const url=new URL(req.url)
  try{
    // GET — fetch current plan state
    if(req.method==='GET'){
      const walletId=url.searchParams.get('walletId')
      if(!walletId)return e('walletId required')
      const r=await fetch(`${SB_URL}/rest/v1/autosave_plans?wallet_id=eq.${encodeURIComponent(walletId)}&limit=1`,{headers:sbH})
      const rows=await r.json() as Record<string,unknown>[]
      if(!rows[0])return j({active:false,percent:0,endTime:0,userDeactivated:false})
      const d=rows[0]
      return j({active:d.active,percent:d.savings_percent,endTime:d.end_time,userDeactivated:d.user_deactivated,walletAddress:d.wallet_address})
    }
    // POST — upsert plan
    if(req.method==='POST'){
      const{walletId,address,percent,durationDays}=await req.json() as{walletId?:string;address?:string;percent?:number;durationDays?:number}
      if(!walletId||!address||percent===undefined)return e('walletId, address, percent required')
      const deactivated=percent===0
      const endTime=(!deactivated&&durationDays&&durationDays>0)?Date.now()+durationDays*86400000:0
      await fetch(`${SB_URL}/rest/v1/autosave_plans`,{method:'POST',headers:{...sbH,'Prefer':'resolution=merge-duplicates'},body:JSON.stringify({wallet_id:walletId,wallet_address:address.toLowerCase(),savings_percent:percent,active:!deactivated,user_deactivated:deactivated,end_time:endTime,updated_at:Date.now()})})
      return j({ok:true})
    }
    return e('Method not allowed',405)
  }catch(err2){return e(err2 instanceof Error?err2.message:'Failed',500)}
})
