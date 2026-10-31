/**
 * inbound-watcher — called by the frontend on login and periodically.
 * Fetches recent incoming Circle transactions for a wallet, deduplicates
 * against tx_history, and writes new inbound records.
 *
 * POST { walletId, walletAddress }
 * Returns { found: number, new: number }
 */
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
}
const j = (d: unknown, s = 200) => new Response(JSON.stringify(d), { status: s, headers: { ...CORS, 'Content-Type': 'application/json' } })
const e = (m: string, s = 400) => j({ error: m }, s)

interface CircleTx {
  id: string
  state: string
  txHash?: string
  amounts?: string[]
  sourceAddress?: string
  destinationAddress?: string
  createDate?: string
  updateDate?: string
  tokenId?: string
  transactionType?: string
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS })
  try {
    const { walletId, walletAddress } = await req.json() as { walletId?: string; walletAddress?: string }
    if (!walletId || !walletAddress) return e('walletId and walletAddress required')

    const apiKey = Deno.env.get('CIRCLE_API_KEY')!
    const SB_URL = Deno.env.get('SUPABASE_URL')!
    const SB_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    const sbH = { 'apikey': SB_KEY, 'Authorization': `Bearer ${SB_KEY}`, 'Content-Type': 'application/json', 'Accept': 'application/json' }

    // Fetch recent transactions from Circle — filter inbound client-side
    // (Circle's API does not support ?operation=INBOUND as a query param)
    const txRes = await fetch(
      `https://api.circle.com/v1/w3s/transactions?walletIds=${walletId}&pageSize=50`,
      { headers: { 'Authorization': `Bearer ${apiKey}` } }
    )
    const txData = await txRes.json() as { data?: { transactions?: CircleTx[] } }
    const transactions = txData.data?.transactions ?? []

    // Keep only COMPLETE INBOUND transfers with a tx hash and an amount
    const completed = transactions.filter(tx =>
      tx.transactionType === 'INBOUND' &&
      tx.state === 'COMPLETE' &&
      tx.txHash &&
      (tx.amounts?.length ?? 0) > 0
    )

    if (completed.length === 0) return j({ found: 0, new: 0 })

    // Get existing tx hashes from Supabase to avoid duplicates
    const existingRes = await fetch(
      `${SB_URL}/rest/v1/tx_history?wallet_id=eq.${encodeURIComponent(walletId)}&select=tx_hash`,
      { headers: sbH }
    )
    const existing = await existingRes.json() as { tx_hash: string }[]
    const existingHashes = new Set(existing.map(r => r.tx_hash))

    // Write new inbound records
    let newCount = 0
    for (const tx of completed) {
      const hash = tx.txHash!
      if (existingHashes.has(hash)) continue

      // Parse amount — Circle returns amounts array in token units
      const rawAmount = tx.amounts?.[0] ?? '0'
      const amount = rawAmount  // already in USDC units (e.g. "5.000000")

      const timestamp = tx.updateDate ? new Date(tx.updateDate).getTime() : Date.now()
      const from = tx.sourceAddress ?? 'external'

      await fetch(`${SB_URL}/rest/v1/tx_history`, {
        method: 'POST',
        headers: { ...sbH, 'Prefer': 'resolution=merge-duplicates' },
        body: JSON.stringify({
          wallet_id: walletId,
          tx_hash: hash,
          direction: 'in',
          amount,
          counterparty: from,
          memo: 'Received',
          label: 'Received',
          timestamp,
        })
      })
      newCount++
    }

    return j({ found: completed.length, new: newCount })
  } catch (err) {
    return e(err instanceof Error ? err.message : 'Failed', 500)
  }
})
