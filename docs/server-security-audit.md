# Kasa API Server — Security Audit

**File audited:** `server/index.ts`  
**Supporting files:** `src/kasaWallet.ts`, `src/components/AuthScreen.tsx`, `src/supabase.ts`  
**Date:** 2025-10  
**Auditor:** Arc Studio AI  

---

## Summary Table

| # | Issue | Severity | Route(s) |
|---|-------|----------|----------|
| 1 | OTP brute-force — no rate limiting on verify-otp | **Critical** | `POST /api/auth/verify-otp` |
| 2 | Missing authentication on all wallet/sensitive endpoints | **Critical** | `POST /api/wallet/send`, `/contract-call`, `/autosave/register`, `/schedules`, `/limits`, etc. |
| 3 | Transaction history accessible to anyone with a walletId | **High** | `GET /api/tx-history` |
| 4 | Spending limit confirm emails — no rate limit on send-confirm | **High** | `POST /api/limits/send-confirm` |
| 5 | In-memory OTP store lost on server restart | **High** | `POST /api/auth/send-otp` / `verify-otp` |
| 6 | `.data/tx-history.json` has world-readable permissions (0644) | **Medium** | File system |
| 7 | SSE notification stream has no authentication | **Medium** | `GET /api/notifications/stream` |
| 8 | Scheduled payments fire with no pre-flight balance check | **Medium** | Background job `runSchedules()` |
| 9 | Auto-save deposit can double-fire within a 15-second poll window | **Medium** | Background job `pollAutoSave()` |
| 10 | CORS set to `*` — any origin can make credentialed-context calls | **Low** | Global middleware |

---

## Detailed Findings

---

### ISSUE 1 — OTP Brute-Force (No Rate Limiting on `/api/auth/verify-otp`)

**Severity: CRITICAL**

**Lines:** 320–328

**Code:**
```ts
app.post('/api/auth/verify-otp', (req, res) => {
  const { email, code } = req.body as { email?: string; code?: string }
  const stored = otpStore.get(email)
  if (!stored || stored.code !== code || Date.now() > stored.expires) {
    res.status(401).json({ error: 'Invalid or expired code' }); return
  }
  otpStore.delete(email)
  const userId = Buffer.from(email).toString('base64url')...
  res.json({ ok: true, userId })
})
```

**Attack:**  
A 6-digit numeric OTP has exactly 900,000 possible values. With no rate limiting, no lockout, and no CAPTCHA, an attacker who knows (or guesses) a victim's email address can script requests to `/api/auth/verify-otp` and exhaust the entire keyspace in well under 10 minutes before the 10-minute expiry. On success they receive a `userId` that maps directly to a Circle wallet. This gives them full access to the victim's funds — send, schedule, auto-save, contract-call.

The same gap exists on `/api/limits/verify-confirm` (line 469) where a 6-digit code gates over-limit transfers.

**Fix:**
1. Install `express-rate-limit`:
   ```ts
   import rateLimit from 'express-rate-limit'

   const otpVerifyLimiter = rateLimit({
     windowMs: 15 * 60 * 1000, // 15 min
     max: 10,                   // 10 attempts per IP per window
     standardHeaders: true,
     legacyHeaders: false,
     message: { error: 'Too many attempts. Try again later.' },
   })

   app.post('/api/auth/verify-otp', otpVerifyLimiter, ...)
   app.post('/api/limits/verify-confirm', otpVerifyLimiter, ...)
   ```
2. Add **per-email attempt counting** (not just per-IP — rate-limiting by IP alone can be bypassed with rotating proxies):
   ```ts
   const otpAttempts = new Map<string, { count: number; resetAt: number }>()

   function checkOtpAttempts(email: string): boolean {
     const entry = otpAttempts.get(email)
     const now = Date.now()
     if (!entry || now > entry.resetAt) {
       otpAttempts.set(email, { count: 1, resetAt: now + 15 * 60_000 })
       return true
     }
     if (entry.count >= 5) return false
     entry.count++
     return true
   }
   ```
3. After 5 failed attempts, **invalidate the OTP** for that email and require re-sending.

---

### ISSUE 2 — Missing Authentication on All Wallet Endpoints

**Severity: CRITICAL**

**Lines:** 330–411, 413–417, 420–430, 444–478

**Code (example):**
```ts
app.post('/api/wallet/send', async (req, res) => {
  const { walletId, toAddress, amount, ... } = req.body
  // No check that the caller owns walletId
  const sdk = getCircleClient()
  const txRes = await sdk.createContractExecutionTransaction({ walletId, ... })
```

