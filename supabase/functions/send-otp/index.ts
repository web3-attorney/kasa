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
    const { email } = await req.json() as { email?: string }
    if (!email) return e('email required')

    const code = String(Math.floor(100000 + Math.random() * 900000))
    const expires = Date.now() + 10 * 60 * 1000
    const SB_URL = Deno.env.get('SUPABASE_URL')!
    const SB_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

    await fetch(`${SB_URL}/rest/v1/otp_store`, {
      method: 'POST',
      headers: { 'apikey': SB_KEY, 'Authorization': `Bearer ${SB_KEY}`, 'Content-Type': 'application/json', 'Prefer': 'resolution=merge-duplicates' },
      body: JSON.stringify({ email, code, expires }),
    })

    const r = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${Deno.env.get('RESEND_API_KEY')}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: 'Kasa <noreply@mail.rovapay.xyz>',
        to: [email],
        subject: 'Your Kasa sign-in code',
        html: `<p style="font-family:sans-serif;font-size:16px">Your Kasa code:</p><p style="font-family:monospace;font-size:36px;font-weight:bold;letter-spacing:10px;color:#000">${code}</p><p style="color:#888;font-size:13px">Expires in 10 min.</p>`,
      }),
    })
    if (!r.ok) throw new Error(`Resend: ${await r.text()}`)
    return j({ ok: true })
  } catch (e2) { return e(e2 instanceof Error ? e2.message : 'Failed', 500) }
})
