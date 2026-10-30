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
      const r=await fetch(`${SB_URL}/rest/v1/contacts?wallet_id=eq.${encodeURIComponent(wId)}&order=created_at.desc`,{headers:h})
      return j(await r.json())
    }
    if(req.method==='POST'){
      const{walletId,name,address,memo}=await req.json() as{walletId?:string;name?:string;address?:string;memo?:string}
      if(!walletId||!name?.trim()||!address?.trim())return e('walletId, name, address required')
      const r=await fetch(`${SB_URL}/rest/v1/contacts`,{method:'POST',headers:{...h,'Prefer':'return=representation,resolution=ignore-duplicates'},body:JSON.stringify({wallet_id:walletId,name:name.trim(),address:address.trim(),memo:memo?.trim(),created_at:Date.now()})})
      if(r.status===409)return e('Address already saved',409)
      const rows=await r.json() as unknown[]
      return j(rows[0]??{},201)
    }
    if(req.method==='DELETE'){
      const id=url.pathname.split('/').pop()
      const{walletId}=await req.json() as{walletId?:string}
      if(!walletId||!id)return e('walletId required')
      await fetch(`${SB_URL}/rest/v1/contacts?id=eq.${encodeURIComponent(id)}&wallet_id=eq.${encodeURIComponent(walletId)}`,{method:'DELETE',headers:h})
      return j({ok:true})
    }
    if(req.method==='PUT'){
      const id=url.pathname.split('/').pop()
      const{walletId,name,memo}=await req.json() as{walletId?:string;name?:string;memo?:string}
      if(!walletId||!id)return e('walletId required')
      await fetch(`${SB_URL}/rest/v1/contacts?id=eq.${encodeURIComponent(id)}&wallet_id=eq.${encodeURIComponent(walletId)}`,{method:'PATCH',headers:h,body:JSON.stringify({name:name?.trim(),memo:memo?.trim()})})
      return j({ok:true})
    }
    return e('Method not allowed',405)
  }catch(err2){return e(err2 instanceof Error?err2.message:'Failed',500)}
})