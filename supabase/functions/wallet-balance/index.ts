import { corsResponse, json, err } from '../_shared/cors.ts'
import { rpcCall, USDC_ADDR } from '../_shared/circle.ts'

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return corsResponse()
  try {
    const url = new URL(req.url)
    const address = url.searchParams.get('address') ?? url.searchParams.get('walletId')
    if (!address) return err('address required')
    const data = '0x70a08231' + address.toLowerCase().replace('0x','').padStart(64,'0')
    const raw = BigInt(await rpcCall<string>('eth_call', [{ to: USDC_ADDR, data }, 'latest']))
    const balance = (Number(raw) / 1e6).toFixed(6).replace(/\.?0+$/, '') || '0'
    return json({ balance, tokenAddress: USDC_ADDR })
  } catch (e) { return err(e instanceof Error ? e.message : 'Server error', 500) }
})
