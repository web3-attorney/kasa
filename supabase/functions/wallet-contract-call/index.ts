const CORS={'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'authorization, x-client-info, apikey, content-type','Access-Control-Allow-Methods':'GET, POST, PUT, DELETE, OPTIONS'}
const j=(d:unknown,s=200)=>new Response(JSON.stringify(d),{status:s,headers:{...CORS,'Content-Type':'application/json'}})

async function encryptEntitySecret(entitySecret:string,publicKeyPem:string):Promise<string>{
  const pem=publicKeyPem.replace(/-----BEGIN PUBLIC KEY-----|-----END PUBLIC KEY-----|\s+/g,'')
  const t=atob(pem)
  const keyBytes=new Uint8Array(t.length)
  for(let a=0;a<t.length;a++) keyBytes[a]=t.codePointAt(a) as number
  const publicKey=await crypto.subtle.importKey('spki',keyBytes.buffer,{name:'RSA-OAEP',hash:'SHA-256'},false,['encrypt'])
  const cleanSecret=entitySecret.trim().replace(/\s+/g,'')
  const secretBytes=new Uint8Array(cleanSecret.length/2)
  for(let i=0;i<cleanSecret.length;i+=2) secretBytes[i/2]=parseInt(cleanSecret.slice(i,i+2),16)
  const encrypted=await crypto.subtle.encrypt({name:'RSA-OAEP'},publicKey,secretBytes)
  return btoa(Array.from(new Uint8Array(encrypted),b=>String.fromCodePoint(b)).join(''))
}

// Derive tx record fields from the contract function signature
function txMeta(sig:string, params:string[], contractAddress:string, savingsAddr:string):{direction:'out'|'save';label:string;counterparty:string;amount:string}|null {
  const fn = sig.split('(')[0].toLowerCase()
  if (fn === 'deposit') {
    // deposit(uint256 amount, uint256 duration) — amount is params[0] in raw units (6 dec)
    const raw = params[0] ? (Number(params[0]) / 1e6).toFixed(2) : '?'
    return { direction: 'save', label: 'Auto-Save Deposit', counterparty: savingsAddr || contractAddress, amount: raw }
  }
  if (fn === 'withdraw') {
    // amount will be filled in after onchain read below
    return { direction: 'save', label: 'Savings Withdrawal', counterparty: savingsAddr || contractAddress, amount: '__FETCH__' }
  }
  // approve, commit, register, etc — no record needed
  return null
}

Deno.serve(async(req)=>{
  if(req.method==='OPTIONS')return new Response(null,{status:204,headers:CORS})
  try{
    const{walletId,contractAddress,abiFunctionSignature,abiParameters}=await req.json() as{walletId?:string;contractAddress?:string;abiFunctionSignature?:string;abiParameters?:string[]}
    if(!walletId||!contractAddress||!abiFunctionSignature)return j({error:'walletId, contractAddress, abiFunctionSignature required'},400)

    const apiKey=Deno.env.get('CIRCLE_API_KEY')!
    const entitySecret=Deno.env.get('CIRCLE_ENTITY_SECRET')!
    const SB_URL=Deno.env.get('SUPABASE_URL')!
    const SB_KEY=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    const SAVINGS=Deno.env.get('VITE_SAVINGS_ADDRESS') ?? ''

    const pkRes=await fetch('https://api.circle.com/v1/w3s/config/entity/publicKey',{headers:{'Authorization':`Bearer ${apiKey}`}})
    const pkData=await pkRes.json() as{data?:{publicKey:string}}
    if(!pkData.data?.publicKey) return j({error:'Failed to get public key'},500)

    const ciphertext=await encryptEntitySecret(entitySecret,pkData.data.publicKey)

    const txRes=await fetch('https://api.circle.com/v1/w3s/developer/transactions/contractExecution',{
      method:'POST',
      headers:{'Authorization':`Bearer ${apiKey}`,'Content-Type':'application/json'},
      body:JSON.stringify({
        idempotencyKey:crypto.randomUUID(),
        entitySecretCiphertext:ciphertext,
        walletId,
        contractAddress,
        abiFunctionSignature,
        abiParameters:(abiParameters??[]).map(String),
        feeLevel:'MEDIUM'
      })
    })
    const txData=await txRes.json() as{data?:{id:string};message?:string;errors?:unknown[]}
    if(!txData.data?.id) return j({error:txData.message??'No txId',detail:txData},400)

    const txId = txData.data.id

    // Write tx_history record for save/withdraw actions
    const meta = txMeta(abiFunctionSignature, abiParameters ?? [], contractAddress, SAVINGS)
    if (meta) {
      // For withdraw, read the savings balance onchain before it's zeroed
      let amount = meta.amount
      if (amount === '__FETCH__') {
        try {
          const RPC = 'https://rpc.testnet.arc.io'
          // KasaSavings.balances(address) — selector keccak256("balances(address)")[0:4]
          // selector = 0x27e235e3
          const walletRes = await fetch(`https://api.circle.com/v1/w3s/wallets/${walletId}`, {
            headers: { 'Authorization': `Bearer ${apiKey}` }
          })
          const walletData = await walletRes.json() as { data?: { wallet?: { address?: string } } }
          const addr = walletData.data?.wallet?.address ?? ''
          if (addr) {
            const paddedAddr = addr.toLowerCase().replace('0x','').padStart(64,'0')
            const rpcRes = await fetch(RPC, {
              method: 'POST', headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ jsonrpc:'2.0', id:1, method:'eth_call', params:[{ to: contractAddress, data: '0x27e235e3' + paddedAddr }, 'latest'] })
            })
            const rpcData = await rpcRes.json() as { result?: string }
            if (rpcData.result && rpcData.result !== '0x') {
              amount = (BigInt(rpcData.result) / BigInt(1e6)).toString() + '.00'
            }
          }
        } catch { amount = '?' }
      }
      await fetch(`${SB_URL}/rest/v1/tx_history`, {
        method: 'POST',
        headers: { 'apikey': SB_KEY, 'Authorization': `Bearer ${SB_KEY}`, 'Content-Type': 'application/json', 'Prefer': 'resolution=merge-duplicates' },
        body: JSON.stringify({ wallet_id: walletId, tx_hash: txId, direction: meta.direction, amount, counterparty: meta.counterparty, memo: '', label: meta.label, timestamp: Date.now() })
      })
    }

    // Return immediately — frontend polls /tx-status
    return j({txId,pending:true})
  }catch(err){
    return j({error:err instanceof Error?err.message:'Server error'},500)
  }
})
