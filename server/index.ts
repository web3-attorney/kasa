/**
 * Kasa API server — standalone Express process on port 3001.
 * Vite proxies /api/* here. This never restarts on .env or source changes,
 * so in-memory state (autosave plans, schedules, OTP codes) persists.
 */
import express from 'express'

import { config as loadEnv } from 'dotenv'
import path from 'path'
import { fileURLToPath } from 'url'
import fs from 'fs'
import { randomBytes } from 'crypto'
import { rateLimit } from 'express-rate-limit'
import cors from 'cors'
import jwt from 'jsonwebtoken' // eslint-disable-line @typescript-eslint/no-require-imports

const __dirname = path.dirname(fileURLToPath(import.meta.url))
loadEnv({ path: path.resolve(__dirname, '../.env') })

import { initiateDeveloperControlledWalletsClient } from '@circle-fin/developer-controlled-wallets'

// ── JWT secret (generate random if not set — ephemeral but safe for testnet) ──
interface JwtPayload { userId: string; walletId: string }
const JWT_SECRET = process.env.JWT_SECRET ?? (() => {
  const s = randomBytes(32).toString('hex')
  console.warn('[kasa-server] JWT_SECRET not set — using ephemeral secret (sessions reset on restart)')
  return s
})()

const app = express()

// ── CORS — only allow the preview origin and localhost ────────────────────────
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS ?? 'https://ideqs3zwnt6ek0nn4yzuf.preview.studio.arc.io,http://localhost:5173').split(',').map(s => s.trim()) // arc-studio-allow-onchain-literal
app.use(cors({ origin: (o, cb) => cb(null, !o || ALLOWED_ORIGINS.includes(o)), credentials: true }))
app.use(express.json())
app.use((req, _res, next) => { if (req.path.startsWith('/api/')) console.log(`[req] ${req.method} ${req.path}`); next() })
app.options('/{*path}', (_, res) => res.sendStatus(204))

// ── Rate limiters ─────────────────────────────────────────────────────────────
const authLimiter = rateLimit({ windowMs: 15 * 60_000, limit: 10, standardHeaders: true, message: { error: 'Too many attempts, try again in 15 minutes' } })
const emailLimiter = rateLimit({ windowMs: 60 * 60_000, limit: 5, standardHeaders: true, message: { error: 'Too many email requests, try again in 1 hour' } })


// ── Config (read from env, never hardcoded) ───────────────────────────────────
// USDC address from Arc onchain-facts registry (Arc Testnet chain 5042002)
const USDC_ADDR = '0x3600000000000000000000000000000000000000' // arc-studio-allow-onchain-literal
// KasaSavings contract — deployed this session, stored in VITE_SAVINGS_ADDRESS
const KASA_SAVINGS_ADDR = (process.env.VITE_SAVINGS_ADDRESS ?? '').toLowerCase()
// RPC: use proxy when chain is covered, else fall back to Arc public endpoint
const proxyBase = process.env.RPC_PROXY_BASE_URL ?? ''
const proxyToken = process.env.RPC_PROXY_TOKEN ?? ''
const proxyChains = (process.env.RPC_PROXY_CHAINS ?? '').split(',').map(s => s.trim())
const ARC_CHAIN_KEY = 'arc-testnet'
const ARC_RPC = proxyChains.includes(ARC_CHAIN_KEY) && proxyBase
  ? `${proxyBase}/api/rpc/${ARC_CHAIN_KEY}?_rpc_token=${proxyToken}`
  : 'https://rpc.testnet.arc.io' // arc-studio-allow-onchain-literal

// ── Circle SDK ────────────────────────────────────────────────────────────────
function getCircleClient() {
  return initiateDeveloperControlledWalletsClient({
    apiKey: process.env.CIRCLE_API_KEY!,
    entitySecret: process.env.CIRCLE_ENTITY_SECRET!,
  })
}
let _walletSetId: string | null = null
async function getOrCreateWalletSet(): Promise<string> {
  if (_walletSetId) return _walletSetId
  const sdk = getCircleClient()
  const ex = await sdk.listWalletSets({ pageSize: 1 })
  if (ex.data?.walletSets?.[0]?.id) { _walletSetId = ex.data.walletSets[0].id; return _walletSetId }
  const r = await sdk.createWalletSet({ name: 'Kasa Users' })
  const id = r.data?.walletSet?.id
  if (!id) throw new Error('Wallet set creation failed')
  _walletSetId = id; return _walletSetId
}

// ── RPC helper ────────────────────────────────────────────────────────────────
async function rpcCall<T>(method: string, params: unknown[]): Promise<T> {
  const r = await fetch(ARC_RPC, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
  })
  const j = await r.json() as { result: T }
  return j.result
}

// ── In-memory stores ──────────────────────────────────────────────────────────
const otpStore = new Map<string, { code: string; expires: number }>()

// ── Persistent tx history ─────────────────────────────────────────────────────
const DATA_DIR = path.resolve(__dirname, '../.data')
const TX_FILE  = path.join(DATA_DIR, 'tx-history.json')
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true, mode: 0o700 })

