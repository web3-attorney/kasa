import { corsResponse, json } from '../_shared/cors.ts'
import { rpcCall, REGISTRY_ADDR } from '../_shared/circle.ts'

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return corsResponse()
  const url = new URL(req.url)
  const username = url.searchParams.get('username')?.toLowerCase().trim() ?? ''
  if (!username || !/^[a-z0-9_]{3,20}$/.test(username))
    return json({ available: false, reason: '3–20 chars, letters/numbers/underscore only' })
  if (!REGISTRY_ADDR) return json({ available: true })
  try {
    const nameBytes = new TextEncoder().encode(username)
    const offset = '0000000000000000000000000000000000000000000000000000000000000020'
    const len = nameBytes.length.toString(16).padStart(64,'0')
    const data32 = Array.from(nameBytes).map(b => b.toString(16).padStart(2,'0')).join('').padEnd(Math.ceil(nameBytes.length / 32) * 64, '0')
    const callData = '0xbf40fac1' + offset + len + data32
    const result = await rpcCall<string>('eth_call', [{ to: REGISTRY_ADDR, data: callData }, 'latest'])
    const addr = '0x' + result.slice(-40)
    const taken = addr !== '0x0000000000000000000000000000000000000000'
    return json({ available: !taken, reason: taken ? 'Username already taken' : undefined })
  } catch { return json({ available: true }) }
})
