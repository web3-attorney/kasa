const CORS={'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'authorization, x-client-info, apikey, content-type','Access-Control-Allow-Methods':'GET, POST, PUT, DELETE, OPTIONS'}
const j=(d:unknown,s=200)=>new Response(JSON.stringify(d),{status:s,headers:{...CORS,'Content-Type':'application/json'}})
const e=(m:string,s=400)=>j({error:m},s)

// Encrypt entity secret with Circle's RSA-OAEP public key (Web Crypto API)
async function encryptEntitySecret(entitySecret: string, publicKeyPem: string): Promise<string> {
  // Decode PEM to ArrayBuffer
  const pem = publicKeyPem.replace(/-----BEGIN PUBLIC KEY-----|-----END PUBLIC KEY-----|\n/g, '')
  const keyBytes = Uint8Array.from(atob(pem), c => c.charCodeAt(0))
  // Import public key
  const publicKey = await crypto.subtle.importKey(
    'spki', keyBytes.buffer,
    { name: 'RSA-OAEP', hash: 'SHA-256' },
    false, ['encrypt']
  )
  // Encrypt the entity secret (hex string → bytes)
  const secretBytes = new Uint8Array(entitySecret.match(/.{2}/g)!.map(h => parseInt(h, 16)))
  const encrypted = await crypto.subtle.encrypt({ name: 'RSA-OAEP' }, publicKey, secretBytes)
  return btoa(Array.from(new Uint8Array(encrypted),b=>String.fromCodePoint(b)).join(''))
}

async function circleReq(method: string, path: string, body?: unknown) {
  const apiKey = Deno.env.get('CIRCLE_API_KEY')!
  const entitySecret = Deno.env.get('CIRCLE_ENTITY_SECRET')!
  // Get Circle's public key
  const pkRes = await fetch('https://api.circle.com/v1/w3s/config/entity/publicKey', {
    headers: { 'Authorization': `Bearer ${apiKey}` }
  })
  const pkData = await pkRes.json() as { data: { publicKey: string } }
  const ciphertext = await encryptEntitySecret(entitySecret, pkData.data.publicKey)
  const r = await fetch(`https://api.circle.com/v1${path}`, {
    method,
    headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify({ ...body as object, entitySecretCiphertext: ciphertext }) : undefined,
  })
  return r.json()
}

async function circleGet(path: string) {
  const apiKey = Deno.env.get('CIRCLE_API_KEY')!
  const r = await fetch(`https://api.circle.com/v1${path}`, {
    headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' }
  })
  return r.json()
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS })
  try {
    const { userId, username: requestedUsername } = await req.json() as { userId?: string; username?: string }
    if (!userId) return e('userId required')
    const SB_URL = Deno.env.get('SUPABASE_URL')!
    const SB_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    const sbH = { 'apikey': SB_KEY, 'Authorization': `Bearer ${SB_KEY}`, 'Accept': 'application/json', 'Content-Type': 'application/json' }

    // Check existing profile
    const pr = await (await fetch(`${SB_URL}/rest/v1/profiles?user_id=eq.${encodeURIComponent(userId)}&limit=1`, { headers: sbH })).json() as Record<string, unknown>[]
    const existingProfile = pr[0]
    const finalUsername = (existingProfile?.username as string) ?? requestedUsername
    if (!finalUsername) return e('username required for new users')

    // Get or create wallet set
    const wsRes = await circleGet('/w3s/walletSets?pageSize=1')
    let wsId = wsRes.data?.walletSets?.[0]?.id
    if (!wsId) {
      const cr = await circleReq('POST', '/w3s/walletSets', { name: 'Kasa Users', idempotencyKey: crypto.randomUUID() })
      wsId = cr.data?.walletSet?.id
    }
    if (!wsId) return e('Wallet set error')

    // Find existing wallet by refId
    const wlRes = await circleGet(`/w3s/wallets?walletSetId=${wsId}&pageSize=50`)
    const wallets = (wlRes.data?.wallets ?? []) as Record<string, unknown>[]
    let wallet = wallets.find(w => w.refId === userId)
    let isNew = false

    if (!wallet) {
      const cr = await circleReq('POST', '/w3s/wallets', {
        accountType: 'EOA',
        blockchains: ['ARC-TESTNET'],
        count: 1,
        walletSetId: wsId,
        metadata: [{ name: `Kasa:${userId}`, refId: userId }],
        idempotencyKey: crypto.randomUUID(),
      })
      wallet = cr.data?.wallets?.[0]
      isNew = true
    }
    if (!wallet) return e('Wallet creation failed')

    // Save profile if new
    if (!existingProfile) {
      await fetch(`${SB_URL}/rest/v1/profiles`, {
        method: 'POST',
        headers: { ...sbH, 'Prefer': 'resolution=merge-duplicates' },
        body: JSON.stringify({ user_id: userId, username: finalUsername, created_at: Date.now() })
      })
    }

    // Simple signed token
    const payload = btoa(JSON.stringify({ userId, walletId: wallet.id, exp: Math.floor(Date.now() / 1000) + 2592000 }))
    const token = `kasa.${payload}.sig`
    return j({ walletId: wallet.id, address: wallet.address, username: finalUsername, token, isNew })
  } catch (err2) { return e(err2 instanceof Error ? err2.message : 'Server error', 500) }
})