export interface TxRecord {
  txHash: string; direction: 'out'|'in'|'save'|'fx'|'schedule'
  amount: string; counterparty: string; memo: string; timestamp: number; label?: string
}
type TxStore = Record<string, TxRecord[]>

function loadTxStore(): TxStore {
  try { return JSON.parse(fs.readFileSync(TX_FILE, 'utf8')) as TxStore } catch { return {} }
}
function saveTxStore(store: TxStore) {
  const tmp = TX_FILE + '.tmp'
  fs.writeFileSync(tmp, JSON.stringify(store), { encoding: 'utf8', mode: 0o600 })
  fs.renameSync(tmp, TX_FILE)
}
const txHistory: TxStore = loadTxStore()

function recordTx(wId: string, tx: TxRecord) {
  // deduplicate by txHash
  const existing = txHistory[wId] ?? []
  if (tx.txHash && existing.some(t => t.txHash === tx.txHash)) return
  txHistory[wId] = [tx, ...existing].slice(0, 200)
  saveTxStore(txHistory)
  pushNotification(wId, tx)
}

// ── User profile (userId → username, permanent) ───────────────────────────────
const PROFILES_FILE = path.join(DATA_DIR, 'profiles.json')
type ProfileStore = Record<string, { username: string; createdAt: number }>
function loadProfiles(): ProfileStore {
  try { return JSON.parse(fs.readFileSync(PROFILES_FILE, 'utf8')) as ProfileStore } catch { return {} }
}
function saveProfiles(p: ProfileStore) {
  const tmp = PROFILES_FILE + '.tmp'
  fs.writeFileSync(tmp, JSON.stringify(p), { encoding: 'utf8', mode: 0o600 })
  fs.renameSync(tmp, PROFILES_FILE)
}
const profiles: ProfileStore = loadProfiles()

// ── Contacts (address book) ───────────────────────────────────────────────────
interface Contact { id: string; name: string; address: string; memo?: string; createdAt: number }
type ContactStore = Record<string, Contact[]>
const CONTACTS_FILE = path.join(DATA_DIR, 'contacts.json')
function loadContacts(): ContactStore {
  try { return JSON.parse(fs.readFileSync(CONTACTS_FILE, 'utf8')) as ContactStore } catch { return {} }
}
function saveContacts(store: ContactStore) {
  const tmp = CONTACTS_FILE + '.tmp'
  fs.writeFileSync(tmp, JSON.stringify(store), { encoding: 'utf8', mode: 0o600 })
  fs.renameSync(tmp, CONTACTS_FILE)
}
const contacts: ContactStore = loadContacts()

// ── SSE notification bus ──────────────────────────────────────────────────────
type SseClient = { walletId: string; res: express.Response }
const sseClients: SseClient[] = []

function pushNotification(wId: string, tx: TxRecord) {
  const payload = JSON.stringify({ type: 'tx', tx })
  for (const c of sseClients) {
    if (c.walletId === wId) {
      try { c.res.write(`data: ${payload}\n\n`) } catch { /* client gone */ }
    }
  }
}

interface SpendLimit { walletId: string; dailyLimitUsdc: number; spentToday: number; resetAt: number; pendingConfirm: Map<string, { amount: number; to: string; code: string; expires: number }> }
const spendLimits = new Map<string, SpendLimit>()
function getOrCreateLimit(wId: string): SpendLimit {
  if (!spendLimits.has(wId)) spendLimits.set(wId, { walletId: wId, dailyLimitUsdc: 0, spentToday: 0, resetAt: Date.now() + 86400_000, pendingConfirm: new Map() })
  const l = spendLimits.get(wId)!
  if (Date.now() > l.resetAt) { l.spentToday = 0; l.resetAt = Date.now() + 86400_000 }
  return l
}

interface Schedule { id: string; walletId: string; toAddress: string; amount: string; label: string; intervalMs: number; nextRun: number; lastRun: number|null; active: boolean; txHashes: string[] }
const schedules = new Map<string, Schedule>()

interface PayLink { id: string; toWalletId: string; toAddress: string; toUsername: string; amount: string; memo: string; createdAt: number; paidTxHash: string|null }
const payLinks = new Map<string, PayLink>()

interface AutoSavePlan { walletId: string; walletAddress: string; savingsPercent: number; lastCheckedBlock: bigint; active: boolean; inFlight: boolean }
const autoSavePlans = new Map<string, AutoSavePlan>()

function upsertAutoSavePlan(wId: string, addr: string, percent: number) {
  // Always reset lastCheckedBlock to 0 so next poll scans back 200 blocks
  autoSavePlans.set(wId, { walletId: wId, walletAddress: addr.toLowerCase(), savingsPercent: percent, lastCheckedBlock: 0n, active: percent > 0, inFlight: false })
  console.log(`[auto-save] upserted wallet=${addr} percent=${percent} active=${percent > 0}`)
}

