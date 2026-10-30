import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { corsResponse, json, err } from '../_shared/cors.ts'

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return corsResponse()
  try {
    const url = new URL(req.url)
    const walletId = url.searchParams.get('walletId')
    if (!walletId) return err('walletId required')
    const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
    const { data } = await sb.from('tx_history')
      .select('tx_hash,direction,amount,counterparty,memo,label,timestamp')
      .eq('wallet_id', walletId)
      .order('timestamp', { ascending: false })
      .limit(200)
    // Map snake_case to camelCase for frontend compatibility
    const rows = (data ?? []).map(r => ({
      txHash: r.tx_hash, direction: r.direction, amount: r.amount,
      counterparty: r.counterparty, memo: r.memo, label: r.label, timestamp: r.timestamp,
    }))
    return json(rows)
  } catch (e) { return err(e instanceof Error ? e.message : 'Failed', 500) }
})
