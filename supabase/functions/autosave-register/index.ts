import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { corsResponse, json, err } from '../_shared/cors.ts'

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return corsResponse()
  try {
    const { walletId, address, percent } = await req.json() as { walletId?: string; address?: string; percent?: number }
    if (!walletId || !address || percent === undefined) return err('walletId, address, percent required')
    const deactivated = percent === 0
    const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
    await sb.from('autosave_plans').upsert({
      wallet_id: walletId,
      wallet_address: address.toLowerCase(),
      savings_percent: percent,
      active: percent > 0 && !deactivated,
      user_deactivated: deactivated,
      end_time: deactivated ? 0 : undefined,
      updated_at: Date.now(),
    }, { onConflict: 'wallet_id' })
    return json({ ok: true })
  } catch (e) { return err(e instanceof Error ? e.message : 'Failed', 500) }
})