// ── On-chain plan reader ───────────────────────────────────────────────────────
async function getOnchainPlan(addr: string): Promise<{ percent: number; active: boolean }> {
  try {
    const sel = '0x7cb22aaf' // keccak256("getPlan(address)")[0:4]
    const data = sel + addr.toLowerCase().replace('0x', '').padStart(64, '0')
    const res = await rpcCall<string>('eth_call', [{ to: KASA_SAVINGS_ADDR, data }, 'latest'])
    if (!res || res === '0x') return { percent: 0, active: false }
    const hex = res.startsWith('0x') ? res.slice(2) : res
    if (hex.length < 6 * 64) return { percent: 0, active: false }
    const percent = parseInt(hex.slice(0, 64), 16)
    const activeVal = parseInt(hex.slice(5 * 64, 6 * 64), 16)
    return { percent, active: activeVal === 1 }
  } catch { return { percent: 0, active: false } }
}

// ── Auto-save sync: discover active plans from chain every 60s ────────────────
async function syncPlansFromChain() {
  try {
    const sdk = getCircleClient()
    const wsId = await getOrCreateWalletSet()
    const wallets = (await sdk.listWallets({ walletSetId: wsId, pageSize: 50 })).data?.wallets ?? []
    let active = 0
    for (const w of wallets) {
      if (!w.address || !w.id) continue
      const plan = await getOnchainPlan(w.address)
      upsertAutoSavePlan(w.id, w.address, plan.active ? plan.percent : 0)
      if (plan.active) active++
    }
    console.log(`[auto-save sync] ${wallets.length} wallets, ${active} active plans`)
  } catch (e) { console.error('[auto-save sync error]', e) }
}

// ── Auto-save poll: detect inbound transfers and deposit ──────────────────────
// Track last known ERC-20 balance per wallet for delta detection
const lastKnownBalance = new Map<string, bigint>()

async function getErc20Balance(addr: string): Promise<bigint> {
  const data = '0x70a08231' + addr.toLowerCase().replace('0x', '').padStart(64, '0')
  const res = await rpcCall<string>('eth_call', [{ to: USDC_ADDR, data }, 'latest'])
  return BigInt(res ?? '0x0')
}

async function pollAutoSave() {
  for (const plan of autoSavePlans.values()) {
    if (!plan.active) continue
    try {
      // Use balance-delta detection: works for both ERC-20 transfers AND native drips
      const currentBalance = await getErc20Balance(plan.walletAddress)
      const prevBalance = lastKnownBalance.get(plan.walletAddress)
      lastKnownBalance.set(plan.walletAddress, currentBalance)

      if (prevBalance === undefined) {
        console.log(`[auto-save poll] wallet=${plan.walletAddress} baseline=$${(Number(currentBalance)/1e6).toFixed(2)}`)
        continue // first read, establish baseline
      }
      if (currentBalance <= prevBalance) continue // no increase

      const inbound = currentBalance - prevBalance
      const inboundUsdc = (Number(inbound)/1e6).toFixed(2)
      console.log(`[auto-save] inbound +$${inboundUsdc} to ${plan.walletAddress}, saving ${plan.savingsPercent}%`)
      // Record the receive in history
      recordTx(plan.walletId, { txHash: `recv-${Date.now()}`, direction: 'in', amount: inboundUsdc, counterparty: 'external', memo: 'Received', timestamp: Date.now() })
      const value = inbound
      const saveRaw = (value * BigInt(plan.savingsPercent)) / 100n
      if (saveRaw === 0n) continue
      // In-flight guard: prevent double-fire if previous deposit is still processing
      if (plan.inFlight) { console.log(`[auto-save] skipping — deposit in flight for ${plan.walletAddress}`); continue }
      plan.inFlight = true
      const sdk = getCircleClient()
      const MAX = '115792089237316195423570985008687907853269984665640564039457584007913129639935'
      const appRes = await sdk.createContractExecutionTransaction({ walletId: plan.walletId, contractAddress: USDC_ADDR, abiFunctionSignature: 'approve(address,uint256)', abiParameters: [KASA_SAVINGS_ADDR, MAX], fee: { type: 'level', config: { feeLevel: 'MEDIUM' } } })
      if (appRes.data?.id) {
        for (let i = 0; i < 15; i++) {
          await new Promise(r => setTimeout(r, 2000))
          const c = await sdk.getTransaction({ id: appRes.data!.id! })
          if (['COMPLETE','FAILED','DENIED','CANCELLED'].includes(c.data?.transaction?.state ?? '')) break
        }
      }
      const depRes = await sdk.createContractExecutionTransaction({ walletId: plan.walletId, contractAddress: KASA_SAVINGS_ADDR, abiFunctionSignature: 'deposit(address,uint256)', abiParameters: [plan.walletAddress, saveRaw.toString()], fee: { type: 'level', config: { feeLevel: 'MEDIUM' } } })
      const txId = depRes.data?.id
      if (!txId) continue
      let txHash = ''
      for (let i = 0; i < 20; i++) {
        await new Promise(r => setTimeout(r, 2000))
        const c = await sdk.getTransaction({ id: txId })
        const state = c.data?.transaction?.state
        if (state === 'COMPLETE') { txHash = c.data.transaction.txHash ?? ''; break }
        if (['FAILED','DENIED','CANCELLED'].includes(state ?? '')) break
      }
      if (txHash) {
        const usdcAmt = (Number(saveRaw) / 1e6).toFixed(2)
        recordTx(plan.walletId, { txHash, direction: 'save', amount: usdcAmt, counterparty: KASA_SAVINGS_ADDR, memo: `Auto-saved ${plan.savingsPercent}% of +$${inboundUsdc}`, timestamp: Date.now(), label: 'Auto-Save' })
        console.log(`[auto-save] deposited $${usdcAmt} USDC tx=${txHash}`)
      }
      plan.inFlight = false
    } catch (e) { plan.inFlight = false; console.error('[auto-save poll error]', e) }
  }
}

