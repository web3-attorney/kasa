import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { corsResponse, json, err } from '../_shared/cors.ts'
import { USDC_ADDR, circlePost, waitForTx } from '../_shared/circle.ts'

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return corsResponse()
  try {
    const { walletId, toAddress, amount, memo } = await req.json() as { walletId?: string; toAddress?: string; amount?: string; memo?: string }
    if (!walletId || !toAddress || !amount) return err('walletId, toAddress, amount required')

    const units = BigInt(Math.round(parseFloat(amount) * 1_000_000))
    const to32  = toAddress.toLowerCase().replace('0x','').padStart(64,'0')
    const amt32 = units.toString(16).padStart(64,'0')

    const txRes = await circlePost('/developer/transactions/contractExecution', {
      walletId, contractAddress: USDC_ADDR,
      callData: `0xa9059cbb${to32}${amt32}`,
      fee: { type: 'level', config: { feeLevel: 'MEDIUM' } },
      idempotencyKey: crypto.randomUUID(),
    })
    const txId = txRes.data?.id
    if (!txId) throw new Error('No txId')
    const result = await waitForTx(txId)
    if (result.state !== 'COMPLETE') throw new Error(`Transaction ${result.state}`)

    // Record in tx_history
    const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
    await sb.from('tx_history').upsert({
      wallet_id: walletId, tx_hash: result.txHash ?? txId,
      direction: 'out', amount, counterparty: toAddress,
      memo: memo ?? '', timestamp: Date.now(),
    }, { onConflict: 'wallet_id,tx_hash' })

    return json({ txId, txHash: result.txHash })
  } catch (e) { return err(e instanceof Error ? e.message : 'Server error', 500) }
})
