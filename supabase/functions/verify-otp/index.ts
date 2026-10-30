import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { corsResponse, json, err } from '../_shared/cors.ts'

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return corsResponse()
  try {
    const { email, code } = await req.json() as { email?: string; code?: string }
    if (!email || !code) return err('email and code required')

    const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
    const { data: stored } = await sb.from('otp_store').select('*').eq('email', email).single()
    if (!stored || stored.code !== code || Date.now() > stored.expires)
      return err('Invalid or expired code', 401)

    await sb.from('otp_store').delete().eq('email', email)

    const userId = btoa(email).replace(/[^a-z0-9]/gi, '').slice(0, 32)
    const { data: profile } = await sb.from('profiles').select('username').eq('user_id', userId).single()
    return json({ ok: true, userId, existingUsername: profile?.username ?? null })
  } catch (e) { return err(e instanceof Error ? e.message : 'Failed', 500) }
})
