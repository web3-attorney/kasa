const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS'
}
const j = (d: unknown, s = 200) => new Response(JSON.stringify(d), { status: s, headers: { ...CORS, 'Content-Type': 'application/json' } })
const e = (m: string, s = 400) => j({ error: m }, s)

const REGISTRY = '0x6a86b61cb3205b8d017186b8ecc9629641c6dd21'
const ARC_RPC = 'https://rpc.testnet.arc.io'

// RSA-OAEP SHA-256 encryption matching Circle SDK exactly
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

async function circlePost(apiKey: string, cipher: string, path: string, body: Record<string, unknown>) {
  const r = await fetch(`https://api.circle.com/v1${path}`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...body, entitySecretCiphertext: cipher })
  })
  return r.json()
}

// ABI-encode a string argument for eth_call
function encodeStringCall(selector: string, str: string): string {
  const enc = new TextEncoder().encode(str)
  const len = enc.length
  // selector (4 bytes) + offset (32) + length (32) + data (padded to 32)
  const padded = Math.ceil(len / 32) * 32
  const buf = new Uint8Array(4 + 32 + 32 + padded)
  // selector
  const selBytes = selector.match(/.{2}/g)!.map(h => parseInt(h, 16))
  buf.set(selBytes, 0)
  // offset = 32 (big-endian in last byte of the 32-byte slot)
  buf[35] = 32
  // length
  const lenHex = len.toString(16).padStart(64, '0')
  const lenBytes = lenHex.match(/.{2}/g)!.map(h => parseInt(h, 16))
  buf.set(lenBytes, 36)
  // data
  buf.set(enc, 68)
  return '0x' + Array.from(buf).map(b => b.toString(16).padStart(2, '0')).join('')
}

// keccak256 of a string in pure JS (used for username hash)
// We use the Ethereum JSON-RPC instead since we can't import keccak in Deno without esm.sh
async function rpcCall(method: string, params: unknown[]) {
  const r = await fetch(ARC_RPC, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params })
  })
  return (await r.json() as { result: string }).result
}

// Commit-reveal username registration via Circle contract calls
async function registerUsernameOnchain(
  apiKey: string, cipher: string, walletId: string, walletAddress: string, username: string
): Promise<void> {
  // Generate salt (32 random bytes)
  const saltBytes = crypto.getRandomValues(new Uint8Array(32))
  const salt = '0x' + Array.from(saltBytes, b => b.toString(16).padStart(2, '0')).join('')

  // Compute commitment = keccak256(abi.encodePacked(username, salt))
  // We do this via eth_call to a precompile-free approach: use eth_call with keccak256 opcode via a static call
  // Simpler: pack username bytes + salt bytes and call keccak256 via RPC
  const usernameBytes = Array.from(new TextEncoder().encode(username)).map(b => b.toString(16).padStart(2, '0')).join('')
  const saltHex = salt.slice(2)
  // abi.encodePacked(string, bytes32) = raw string bytes + salt bytes (no padding)
  const packed = usernameBytes + saltHex
  const commitment = await rpcCall('eth_call', [{
    to: '0x0000000000000000000000000000000000000000',
    data: '0x' + packed  // This won't work for keccak — use a different approach
  }, 'latest']).catch(() => '')

  // Better: use the eth_sign keccak approach via a known utility
  // Actually compute keccak256 using a pure-JS implementation
  const commitmentHash = await computeKeccak256Packed(username, saltBytes)

  // Step 1: commit(bytes32 commitment)
  // selector: keccak256("commit(bytes32)")[0:4] = 0xf14fcbc8
  const commitCalldata = '0xf14fcbc8' + commitmentHash.slice(2)
  const commitRes = await circlePost(apiKey, cipher, '/w3s/developer/transactions/contractExecution', {
    walletId,
    contractAddress: REGISTRY,
    callData: commitCalldata,
    feeLevel: 'MEDIUM',
    idempotencyKey: crypto.randomUUID(),
  }) as { data?: { id?: string }; message?: string }

  if (!commitRes.data?.id) {
    console.error('Commit failed:', JSON.stringify(commitRes))
    return
  }

  // Wait for commit to confirm (need at least 2 blocks)
  await new Promise(r => setTimeout(r, 8000))

  // Step 2: register(string username, bytes32 salt)
  // selector: keccak256("register(string,bytes32)")[0:4]
  const registerSel = await getSelector('register(string,bytes32)')
  const registerCalldata = encodeRegister(registerSel, username, saltBytes)

  const regRes = await circlePost(apiKey, cipher, '/w3s/developer/transactions/contractExecution', {
    walletId,
    contractAddress: REGISTRY,
    callData: registerCalldata,
    feeLevel: 'MEDIUM',
    idempotencyKey: crypto.randomUUID(),
  }) as { data?: { id?: string }; message?: string }

  if (!regRes.data?.id) {
    console.error('Register failed:', JSON.stringify(regRes))
  }
}

async function getSelector(sig: string): Promise<string> {
  // keccak256 of function signature, first 4 bytes
  const bytes = new TextEncoder().encode(sig)
  const hash = await crypto.subtle.digest('SHA-256', bytes) // SHA-256 not keccak, but let's use RPC
  // Use eth_call to a fake address just to get keccak256 — not possible without a contract
  // Use the known selectors instead
  const known: Record<string, string> = {
    'commit(bytes32)': 'f14fcbc8',
    'register(string,bytes32)': '60c7e39c',
    'resolve(string)': '461a4478',
  }
  return known[sig] ? '0x' + known[sig] : '0x00000000'
}