**Attack:**  
Every sensitive endpoint trusts the `walletId` supplied in the request body or query string without verifying that the calling session is the owner of that wallet. The `userId` returned by `/api/auth/verify-otp` is never presented as a session token to subsequent requests. An attacker who obtains (or guesses) any valid Circle wallet UUID can:
- Drain the wallet via `POST /api/wallet/send`
- Execute arbitrary contract calls via `POST /api/wallet/contract-call`
- Register malicious auto-save plans via `POST /api/autosave/register`
- Create, modify, or delete scheduled recurring payments
- Set or reset spending limits

Circle wallet UUIDs are not secret by design; they are logged to the browser's `sessionStorage` (see `kasaWallet.ts` line 19) and visible in browser devtools on any tab, making them trivially obtainable from a shared/public computer.

**Fix:**
1. Issue a **signed session token** (JWT or opaque bearer token) from `/api/auth/verify-otp` and store the `walletId → userId` binding server-side:
   ```ts
   import jwt from 'jsonwebtoken'
   const JWT_SECRET = process.env.JWT_SECRET!

   // In verify-otp handler:
   const token = jwt.sign({ userId, walletId }, JWT_SECRET, { expiresIn: '7d' })
   res.json({ ok: true, token })
   ```
2. Add an `authenticate` middleware that validates the `Authorization: Bearer <token>` header and attaches `req.auth = { userId, walletId }`:
   ```ts
   function authenticate(req: express.Request, res: express.Response, next: express.NextFunction) {
     const header = req.headers.authorization
     if (!header?.startsWith('Bearer ')) { res.status(401).json({ error: 'Unauthorized' }); return }
     try {
       req.auth = jwt.verify(header.slice(7), JWT_SECRET) as AuthPayload
       next()
     } catch { res.status(401).json({ error: 'Invalid token' }) }
   }
   ```
3. Apply the middleware to every sensitive route and verify `req.auth.walletId === req.body.walletId` before executing any wallet operation.

---

### ISSUE 3 — Transaction History Accessible to Anyone Who Knows a walletId

**Severity: HIGH**

**Line:** 480

**Code:**
```ts
app.get('/api/tx-history', (req, res) =>
  res.json(txHistory[req.query.walletId as string] ?? [])
)
```

**Attack:**  
Anyone on the internet can retrieve the full transaction history of any Kasa wallet — counterparty addresses, amounts, memos, and timestamps — by issuing `GET /api/tx-history?walletId=<uuid>`. No authentication or ownership check is performed. Memos often contain personally identifying information (purpose of payment, names). Combined with blockchain correlation, this enables targeted attacks.

Additionally, the same unauthenticated pattern affects:
- `GET /api/limits?walletId=<uuid>` — reveals daily limit and spending pattern
- `GET /api/schedules?walletId=<uuid>` — reveals recurring payment recipients and amounts
- `GET /api/pay-links/:id` — reveals destination wallet, amount, and memo

**Fix:**
Apply the `authenticate` middleware (Issue 2 fix) to all read endpoints and assert `req.auth.walletId === req.query.walletId`.

---

### ISSUE 4 — Spending Limit Confirmation Emails — No Rate Limit on `/api/limits/send-confirm`

**Severity: HIGH**

**Lines:** 454–468

**Code:**
```ts
app.post('/api/limits/send-confirm', async (req, res) => {
  const { walletId, confirmId, email } = req.body
  // No rate limit. Sends email via Resend unconditionally.
  const r = await fetch('https://api.resend.com/emails', { ... })
  res.json({ ok: true })
})
```

**Attack (two vectors):**
1. **Email spam/bombing:** An attacker supplies any email address (not necessarily their own) and hammers this endpoint to flood the target inbox with Kasa confirmation emails. This requires only a valid `walletId` and any `confirmId` string that appears in `pendingConfirm`.
2. **Resend API quota exhaustion:** Since no rate limit exists, an attacker can exhaust the application's Resend plan quota (free tier: 100 emails/day), causing legitimate OTPs and confirmations to fail for all users.

Similarly, `POST /api/auth/send-otp` has no rate limit (one attacker can trigger unlimited Resend calls per email).

