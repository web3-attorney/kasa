/**
 * InternalSend — sends USDC via developer-controlled wallet (server-side signing).
 * Enforces spending limits: if daily cap is exceeded, requests an email confirmation code.
 */
import { useState, useEffect } from 'react'
import { erc20Abi, isAddress, createPublicClient, http } from 'viem'
import { ArrowUpRight, Loader2, CheckCircle2, ExternalLink, ShieldAlert, BookUser, X } from 'lucide-react'
import { getUsdc, requireChain, buildTxExplorerUrl } from '@/onchain-facts'
import { Amount, parseAmount } from '@/onchain-money'
import { ARC_CHAIN_ID, arcChain as arcChainDef } from '@/chain'
import { toast } from 'sonner'
import { apiFetch } from '@/kasaWallet'
import Contacts, { type Contact } from './Contacts'

const USDC = getUsdc(ARC_CHAIN_ID)!

const arcChainInfo = requireChain(ARC_CHAIN_ID)
const publicClient = createPublicClient({
  chain: { ...arcChainDef, contracts: {} },
  transport: http(arcChainInfo.rpcUrls[0], { timeout: 8000 }),
})

interface Props {
  walletId?: string
  walletAddress?: string
  email?: string
}

type SendStep = 'form' | 'confirm' | 'done'