// ── Scheduled payments runner ─────────────────────────────────────────────────
async function runSchedules() {
  const now = Date.now()
  for (const s of schedules.values()) {
    if (!s.active || s.nextRun > now) continue
    s.nextRun = now + s.intervalMs
    try {
      const sdk = getCircleClient()
      const units = BigInt(Math.round(parseFloat(s.amount) * 1_000_000))
      const to32 = s.toAddress.toLowerCase().replace('0x', '').padStart(64, '0')
      const amt32 = units.toString(16).padStart(64, '0')
      const txRes = await sdk.createContractExecutionTransaction({ walletId: s.walletId, contractAddress: USDC_ADDR, callData: `0xa9059cbb${to32}${amt32}`, fee: { type: 'level', config: { feeLevel: 'MEDIUM' } } })
      const txId = txRes.data?.id; if (!txId) continue
      s.lastRun = Date.now()
      for (let i = 0; i < 20; i++) {
        await new Promise(r => setTimeout(r, 3000))
        const c = await sdk.getTransaction({ id: txId })
        if (c.data?.transaction?.state === 'COMPLETE') {
          const txHash = c.data.transaction.txHash ?? txId
          s.txHashes = [txHash, ...s.txHashes].slice(0, 20)
          recordTx(s.walletId, { txHash, direction: 'schedule', amount: s.amount, counterparty: s.toAddress, memo: s.label, timestamp: Date.now(), label: 'Scheduled' })
          break
        }
        if (['FAILED','DENIED','CANCELLED'].includes(c.data?.transaction?.state ?? '')) break
      }
    } catch (e) { console.error('[scheduler error]', e) }
  }
}

// ── Balance watcher for wallets without auto-save (records inbound receives) ──
const allWalletBalances = new Map<string, { walletId: string; address: string; balance: bigint }>()

async function pollInboundForAllWallets() {
  try {
    const sdk = getCircleClient()
    const wsId = await getOrCreateWalletSet()
    const wallets = (await sdk.listWallets({ walletSetId: wsId, pageSize: 50 })).data?.wallets ?? []
    for (const w of wallets) {
      if (!w.address || !w.id) continue
      const addr = w.address.toLowerCase()
      const current = await getErc20Balance(addr)
      const prev = allWalletBalances.get(addr)
      allWalletBalances.set(addr, { walletId: w.id, address: addr, balance: current })
      if (!prev) continue // first read
      if (current <= prev.balance) continue
      // Has auto-save plan? — already handled in pollAutoSave, skip
      const hasPlan = autoSavePlans.has(w.id) && autoSavePlans.get(w.id)!.active
      if (hasPlan) continue
      const inboundUsdc = (Number(current - prev.balance) / 1e6).toFixed(2)
      recordTx(w.id, { txHash: `recv-${Date.now()}`, direction: 'in', amount: inboundUsdc, counterparty: 'external', memo: 'Received', timestamp: Date.now() })
    }
  } catch { /* silent */ }
}

// Start background jobs
setTimeout(() => { void syncPlansFromChain() }, 3000)
setInterval(() => { void syncPlansFromChain() }, 60_000)
setInterval(() => { void pollAutoSave() }, 15_000)
setInterval(() => { void pollInboundForAllWallets() }, 15_000)
setInterval(() => { void runSchedules() }, 60_000)

// ── API Routes ────────────────────────────────────────────────────────────────

app.get('/api/health', (_, res) => res.json({ status: 'ok', x402: true }))

app.get('/api/agent.json', (req, res) => {
  const host = (req.headers['x-forwarded-host'] as string) || req.headers.host || 'localhost'
  const proto = (req.headers['x-forwarded-proto'] as string) || 'https'
  res.json({ type: 'https://eips.ethereum.org/EIPS/eip-8004#registration-v1', name: 'Kasa', description: 'Kasa onchain treasury agent', services: [{ name: 'agent-service', endpoint: `${proto}://${host}/api/agent-service`, version: '1.0.0' }], x402Support: true, active: true })
})

app.post('/api/auth/send-otp', emailLimiter, async (req, res) => {
  try {
    const { email } = req.body as { email?: string }
    if (!email) { res.status(400).json({ error: 'email required' }); return }
    const code = String(Math.floor(100000 + Math.random() * 900000))
    otpStore.set(email, { code, expires: Date.now() + 10 * 60 * 1000 })
    const r = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: 'Kasa <onboarding@resend.dev>', to: [email], subject: 'Your Kasa sign-in code', html: `<p style="font-family:sans-serif;font-size:16px">Your Kasa code:</p><p style="font-family:monospace;font-size:36px;font-weight:bold;letter-spacing:10px;color:#000">${code}</p><p style="color:#888;font-size:13px">Expires in 10 min.</p>` }),
    })
    if (!r.ok) throw new Error(`Resend: ${await r.text()}`)
    res.json({ ok: true })
  } catch (e) { res.status(500).json({ error: e instanceof Error ? e.message : 'Failed' }) }
})