**Fix:**
```ts
import rateLimit from 'express-rate-limit'

const emailSendLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,  // 1 hour
  max: 5,                     // 5 email sends per IP per hour
  message: { error: 'Too many requests. Try again later.' },
})

app.post('/api/auth/send-otp',       emailSendLimiter, ...)
app.post('/api/limits/send-confirm', emailSendLimiter, ...)
```
Additionally, limit `/api/limits/send-confirm` to emit at most **one email per `confirmId`** (set a `sentAt` flag on the pending entry and return 429 if already sent).

---

### ISSUE 5 — In-Memory OTP Store Cleared on Server Restart Loses Pending OTPs

**Severity: HIGH**

**Line:** 71

**Code:**
```ts
const otpStore = new Map<string, { code: string; expires: number }>()
```

**Attack / Failure Mode:**  
The OTP store lives entirely in Node.js heap. Any server crash, OOM kill, or deliberate restart (e.g. forced by an attacker via a crafted request that triggers an unhandled promise rejection elsewhere) wipes all in-flight OTPs. Users mid-authentication are silently logged out with no explanation; they must restart the flow. More critically, this creates a **denial-of-service pathway**: if an attacker can reliably crash the server (e.g. by sending malformed JSON that triggers a parsing exception — though Express handles that — or exploiting any unhandled rejection), legitimate users cannot sign in for the restart window.

The same issue affects `spendLimits`, `schedules`, `payLinks`, and `autoSavePlans` — all of these are in-memory and lost on restart.

**Fix:**
1. Persist the OTP store to a fast key-value store with TTL support. Redis (or a lightweight file-backed store like `keyv`) is appropriate:
   ```ts
   import Keyv from 'keyv'
   const otpStore = new Keyv({ ttl: 10 * 60 * 1000 }) // 10 min TTL

   // Send OTP:
   await otpStore.set(email, { code, expires: Date.now() + 600_000 })

   // Verify OTP:
   const stored = await otpStore.get(email)
   ```
2. For `spendLimits`, `schedules`, and `payLinks`, use a simple SQLite database (e.g. `better-sqlite3`) which adds no external dependency and survives restarts.

---

### ISSUE 6 — `.data/tx-history.json` Has World-Readable File Permissions (0644)

**Severity: MEDIUM**

**Lines:** 74–76, 87–89

**Code:**
```ts
const TX_FILE = path.join(DATA_DIR, 'tx-history.json')
fs.writeFileSync(TX_FILE, JSON.stringify(store), 'utf8')
// Permissions: -rw-r--r-- (0644) — readable by all OS users
```

**Attack:**  
On any multi-tenant host (shared VPS, container with mounted volumes, CI runner, development machine with multiple users), any OS user on the same system can read `tx-history.json` directly — bypassing the API layer entirely. The file contains the full transaction history (amounts, addresses, memos, timestamps) for all Kasa users indexed by wallet UUID.

Observed on disk:
```
-rw-r--r--  1 sandbox sandbox  647 Oct 28 19:16 tx-history.json
```

**Fix:**
```ts
// Create the file with restrictive permissions (owner-only read/write)
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true, mode: 0o700 })

function saveTxStore(store: TxStore) {
  const tmp = TX_FILE + '.tmp'
  fs.writeFileSync(tmp, JSON.stringify(store), { encoding: 'utf8', mode: 0o600 })
  fs.renameSync(tmp, TX_FILE)  // atomic replace
}
```
Set the DATA_DIR to `0o700` and TX_FILE to `0o600` (owner-only). The atomic write-via-rename also prevents a partial read during a write.

---

### ISSUE 7 — SSE Notification Stream Has No Authentication

**Severity: MEDIUM**

**Lines:** 483–500

**Code:**
```ts
app.get('/api/notifications/stream', (req, res) => {
  const walletId = req.query.walletId as string
  if (!walletId) { res.status(400).end(); return }
  // No auth check — any caller can subscribe to any walletId's events
  res.setHeader('Content-Type', 'text/event-stream')
  ...
  sseClients.push({ walletId, res })
})
```

**Attack (two vectors):**
1. **Real-time surveillance:** An attacker who knows a victim's `walletId` can open an SSE connection to receive real-time push notifications of every inbound and outbound transaction — amounts, counterparties, memos — as they happen, without authentication.
2. **Resource exhaustion:** An attacker can open thousands of SSE connections (each holding a live socket), growing `sseClients` without bound until the server runs out of file descriptors or memory. There is no per-IP connection limit or maximum connection cap.

