const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS'
}
const j = (d: unknown, s = 200) => new Response(JSON.stringify(d), { status: s, headers: { ...CORS, 'Content-Type': 'application/json' } })
const e = (m: string, s = 400) => j({ error: m }, s)

const REGISTRY = '0x6a86b61cb3205b8d017186b8ecc9629641c6dd21'
const RPC = Deno.env.get('ARC_RPC') ?? 'https://rpc.mainnet.arc.io'

// ── Keccak-256 pure TypeScript (no imports) ───────────────────────────────────
// RC: https://github.com/nicowillis/keccak in public domain
const RC: bigint[] = [
  0x0000000000000001n,0x0000000000008082n,0x800000000000808An,0x8000000080008000n,
  0x000000000000808Bn,0x0000000080000001n,0x8000000080008081n,0x8000000000008009n,
  0x000000000000008An,0x0000000000000088n,0x0000000080008009n,0x000000008000000An,
  0x000000008000808Bn,0x800000000000008Bn,0x8000000000008089n,0x8000000000008003n,
  0x8000000000008002n,0x8000000000000080n,0x000000000000800An,0x800000008000000An,
  0x8000000080008081n,0x8000000000008080n,0x0000000080000001n,0x8000000080008008n,
]
const ROTC = [1,3,6,10,15,21,28,36,45,55,2,14,27,41,56,8,25,43,62,18,39,61,20,44]
const PI = [10,7,11,17,18,3,5,16,8,21,24,4,15,23,19,13,12,2,20,14,22,9,6,1]

function rot64(v: bigint, n: number): bigint {
  return ((v << BigInt(n)) | (v >> BigInt(64 - n))) & 0xFFFFFFFFFFFFFFFFn
}

function keccakF(s: bigint[]): void {
  for (let r = 0; r < 24; r++) {
    // Theta
    const c = [0,1,2,3,4].map(i => s[i]^s[i+5]^s[i+10]^s[i+15]^s[i+20])
    const d = c.map((_, i) => c[(i+4)%5] ^ rot64(c[(i+1)%5], 1))
    for (let i = 0; i < 25; i++) s[i] ^= d[i%5]
    // Rho + Pi
    let last = s[1]; let j = 0
    for (let i = 0; i < 24; i++) { const tmp = s[PI[i]]; s[PI[i]] = rot64(last, ROTC[i]); last = tmp; j = i }
    void j
    // Chi
    for (let i = 0; i < 25; i += 5) {
      const a = s.slice(i, i+5)
      for (let k = 0; k < 5; k++) s[i+k] = a[k] ^ (~a[(k+1)%5] & a[(k+2)%5])
    }
    s[0] ^= RC[r]
  }
}

function keccak256(data: Uint8Array): string {
  const rate = 136 // 1088 bits / 8
  const padded = new Uint8Array(Math.ceil((data.length + 1) / rate) * rate)
  padded.set(data)
  padded[data.length] = 0x01
  padded[padded.length - 1] ^= 0x80
  const state: bigint[] = Array(25).fill(0n)
  for (let i = 0; i < padded.length; i += rate) {
    for (let j = 0; j < rate / 8; j++) {
      let w = 0n
      for (let k = 0; k < 8; k++) w |= BigInt(padded[i + j*8 + k]) << BigInt(k*8)
      state[j] ^= w
    }
    keccakF(state)
  }
  let hex = '0x'
  for (let i = 0; i < 4; i++) {
    const w = state[i]
    for (let k = 0; k < 8; k++) hex += ((Number((w >> BigInt(k*8)) & 0xFFn)).toString(16).padStart(2, '0'))
  }
  return hex
}

function keccak256Packed(username: string, saltHex: string): string {
  const usernameBytes = new TextEncoder().encode(username)
  const saltStripped = saltHex.replace('0x', '')
  const saltBytes = new Uint8Array(32)
  for (let i = 0; i < 32; i++) saltBytes[i] = parseInt(saltStripped.slice(i * 2, i * 2 + 2), 16)
  const packed = new Uint8Array(usernameBytes.length + 32)
  packed.set(usernameBytes, 0)
  packed.set(saltBytes, usernameBytes.length)
  return keccak256(packed)
}

// ABI encode resolve(string) calldata
function encodeResolveCall(username: string): string {
  // selector: keccak256("resolve(string)")[0:4] — precomputed
  const selector = '461a4478'
  const strBytes = new TextEncoder().encode(username)
  const offset = '0000000000000000000000000000000000000000000000000000000000000020'
  const len = strBytes.length.toString(16).padStart(64, '0')
  const dataHex = Array.from(strBytes).map(b => b.toString(16).padStart(2, '0')).join('')
  const padded = dataHex.padEnd(Math.ceil(strBytes.length / 32) * 64, '0')
  return '0x' + selector + offset + len + padded
}

function decodeAddressResult(hex: string): string {
  if (!hex || hex === '0x') return '0x0000000000000000000000000000000000000000'
  return '0x' + hex.slice(-40)
}