app.post('/api/auth/verify-otp', authLimiter, (req, res) => {
  const { email, code } = req.body as { email?: string; code?: string }
  if (!email || !code) { res.status(400).json({ error: 'email and code required' }); return }
  const stored = otpStore.get(email)
  if (!stored || stored.code !== code || Date.now() > stored.expires) { res.status(401).json({ error: 'Invalid or expired code' }); return }
  otpStore.delete(email)
  const userId = Buffer.from(email).toString('base64url').replace(/[^a-z0-9]/gi, '').slice(0, 32)
  // Return existing username if already set — client skips the username step
  const existingUsername = profiles[userId]?.username ?? null
  res.json({ ok: true, userId, existingUsername })
})

// ── Username registry helpers ────────────────────────────────────────────────
const REGISTRY_ADDR = process.env.VITE_REGISTRY_ADDRESS ?? ''

async function encodePackedHash(username: string, salt: string): Promise<string> {
  // Compute keccak256(abi.encodePacked(username, salt)) via web3_sha3 RPC
  const usernameHex = Buffer.from(username, 'utf8').toString('hex')
  const saltHex = salt.replace('0x', '').padStart(64, '0')
  const data = '0x' + usernameHex + saltHex
  return await rpcCall<string>('web3_sha3', [data])
}

async function registerUsernameOnchain(walletId: string, address: string, username: string): Promise<void> {
  if (!REGISTRY_ADDR) { console.log('[registry] VITE_REGISTRY_ADDRESS not set, skipping'); return }
  if (!username || username.length < 3) return
  try {
    const sdk = getCircleClient()
    // deterministic salt from address
    const salt = '0x' + address.toLowerCase().replace('0x', '').padStart(64, '0')
    const commitment = await encodePackedHash(username, salt)
    if (!commitment || commitment === '0x') { console.warn('[registry] could not compute commitment'); return }
    // Step 1: commit
    console.log(`[registry] committing username @${username}`)
    await sdk.createContractExecutionTransaction({ walletId, contractAddress: REGISTRY_ADDR, abiFunctionSignature: 'commit(bytes32)', abiParameters: [commitment], fee: { type: 'level', config: { feeLevel: 'MEDIUM' } } })
    // Step 2: wait 3s for 2+ blocks
    await new Promise(r => setTimeout(r, 4000))
    // Step 3: register
    console.log(`[registry] registering username @${username}`)
    await sdk.createContractExecutionTransaction({ walletId, contractAddress: REGISTRY_ADDR, abiFunctionSignature: 'register(string,bytes32)', abiParameters: [username, salt], fee: { type: 'level', config: { feeLevel: 'MEDIUM' } } })
    console.log(`[registry] @${username} registered onchain for ${address}`)
  } catch (e) { console.warn('[registry] onchain registration failed:', e instanceof Error ? e.message : e) }
}

app.post('/api/wallet/get-or-create', async (req, res) => {
  try {
    const { userId, username: requestedUsername } = req.body as { userId?: string; username?: string }
    if (!userId) { res.status(400).json({ error: 'userId required' }); return }
    // Username is permanent — always use existing profile if present
    const existingProfile = profiles[userId]
    const finalUsername = existingProfile?.username ?? requestedUsername
    if (!finalUsername) { res.status(400).json({ error: 'username required for new users' }); return }
    const sdk = getCircleClient()
    const wsId = await getOrCreateWalletSet()
    const ex = (await sdk.listWallets({ walletSetId: wsId, pageSize: 50 })).data?.wallets?.find(w => w.refId === userId)
    let walletId: string, address: string | undefined
    const isNew = !ex
    if (ex) { walletId = ex.id!; address = ex.address }
    else {
      const cr = await sdk.createWallets({ accountType: 'EOA', blockchains: ['ARC-TESTNET'], count: 1, walletSetId: wsId, metadata: [{ name: `Kasa:${userId}`, refId: userId }] })
      const w = cr.data?.wallets?.[0]
      if (!w) throw new Error('Wallet creation failed')
      walletId = w.id!; address = w.address
    }
    // Persist profile on first signup only — never overwrite
    if (!existingProfile) {
      profiles[userId] = { username: finalUsername, createdAt: Date.now() }
      saveProfiles(profiles)
    }
    const token = jwt.sign({ userId, walletId } satisfies JwtPayload, JWT_SECRET, { expiresIn: '30d' })
    res.json({ walletId, address, username: finalUsername, token })
    // Register username onchain in background (new wallets only)
    if (isNew && address) {
      void registerUsernameOnchain(walletId, address, finalUsername)
    }
  } catch (e) { res.status(500).json({ error: e instanceof Error ? e.message : 'Server error' }) }
})