export default function InternalSend({ walletId, walletAddress, email }: Props) {
  const [to, setTo]           = useState('')
  const [amount, setAmount]   = useState('')
  const [memo, setMemo]       = useState('')
  const [sending, setSending] = useState(false)
  const [txHash, setTxHash]   = useState<string | null>(null)
  const [balanceRaw, setBalanceRaw] = useState<bigint | undefined>()

  // Contact picker
  const [showPicker, setShowPicker] = useState(false)
  const [selectedContact, setSelectedContact] = useState<Contact | null>(null)

  // Spending limit confirmation
  const [step, setStep]             = useState<SendStep>('form')
  const [confirmId, setConfirmId]   = useState<string | null>(null)
  const [confirmCode, setConfirmCode] = useState('')
  const [verifying, setVerifying]   = useState(false)

  useEffect(() => {
    if (!walletAddress) return
    publicClient.readContract({
      address: USDC.address as `0x${string}`,
      abi: erc20Abi,
      functionName: 'balanceOf',
      args: [walletAddress as `0x${string}`],
    }).then(setBalanceRaw).catch(() => {})
  }, [walletAddress, txHash])

  const balance = balanceRaw !== undefined
    ? Amount.fromRaw(balanceRaw, USDC.decimals).toFixed(2)
    : '—'

  const amountNum = parseFloat(amount) || 0
  const isUsername = to.startsWith('@') || (!to.startsWith('0x') && to.length >= 3 && /^[a-z0-9_]+$/i.test(to))
  const canSend = (isAddress(to) || isUsername) && amountNum > 0 && !!walletId && !sending

  const handleSend = async (overrideConfirmId?: string) => {
    if (!canSend || !walletId) return
    setSending(true)
    try {
      // Resolve @username to address if needed
      let resolvedTo = to
      if (to.startsWith('@') || (!to.startsWith('0x') && to.length > 1)) {
        const uname = to.replace(/^@/, '').toLowerCase()
        const lookup = await apiFetch(`/api/registry/lookup?username=${encodeURIComponent(uname)}`)
        const data = await lookup.json() as { address?: string; error?: string }
        const ZERO = '0x0000000000000000000000000000000000000000'
        if (!lookup.ok || !data.address || data.address === ZERO) {
          throw new Error(`@${uname} is not registered on Kasa yet`)
        }
        resolvedTo = data.address
      }
      const parsed = parseAmount(ARC_CHAIN_ID, amount)
      // Try to send; server returns 402 if limit exceeded
      const res = await apiFetch('/api/wallet/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          walletId, toAddress: resolvedTo, amount: (parsed.raw / 1_000_000n).toString() + '.' + String(Number(parsed.raw % 1_000_000n)).padStart(6, '0').replace(/0+$/, ''),
          memo, ...(overrideConfirmId ? { confirmedId: overrideConfirmId } : {}),
        }),
      })
      const data = await res.json() as { txId?: string; txHash?: string; error?: string; confirmId?: string }

      if (res.status === 402) {
        // Limit exceeded — request confirmation
        const confirmRes = await apiFetch('/api/limits/send-confirm', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ walletId, amount: amountNum, to, email: email ?? '' }),
        })
        const confirmData = await confirmRes.json() as { confirmId?: string; error?: string }
        if (!confirmRes.ok) throw new Error(confirmData.error ?? 'Failed to send confirmation')
        setConfirmId(confirmData.confirmId ?? null)
        setStep('confirm')
        toast.info('Daily limit reached — check your email for a confirmation code')
        setSending(false)
        return
      }

      if (!res.ok) throw new Error(data.error ?? 'Transaction failed')
      setTxHash(data.txHash ?? data.txId ?? '')
      toast.success(`Sent ${amount} USDC${memo ? ` · "${memo}"` : ''}`)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Transaction failed')
    }
    setSending(false)
  }

  const handleVerifyConfirm = async () => {
    if (!confirmId || confirmCode.length < 6 || !walletId) return
    setVerifying(true)
    try {
      const res = await apiFetch('/api/limits/verify-confirm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ walletId, confirmId, code: confirmCode.trim() }),
      })
      const data = await res.json() as { ok?: boolean; error?: string }
      if (!res.ok || !data.ok) throw new Error(data.error ?? 'Invalid code')
      toast.success('Code confirmed — sending…')
      setStep('form')
      await handleSend(confirmId)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Invalid code')
    }
    setVerifying(false)
  }

  const inputStyle: React.CSSProperties = {
    width: '100%', padding: '12px 16px', borderRadius: '14px',
    background: 'var(--surface-muted)', border: '1px solid var(--border)',
    color: 'var(--t1)', fontSize: '14px', outline: 'none', fontFamily: 'Geist, sans-serif',
    boxSizing: 'border-box',
  }
  const labelStyle: React.CSSProperties = {
    fontSize: '11px', fontWeight: 600, letterSpacing: '.06em',
    textTransform: 'uppercase', color: 'var(--t3)', marginBottom: '6px', display: 'block',
  }

  // ── Done state ─────────────────────────────────────────────────────────────
  if (txHash) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '16px', padding: '24px 0', textAlign: 'center' }}>
        <div style={{ width: '48px', height: '48px', borderRadius: '50%', background: 'rgba(34,197,94,.15)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <CheckCircle2 style={{ width: '24px', height: '24px', color: 'var(--success)' }} />
        </div>
        <div>
          <p style={{ margin: 0, fontSize: '16px', fontWeight: 600, color: 'var(--t1)' }}>Sent!</p>
          <p style={{ margin: '4px 0 0', fontSize: '12px', color: 'var(--t3)' }}>
            {amount} USDC to {to.slice(0, 6)}…{to.slice(-4)}
          </p>
          {memo && <p style={{ margin: '4px 0 0', fontSize: '12px', color: 'var(--t3)' }}>"{memo}"</p>}
        </div>
        <a href={buildTxExplorerUrl(ARC_CHAIN_ID, txHash)} target="_blank" rel="noopener noreferrer"
          style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: '12px', color: 'var(--t3)', textDecoration: 'none' }}>
          <ExternalLink style={{ width: '12px', height: '12px' }} /> View on explorer
        </a>
        <button onClick={() => { setTo(''); setAmount(''); setMemo(''); setTxHash(null); setStep('form') }}
          style={{ height: '40px', padding: '0 24px', borderRadius: '12px', background: 'var(--surface)', border: '1px solid var(--border)', color: 'var(--t1)', fontWeight: 600, fontSize: '14px', cursor: 'pointer' }}>
          Send another
        </button>
      </div>
    )
  }

  // ── Confirmation step ──────────────────────────────────────────────────────
  if (step === 'confirm') {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
        <div style={{ padding: '16px', borderRadius: '16px', background: 'rgba(251,191,36,.06)', border: '1px solid rgba(251,191,36,.2)', display: 'flex', gap: '10px', alignItems: 'flex-start' }}>
          <ShieldAlert style={{ width: '16px', height: '16px', color: '#fbbf24', flexShrink: 0, marginTop: '1px' }} />
          <div>
            <p style={{ margin: 0, fontSize: '13px', fontWeight: 600, color: '#fcd34d' }}>Daily limit exceeded</p>
            <p style={{ margin: '4px 0 0', fontSize: '12px', color: 'rgba(252,211,77,.7)', lineHeight: 1.5 }}>
              A 6-digit confirmation code was sent to your email. Enter it below to approve this send.
            </p>
          </div>
        </div>

        <div>
          <label style={labelStyle}>Confirmation code</label>
          <input
            type="text" inputMode="numeric" maxLength={6} value={confirmCode}
            onChange={e => setConfirmCode(e.target.value.replace(/\D/g, ''))}
            placeholder="000000" autoFocus
            style={{ ...inputStyle, fontSize: '24px', letterSpacing: '8px', textAlign: 'center', fontFamily: 'monospace' }}
          />
        </div>

        <div style={{ display: 'flex', gap: '8px' }}>
          <button onClick={() => { setStep('form'); setConfirmCode('') }}
            style={{ flex: 1, height: '44px', borderRadius: '14px', background: 'var(--surface-muted)', border: '1px solid var(--border)', color: 'var(--t2)', fontWeight: 600, fontSize: '13px', cursor: 'pointer' }}>
            Cancel
          </button>
          <button onClick={() => void handleVerifyConfirm()} disabled={verifying || confirmCode.length < 6}
            style={{ flex: 2, height: '44px', borderRadius: '14px', border: 'none',
              background: (!verifying && confirmCode.length === 6) ? 'var(--acc)' : 'var(--surface-muted)',
              color: (!verifying && confirmCode.length === 6) ? 'var(--accent-fg)' : 'var(--t3)',
              fontWeight: 700, fontSize: '14px', cursor: (!verifying && confirmCode.length === 6) ? 'pointer' : 'not-allowed',
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px' }}>
            {verifying ? <Loader2 style={{ width: '15px', height: '15px', animation: 'spin 1s linear infinite' }} /> : null}
            {verifying ? 'Verifying…' : 'Approve send'}
          </button>
        </div>
      </div>
    )
  }

  // ── Normal form ────────────────────────────────────────────────────────────
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
      <p style={{ margin: 0, fontSize: '12px', color: 'var(--t3)' }}>
        To any @username or address · with memo
      </p>

      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 14px', borderRadius: '14px', background: 'var(--surface-muted)', border: '1px solid var(--border)' }}>
        <span style={{ fontSize: '12px', color: 'var(--t3)' }}>Your balance</span>
        <span className="mono" style={{ fontSize: '13px', fontWeight: 600, color: 'var(--t1)' }}>${balance} USDC</span>
      </div>

      <div>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '6px' }}>
          <label style={{ ...labelStyle, marginBottom: 0 }}>TO</label>
          <button onClick={() => setShowPicker(v => !v)}
            style={{ display: 'flex', alignItems: 'center', gap: '5px', padding: '4px 10px', borderRadius: '8px', background: showPicker ? 'rgba(91,80,240,.1)' : 'var(--surface-muted)', border: `1px solid ${showPicker ? 'rgba(91,80,240,.3)' : 'var(--border)'}`, color: showPicker ? 'var(--acc)' : 'var(--t2)', fontSize: '11px', cursor: 'pointer', fontWeight: 600 }}>
            {showPicker ? <X style={{ width: 11, height: 11 }} /> : <BookUser style={{ width: 11, height: 11 }} />}
            {showPicker ? 'Close' : 'Contacts'}
          </button>
        </div>

        {/* Contact picker dropdown */}
        {showPicker && (
          <div style={{ marginBottom: '10px', padding: '12px', borderRadius: '14px', background: 'var(--surface)', border: '1px solid rgba(91,80,240,.2)' }}>
            <Contacts walletId={walletId} pickerMode onSelect={c => {
              setSelectedContact(c)
              setTo(c.address)
              setShowPicker(false)
            }} />
          </div>
        )}

        {/* Selected contact badge */}
        {selectedContact && !showPicker && (
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '8px 12px', borderRadius: '10px', background: 'rgba(91,80,240,.08)', border: '1px solid rgba(91,80,240,.2)', marginBottom: '8px' }}>
            <div style={{ width: 26, height: 26, borderRadius: '50%', background: 'rgba(91,80,240,.15)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '12px', fontWeight: 700, color: 'var(--acc)', flexShrink: 0 }}>
              {selectedContact.name.charAt(0).toUpperCase()}
            </div>
            <span style={{ fontSize: '13px', fontWeight: 600, color: 'var(--acc)', flex: 1 }}>{selectedContact.name}</span>
            <button onClick={() => { setSelectedContact(null); setTo('') }}
              style={{ padding: '2px', background: 'transparent', border: 'none', color: 'var(--t3)', cursor: 'pointer' }}>
              <X style={{ width: 13, height: 13 }} />
            </button>
          </div>
        )}

        <input type="text" value={to} onChange={e => { setTo(e.target.value.trim()); if (selectedContact) setSelectedContact(null) }}
          placeholder="0x… address" style={inputStyle} />
        {to && !isAddress(to) && !isUsername && <p style={{ margin: '4px 0 0', fontSize: '11px', color: 'var(--danger)' }}>Enter a valid address or @username</p>}
        {isUsername && <p style={{ margin: '4px 0 0', fontSize: '11px', color: 'var(--acc)' }}>Resolves via Kasa Registry</p>}
      </div>

      <div>
        <label style={labelStyle}>AMOUNT (USDC)</label>
        <input type="number" min="0" step="0.01" value={amount} onChange={e => setAmount(e.target.value)} placeholder="0.00" style={inputStyle} />
      </div>

      <div>
        <label style={{ ...labelStyle, display: 'flex', justifyContent: 'space-between' }}>
          <span>MEMO</span>
          <span style={{ fontWeight: 400 }}>{memo.length}/280</span>
        </label>
        <input type="text" value={memo} maxLength={280} onChange={e => setMemo(e.target.value)} placeholder="What's it for?" style={inputStyle} />
      </div>

      <button onClick={() => void handleSend()} disabled={!canSend}
        style={{ width: '100%', height: '48px', borderRadius: '16px',
          background: canSend ? 'var(--acc)' : 'var(--surface-muted)',
          border: canSend ? 'none' : '1px solid var(--border)', color: canSend ? 'var(--accent-fg)' : 'var(--t3)',
          fontWeight: 700, fontSize: '14px', cursor: canSend ? 'pointer' : 'not-allowed',
          display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px', transition: 'all .2s' }}>
        {sending
          ? <><Loader2 style={{ width: '16px', height: '16px', animation: 'spin 1s linear infinite' }} />Sending…</>
          : <><ArrowUpRight style={{ width: '16px', height: '16px' }} />Send USDC</>}
      </button>
    </div>
  )
}
