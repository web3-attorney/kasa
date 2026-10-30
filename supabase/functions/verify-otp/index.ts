const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
}
const j = (d: unknown, s = 200) => new Response(JSON.stringify(d), { status: s, headers: { ...CORS, 'Content-Type': 'application/json' } })
const e = (m: string, s = 400) => j({ error: m }, s)

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS })
  try {
    const { email, code } = await req.json() as { email?: string; code?: string }
    if (!email || !code) return e('email and code required')

    const SB_URL = Deno.env.get('SUPABASE_URL')!
    const SB_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

    const otpRes = await fetch(`${SB_URL}/rest/v1/otp_store?email=eq.${encodeURIComponent(email)}&limit=1`, {
      headers: { 'apikey': SB_KEY, 'Authorization': `Bearer ${SB_KEY}`, 'Accept': 'application/json' },
    })
    const rows = await otpRes.json() as Record<string, unknown>[]
    const stored = rows[0]
    if (!stored || stored['code'] !== code || Date.now() > (stored['expires'] as number))
      return e('Invalid or expired code', 401)

    await fetch(`${SB_URL}/rest/v1/otp_store?email=eq.${encodeURIComponent(email)}`, {
      method: 'DELETE',
      headers: { 'apikey': SB_KEY, 'Authorization': `Bearer ${SB_KEY}` },
    })

    const userId = btoa(email).replace(/[^a-z0-9]/gi, '').slice(0, 32)
    const profRes = await fetch(`${SB_URL}/rest/v1/profiles?user_id=eq.${encodeURIComponent(userId)}&limit=1`, {
      headers: { 'apikey': SB_KEY, 'Authorization': `Bearer ${SB_KEY}`, 'Accept': 'application/json' },
    })
    const profiles = await profRes.json() as Record<string, unknown>[]
    const profile = profiles[0]
    return j({ ok: true, userId, existingUsername: (profile?.['username'] as string) ?? null })
  } catch (e2) { return e(e2 instanceof Error ? e2.message : 'Failed', 500) }
})