// ── RPC + Circle helpers ──────────────────────────────────────────────────────
async function rpcCall(method: string, params: unknown[]) {
  const r = await fetch(RPC, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params })
  })
  const d = await r.json() as { result?: string }
  return d.result
}

async function encrypt(entitySecret: string, publicKeyPem: string): Promise<string> {
  const pem = publicKeyPem.replace(/-----BEGIN PUBLIC KEY-----|-----END PUBLIC KEY-----|\s+/g, '')
  const t = atob(pem)
  const kb = new Uint8Array(t.length)
  for (let i = 0; i < t.length; i++) kb[i] = t.codePointAt(i) as number
  const key = await crypto.subtle.importKey('spki', kb.buffer, { name: 'RSA-OAEP', hash: 'SHA-256' }, false, ['encrypt'])
  const hex = entitySecret.trim().replace(/\s+/g, '')
  const sb = new Uint8Array(hex.length / 2)
  for (let i = 0; i < hex.length; i += 2) sb[i / 2] = parseInt(hex.slice(i, i + 2), 16)
  const enc = await crypto.subtle.encrypt({ name: 'RSA-OAEP' }, key, sb)
  return btoa(Array.from(new Uint8Array(enc), b => String.fromCodePoint(b)).join(''))
}

async function circleGet(apiKey: string, path: string) {
  const r = await fetch(`https://api.circle.com/v1${path}`, { headers: { 'Authorization': `Bearer ${apiKey}` } })
  return r.json()
}

// Always re-encrypt to get a fresh ciphertext — Circle rejects reused ciphertexts
async function circlePost(apiKey: string, entitySecret: string, pem: string, path: string, body: Record<string, unknown>) {
  const cipher = await encrypt(entitySecret, pem)
  const r = await fetch(`https://api.circle.com/v1${path}`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...body, entitySecretCiphertext: cipher })
  })
  return r.json()
}

async function waitForTx(txId: string, apiKey: string, maxWait = 60000): Promise<boolean> {
  const start = Date.now()
  while (Date.now() - start < maxWait) {
    await new Promise(r => setTimeout(r, 3000))
    const res = await circleGet(apiKey, `/w3s/transactions/${txId}`) as { data?: { transaction?: { state?: string } } }
    const state = res.data?.transaction?.state
    if (state === 'COMPLETE') return true
    if (state === 'FAILED' || state === 'CANCELLED') return false
  }
  return false
}

async function registerUsernameOnchain(
  walletId: string, username: string, apiKey: string, entitySecret: string
): Promise<void> {
  const pkData = await circleGet(apiKey, '/w3s/config/entity/publicKey') as { data: { publicKey: string } }
  const pubKeyPem = pkData.data.publicKey

  const saltBytes = new Uint8Array(32)
  crypto.getRandomValues(saltBytes)
  const saltHex = '0x' + Array.from(saltBytes).map(b => b.toString(16).padStart(2, '0')).join('')

  const commitment = keccak256Packed(username, saltHex)
  console.log('Registering', username, 'commitment:', commitment)

  const commitRes = await circlePost(apiKey, entitySecret, pubKeyPem, '/w3s/developer/transactions/contractExecution', {
    idempotencyKey: crypto.randomUUID(),
    walletId,
    contractAddress: REGISTRY,
    abiFunctionSignature: 'commit(bytes32)',
    abiParameters: [commitment],
    feeLevel: 'MEDIUM',
  }) as { data?: { id?: string }; message?: string }

  const commitTxId = commitRes.data?.id
  if (!commitTxId) { console.error('Commit failed:', JSON.stringify(commitRes).slice(0, 300)); return }
  console.log('Commit tx:', commitTxId)

  const committed = await waitForTx(commitTxId, apiKey, 45000)
  if (!committed) { console.error('Commit did not confirm'); return }
  await new Promise(r => setTimeout(r, 6000)) // wait 2+ blocks

  const registerRes = await circlePost(apiKey, entitySecret, pubKeyPem, '/w3s/developer/transactions/contractExecution', {
    idempotencyKey: crypto.randomUUID(),
    walletId,
    contractAddress: REGISTRY,
    abiFunctionSignature: 'register(string,bytes32)',
    abiParameters: [username, saltHex],
    feeLevel: 'MEDIUM',
  }) as { data?: { id?: string }; message?: string }

  const registerTxId = registerRes.data?.id
  if (!registerTxId) { console.error('Register failed:', JSON.stringify(registerRes).slice(0, 300)); return }
  console.log('Register tx:', registerTxId)
}

