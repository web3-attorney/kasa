import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { corsResponse, json, err } from '../_shared/cors.ts'

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return corsResponse()
  const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
  const url = new URL(req.url)

  try {
    if (req.method === 'GET') {
      const walletId = url.searchParams.get('walletId')
      if (!walletId) return err('walletId required')
      const { data } = await sb.from('spend_limits').select('*').eq('wallet_id', walletId).single()
      if (!data) return json({ dailyLimitUsdc: 0, spentToday: 0, resetAt: Date.now() + 86400_000 })
      // Auto-reset if day rolled over
      if (Date.now() > data.reset_at) {
        await sb.from('spend_limits').update({ spent_today: 0, reset_at: Date.now() + 86400_000 }).eq('wallet_id', walletId)
        return json({ dailyLimitUsdc: data.daily_limit_usdc, spentToday: 0, resetAt: Date.now() + 86400_000 })
      }
      return json({ dailyLimitUsdc: data.daily_limit_usdc, spentToday: data.spent_today, resetAt: data.reset_at })
    }

    if (req.method === 'POST') {
      const { walletId, dailyLimitUsdc } = await req.json() as { walletId?: string; dailyLimitUsdc?: number }
      if (!walletId || dailyLimitUsdc === undefined) return err('missing fields')
      await sb.from('spend_limits').upsert({
        wallet_id: walletId, daily_limit_usdc: dailyLimitUsdc,
        spent_today: 0, reset_at: Date.now() + 86400_000,
      }, { onConflict: 'wallet_id' })
      return json({ ok: true })
    }

    return err('Method not allowed', 405)
  } catch (e) { return err(e instanceof Error ? e.message : 'Failed', 500) }
})
