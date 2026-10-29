/**
 * PaymentRequest — create shareable pay links.
 * Anyone can open the link and pay you USDC without signing up.
 */
import { useState } from 'react'
import { Link, Copy, CheckCircle2, ExternalLink } from 'lucide-react'
import { toast } from 'sonner'
import { apiFetch } from '@/kasaWallet'

interface Props { walletId?: string; walletAddress?: string; username?: string }

const inputStyle: React.CSSProperties = {
  width: '100%', padding: '11px 14px', borderRadius: '12px',
  background: 'var(--surface-muted)', border: '1px solid var(--border)',
  color: 'var(--t1)', fontSize: '14px', outline: 'none', fontFamily: 'Geist, sans-serif',
  boxSizing: 'border-box',
}
const labelStyle: React.CSSProperties = {
  fontSize: '11px', fontWeight: 600, letterSpacing: '.06em',
  textTransform: 'uppercase', color: 'var(--t3)', marginBottom: '5px', display: 'block',
}

export default function PaymentRequest({ walletId, walletAddress, username }: Props) {
  const [amount, setAmount]   = useState('')
  const [memo, setMemo]       = useState('')
  const [loading, setLoading] = useState(false)
  const [link, setLink]       = useState<string | null>(null)

  const handleCreate = async () => {
    if (!walletId || !walletAddress || !parseFloat(amount)) return
    setLoading(true)
    try {
      const res = await apiFetch('/api/pay-links', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ toWalletId: walletId, toAddress: walletAddress, toUsername: username ?? '', amount, memo }),
      })
      if (!res.ok) throw new Error((await res.json() as { error?: string }).error ?? 'Failed')
      const data = await res.json() as { id: string; url: string }
      const host = window.location.origin
      setLink(`${host}${data.url}`)
      toast.success('Payment link created!')
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Failed') }
    setLoading(false)
  }

  const copyLink = () => {
    if (!link) return
    void navigator.clipboard.writeText(link)
    toast.success('Link copied!')
  }

  const card: React.CSSProperties = {
    padding: '14px', borderRadius: '16px',
    background: 'var(--surface-muted)', border: '1px solid var(--border)',
  }

  if (link) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
        <div style={{ ...card, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '14px', padding: '28px 20px', textAlign: 'center' }}>
          <div style={{ width: '48px', height: '48px', borderRadius: '50%', background: 'rgba(34,197,94,.15)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <CheckCircle2 style={{ width: '24px', height: '24px', color: 'var(--success)' }} />
          </div>
          <div>
            <p style={{ margin: 0, fontSize: '15px', fontWeight: 600, color: 'var(--t1)' }}>Payment link ready</p>
            <p style={{ margin: '4px 0 0', fontSize: '12px', color: 'var(--t2)' }}>Share it with anyone — they pay, you receive</p>
          </div>
          <div style={{ width: '100%', padding: '10px 14px', borderRadius: '12px', background: 'rgba(108,99,255,.08)', border: '1px solid rgba(232,255,31,.18)', wordBreak: 'break-all', fontSize: '12px', color: 'var(--acc)', fontFamily: 'monospace', textAlign: 'left' }}>
            {link}
          </div>
          <div style={{ display: 'flex', gap: '8px', width: '100%' }}>
            <button onClick={copyLink}
              style={{ flex: 1, height: '40px', borderRadius: '12px', background: 'var(--acc)', border: 'none', color: 'var(--t1)', fontWeight: 700, fontSize: '13px', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px' }}>
              <Copy style={{ width: '14px', height: '14px' }} /> Copy link
            </button>
            <a href={link} target="_blank" rel="noopener noreferrer"
              style={{ height: '40px', padding: '0 14px', borderRadius: '12px', background: 'var(--surface)', border: '1px solid var(--border)', color: 'var(--t2)', fontWeight: 600, fontSize: '13px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '6px', textDecoration: 'none' }}>
              <ExternalLink style={{ width: '14px', height: '14px' }} />
            </a>
          </div>
          <button onClick={() => { setLink(null); setAmount(''); setMemo('') }}
            style={{ background: 'none', border: 'none', color: 'rgba(255,255,255,.35)', fontSize: '12px', cursor: 'pointer' }}>
            Create another
          </button>
        </div>
      </div>
    )
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
      <div style={{ ...card, display: 'flex', flexDirection: 'column', gap: '12px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '2px' }}>
          <Link style={{ width: '14px', height: '14px', color: 'var(--acc)' }} />
          <p style={{ margin: 0, fontSize: '12px', color: 'var(--t2)' }}>
            Generate a link anyone can use to pay you — no account needed on their end
          </p>
        </div>

        <div>
          <label style={labelStyle}>Amount to request (USDC)</label>
          <input style={inputStyle} type="number" min="0" step="0.01" value={amount}
            onChange={e => setAmount(e.target.value)} placeholder="0.00" />
        </div>

        <div>
          <label style={{ ...labelStyle, display: 'flex', justifyContent: 'space-between' }}>
            <span>Memo (optional)</span>
            <span style={{ fontWeight: 400 }}>{memo.length}/140</span>
          </label>
          <input style={inputStyle} value={memo} maxLength={140}
            onChange={e => setMemo(e.target.value)} placeholder="What's it for?" />
        </div>

        {walletAddress && (
          <div style={{ padding: '10px 12px', borderRadius: '12px', background: 'rgba(255,255,255,.03)', border: '1px solid rgba(255,255,255,.07)', fontSize: '11px' }}>
            <span style={{ color: 'rgba(255,255,255,.35)' }}>Receiving to </span>
            <span style={{ color: 'rgba(255,255,255,.55)', fontFamily: 'monospace' }}>{walletAddress.slice(0,8)}…{walletAddress.slice(-6)}</span>
            {username && <span style={{ color: 'var(--acc)', marginLeft: '6px', fontWeight: 600 }}>@{username}</span>}
          </div>
        )}

        <button onClick={() => void handleCreate()}
          disabled={loading || !parseFloat(amount)}
          style={{ width: '100%', height: '46px', borderRadius: '14px', border: 'none',
            background: (!loading && !!parseFloat(amount)) ? 'var(--acc)' : 'rgba(255,255,255,.12)',
            color: (!loading && !!parseFloat(amount)) ? '#0b0b0c' : 'rgba(255,255,255,.3)',
            fontWeight: 700, fontSize: '14px', cursor: (!loading && !!parseFloat(amount)) ? 'pointer' : 'not-allowed',
            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px', transition: 'all .2s' }}>
          <Link style={{ width: '15px', height: '15px' }} />
          {loading ? 'Creating…' : 'Create payment link'}
        </button>
      </div>
    </div>
  )
}