async function computeKeccak256Packed(username: string, salt: Uint8Array): Promise<string> {
  // abi.encodePacked(username, salt) = utf8(username) + salt
  const usernameBytes = new TextEncoder().encode(username)
  const packed = new Uint8Array(usernameBytes.length + 32)
  packed.set(usernameBytes, 0)
  packed.set(salt, usernameBytes.length)

  // Compute keccak256 via eth_call to a contract that does keccak256(data)
  // We'll use the precompile approach: call the RPC with eth_call and data hash
  // Simplest: use the RPC keccak method
  const hex = '0x' + Array.from(packed, b => b.toString(16).padStart(2, '0')).join('')
  const result = await rpcCall('eth_call', [{
    to: null,
    // keccak256 is not callable via eth_call directly
    // Use web3_sha3 which IS the keccak256 RPC method
  }, 'latest']).catch(() => '')

  // Use web3_sha3 instead
  const sha3Result = await fetch(ARC_RPC, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'web3_sha3', params: [hex] })
  }).then(r => r.json()).then((r: { result: string }) => r.result)

  return sha3Result
}

function encodeRegister(selector: string, username: string, salt: Uint8Array): string {
  // register(string username, bytes32 salt)
  // ABI encoding: selector + offset_username(32) + salt(32) + len_username(32) + username_padded
  const enc = new TextEncoder().encode(username)
  const len = enc.length
  const padded = Math.ceil(len / 32) * 32

  const buf = new Uint8Array(4 + 32 + 32 + 32 + padded)
  const selBytes = selector.slice(2).match(/.{2}/g)!.map(h => parseInt(h, 16))
  buf.set(selBytes, 0)
  // offset for string = 64 (after the selector+offset+salt = 4+32+32 = 68, but offset counts from after selector)
  buf[35] = 64  // 0x40 = 64
  // salt (32 bytes) at position 36
  buf.set(salt, 36)
  // string length at position 68
  const lenBytes = new Uint8Array(32)
  lenBytes[31] = len
  buf.set(lenBytes, 68)
  // string data at position 100
  buf.set(enc, 100)

  return '0x' + Array.from(buf, b => b.toString(16).padStart(2, '0')).join('')
}

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

    // Check existing profile
    const pr = await (await fetch(`${SB_URL}/rest/v1/profiles?user_id=eq.${encodeURIComponent(userId)}&limit=1`, { headers: sbH })).json() as Record<string, unknown>[]
    const existingProfile = pr[0]
    const finalUsername = (existingProfile?.username as string) ?? requestedUsername
    if (!finalUsername) return e('username required for new users')

    // Get Circle public key + cipher once
    const pkData = await circleGet(apiKey, '/w3s/config/entity/publicKey') as { data: { publicKey: string } }
    const cipher = await encrypt(entitySecret, pkData.data.publicKey)

    // Get or create wallet set
    const wsRes = await circleGet(apiKey, '/w3s/walletSets?pageSize=1') as { data?: { walletSets?: Array<{ id: string }> } }
    let wsId = wsRes.data?.walletSets?.[0]?.id
    if (!wsId) {
      const cr = await circlePost(apiKey, cipher, '/w3s/walletSets', { name: 'Kasa Users', idempotencyKey: crypto.randomUUID() }) as { data?: { walletSet?: { id: string } } }
      wsId = cr.data?.walletSet?.id
    }
    if (!wsId) return e('Wallet set unavailable')

    // Find existing wallet by refId
    const wlRes = await circleGet(apiKey, `/w3s/wallets?walletSetId=${wsId}&pageSize=50`) as { data?: { wallets?: Array<Record<string, unknown>> } }
    const wallets = wlRes.data?.wallets ?? []
    let wallet = wallets.find(w => w.refId === userId)
    const isNew = !wallet && !existingProfile

    if (!wallet) {
      const cr = await circlePost(apiKey, cipher, '/w3s/developer/wallets', {
        accountType: 'EOA',
        blockchains: ['ARC-TESTNET'],
        count: 1,
        walletSetId: wsId,
        metadata: [{ name: `Kasa:${userId}`, refId: userId }],
        idempotencyKey: crypto.randomUUID(),
      }) as { data?: { wallets?: Array<Record<string, unknown>> }; message?: string; code?: number }
      wallet = cr.data?.wallets?.[0]
      if (!wallet) return e(`Wallet creation failed: ${cr.message ?? 'unknown'}`)
    }

    // Save profile
    if (!existingProfile) {
      await fetch(`${SB_URL}/rest/v1/profiles`, {
        method: 'POST',
        headers: { ...sbH, 'Prefer': 'resolution=merge-duplicates' },
        body: JSON.stringify({ user_id: userId, username: finalUsername, created_at: Date.now() })
      })
    }

    // Register username onchain for new users (fire-and-forget, don't block response)
    if (isNew && wallet.address) {
      registerUsernameOnchain(apiKey, cipher, wallet.id as string, wallet.address as string, finalUsername)
        .catch(err => console.error('Username registration error:', err))
    }

    const payload = btoa(JSON.stringify({ userId, walletId: wallet.id, exp: Math.floor(Date.now() / 1000) + 2592000 }))
    const token = `kasa.${payload}.sig`
    return j({ walletId: wallet.id, address: wallet.address, username: finalUsername, token, isNew })
  } catch (err2) {
    return e(err2 instanceof Error ? err2.message : 'Server error', 500)
  }
})
