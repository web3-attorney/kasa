const CORS={'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'authorization, x-client-info, apikey, content-type','Access-Control-Allow-Methods':'GET, POST, PUT, DELETE, OPTIONS'}
const j=(d:unknown,s=200)=>new Response(JSON.stringify(d),{status:s,headers:{...CORS,'Content-Type':'application/json'}})
const e=(m:string,s=400)=>j({error:m},s)
const USDC='0x3600000000000000000000000000000000000000'
const ARC_RPC=Deno.env.get('ARC_RPC')??`https://rpc.mainnet.arc.io`
async function rpcCall(method:string,params:unknown[]){
  const r=await fetch(ARC_RPC,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:1,method,params})})
  const j2=await r.json() as{result:string}
  return j2.result
}
Deno.serve(async(req)=>{
  if(req.method==='OPTIONS')return new Response(null,{status:204,headers:CORS})
  try{
    const url=new URL(req.url)
    const address=url.searchParams.get('address')??url.searchParams.get('walletId')
    if(!address)return e('address required')
    const data='0x70a08231'+address.toLowerCase().replace('0x','').padStart(64,'0')
    const raw=BigInt(await rpcCall('eth_call',[{to:USDC,data},'latest']))
    const balance=(Number(raw)/1e6).toFixed(6).replace(/\.?0+$/,'')||'0'
    return j({balance,tokenAddress:USDC})
  }catch(err2){return e(err2 instanceof Error?err2.message:'Server error',500)}
})