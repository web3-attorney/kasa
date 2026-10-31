/**
 * SpendingLimits — set a daily USDC spend cap on your wallet.
 * Sends above the cap require an email confirmation code.
 */
import { useState, useEffect, useCallback } from 'react'
import { Shield, ShieldCheck, Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { apiFetch } from '@/kasaWallet'

interface LimitData { dailyLimitUsdc: number; spentToday: number; resetAt: number }
interface Props { walletId?: string }

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

export default function SpendingLimits({ walletId }: Props) {
  const [data, setData]         = useState<LimitData | null>(null)
  const [editing, setEditing]   = useState(false)
  const [newLimit, setNewLimit] = useState('')
  const [saving, setSaving]     = useState(false)

  const load = useCallback(async () => {
    if (!walletId) return
    const res = await apiFetch(`/api/limits?walletId=${walletId}`)
    if (res.ok) setData(await res.json() as LimitData)
  }, [walletId])

  // eslint-disable-next-line react/set-state-in-effect
  useEffect(() => { void load() }, [load])

  const handleSave = async () => {
    if (!walletId) return
    setSaving(true)
    try {
      const daily = parseFloat(newLimit) || 0
      const res = await apiFetch('/api/limits', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ walletId, dailyLimitUsdc: daily }),
      })
      if (!res.ok) throw new Error('Failed to save')
      toast.success(daily > 0 ? `Daily limit set to $${daily} USDC` : 'Daily limit removed')
      setEditing(false)
      await load()
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Failed') }
    setSaving(false)
  }

  const card: React.CSSProperties = {
    padding: '16px', borderRadius: '16px',
    background: 'var(--surface-muted)', border: '1px solid var(--border)',
  }

  const hasLimit   = (data?.dailyLimitUsdc ?? 0) > 0
  const pctUsed    = hasLimit ? Math.min(100, ((data?.spentToday ?? 0) / (data?.dailyLimitUsdc ?? 1)) * 100) : 0
  const resetTime  = data ? new Date(data.resetAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : ''

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>

      {/* Status card */}
      <div style={{ ...card, background: hasLimit ? 'rgba(34,197,94,.06)' : 'rgba(255,255,255,.04)', border: hasLimit ? '1px solid rgba(34,197,94,.18)' : '1px solid rgba(255,255,255,.08)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '12px' }}>
          {hasLimit
            ? <ShieldCheck style={{ width: '16px', height: '16px', color: 'var(--success)' }} />
            : <Shield style={{ width: '16px', height: '16px', color: 'var(--t3)' }} />}
          <span style={{ fontSize: '14px', fontWeight: 600, color: 'var(--t1)' }}>
            {hasLimit ? 'Daily limit active' : 'No spending limit'}
          </span>
        </div>

        {hasLimit && data && (
          <>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px', fontSize: '12px' }}>
              <span style={{ color: 'var(--t2)' }}>Spent today</span>
              <span style={{ color: 'var(--t1)', fontWeight: 600, fontFamily: 'monospace' }}>
                ${data.spentToday.toFixed(2)} / ${data.dailyLimitUsdc.toFixed(2)}
              </span>
            </div>
            {/* Progress bar */}
            <div style={{ height: '6px', borderRadius: '3px', background: 'var(--surface)', overflow: 'hidden', marginBottom: '8px' }}>
              <div style={{ height: '100%', borderRadius: '3px', width: `${pctUsed}%`, transition: 'width .4s',
                background: pctUsed > 80 ? '#ef4444' : pctUsed > 50 ? '#f59e0b' : '#22c55e' }} />
            </div>
            <p style={{ margin: 0, fontSize: '11px', color: 'var(--t3)' }}>
              Resets at {resetTime} · Sends above limit require email confirmation
            </p>
          </>
        )}

        {!hasLimit && (
          <p style={{ margin: 0, fontSize: '12px', color: 'rgba(255,255,255,.35)' }}>
            Set a daily cap — any send above it will require you to confirm via email code.
          </p>
        )}
      </div>

      {/* Edit form */}
      {editing ? (
        <div style={{ ...card, display: 'flex', flexDirection: 'column', gap: '12px' }}>
          <div>
            <label style={labelStyle}>Daily limit (USDC) — set 0 to remove</label>
            <input style={inputStyle} type="number" min="0" step="1" value={newLimit}
              onChange={e => setNewLimit(e.target.value)} placeholder="e.g. 100" autoFocus />
          </div>
          <div style={{ display: 'flex', gap: '8px' }}>
            <button onClick={() => setEditing(false)}
              style={{ flex: 1, height: '40px', borderRadius: '12px', background: 'var(--surface-muted)', border: '1px solid var(--border)', color: 'var(--t2)', fontWeight: 600, fontSize: '13px', cursor: 'pointer' }}>
              Cancel
            </button>
            <button onClick={() => void handleSave()} disabled={saving}
              style={{ flex: 2, height: '40px', borderRadius: '12px', border: 'none',
                background: saving ? 'rgba(255,255,255,.12)' : 'var(--acc)',
                color: saving ? 'rgba(255,255,255,.3)' : '#0b0b0c',
                fontWeight: 700, fontSize: '13px', cursor: saving ? 'not-allowed' : 'pointer',
                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px' }}>
              {saving ? <Loader2 style={{ width: '14px', height: '14px', animation: 'spin 1s linear infinite' }} /> : null}
              {saving ? 'Saving…' : 'Save limit'}
            </button>
          </div>
        </div>
      ) : (
        <button onClick={() => { setEditing(true); setNewLimit(String(data?.dailyLimitUsdc ?? '')) }}
          style={{ width: '100%', height: '44px', borderRadius: '14px', border: '1px solid var(--border)',
            background: 'var(--surface-muted)', color: 'var(--t2)', fontWeight: 600, fontSize: '13px', cursor: 'pointer',
            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px' }}>
          <Shield style={{ width: '14px', height: '14px' }} />
          {hasLimit ? 'Change limit' : 'Set daily limit'}
        </button>
      )}

      {/* Info */}
      <div style={{ padding: '12px 14px', borderRadius: '14px', background: 'rgba(255,255,255,.02)', border: '1px solid rgba(255,255,255,.05)', fontSize: '12px', color: 'var(--t3)', lineHeight: 1.6 }}>
        When a send exceeds your daily limit, Kasa emails you a 6-digit code. Enter it to approve the transaction. Limits reset every 24 hours.
      </div>
    </div>
  )
}
