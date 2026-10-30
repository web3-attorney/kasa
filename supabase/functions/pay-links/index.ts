const CORS={'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'authorization, x-client-info, apikey, content-type','Access-Control-Allow-Methods':'GET, POST, PUT, DELETE, OPTIONS'}
const j=(d:unknown,s=200)=>new Response(JSON.stringify(d),{status:s,headers:{...CORS,'Content-Type':'application/json'}})
const e=(m:string,s=400)=>j({error:m},s)
Deno.serve(async(req)=>{
  if(req.method==='OPTIONS')return new Response(null,{status:204,headers:CORS})
  const SB_URL=Deno.env.get('SUPABASE_URL')!,SB_KEY=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  const h={'apikey':SB_KEY,'Authorization':`Bearer ${SB_KEY}`,'Content-Type':'application/json','Accept':'application/json'}
  const url=new URL(req.url)
  try{
    if(req.method==='POST'){
      const{toWalletId,toAddress,toUsername,amount,memo}=await req.json() as{toWalletId?:string;toAddress?:string;toUsername?:string;amount?:string;memo?:string}
      if(!toWalletId||!toAddress||!amount)return e('missing fields')
      const id=crypto.randomUUID().replace(/-/g,'').slice(0,14)
      await fetch(`${SB_URL}/rest/v1/pay_links`,{method:'POST',headers:h,body:JSON.stringify({id,to_wallet_id:toWalletId,to_address:toAddress,to_username:toUsername??'',amount,memo:memo??'',created_at:Date.now(),paid_tx_hash:null})})
      return j({id,url:`/pay/${id}`})
    }
    if(req.method==='GET'){
      const id=url.pathname.split('/').pop()
      if(!id)return e('id required')
      const r=await fetch(`${SB_URL}/rest/v1/pay_links?id=eq.${encodeURIComponent(id)}&limit=1`,{headers:h})
      const rows=await r.json() as Record<string,unknown>[]
      if(!rows[0])return e('Not found',404)
      const d=rows[0]
      return j({id:d.id,toWalletId:d.to_wallet_id,toAddress:d.to_address,toUsername:d.to_username,amount:d.amount,memo:d.memo,createdAt:d.created_at,paidTxHash:d.paid_tx_hash})
    }
    return e('Method not allowed',405)
  }catch(err2){return e(err2 instanceof Error?err2.message:'Failed',500)}
})