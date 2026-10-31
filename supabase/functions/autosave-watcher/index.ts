/**
 * autosave-watcher — called by pg_cron every minute AND by inbound-watcher when
 * a new inbound transfer is detected.
 *
 * Does two things:
 * 1. For each active plan whose end_time has passed → auto-withdraw
 * 2. For each active plan with a new inbound balance increase → deposit savings %
 *
 * POST {} — run now (called by inbound-watcher or pg_cron)
 * GET  ?walletId=... — legacy compat, same as POST but filtered
 */
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
}
const j = (d: unknown, s = 200) => new Response(JSON.stringify(d), { status: s, headers: { ...CORS, 'Content-Type': 'application/json' } })

const RPC = 'https://rpc.testnet.arc.io'
const USDC = '0x3600000000000000000000000000000000000000'

async function encryptEntitySecret(entitySecret: string, publicKeyPem: string): Promise<string> {
  const pem = publicKeyPem.replace(/-----BEGIN PUBLIC KEY-----|-----END PUBLIC KEY-----|\s+/g, '')
  const t = atob(pem)
  const kb = new Uint8Array(t.length)
  for (let a = 0; a < t.length; a++) kb[a] = t.codePointAt(a) as number
  const key = await crypto.subtle.importKey('spki', kb.buffer, { name: 'RSA-OAEP', hash: 'SHA-256' }, false, ['encrypt'])
  const hex = entitySecret.trim().replace(/\s+/g, '')
  const sb = new Uint8Array(hex.length / 2)
  for (let i = 0; i < hex.length; i += 2) sb[i / 2] = parseInt(hex.slice(i, i + 2), 16)
  const enc = await crypto.subtle.encrypt({ name: 'RSA-OAEP' }, key, sb)
  return btoa(Array.from(new Uint8Array(enc), b => String.fromCodePoint(b)).join(''))
}

async function rpcCall(method: string, params: unknown[]): Promise<string | undefined> {
  const r = await fetch(RPC, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params })
  })
  const d = await r.json() as { result?: string }
  return d.result
}

async function getUsdcBalance(address: string): Promise<bigint> {
  const data = '0x70a08231' + address.toLowerCase().replace('0x', '').padStart(64, '0')
  const result = await rpcCall('eth_call', [{ to: USDC, data }, 'latest'])
  if (!result || result === '0x') return 0n
  return BigInt(result)
}

async function getSavingsBalance(savingsAddr: string, userAddress: string): Promise<bigint> {
  // KasaSavings.balances(address) selector = 0x27e235e3
  const data = '0x27e235e3' + userAddress.toLowerCase().replace('0x', '').padStart(64, '0')
  const result = await rpcCall('eth_call', [{ to: savingsAddr, data }, 'latest'])
  if (!result || result === '0x') return 0n
  return BigInt(result)
}

async function circleContractCall(
  walletId: string, contractAddress: string, abiFunctionSignature: string,
  abiParameters: string[], apiKey: string, entitySecret: string
): Promise<string | null> {
  const pkRes = await fetch('https://api.circle.com/v1/w3s/config/entity/publicKey', { headers: { 'Authorization': `Bearer ${apiKey}` } })
  const pkData = await pkRes.json() as { data?: { publicKey: string } }
  if (!pkData.data?.publicKey) return null
  const ciphertext = await encryptEntitySecret(entitySecret, pkData.data.publicKey)
  const r = await fetch('https://api.circle.com/v1/w3s/developer/transactions/contractExecution', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ idempotencyKey: crypto.randomUUID(), entitySecretCiphertext: ciphertext, walletId, contractAddress, abiFunctionSignature, abiParameters, feeLevel: 'MEDIUM' })
  })
  const d = await r.json() as { data?: { id: string }; message?: string }
  if (!d.data?.id) { console.error('Circle call failed:', d.message); return null }
  return d.data.id
}

