const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS'
}
const j = (d: unknown, s = 200) => new Response(JSON.stringify(d), { status: s, headers: { ...CORS, 'Content-Type': 'application/json' } })
const e = (m: string, s = 400) => j({ error: m }, s)

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

    // Get or create wallet set (uses /w3s/walletSets — no /developer/)
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

    if (!wallet) {
      // Create wallet — uses /w3s/developer/wallets
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

    const payload = btoa(JSON.stringify({ userId, walletId: wallet.id, exp: Math.floor(Date.now() / 1000) + 2592000 }))
    const token = `kasa.${payload}.sig`
    return j({ walletId: wallet.id, address: wallet.address, username: finalUsername, token, isNew: !existingProfile })
  } catch (err2) {
    return e(err2 instanceof Error ? err2.message : 'Server error', 500)
  }
})
