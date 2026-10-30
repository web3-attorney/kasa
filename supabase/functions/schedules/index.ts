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
      const r=await fetch(`${SB_URL}/rest/v1/schedules?wallet_id=eq.${encodeURIComponent(wId??'')}`,{headers:h})
      return j(await r.json())
    }
    if(req.method==='POST'){
      const{walletId,toAddress,amount,label,intervalMs}=await req.json() as{walletId?:string;toAddress?:string;amount?:string;label?:string;intervalMs?:number}
      if(!walletId||!toAddress||!amount||!intervalMs)return e('missing fields')
      if(intervalMs<3_600_000)return e('Minimum interval is 1 hour')
      const id=crypto.randomUUID().replace(/-/g,'').slice(0,12)
      const s={id,wallet_id:walletId,to_address:toAddress,amount,label:label??'',interval_ms:intervalMs,next_run:Date.now()+intervalMs,last_run:null,active:true,tx_hashes:[]}
      await fetch(`${SB_URL}/rest/v1/schedules`,{method:'POST',headers:h,body:JSON.stringify(s)})
      return j({id,walletId,toAddress,amount,label:label??'',intervalMs,nextRun:s.next_run,lastRun:null,active:true,txHashes:[]})
    }
    if(req.method==='DELETE'){
      const id=url.pathname.split('/').pop()
      await fetch(`${SB_URL}/rest/v1/schedules?id=eq.${encodeURIComponent(id??'')}`,{method:'DELETE',headers:h})
      return j({ok:true})
    }
    return e('Method not allowed',405)
  }catch(err2){return e(err2 instanceof Error?err2.message:'Failed',500)}
})