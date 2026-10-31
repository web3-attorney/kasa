const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS'
}
const j = (d: unknown, s = 200) => new Response(JSON.stringify(d), { status: s, headers: { ...CORS, 'Content-Type': 'application/json' } })
const e = (m: string, s = 400) => j({ error: m }, s)

const REGISTRY = '0x6a86b61cb3205b8d017186b8ecc9629641c6dd21'
const RPC = 'https://rpc.testnet.arc.io'

// ── Keccak-256 pure TypeScript ────────────────────────────────────────────────
const RC = [
  0x0000000000000001n,0x0000000000008082n,0x800000000000808An,0x8000000080008000n,
  0x000000000000808Bn,0x0000000080000001n,0x8000000080008081n,0x8000000000008009n,
  0x000000000000008An,0x0000000000000088n,0x0000000080008009n,0x000000008000000An,
  0x000000008000808Bn,0x800000000000008Bn,0x8000000000008089n,0x8000000000008003n,
  0x8000000000008002n,0x8000000000000080n,0x000000000000800An,0x800000008000000An,
  0x8000000080008081n,0x8000000000008080n,0x0000000080000001n,0x8000000080008008n,
]
const ROTC = [1,3,6,10,15,21,28,36,45,55,2,14,27,41,56,8,25,43,62,18,39,61,20,44]
const PI = [10,7,11,17,18,3,5,16,8,21,24,4,15,23,19,13,12,2,20,14,22,9,6,1]
function rot64(v: bigint, n: number): bigint { return ((v << BigInt(n)) | (v >> BigInt(64-n))) & 0xFFFFFFFFFFFFFFFFn }
function keccakF(s: bigint[]): void {
  for (let r = 0; r < 24; r++) {
    const c = [0,1,2,3,4].map(i => s[i]^s[i+5]^s[i+10]^s[i+15]^s[i+20])
    const d = c.map((_,i) => c[(i+4)%5] ^ rot64(c[(i+1)%5],1))
    for (let i = 0; i < 25; i++) s[i] ^= d[i%5]
    let last = s[1]
    for (let i = 0; i < 24; i++) { const tmp = s[PI[i]]; s[PI[i]] = rot64(last,ROTC[i]); last = tmp }
    for (let i = 0; i < 25; i += 5) {
      const a = s.slice(i,i+5)
      for (let k = 0; k < 5; k++) s[i+k] = a[k] ^ (~a[(k+1)%5] & a[(k+2)%5])
    }
    s[0] ^= RC[r]
  }
}
function keccak256(data: Uint8Array): string {
  const rate = 136
  const padded = new Uint8Array(Math.ceil((data.length+1)/rate)*rate)
  padded.set(data); padded[data.length]=0x01; padded[padded.length-1]^=0x80
  const state: bigint[] = Array(25).fill(0n)
  for (let i = 0; i < padded.length; i += rate) {
    for (let j = 0; j < rate/8; j++) {
      let w = 0n
      for (let k = 0; k < 8; k++) w |= BigInt(padded[i+j*8+k]) << BigInt(k*8)
      state[j] ^= w
    }
    keccakF(state)
  }
  let hex = '0x'
  for (let i = 0; i < 4; i++) {
    const w = state[i]
    for (let k = 0; k < 8; k++) hex += (Number((w >> BigInt(k*8)) & 0xFFn)).toString(16).padStart(2,'0')
  }
  return hex
}
function keccak256Packed(username: string, saltHex: string): string {
  const ub = new TextEncoder().encode(username)
  const sb = new Uint8Array(32)
  const s = saltHex.replace('0x','')
  for (let i = 0; i < 32; i++) sb[i] = parseInt(s.slice(i*2,i*2+2),16)
  const p = new Uint8Array(ub.length+32); p.set(ub); p.set(sb,ub.length)
  return keccak256(p)
}

function encodeResolveCall(username: string): string {
  // ABI encode: resolve(string) — selector + offset(32) + length + data padded to 32 bytes
  const ub = new TextEncoder().encode(username)
  const offset = '0000000000000000000000000000000000000000000000000000000000000020'
  const len = ub.length.toString(16).padStart(64, '0')
  const dataHex = Array.from(ub).map(b => b.toString(16).padStart(2, '0')).join('')
  const dataPadded = dataHex.padEnd(Math.ceil(ub.length / 32) * 64, '0')
  return '0x461a4478' + offset + len + dataPadded
}

