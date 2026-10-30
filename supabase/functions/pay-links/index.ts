import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { corsResponse, json, err } from '../_shared/cors.ts'

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return corsResponse()
  const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
  const url = new URL(req.url)

  try {
    if (req.method === 'POST') {
      const { toWalletId, toAddress, toUsername, amount, memo } = await req.json() as {
        toWalletId?: string; toAddress?: string; toUsername?: string; amount?: string; memo?: string
      }
      if (!toWalletId || !toAddress || !amount) return err('missing fields')
      const id = crypto.randomUUID().replace(/-/g,'').slice(0,14)
      await sb.from('pay_links').insert({
        id, to_wallet_id: toWalletId, to_address: toAddress, to_username: toUsername ?? '',
        amount, memo: memo ?? '', created_at: Date.now(), paid_tx_hash: null,
      })
      return json({ id, url: `/pay/${id}` })
    }

    if (req.method === 'GET') {
      const id = url.pathname.split('/').pop()
      if (!id) return err('id required')
      const { data } = await sb.from('pay_links').select('*').eq('id', id).single()
      if (!data) return err('Not found', 404)
      return json({
        id: data.id, toWalletId: data.to_wallet_id, toAddress: data.to_address,
        toUsername: data.to_username, amount: data.amount, memo: data.memo,
        createdAt: data.created_at, paidTxHash: data.paid_tx_hash,
      })
    }

    return err('Method not allowed', 405)
  } catch (e) { return err(e instanceof Error ? e.message : 'Failed', 500) }
})
