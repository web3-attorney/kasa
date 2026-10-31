/**
 * kasaWallet.ts — Kasa wallet helpers
 *
 * All wallet operations are server-side via developer-controlled wallets.
 * The browser calls the Vite middleware API — no passkeys, no bundler.
 */
import { formatUnits } from 'viem'

// ── Session storage keys ──────────────────────────────────────────────────────
const WALLET_ID_KEY   = 'kasa_wallet_id'
const WALLET_ADDR_KEY = 'kasa_wallet_address'
const USER_ID_KEY     = 'kasa_user_id'
const USERNAME_KEY    = 'kasa_username'
const EMAIL_KEY       = 'kasa_email'
const TOKEN_KEY       = 'kasa_token'

// ── Persist / load session ────────────────────────────────────────────────────

export function saveSession(userId: string, username: string, walletId: string, address: string, email?: string, token?: string) {
  sessionStorage.setItem(USER_ID_KEY, userId)
  sessionStorage.setItem(USERNAME_KEY, username)
  sessionStorage.setItem(WALLET_ID_KEY, walletId)
  sessionStorage.setItem(WALLET_ADDR_KEY, address)
  if (email) sessionStorage.setItem(EMAIL_KEY, email)
  if (token) sessionStorage.setItem(TOKEN_KEY, token)
}

export function loadSession(): { userId: string; username: string; walletId: string; address: string; email: string } | null {
  const userId = sessionStorage.getItem(USER_ID_KEY)
  const username = sessionStorage.getItem(USERNAME_KEY)
  const walletId = sessionStorage.getItem(WALLET_ID_KEY)
  const address = sessionStorage.getItem(WALLET_ADDR_KEY)
  if (!userId || !walletId || !address) return null
  return { userId, username: username ?? '', walletId, address, email: sessionStorage.getItem(EMAIL_KEY) ?? '' }
}

export function clearSession() {
  sessionStorage.removeItem(USER_ID_KEY)
  sessionStorage.removeItem(USERNAME_KEY)
  sessionStorage.removeItem(WALLET_ID_KEY)
  sessionStorage.removeItem(WALLET_ADDR_KEY)
  sessionStorage.removeItem(EMAIL_KEY)
  sessionStorage.removeItem(TOKEN_KEY)
}

// ── API URL router ─────────────────────────────────────────────────────────────
// In dev, all calls proxy to Express on :3001 via Vite's /api/* proxy.
// In production (Vercel), calls go to Supabase Edge Functions.
const SB_BASE = (import.meta.env.VITE_SUPABASE_FUNCTIONS_URL as string | undefined) ?? ''

// Maps legacy /api/<path> → Supabase Edge Function name
const ROUTE_MAP: Record<string, string> = {
  '/api/auth/send-otp':          'send-otp',
  '/api/auth/verify-otp':        'verify-otp',
  '/api/wallet/get-or-create':   'wallet-get-or-create',
  '/api/wallet/balance':         'wallet-balance',
  '/api/wallet/send':            'wallet-send',
  '/api/wallet/contract-call':   'wallet-contract-call',
  '/api/registry/check':         'registry-check',
  '/api/registry/lookup':        'registry-lookup',
  '/api/autosave/register':      'autosave-register',
  '/api/tx-history':             'tx-history',
  '/api/contacts':               'contacts',
  '/api/schedules':              'schedules',
  '/api/pay-links':              'pay-links',
  '/api/limits':                 'limits',
  '/api/limits/send-confirm':    'limits',
  '/api/limits/verify-confirm':  'limits',
  '/api/tx-status':              'tx-status',
  '/api/registry/register':     'register-username',
  '/api/inbound-watcher':       'inbound-watcher',
}

export function apiUrl(path: string): string {
  if (!SB_BASE) return path // dev: use Vite proxy as-is
  // Strip query string for lookup, re-append after
  const [pathname, qs] = path.split('?')
  const fn = ROUTE_MAP[pathname]
  if (!fn) return path
  const base = `${SB_BASE}/${fn}`
  return qs ? `${base}?${qs}` : base
}

// ── Authenticated fetch helper ────────────────────────────────────────────────
function authHeaders(): Record<string, string> {
  return { 'Content-Type': 'application/json' }
}

export async function apiFetch(url: string, init?: RequestInit): Promise<Response> {
  return fetch(apiUrl(url), { ...init, headers: { ...authHeaders(), ...(init?.headers ?? {}) } })
}