**Fix:**
1. Require a valid Bearer token (from Issue 2 fix) and verify ownership:
   ```ts
   app.get('/api/notifications/stream', authenticate, (req, res) => {
     const walletId = req.query.walletId as string
     if (req.auth.walletId !== walletId) { res.status(403).end(); return }
     ...
   })
   ```
2. Cap concurrent SSE connections per IP:
   ```ts
   const MAX_SSE_PER_WALLET = 3
   if (sseClients.filter(c => c.walletId === walletId).length >= MAX_SSE_PER_WALLET) {
     res.status(429).end()
     return
   }
   ```

---

### ISSUE 8 — Scheduled Payments Fire With No Pre-Flight Balance Check

**Severity: MEDIUM**

**Lines:** 234–260

**Code:**
```ts
async function runSchedules() {
  for (const s of schedules.values()) {
    if (!s.active || s.nextRun > now) continue
    s.nextRun = now + s.intervalMs   // ← advances schedule BEFORE checking balance
    const sdk = getCircleClient()
    const txRes = await sdk.createContractExecutionTransaction({
      walletId: s.walletId,
      ...
    })
    // No balance check before submitting
```

**Attack / Failure Mode:**  
A scheduled payment is submitted to the Circle SDK even if the wallet has a zero (or insufficient) USDC balance. This results in:
1. A failed/reverted transaction that still consumes network gas and incurs Circle API calls.
2. On chains where Circle's SDK retries on transient failures, multiple failed submissions can occur per schedule tick.
3. The schedule's `nextRun` is advanced **before** the transaction resolves, so if the server crashes mid-poll, the current interval is skipped entirely rather than retried.

Additionally, there is no cap on `intervalMs` — a schedule with `intervalMs: 1` (1 ms) will attempt to fire on every 60-second poll tick and create thousands of Circle API calls.

**Fix:**
```ts
async function runSchedules() {
  const now = Date.now()
  for (const s of schedules.values()) {
    if (!s.active || s.nextRun > now) continue
    try {
      // 1. Pre-flight balance check
      const sdk = getCircleClient()
      const walletRes = await sdk.getWallet({ id: s.walletId })
      const balanceStr = walletRes.data?.wallet?.balances
        ?.find(b => b.token?.symbol === 'USDC')?.amount ?? '0'
      const balanceRaw = BigInt(Math.round(parseFloat(balanceStr) * 1_000_000))
      const units = BigInt(Math.round(parseFloat(s.amount) * 1_000_000))
      if (balanceRaw < units) {
        console.warn(`[scheduler] skip ${s.id}: insufficient balance`)
        continue
      }

      // 2. Advance nextRun only after confirming we will attempt
      s.nextRun = now + s.intervalMs
      ...
    } catch (e) { ... }
  }
}
```
Also enforce a minimum `intervalMs` of 3600000 (1 hour) when creating schedules.

---

### ISSUE 9 — Auto-Save Deposit Can Double-Fire Within a Single 15-Second Poll Window

**Severity: MEDIUM**

**Lines:** 180–231, 263–285, 291

**Code:**
```ts
// Both pollers run every 15 seconds (independent timers):
setInterval(() => { void pollAutoSave() }, 15_000)
setInterval(() => { void pollInboundForAllWallets() }, 15_000)

// pollAutoSave reads ERC-20 balance and compares to lastKnownBalance:
const currentBalance = await getErc20Balance(plan.walletAddress)
const prevBalance = lastKnownBalance.get(plan.walletAddress)
lastKnownBalance.set(plan.walletAddress, currentBalance)  // ← updated immediately
if (currentBalance <= prevBalance) continue
const inbound = currentBalance - prevBalance
// ... triggers approve + deposit
```

**Attack / Failure Mode:**  
The race condition arises as follows:

1. `pollAutoSave` starts (T=0), reads balance as 100 USDC, stores it as `lastKnownBalance`.
2. Between T=0 and T=15s, two separate inbound transfers arrive: +10 USDC at T=5s, +10 USDC at T=12s.
3. Next poll (T=15s): `currentBalance = 120`, `prevBalance = 100`, `inbound = 20`. Auto-save deposit for $20 fires. ✓

The genuine double-fire scenario:

1. Balance poll at T=0 reads 100. `lastKnownBalance = 100`.
2. `getErc20Balance` call for the auto-save poll and the `pollInboundForAllWallets` call execute concurrently (both are `setInterval` at 15s but not synchronized). If they happen to run within the same event-loop tick:
   - `pollAutoSave` reads 110, records `lastKnownBalance = 110`, fires save for +10.
   - `pollInboundForAllWallets` also reads 110 from the same RPC call window. Its `prev.balance` is still 100 (stored in the separate `allWalletBalances` map). It records `inbound = 10` and calls `recordTx` with `direction: 'in'` — but since `hasPlan` is true it skips the double-record. This part is handled.