// ── Username lookup ───────────────────────────────────────────────────────────
app.get('/api/registry/check', async (req, res) => {
  const username = (req.query.username as string)?.toLowerCase().trim()
  if (!username || !/^[a-z0-9_]{3,20}$/.test(username)) {
    res.json({ available: false, reason: '3–20 chars, letters/numbers/underscore only' }); return
  }
  if (!REGISTRY_ADDR) { res.json({ available: true }); return }
  try {
    const nameBytes = Buffer.from(username, 'utf8')
    const offset = '0000000000000000000000000000000000000000000000000000000000000020'
    const len = nameBytes.length.toString(16).padStart(64, '0')
    const data32 = nameBytes.toString('hex').padEnd(Math.ceil(nameBytes.length / 32) * 64, '0')
    const callData = '0xbf40fac1' + offset + len + data32
    const result = await rpcCall<string>('eth_call', [{ to: REGISTRY_ADDR, data: callData }, 'latest'])
    const addr = '0x' + result.slice(-40)
    const taken = addr !== '0x0000000000000000000000000000000000000000'
    res.json({ available: !taken, reason: taken ? 'Username already taken' : undefined })
  } catch { res.json({ available: true }) }
})

app.get('/api/registry/lookup', async (req, res) => {
  const username = (req.query.username as string ?? '').replace(/^@/, '').toLowerCase()
  if (!username) { res.status(400).json({ error: 'username required' }); return }
  if (!REGISTRY_ADDR) { res.status(503).json({ error: 'Registry not configured' }); return }
  try {
    // call getAddress(string username) — selector 0xbf40fac1
    // ABI-encode string: offset(32) + length(32) + data(padded)
    const nameBytes = Buffer.from(username, 'utf8')
    const offset = '0000000000000000000000000000000000000000000000000000000000000020'
    const len = nameBytes.length.toString(16).padStart(64, '0')
    const data32 = nameBytes.toString('hex').padEnd(Math.ceil(nameBytes.length / 32) * 64, '0')
    const callData = '0xbf40fac1' + offset + len + data32 // getAddress selector
    const result = await rpcCall<string>('eth_call', [{ to: REGISTRY_ADDR, data: callData }, 'latest'])
    const addr = '0x' + result.slice(-40)
    if (addr === '0x0000000000000000000000000000000000000000') {
      res.status(404).json({ error: 'Username not found' }); return
    }
    res.json({ address: addr })
  } catch (e) { res.status(500).json({ error: e instanceof Error ? e.message : 'Lookup failed' }) }
})

app.get('/api/wallet/balance', async (req, res) => {
  try {
    const address = (req.query.address ?? req.query.walletId) as string
    if (!address) { res.status(400).json({ error: 'address required' }); return }
    const data = '0x70a08231' + address.toLowerCase().replace('0x', '').padStart(64, '0')
    const raw = BigInt(await rpcCall<string>('eth_call', [{ to: USDC_ADDR, data }, 'latest']))
    res.json({ balance: (Number(raw) / 1e6).toFixed(6).replace(/\.?0+$/, '') || '0', tokenAddress: USDC_ADDR })
  } catch (e) { res.status(500).json({ error: e instanceof Error ? e.message : 'Server error' }) }
})

app.post('/api/wallet/send', async (req, res) => {
  try {
    const { walletId, toAddress, amount, memo, confirmedId } = req.body as { walletId?: string; toAddress?: string; amount?: string; memo?: string; confirmedId?: string }
    if (!walletId || !toAddress || !amount) { res.status(400).json({ error: 'walletId, toAddress, amount required' }); return }
    const limit = getOrCreateLimit(walletId)
    const amountNum = parseFloat(amount)
    if (limit.dailyLimitUsdc > 0 && (limit.spentToday + amountNum) > limit.dailyLimitUsdc) {
      if (confirmedId) {
        const v = limit.pendingConfirm.get('verified:' + confirmedId)
        if (!v || Date.now() > v.expires) { res.status(403).json({ error: 'Confirmation expired', requiresConfirmation: true }); return }
        limit.pendingConfirm.delete('verified:' + confirmedId)
      } else {
        const confirmId = Math.random().toString(36).slice(2, 10)
        const code = String(Math.floor(100000 + Math.random() * 900000))
        limit.pendingConfirm.set(confirmId, { amount: amountNum, to: toAddress, code, expires: Date.now() + 10 * 60 * 1000 })
        res.status(403).json({ requiresConfirmation: true, confirmId, message: 'Daily limit exceeded. Check email for confirmation code.' })
        return
      }
    }
    const sdk = getCircleClient()
    const units = BigInt(Math.round(amountNum * 1_000_000))
    const to32 = toAddress.toLowerCase().replace('0x', '').padStart(64, '0')
    const amt32 = units.toString(16).padStart(64, '0')
    const txRes = await sdk.createContractExecutionTransaction({ walletId, contractAddress: USDC_ADDR, callData: `0xa9059cbb${to32}${amt32}`, fee: { type: 'level', config: { feeLevel: 'MEDIUM' } } })
    const txId = txRes.data?.id; if (!txId) throw new Error('No txId')
    let txHash: string | undefined
    for (let i = 0; i < 30; i++) {
      await new Promise(r => setTimeout(r, 2000))
      const c = await sdk.getTransaction({ id: txId })
      const st = c.data?.transaction?.state; txHash = c.data?.transaction?.txHash ?? undefined
      if (st === 'COMPLETE') break
      if (['FAILED','DENIED','CANCELLED'].includes(st ?? '')) throw new Error(`Transaction ${st}`)
    }
    limit.spentToday += amountNum
    recordTx(walletId, { txHash: txHash ?? txId, direction: 'out', amount, counterparty: toAddress, memo: memo ?? '', timestamp: Date.now() })
    res.json({ txId, txHash })
  } catch (e) { res.status(500).json({ error: e instanceof Error ? e.message : 'Server error' }) }
})