// ── Main handler ─────────────────────────────────────────────────────────────
Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS })
  try {
    const { userId, username: requestedUsername } = await req.json() as { userId?: string; username?: string }
    if (!userId) return e('userId required')

    const apiKey = Deno.env.get('CIRCLE_API_KEY')!
    const entitySecret = Deno.env.get('CIRCLE_ENTITY_SECRET')!
    const SB_URL = Deno.env.get('SUPABASE_URL')!
    const SB_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    const sbH = { 'apikey': SB_KEY, 'Authorization': `Bearer ${SB_KEY}`, 'Accept': 'application/json', 'Content-Type': 'application/json' }

    const pr = await (await fetch(`${SB_URL}/rest/v1/profiles?user_id=eq.${encodeURIComponent(userId)}&limit=1`, { headers: sbH })).json() as Record<string, unknown>[]
    const existingProfile = pr[0]
    const finalUsername = (existingProfile?.username as string) ?? requestedUsername
    if (!finalUsername) return e('username required for new users')

    const pkData = await circleGet(apiKey, '/w3s/config/entity/publicKey') as { data: { publicKey: string } }
    const pem = pkData.data.publicKey

    const wsRes = await circleGet(apiKey, '/w3s/walletSets?pageSize=1') as { data?: { walletSets?: Array<{ id: string }> } }
    let wsId = wsRes.data?.walletSets?.[0]?.id
    if (!wsId) {
      const cr = await circlePost(apiKey, entitySecret, pem, '/w3s/walletSets', { name: 'Kasa Users', idempotencyKey: crypto.randomUUID() }) as { data?: { walletSet?: { id: string } } }
      wsId = cr.data?.walletSet?.id
    }
    if (!wsId) return e('Wallet set unavailable')

    const wlRes = await circleGet(apiKey, `/w3s/wallets?walletSetId=${wsId}&pageSize=50`) as { data?: { wallets?: Array<Record<string, unknown>> } }
    const wallets = wlRes.data?.wallets ?? []
    let wallet = wallets.find(w => w.refId === userId)
    const isNew = !wallet

    if (!wallet) {
      const cr = await circlePost(apiKey, entitySecret, pem, '/w3s/developer/wallets', {
        accountType: 'EOA', blockchains: [Deno.env.get('ARC_BLOCKCHAIN') ?? 'ARC-MAINNET'], count: 1, walletSetId: wsId,
        metadata: [{ name: `Kasa:${userId}`, refId: userId }],
        idempotencyKey: crypto.randomUUID(),
      }) as { data?: { wallets?: Array<Record<string, unknown>> }; message?: string }
      wallet = cr.data?.wallets?.[0]
      if (!wallet) return e(`Wallet creation failed: ${cr.message ?? 'unknown'}`)
    }

    if (!existingProfile) {
      await fetch(`${SB_URL}/rest/v1/profiles`, {
        method: 'POST',
        headers: { ...sbH, 'Prefer': 'resolution=merge-duplicates' },
        body: JSON.stringify({ user_id: userId, username: finalUsername, created_at: Date.now() })
      })
    }

    // Fund new wallets with 1 USDC from dev wallet so they can pay gas
    if (isNew) {
      const devWalletId = Deno.env.get('DEV_WALLET_ID')
      if (devWalletId) {
        const fundRes = await circlePost(apiKey, entitySecret, pem, '/w3s/developer/transactions/transfer', {
          idempotencyKey: crypto.randomUUID(),
          sourceWalletId: devWalletId,
          destinationAddress: wallet.address as string,
          amounts: ['1'],
          tokenAddress: '0x3600000000000000000000000000000000000000',
          blockchain: Deno.env.get('ARC_BLOCKCHAIN') ?? 'ARC-MAINNET',
          feeLevel: 'MEDIUM',
        }) as { data?: { id?: string }; message?: string }
        console.log('Fund tx:', fundRes.data?.id ?? fundRes.message)
        // Wait for fund to confirm before registering username
        if (fundRes.data?.id) {
          await waitForTx(fundRes.data.id, apiKey, 60000)
          await new Promise(r => setTimeout(r, 3000))
        }
      }
    }

    // Check onchain registration, register if not yet done
    const callData = encodeResolveCall(finalUsername)
    const onchainResult = await rpcCall('eth_call', [{ to: REGISTRY, data: callData }, 'latest'])
    const registeredAddr = decodeAddressResult(onchainResult ?? '')
    const ZERO = '0x' + '0'.repeat(40)

    if (registeredAddr.toLowerCase() === ZERO) {
      console.log(finalUsername, 'not registered — starting commit-reveal')
      // Call register-username function synchronously for new users (they're waiting anyway)
      const SB_URL = Deno.env.get('SUPABASE_URL')!
      fetch(`${SB_URL}/functions/v1/register-username`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!}` },
        body: JSON.stringify({ walletId: wallet.id, username: finalUsername })
      }).then(r => r.json()).then(d => console.log('register-username result:', JSON.stringify(d).slice(0,100)))
        .catch(err => console.error('register-username error:', err))
    } else {
      console.log(finalUsername, 'already registered at', registeredAddr)
    }

    const payload = btoa(JSON.stringify({ userId, walletId: wallet.id, exp: Math.floor(Date.now() / 1000) + 2592000 }))
    const token = `kasa.${payload}.sig`
    return j({ walletId: wallet.id, address: wallet.address, username: finalUsername, token, isNew })
  } catch (err2) {
    return e(err2 instanceof Error ? err2.message : 'Server error', 500)
  }
})