async function rpcCall(method: string, params: unknown[]) {
  const r = await fetch(RPC,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:1,method,params})})
  const d = await r.json() as {result?:string}; return d.result
}
async function encrypt(secret: string, pem: string): Promise<string> {
  const clean = pem.replace(/-----BEGIN PUBLIC KEY-----|-----END PUBLIC KEY-----|\s+/g,'')
  const t = atob(clean); const kb = new Uint8Array(t.length)
  for (let i = 0; i < t.length; i++) kb[i] = t.codePointAt(i) as number
  const key = await crypto.subtle.importKey('spki',kb.buffer,{name:'RSA-OAEP',hash:'SHA-256'},false,['encrypt'])
  const hex = secret.trim(); const sb = new Uint8Array(hex.length/2)
  for (let i = 0; i < hex.length; i+=2) sb[i/2] = parseInt(hex.slice(i,i+2),16)
  const enc = await crypto.subtle.encrypt({name:'RSA-OAEP'},key,sb)
  return btoa(Array.from(new Uint8Array(enc),b=>String.fromCodePoint(b)).join(''))
}
async function cGet(key: string, path: string) {
  return (await fetch(`https://api.circle.com/v1${path}`,{headers:{'Authorization':`Bearer ${key}`}})).json()
}
async function cPost(key: string, cipher: string, path: string, body: Record<string,unknown>) {
  return (await fetch(`https://api.circle.com/v1${path}`,{method:'POST',headers:{'Authorization':`Bearer ${key}`,'Content-Type':'application/json'},body:JSON.stringify({...body,entitySecretCiphertext:cipher})})).json()
}
async function waitTx(txId: string, apiKey: string): Promise<boolean> {
  const end = Date.now()+80000
  while (Date.now()<end) {
    await new Promise(r=>setTimeout(r,3000))
    const res = await cGet(apiKey,`/w3s/transactions/${txId}`) as {data?:{transaction?:{state?:string}}}
    const st = res.data?.transaction?.state
    if (st==='COMPLETE') return true
    if (st==='FAILED'||st==='CANCELLED') return false
  }
  return false
}

Deno.serve(async (req) => {
  if (req.method==='OPTIONS') return new Response(null,{status:204,headers:CORS})
  try {
    const {walletId, username} = await req.json() as {walletId?:string;username?:string}
    if (!walletId||!username) return e('walletId and username required')

    const apiKey = Deno.env.get('CIRCLE_API_KEY')!
    const entitySecret = Deno.env.get('CIRCLE_ENTITY_SECRET')!

    // Check if already registered
    const callData = encodeResolveCall(username)
    const onchain = await rpcCall('eth_call',[{to:REGISTRY,data:callData},'latest'])
    const addr = onchain ? '0x'+(onchain as string).slice(-40) : '0x'+'0'.repeat(40)
    const ZERO = '0x'+'0'.repeat(40)
    if (addr.toLowerCase() !== ZERO) return j({ok:true,already:true,address:addr})

    // Get public key once — re-encrypt fresh cipher for every Circle API call
    const pk = await cGet(apiKey,'/w3s/config/entity/publicKey') as {data:{publicKey:string}}
    const pem = pk.data.publicKey

    // Random salt
    const saltArr = new Uint8Array(32); crypto.getRandomValues(saltArr)
    const saltHex = '0x'+Array.from(saltArr).map(b=>b.toString(16).padStart(2,'0')).join('')
    const commitment = keccak256Packed(username,saltHex)

    // Commit tx — fresh cipher
    const cr = await cPost(apiKey, await encrypt(entitySecret,pem), '/w3s/developer/transactions/contractExecution',{
      idempotencyKey: crypto.randomUUID(), walletId,
      contractAddress: REGISTRY,
      abiFunctionSignature: 'commit(bytes32)',
      abiParameters: [commitment],
      feeLevel: 'MEDIUM',
    }) as {data?:{id?:string};message?:string}
    const commitTxId = cr.data?.id
    if (!commitTxId) return e('Commit failed: '+(cr.message??'unknown'))

    const committed = await waitTx(commitTxId, apiKey)
    if (!committed) return e('Commit tx did not confirm')

    // Wait 2+ blocks
    await new Promise(r=>setTimeout(r,6000))

    // Register tx — fresh cipher
    const rr = await cPost(apiKey, await encrypt(entitySecret,pem), '/w3s/developer/transactions/contractExecution',{
      idempotencyKey: crypto.randomUUID(), walletId,
      contractAddress: REGISTRY,
      abiFunctionSignature: 'register(string,bytes32)',
      abiParameters: [username, saltHex],
      feeLevel: 'MEDIUM',
    }) as {data?:{id?:string};message?:string}
    const registerTxId = rr.data?.id
    if (!registerTxId) return e('Register failed: '+(rr.message??'unknown'))

    const registered = await waitTx(registerTxId, apiKey)
    return j({ok:registered, commitTxId, registerTxId})
  } catch(err) {
    return e(err instanceof Error ? err.message : 'Server error', 500)
  }
})
