const CORS={'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'authorization, x-client-info, apikey, content-type','Access-Control-Allow-Methods':'GET, POST, PUT, DELETE, OPTIONS'}
const j=(d:unknown,s=200)=>new Response(JSON.stringify(d),{status:s,headers:{...CORS,'Content-Type':'application/json'}})

Deno.serve(async(req)=>{
  if(req.method==='OPTIONS')return new Response(null,{status:204,headers:CORS})
  try{
    const url=new URL(req.url)
    const txId=url.searchParams.get('txId')
    if(!txId)return j({error:'txId required'},400)

    const apiKey=Deno.env.get('CIRCLE_API_KEY')!
    const r=await fetch(`https://api.circle.com/v1/w3s/developer/transactions/${txId}`,{
      headers:{'Authorization':`Bearer ${apiKey}`}
    })
    const d=await r.json() as{data?:{transaction?:{state:string;txHash?:string}}}
    const tx=d.data?.transaction
    if(!tx)return j({state:'UNKNOWN'})

    // If complete, update the tx_history record with real hash
    if(tx.state==='COMPLETE'&&tx.txHash){
      const SB_URL=Deno.env.get('SUPABASE_URL')!,SB_KEY=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
      await fetch(`${SB_URL}/rest/v1/tx_history?tx_hash=eq.${encodeURIComponent(txId)}`,{
        method:'PATCH',
        headers:{'apikey':SB_KEY,'Authorization':`Bearer ${SB_KEY}`,'Content-Type':'application/json'},
        body:JSON.stringify({tx_hash:tx.txHash})
      })
    }
    return j({state:tx.state,txHash:tx.txHash})
  }catch(err){
    return j({error:err instanceof Error?err.message:'Server error'},500)
  }
})