app.post('/api/wallet/contract-call', async (req, res) => {
  try {
    const { walletId, contractAddress, abiFunctionSignature, abiParameters } = req.body as { walletId?: string; contractAddress?: string; abiFunctionSignature?: string; abiParameters?: (string|number|boolean)[] }
    if (!walletId || !contractAddress || !abiFunctionSignature) { res.status(400).json({ error: 'walletId, contractAddress, abiFunctionSignature required' }); return }
    const sdk = getCircleClient()
    const txRes = await sdk.createContractExecutionTransaction({ walletId, contractAddress, abiFunctionSignature, abiParameters: (abiParameters ?? []).map(String), fee: { type: 'level', config: { feeLevel: 'MEDIUM' } } })
    const txId = txRes.data?.id; if (!txId) throw new Error('No txId')
    let txHash: string | undefined
    for (let i = 0; i < 30; i++) {
      await new Promise(r => setTimeout(r, 2000))
      const c = await sdk.getTransaction({ id: txId })
      const st = c.data?.transaction?.state; txHash = c.data?.transaction?.txHash ?? undefined
      if (st === 'COMPLETE') break
      if (['FAILED','DENIED','CANCELLED'].includes(st ?? '')) throw new Error(`Transaction ${st}`)
    }
    res.json({ txId, txHash })
  } catch (e) { res.status(500).json({ error: e instanceof Error ? e.message : 'Server error' }) }
})

app.post('/api/autosave/register', (req, res) => {
  const { walletId, address, percent } = req.body as { walletId?: string; address?: string; percent?: number }
  if (!walletId || !address || percent === undefined) { res.status(400).json({ error: 'walletId, address, percent required' }); return }
  upsertAutoSavePlan(walletId, address, percent)
  res.json({ ok: true })
})

app.get('/api/schedules', (req, res) => {
  res.json([...schedules.values()].filter(s => s.walletId === req.query.walletId))
})
app.post('/api/schedules', (req, res) => {
  const { walletId, toAddress, amount, label, intervalMs } = req.body as { walletId?: string; toAddress?: string; amount?: string; label?: string; intervalMs?: number }
  if (!walletId || !toAddress || !amount || !intervalMs) { res.status(400).json({ error: 'missing fields' }); return }
  if (intervalMs < 3_600_000) { res.status(400).json({ error: 'Minimum interval is 1 hour' }); return }
  const id = Math.random().toString(36).slice(2, 12)
  const s: Schedule = { id, walletId, toAddress, amount, label: label ?? '', intervalMs, nextRun: Date.now() + intervalMs, lastRun: null, active: true, txHashes: [] }
  schedules.set(id, s); res.json(s)
})
app.delete('/api/schedules/:id', (req, res) => { schedules.delete(req.params.id); res.json({ ok: true }) })

app.post('/api/pay-links', (req, res) => {
  const { toWalletId, toAddress, toUsername, amount, memo } = req.body as { toWalletId?: string; toAddress?: string; toUsername?: string; amount?: string; memo?: string }
  if (!toWalletId || !toAddress || !amount) { res.status(400).json({ error: 'missing fields' }); return }
  const id = Math.random().toString(36).slice(2, 14)
  payLinks.set(id, { id, toWalletId, toAddress, toUsername: toUsername ?? '', amount, memo: memo ?? '', createdAt: Date.now(), paidTxHash: null })
  res.json({ id, url: `/pay/${id}` })
})
app.get('/api/pay-links/:id', (req, res) => {
  const l = payLinks.get(req.params.id)
  if (!l) { res.status(404).json({ error: 'Not found' }); return }
  res.json(l)
})

