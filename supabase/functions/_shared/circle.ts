// Circle SDK helpers for Supabase Edge Functions (Deno runtime)
// Uses the Circle REST API directly since the Node SDK won't run in Deno.

const CIRCLE_API = 'https://api.circle.com/v1/w3s'
const CIRCLE_API_KEY = Deno.env.get('CIRCLE_API_KEY')!
const CIRCLE_ENTITY_SECRET = Deno.env.get('CIRCLE_ENTITY_SECRET')!

export const USDC_ADDR = '0x3600000000000000000000000000000000000000'
export const KASA_SAVINGS_ADDR = (Deno.env.get('VITE_SAVINGS_ADDRESS') ?? '').toLowerCase()
export const REGISTRY_ADDR = Deno.env.get('VITE_REGISTRY_ADDRESS') ?? ''
export const ARC_RPC = 'https://rpc.testnet.arc.io'

// ── Entity secret ciphertext helper ───────────────────────────────────────────
// Circle requires the entity secret to be RSA-encrypted with their public key.
// For Edge Functions we use the pre-registered ciphertext stored as an env var.
export async function getEntitySecretCiphertext(): Promise<string> {
  const cached = Deno.env.get('CIRCLE_ENTITY_SECRET_CIPHERTEXT')
  if (cached) return cached
  // Fallback: fetch from Circle to get public key and encrypt
  const pkRes = await circleGet('/config/entity/publicKey')
  const publicKeyPem: string = pkRes.data?.publicKey
  if (!publicKeyPem) throw new Error('Could not fetch Circle public key')
  // Import the RSA-OAEP public key
  const pemBody = publicKeyPem.replace(/-----.*-----/g, '').replace(/\s/g, '')
  const keyBuf = Uint8Array.from(atob(pemBody), c => c.charCodeAt(0))
  const cryptoKey = await crypto.subtle.importKey('spki', keyBuf, { name: 'RSA-OAEP', hash: 'SHA-256' }, false, ['encrypt'])
  // Encrypt the entity secret (hex string → bytes)
  const secretBytes = Uint8Array.from(CIRCLE_ENTITY_SECRET.match(/.{2}/g)!.map(b => parseInt(b, 16)))
  const encrypted = await crypto.subtle.encrypt({ name: 'RSA-OAEP' }, cryptoKey, secretBytes)
  return btoa(String.fromCharCode(...new Uint8Array(encrypted)))
}

// ── Circle REST helpers ────────────────────────────────────────────────────────
async function circleReq(method: string, path: string, body?: unknown) {
  const ciphertext = await getEntitySecretCiphertext()
  const res = await fetch(`${CIRCLE_API}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${CIRCLE_API_KEY}`,
      'Content-Type': 'application/json',
      'X-Entity-Secret-Ciphertext': ciphertext,
    },
    body: body ? JSON.stringify(body) : undefined,
  })
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`Circle API ${method} ${path}: ${res.status} ${text}`)
  }
  return res.json()
}

export const circleGet  = (path: string) => circleReq('GET', path)
export const circlePost = (path: string, body: unknown) => circleReq('POST', path, body)

// ── Wallet set ────────────────────────────────────────────────────────────────
let _walletSetId: string | null = null
export async function getOrCreateWalletSet(): Promise<string> {
  if (_walletSetId) return _walletSetId
  const res = await circleGet('/developer/walletSets?pageSize=1')
  if (res.data?.walletSets?.[0]?.id) { _walletSetId = res.data.walletSets[0].id; return _walletSetId! }
  const cr = await circlePost('/developer/walletSets', { name: 'Kasa Users', idempotencyKey: 'kasa-wallet-set-v1' })
  const id = cr.data?.walletSet?.id
  if (!id) throw new Error('Wallet set creation failed')
  _walletSetId = id; return _walletSetId!
}

// ── Transaction polling helper ────────────────────────────────────────────────
export async function waitForTx(txId: string, maxTries = 20, intervalMs = 2000): Promise<{ state: string; txHash?: string }> {
  for (let i = 0; i < maxTries; i++) {
    await new Promise(r => setTimeout(r, intervalMs))
    const c = await circleGet(`/transactions/${txId}`)
    const t = c.data?.transaction
    if (t?.state === 'COMPLETE') return { state: 'COMPLETE', txHash: t.txHash }
    if (['FAILED','DENIED','CANCELLED'].includes(t?.state ?? '')) return { state: t?.state ?? 'FAILED' }
  }
  return { state: 'TIMEOUT' }
}

// ── Execute contract transaction ──────────────────────────────────────────────
export async function execContract(walletId: string, contractAddress: string, abiFunctionSignature: string, abiParameters: string[]): Promise<{ txId: string; txHash?: string }> {
  const r = await circlePost('/developer/transactions/contractExecution', {
    walletId, contractAddress, abiFunctionSignature, abiParameters,
    fee: { type: 'level', config: { feeLevel: 'MEDIUM' } },
    idempotencyKey: crypto.randomUUID(),
  })
  const txId = r.data?.id
  if (!txId) throw new Error('No txId returned')
  const result = await waitForTx(txId)
  return { txId, txHash: result.txHash }
}

// ── RPC helper ────────────────────────────────────────────────────────────────
export async function rpcCall<T>(method: string, params: unknown[]): Promise<T> {
  const r = await fetch(ARC_RPC, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
  })
  const j = await r.json() as { result: T }
  return j.result
}
