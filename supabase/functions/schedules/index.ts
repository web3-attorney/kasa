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
      const { data } = await sb.from('schedules').select('*').eq('wallet_id', walletId)
      return json((data ?? []).map(r => ({
        id: r.id, walletId: r.wallet_id, toAddress: r.to_address, amount: r.amount,
        label: r.label, intervalMs: r.interval_ms, nextRun: r.next_run,
        lastRun: r.last_run, active: r.active, txHashes: r.tx_hashes,
      })))
    }

    if (req.method === 'POST') {
      const { walletId, toAddress, amount, label, intervalMs } = await req.json() as {
        walletId?: string; toAddress?: string; amount?: string; label?: string; intervalMs?: number
      }
      if (!walletId || !toAddress || !amount || !intervalMs) return err('missing fields')
      if (intervalMs < 3_600_000) return err('Minimum interval is 1 hour')
      const id = crypto.randomUUID().replace(/-/g,'').slice(0,12)
      const s = { id, wallet_id: walletId, to_address: toAddress, amount, label: label ?? '', interval_ms: intervalMs, next_run: Date.now() + intervalMs, last_run: null, active: true, tx_hashes: [] }
      await sb.from('schedules').insert(s)
      return json({ id, walletId, toAddress, amount, label: label ?? '', intervalMs, nextRun: s.next_run, lastRun: null, active: true, txHashes: [] })
    }

    if (req.method === 'DELETE') {
      const id = url.pathname.split('/').pop()
      if (!id) return err('id required')
      await sb.from('schedules').delete().eq('id', id)
      return json({ ok: true })
    }

    return err('Method not allowed', 405)
  } catch (e) { return err(e instanceof Error ? e.message : 'Failed', 500) }
})