app.get('/api/limits', (req, res) => {
  const l = getOrCreateLimit(req.query.walletId as string)
  res.json({ dailyLimitUsdc: l.dailyLimitUsdc, spentToday: l.spentToday, resetAt: l.resetAt })
})
app.post('/api/limits', (req, res) => {
  const { walletId, dailyLimitUsdc } = req.body as { walletId?: string; dailyLimitUsdc?: number }
  if (!walletId || dailyLimitUsdc === undefined) { res.status(400).json({ error: 'missing fields' }); return }
  getOrCreateLimit(walletId).dailyLimitUsdc = dailyLimitUsdc; res.json({ ok: true })
})
app.post('/api/limits/send-confirm', emailLimiter, async (req, res) => {
  try {
    const { walletId, confirmId, email } = req.body as { walletId?: string; confirmId?: string; email?: string }
    if (!walletId || !confirmId || !email) { res.status(400).json({ error: 'missing fields' }); return }
    const pending = getOrCreateLimit(walletId).pendingConfirm.get(confirmId)
    if (!pending) { res.status(404).json({ error: 'Not found' }); return }
    const r = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: 'Kasa <onboarding@resend.dev>', to: [email], subject: 'Kasa spending confirmation', html: `<p style="font-family:sans-serif">Confirm sending $${pending.amount} USDC:</p><p style="font-family:monospace;font-size:36px;font-weight:bold;letter-spacing:10px">${pending.code}</p>` }),
    })
    if (!r.ok) throw new Error(`Resend: ${await r.text()}`)
    res.json({ ok: true })
  } catch (e) { res.status(500).json({ error: e instanceof Error ? e.message : 'Failed' }) }
})
app.post('/api/limits/verify-confirm', authLimiter, (req, res) => {
  const { walletId, confirmId, code } = req.body as { walletId?: string; confirmId?: string; code?: string }
  if (!walletId || !confirmId || !code) { res.status(400).json({ error: 'missing fields' }); return }
  const l = getOrCreateLimit(walletId)
  const p = l.pendingConfirm.get(confirmId)
  if (!p || p.code !== code || Date.now() > p.expires) { res.status(401).json({ error: 'Invalid or expired code' }); return }
  l.pendingConfirm.delete(confirmId)
  l.pendingConfirm.set('verified:' + confirmId, { amount: p.amount, to: p.to, code: '', expires: Date.now() + 300_000 })
  res.json({ ok: true })
})

app.get('/api/tx-history', (req, res) => res.json(txHistory[req.query.walletId as string] ?? []))

// ── Contacts ──────────────────────────────────────────────────────────────────
app.get('/api/contacts', (req, res) => {
  const wId = req.query.walletId as string
  if (!wId) { res.status(400).json({ error: 'walletId required' }); return }
  res.json(contacts[wId] ?? [])
})

app.post('/api/contacts', (req, res) => {
  const { walletId, name, address, memo } = req.body as { walletId?: string; name?: string; address?: string; memo?: string }
  if (!walletId || !name?.trim() || !address?.trim()) { res.status(400).json({ error: 'walletId, name, address required' }); return }
  const list = contacts[walletId] ?? []
  if (list.some(c => c.address.toLowerCase() === address.toLowerCase())) {
    res.status(409).json({ error: 'Address already saved' }); return
  }
  const contact: Contact = { id: Math.random().toString(36).slice(2, 10), name: name.trim(), address: address.trim(), memo: memo?.trim(), createdAt: Date.now() }
  contacts[walletId] = [contact, ...list]
  saveContacts(contacts)
  res.json(contact)
})

app.delete('/api/contacts/:id', (req, res) => {
  const { walletId } = req.body as { walletId?: string }
  if (!walletId) { res.status(400).json({ error: 'walletId required' }); return }
  contacts[walletId] = (contacts[walletId] ?? []).filter(c => c.id !== req.params.id)
  saveContacts(contacts)
  res.json({ ok: true })
})

app.put('/api/contacts/:id', (req, res) => {
  const { walletId, name, memo } = req.body as { walletId?: string; name?: string; memo?: string }
  if (!walletId) { res.status(400).json({ error: 'walletId required' }); return }
  contacts[walletId] = (contacts[walletId] ?? []).map(c =>
    c.id === req.params.id ? { ...c, name: name?.trim() ?? c.name, memo: memo?.trim() ?? c.memo } : c
  )
  saveContacts(contacts)
  res.json({ ok: true })
})

// SSE: real-time notifications
// SSE auth: EventSource can't set headers, so accept token from query param too
app.get('/api/notifications/stream', (req, _res, next) => {
  if (!req.headers.authorization && req.query.token) {
    req.headers.authorization = `Bearer ${req.query.token as string}`
  }
  next()
}, (req, res) => {
  const walletId = req.query.walletId as string
  if (!walletId) { res.status(400).end(); return }
  if (sseClients.length >= 100) { res.status(503).json({ error: 'Too many connections' }); return }
  res.setHeader('Content-Type', 'text/event-stream')
  res.setHeader('Cache-Control', 'no-cache')
  res.setHeader('Connection', 'keep-alive')
  res.setHeader('X-Accel-Buffering', 'no')
  res.flushHeaders()
  res.write(': connected\n\n')
  const client: SseClient = { walletId, res }
  sseClients.push(client)
  const heartbeat = setInterval(() => { try { res.write(': ping\n\n') } catch { clearInterval(heartbeat) } }, 25_000)
  req.on('close', () => {
    clearInterval(heartbeat)
    const idx = sseClients.indexOf(client)
    if (idx !== -1) sseClients.splice(idx, 1)
  })
})

const PORT = process.env.API_PORT ? parseInt(process.env.API_PORT) : 3001
app.listen(PORT, () => console.log(`[kasa-server] :${PORT}`))
