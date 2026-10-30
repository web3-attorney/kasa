import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { corsResponse, json, err } from '../_shared/cors.ts'

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return corsResponse()
  try {
    const { email } = await req.json() as { email?: string }
    if (!email) return err('email required')

    const code = String(Math.floor(100000 + Math.random() * 900000))
    const expires = Date.now() + 10 * 60 * 1000

    const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
    await sb.from('otp_store').upsert({ email, code, expires })

    const r = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${Deno.env.get('RESEND_API_KEY')}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: 'Kasa <onboarding@resend.dev>',
        to: [email],
        subject: 'Your Kasa sign-in code',
        html: `<p style="font-family:sans-serif;font-size:16px">Your Kasa code:</p><p style="font-family:monospace;font-size:36px;font-weight:bold;letter-spacing:10px;color:#000">${code}</p><p style="color:#888;font-size:13px">Expires in 10 min.</p>`,
      }),
    })
    if (!r.ok) throw new Error(`Resend: ${await r.text()}`)
    return json({ ok: true })
  } catch (e) { return err(e instanceof Error ? e.message : 'Failed', 500) }
})
