const CORS={'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'authorization, x-client-info, apikey, content-type','Access-Control-Allow-Methods':'GET, POST, PUT, DELETE, OPTIONS'}
const j=(d:unknown,s=200)=>new Response(JSON.stringify(d),{status:s,headers:{...CORS,'Content-Type':'application/json'}})
const e=(m:string,s=400)=>j({error:m},s)
Deno.serve(async(req)=>{
  if(req.method==='OPTIONS')return new Response(null,{status:204,headers:CORS})
  try{
    const{walletId,address,percent}=await req.json() as{walletId?:string;address?:string;percent?:number}
    if(!walletId||!address||percent===undefined)return e('walletId, address, percent required')
    const deactivated=percent===0
    const SB_URL=Deno.env.get('SUPABASE_URL')!,SB_KEY=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    await fetch(`${SB_URL}/rest/v1/autosave_plans`,{method:'POST',headers:{'apikey':SB_KEY,'Authorization':`Bearer ${SB_KEY}`,'Content-Type':'application/json','Prefer':'resolution=merge-duplicates'},body:JSON.stringify({wallet_id:walletId,wallet_address:address.toLowerCase(),savings_percent:percent,active:percent>0&&!deactivated,user_deactivated:deactivated,end_time:deactivated?0:undefined,updated_at:Date.now()})})
    return j({ok:true})
  }catch(err2){return e(err2 instanceof Error?err2.message:'Failed',500)}
})