// ── Get or create a wallet for a user ────────────────────────────────────────

export async function getOrCreateWallet(userId: string, username?: string): Promise<{ walletId: string; address: string; token: string; username: string }> {
  const res = await fetch(apiUrl('/api/wallet/get-or-create'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ userId, username }),
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: 'Unknown error' })) as { error?: string }
    throw new Error(err.error ?? 'Failed to get wallet')
  }
  return res.json() as Promise<{ walletId: string; address: string; token: string; username: string }>
}

// ── Get USDC balance ──────────────────────────────────────────────────────────

export async function getWalletBalance(walletId: string, address: string): Promise<string> {
  const res = await fetch(apiUrl(`/api/wallet/balance?walletId=${encodeURIComponent(walletId)}&address=${encodeURIComponent(address)}`), { headers: authHeaders() })
  if (!res.ok) return '0'
  const data = await res.json() as { balance?: string }
  return data.balance ?? '0'
}

// ── Poll tx status (production: Edge Function returns txId immediately) ────────

async function pollUntilComplete(txId: string, timeoutMs = 120_000): Promise<string> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    await new Promise(r => setTimeout(r, 3000))
    try {
      const r = await fetch(apiUrl(`/api/tx-status?txId=${encodeURIComponent(txId)}`), { headers: authHeaders() })
      const d = await r.json() as { state?: string; txHash?: string }
      if (d.state === 'COMPLETE') return d.txHash ?? txId
      if (d.state && ['FAILED','DENIED','CANCELLED'].includes(d.state)) throw new Error(`Transaction ${d.state}`)
    } catch (e) {
      if (e instanceof Error && e.message.startsWith('Transaction')) throw e
      // network error — keep polling
    }
  }
  throw new Error('Transaction timed out')
}

// ── Send USDC ─────────────────────────────────────────────────────────────────

export async function sendUsdc(walletId: string, toAddress: string, amountRaw: bigint): Promise<string> {
  const amount = formatUnits(amountRaw, 6)
  const res = await fetch(apiUrl('/api/wallet/send'), {
    method: 'POST', headers: authHeaders(),
    body: JSON.stringify({ walletId, toAddress, amount }),
  })
  const data = await res.json() as { txId?: string; txHash?: string; pending?: boolean; error?: string; requiresConfirmation?: boolean; confirmId?: string }
  if (!res.ok) throw Object.assign(new Error(data.error ?? 'Transaction failed'), data)
  // If pending (production), poll for completion
  if (data.pending && data.txId) return pollUntilComplete(data.txId)
  return data.txHash ?? data.txId ?? ''
}

// ── Inbound transfer watcher (call on login + periodically) ──────────────────

export function triggerInboundWatch(walletId: string, walletAddress: string): Promise<{ found: number; new: number }> {
  return fetch(apiUrl('/api/inbound-watcher'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ walletId, walletAddress }),
  }).then(r => r.json() as Promise<{ found: number; new: number }>).catch(() => ({ found: 0, new: 0 }))
}

// ── Username registration (fire and forget after login) ───────────────────────

export function triggerUsernameRegistration(walletId: string, username: string): void {
  fetch(apiUrl('/api/registry/register'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ walletId, username }),
  }).then(r => r.json()).then((d: Record<string, unknown>) => {
    if (d.ok) console.log(`[kasa] @${username} registered onchain`)
    else if (d.already) console.log(`[kasa] @${username} already registered`)
    else console.warn('[kasa] register-username:', d['error'])
  }).catch(() => { /* non-fatal — will retry on next login */ })
}

// ── Contract call ─────────────────────────────────────────────────────────────

export async function sendContractCall(walletId: string, contractAddress: string, abiFunctionSignature: string, abiParameters: string[]): Promise<string> {
  const res = await fetch(apiUrl('/api/wallet/contract-call'), {
    method: 'POST', headers: authHeaders(),
    body: JSON.stringify({ walletId, contractAddress, abiFunctionSignature, abiParameters }),
  })
  const data = await res.json() as { txId?: string; txHash?: string; pending?: boolean; error?: string }
  if (!res.ok) throw new Error(data.error ?? 'Contract call failed')
  if (data.pending && data.txId) return pollUntilComplete(data.txId)
  return data.txHash ?? data.txId ?? ''
}