async function writeTxHistory(
  SB_URL: string, SB_KEY: string,
  walletId: string, txId: string, direction: string,
  amount: string, counterparty: string, memo: string, label: string
): Promise<void> {
  const sbH = { 'apikey': SB_KEY, 'Authorization': `Bearer ${SB_KEY}`, 'Content-Type': 'application/json', 'Accept': 'application/json' }
  await fetch(`${SB_URL}/rest/v1/tx_history`, {
    method: 'POST',
    headers: { ...sbH, 'Prefer': 'resolution=merge-duplicates' },
    body: JSON.stringify({ wallet_id: walletId, tx_hash: txId, direction, amount, counterparty, memo, label, timestamp: Date.now() })
  })
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS })
  try {
    const SB_URL = Deno.env.get('SUPABASE_URL')!
    const SB_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    const CIRCLE_KEY = Deno.env.get('CIRCLE_API_KEY')!
    const ENTITY_SECRET = Deno.env.get('CIRCLE_ENTITY_SECRET')!
    const SAVINGS = Deno.env.get('VITE_SAVINGS_ADDRESS')!
    const sbH = { 'apikey': SB_KEY, 'Authorization': `Bearer ${SB_KEY}`, 'Content-Type': 'application/json', 'Accept': 'application/json' }

    // Optional: filter to one walletId (when called from inbound-watcher)
    const url = new URL(req.url)
    const filterWalletId = url.searchParams.get('walletId') ?? null

    // Fetch active, non-deactivated plans
    const plansUrl = filterWalletId
      ? `${SB_URL}/rest/v1/autosave_plans?active=eq.true&user_deactivated=eq.false&wallet_id=eq.${encodeURIComponent(filterWalletId)}`
      : `${SB_URL}/rest/v1/autosave_plans?active=eq.true&user_deactivated=eq.false`

    const r = await fetch(plansUrl, { headers: sbH })
    const plans = await r.json() as {
      wallet_id: string; wallet_address: string; end_time: number;
      savings_percent: number; last_balance?: number
    }[]

    const now = Date.now()
    const results: string[] = []

    for (const plan of plans) {
      const addr = plan.wallet_address

      // ── 1. Check maturity → auto-withdraw ──────────────────────────────────
      if (plan.end_time > 0 && plan.end_time < now) {
        try {
          const savedBal = await getSavingsBalance(SAVINGS, addr)
          const savedAmt = savedBal > 0n ? (Number(savedBal) / 1e6).toFixed(2) : '0'
          const txId = await circleContractCall(plan.wallet_id, SAVINGS, 'withdraw()', [], CIRCLE_KEY, ENTITY_SECRET)
          await fetch(`${SB_URL}/rest/v1/autosave_plans?wallet_id=eq.${encodeURIComponent(plan.wallet_id)}`, {
            method: 'PATCH', headers: sbH,
            body: JSON.stringify({ active: false, user_deactivated: true, updated_at: now })
          })
          if (txId) {
            await writeTxHistory(SB_URL, SB_KEY, plan.wallet_id, txId, 'save', savedAmt, SAVINGS, 'Auto-withdraw on maturity', 'Savings Withdrawal')
          }
          results.push(`matured:${plan.wallet_id}:${txId ?? 'no-tx'}`)
        } catch (err) {
          results.push(`error:${plan.wallet_id}:${err instanceof Error ? err.message : 'unknown'}`)
        }
        continue // don't also try to deposit into a matured plan
      }

      // ── 2. Check for new inbound balance → auto-deposit savings % ──────────
      try {
        const currentBal = await getUsdcBalance(addr)
        const prevBal = BigInt(plan.last_balance ?? 0)

        // Update last_balance regardless
        await fetch(`${SB_URL}/rest/v1/autosave_plans?wallet_id=eq.${encodeURIComponent(plan.wallet_id)}`, {
          method: 'PATCH', headers: sbH,
          body: JSON.stringify({ last_balance: currentBal.toString(), updated_at: now })
        })

        if (currentBal <= prevBal || prevBal === 0n) {
          results.push(`no-inbound:${plan.wallet_id}`)
          continue
        }

        const inbound = currentBal - prevBal
        const saveRaw = (inbound * BigInt(plan.savings_percent)) / 100n
        if (saveRaw === 0n) { results.push(`too-small:${plan.wallet_id}`); continue }

        const inboundUsdc = (Number(inbound) / 1e6).toFixed(2)
        const saveUsdc = (Number(saveRaw) / 1e6).toFixed(2)

        console.log(`[autosave] inbound +$${inboundUsdc} to ${addr}, saving ${plan.savings_percent}% = $${saveUsdc}`)

        // Record inbound receive
        const recvHash = `recv-${Date.now()}-${plan.wallet_id.slice(0, 8)}`
        await writeTxHistory(SB_URL, SB_KEY, plan.wallet_id, recvHash, 'in', inboundUsdc, 'external', 'Received', 'Received')

        // Trigger deposit
        const txId = await circleContractCall(
          plan.wallet_id, SAVINGS,
          'deposit(address,uint256)',
          [addr, saveRaw.toString()],
          CIRCLE_KEY, ENTITY_SECRET
        )

        if (txId) {
          await writeTxHistory(SB_URL, SB_KEY, plan.wallet_id, txId, 'save', saveUsdc, SAVINGS,
            `Auto-saved ${plan.savings_percent}% of +$${inboundUsdc}`, 'Auto-Save')
          results.push(`deposited:${plan.wallet_id}:${saveUsdc}:${txId}`)
        } else {
          results.push(`deposit-failed:${plan.wallet_id}`)
        }
      } catch (err) {
        results.push(`inbound-error:${plan.wallet_id}:${err instanceof Error ? err.message : 'unknown'}`)
      }
    }

    return j({ processed: results.length, results })
  } catch (err) {
    return j({ error: err instanceof Error ? err.message : 'Failed' }, 500)
  }
})
