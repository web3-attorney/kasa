import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { corsResponse, json, err } from '../_shared/cors.ts'

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return corsResponse()
  const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
  const url = new URL(req.url)

  try {
    // GET /contacts?walletId=...
    if (req.method === 'GET') {
      const walletId = url.searchParams.get('walletId')
      if (!walletId) return err('walletId required')
      const { data } = await sb.from('contacts').select('*').eq('wallet_id', walletId).order('created_at', { ascending: false })
      return json(data ?? [])
    }

    // POST — add contact
    if (req.method === 'POST') {
      const { walletId, name, address, memo } = await req.json() as { walletId?: string; name?: string; address?: string; memo?: string }
      if (!walletId || !name?.trim() || !address?.trim()) return err('walletId, name, address required')
      const { data, error } = await sb.from('contacts').insert({
        wallet_id: walletId, name: name.trim(), address: address.trim(), memo: memo?.trim(), created_at: Date.now(),
      }).select().single()
      if (error?.code === '23505') return err('Address already saved', 409)
      if (error) throw error
      return json(data)
    }

    // DELETE /contacts/:id
    if (req.method === 'DELETE') {
      const id = url.pathname.split('/').pop()
      const { walletId } = await req.json() as { walletId?: string }
      if (!walletId || !id) return err('walletId and id required')
      await sb.from('contacts').delete().eq('id', id).eq('wallet_id', walletId)
      return json({ ok: true })
    }

    // PUT /contacts/:id
    if (req.method === 'PUT') {
      const id = url.pathname.split('/').pop()
      const { walletId, name, memo } = await req.json() as { walletId?: string; name?: string; memo?: string }
      if (!walletId || !id) return err('walletId and id required')
      await sb.from('contacts').update({ name: name?.trim(), memo: memo?.trim() }).eq('id', id).eq('wallet_id', walletId)
      return json({ ok: true })
    }

    return err('Method not allowed', 405)
  } catch (e) { return err(e instanceof Error ? e.message : 'Failed', 500) }
})
