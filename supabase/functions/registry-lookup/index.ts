const CORS={'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'authorization, x-client-info, apikey, content-type','Access-Control-Allow-Methods':'GET, POST, PUT, DELETE, OPTIONS'}
const j=(d:unknown,s=200)=>new Response(JSON.stringify(d),{status:s,headers:{...CORS,'Content-Type':'application/json'}})
const e=(m:string,s=400)=>j({error:m},s)
const ARC_RPC='https://rpc.testnet.arc.io'
const REGISTRY=Deno.env.get('VITE_REGISTRY_ADDRESS')??''
async function rpc(method:string,params:unknown[]){const r=await fetch(ARC_RPC,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:1,method,params})});return(await r.json() as{result:string}).result}
Deno.serve(async(req)=>{
  if(req.method==='OPTIONS')return new Response(null,{status:204,headers:CORS})
  const url=new URL(req.url)
  const username=url.searchParams.get('username')?.replace(/^@/,'').toLowerCase()??''
  if(!username)return e('username required')
  if(!REGISTRY)return e('Registry not configured',503)
  try{
    const nb=new TextEncoder().encode(username)
    const offset='0000000000000000000000000000000000000000000000000000000000000020'
    const len=nb.length.toString(16).padStart(64,'0')
    const data32=Array.from(nb).map(b=>b.toString(16).padStart(2,'0')).join('').padEnd(Math.ceil(nb.length/32)*64,'0')
    const result=await rpc('eth_call',[{to:REGISTRY,data:'0xbf40fac1'+offset+len+data32},'latest'])
    const addr='0x'+result.slice(-40)
    if(addr==='0x0000000000000000000000000000000000000000')return e('Username not found',404)
    return j({address:addr})
  }catch(err2){return e(err2 instanceof Error?err2.message:'Lookup failed',500)}
})