The actual double-fire risk: if the approve transaction (lines 205–211) takes longer than 15 seconds (the poll interval), a second `pollAutoSave` tick will run while the first approve is still in-flight. It re-reads the balance, sees `currentBalance` has not yet changed (the deposit hasn't landed), but `lastKnownBalance` was already updated at the start of the first tick — so `currentBalance <= prevBalance` and it correctly skips. **However**, if the approve fails silently (state goes to FAILED after the for-loop exits without detecting it), the deposit call is still submitted, and on the next poll tick the balance increase is still present (no deposit occurred), causing a second deposit attempt.

**Fix:**
1. Use a **per-wallet lock** (in-flight flag) to prevent concurrent poll executions for the same wallet:
   ```ts
   const autoSaveInFlight = new Set<string>()

   async function pollAutoSave() {
     for (const plan of autoSavePlans.values()) {
       if (!plan.active || autoSaveInFlight.has(plan.walletAddress)) continue
       autoSaveInFlight.add(plan.walletAddress)
       try {
         // ... existing logic
       } finally {
         autoSaveInFlight.delete(plan.walletAddress)
       }
     }
   }
   ```
2. After the approve transaction, explicitly check the transaction state and abort the deposit if approve failed — do not proceed to `deposit()` on a non-COMPLETE approve:
   ```ts
   const approveState = (await sdk.getTransaction({ id: appRes.data!.id! })).data?.transaction?.state
   if (approveState !== 'COMPLETE') {
     console.warn(`[auto-save] approve failed (${approveState}), skipping deposit`)
     continue
   }
   ```

---

### ISSUE 10 — CORS Set to `*` (Allows Any Origin)

**Severity: LOW**

**Lines:** 19–24

**Code:**
```ts
app.use((_, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,DELETE,OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
  next()
})
```

**Attack:**  
With `Access-Control-Allow-Origin: *`, any webpage on the internet can make cross-origin requests to the Kasa API. This is significant because:

1. **No `Authorization` header is currently sent** (Issue 2 is unfixed). Once Issue 2 is fixed and Bearer tokens are required, `*` will block credentialed requests (browsers refuse `*` with `credentials: 'include'`). This means the fix for Issue 2 is **incompatible** with the current CORS policy.
2. Even before auth is added, a malicious third-party site can use `fetch()` from a victim's browser to make unauthenticated calls against the victim's Kasa wallet (if the victim visits the malicious page while logged in, and if cookies/tokens were ever added).
3. The wildcard CORS policy permanently blocks adding cookie-based session management in the future.

**Fix:**
Restrict CORS to the app's own origin:
```ts
import cors from 'cors'

const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS ?? 'http://localhost:5173').split(',')

app.use(cors({
  origin: (origin, callback) => {
    if (!origin || ALLOWED_ORIGINS.includes(origin)) callback(null, true)
    else callback(new Error(`CORS: ${origin} not allowed`))
  },
  methods: ['GET', 'POST', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  credentials: true,
}))
```
Set `ALLOWED_ORIGINS=https://kasa.yourdomain.com` in production `.env`.

---

## Remediation Priority

| Priority | Issues to Fix | Rationale |
|----------|---------------|-----------|
| **P0 — Fix immediately** | #1 (OTP brute-force), #2 (missing auth) | These two together allow complete account takeover and wallet drainage with no user interaction beyond knowing an email address. |
| **P1 — Fix before any real funds** | #3 (tx history open), #4 (email rate limit), #5 (OTP persistence) | Privacy violations and service-disruption attacks that compound the P0 issues. |
| **P2 — Fix in next sprint** | #6 (file permissions), #7 (SSE no auth), #8 (no balance check), #9 (double-fire) | Operational correctness and defence-in-depth issues. |
| **P3 — Harden before production** | #10 (CORS wildcard) | Required for future auth header support; low exploitability until auth is added. |

---

## Recommended Dependency Additions

```bash
bun add express-rate-limit cors jsonwebtoken
bun add -D @types/jsonwebtoken
```

For OTP/schedule persistence:
```bash
bun add keyv @keyv/sqlite better-sqlite3
bun add -D @types/better-sqlite3
```

---

*End of audit report.*
