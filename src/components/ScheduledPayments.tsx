/**
 * ScheduledPayments — create and manage recurring USDC payments.
 * Server executes them automatically at the chosen interval.
 */
import { useState, useEffect, useCallback } from 'react'
import { Clock, Plus, Trash2, Loader2, CheckCircle2, Calendar } from 'lucide-react'
import { isAddress } from 'viem'
import { toast } from 'sonner'
import { apiFetch } from '@/kasaWallet'

interface Schedule {
  id: string; toAddress: string; amount: string; label: string
  cronHuman: string; nextRun: number; lastRun: number | null
  active: boolean; txHashes: string[]
}

interface Props { walletId?: string }

const FREQ_OPTIONS = [
  { value: 'daily',     label: 'Daily' },
  { value: 'weekly',    label: 'Weekly' },
  { value: 'biweekly',  label: 'Every 2 weeks' },
  { value: 'monthly',   label: 'Monthly' },
]

const inputStyle: React.CSSProperties = {
  width: '100%', padding: '11px 14px', borderRadius: '12px',
  background: 'rgba(255,255,255,.06)', border: '1px solid rgba(255,255,255,.12)',
  color: '#fff', fontSize: '14px', outline: 'none', fontFamily: 'Geist, sans-serif',
  boxSizing: 'border-box',
}
const labelStyle: React.CSSProperties = {
  fontSize: '11px', fontWeight: 600, letterSpacing: '.06em',
  textTransform: 'uppercase', color: 'rgba(255,255,255,.4)', marginBottom: '5px', display: 'block',
}

export default function ScheduledPayments({ walletId }: Props) {
  const [schedules, setSchedules] = useState<Schedule[]>([])
  const [showing, setShowing]     = useState(false)
  const [loading, setLoading]     = useState(false)
  const [toAddress, setToAddress] = useState('')
  const [amount, setAmount]       = useState('')
  const [label, setLabel]         = useState('')
  const [frequency, setFrequency] = useState('weekly')

  const load = useCallback(async () => {
    if (!walletId) return
    const res = await apiFetch(`/api/schedules?walletId=${walletId}`)
    if (res.ok) setSchedules(await res.json() as Schedule[])
  }, [walletId])

  // eslint-disable-next-line react/set-state-in-effect
  useEffect(() => { void load() }, [load])

  const handleCreate = async () => {
    if (!walletId || !isAddress(toAddress) || !parseFloat(amount)) return
    setLoading(true)
    try {
      const res = await apiFetch('/api/schedules', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ walletId, toAddress, amount, label, frequency }),
      })
      if (!res.ok) throw new Error((await res.json() as { error?: string }).error ?? 'Failed')
      toast.success('Scheduled payment created!')
      setShowing(false); setToAddress(''); setAmount(''); setLabel('')
      await load()
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Failed') }
    setLoading(false)
  }

  const handleDelete = async (id: string) => {
    await apiFetch(`/api/schedules/${id}`, { method: 'DELETE' })
    toast.success('Schedule removed')
    await load()
  }

  const card: React.CSSProperties = {
    padding: '14px', borderRadius: '16px',
    background: 'rgba(255,255,255,.04)', border: '1px solid rgba(255,255,255,.08)',
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>

      {/* Existing schedules */}
      {schedules.length === 0 && !showing && (
        <div style={{ ...card, textAlign: 'center', padding: '32px 20px' }}>
          <Calendar style={{ width: '28px', height: '28px', color: 'rgba(255,255,255,.2)', margin: '0 auto 10px' }} />
          <p style={{ margin: 0, fontSize: '13px', color: 'rgba(255,255,255,.4)' }}>No scheduled payments yet</p>
          <p style={{ margin: '4px 0 0', fontSize: '12px', color: 'rgba(255,255,255,.25)' }}>Set up a recurring send for rent, subscriptions, or savings</p>
        </div>
      )}

      {schedules.map(s => (
        <div key={s.id} style={card}>
          <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '8px' }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '6px' }}>
                <CheckCircle2 style={{ width: '13px', height: '13px', color: '#22c55e', flexShrink: 0 }} />
                <span style={{ fontSize: '13px', fontWeight: 600, color: '#fff' }}>{s.label || 'Unnamed'}</span>
                <span style={{ marginLeft: 'auto', fontSize: '11px', color: 'var(--acc)', fontWeight: 600 }}>${s.amount} USDC</span>
              </div>
              <p style={{ margin: 0, fontSize: '11px', color: 'rgba(255,255,255,.4)', fontFamily: 'monospace', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {s.toAddress}
              </p>
              <div style={{ display: 'flex', gap: '12px', marginTop: '8px' }}>
                <span style={{ fontSize: '11px', color: 'rgba(255,255,255,.4)' }}>
                  <Clock style={{ width: '10px', height: '10px', display: 'inline', verticalAlign: 'middle', marginRight: '3px' }} />
                  {s.cronHuman}
                </span>
                <span style={{ fontSize: '11px', color: 'rgba(255,255,255,.3)' }}>
                  Next: {new Date(s.nextRun).toLocaleDateString()}
                </span>
                {s.lastRun && (
                  <span style={{ fontSize: '11px', color: 'rgba(255,255,255,.3)' }}>
                    Last: {new Date(s.lastRun).toLocaleDateString()}
                  </span>
                )}
              </div>
            </div>
            <button onClick={() => void handleDelete(s.id)}
              style={{ padding: '6px', borderRadius: '8px', background: 'transparent', border: 'none', cursor: 'pointer', color: 'rgba(255,255,255,.3)', flexShrink: 0 }}>
              <Trash2 style={{ width: '14px', height: '14px' }} />
            </button>
          </div>
        </div>
      ))}

      {/* Create form */}
      {showing && (
        <div style={{ ...card, display: 'flex', flexDirection: 'column', gap: '12px' }}>
          <p style={{ margin: 0, fontSize: '13px', fontWeight: 600, color: '#fff' }}>New scheduled payment</p>

          <div>
            <label style={labelStyle}>Label (optional)</label>
            <input style={inputStyle} value={label} onChange={e => setLabel(e.target.value)} placeholder="e.g. Rent, Subscription…" />
          </div>
          <div>
            <label style={labelStyle}>To address</label>
            <input style={inputStyle} value={toAddress} onChange={e => setToAddress(e.target.value.trim())} placeholder="0x…" />
            {toAddress && !isAddress(toAddress) && <p style={{ margin: '3px 0 0', fontSize: '11px', color: '#f87171' }}>Invalid address</p>}
          </div>
          <div>
            <label style={labelStyle}>Amount (USDC)</label>
            <input style={inputStyle} type="number" min="0" step="0.01" value={amount} onChange={e => setAmount(e.target.value)} placeholder="0.00" />
          </div>
          <div>
            <label style={labelStyle}>Frequency</label>
            <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
              {FREQ_OPTIONS.map(f => (
                <button key={f.value} onClick={() => setFrequency(f.value)}
                  style={{ padding: '6px 12px', borderRadius: '10px', border: 'none', cursor: 'pointer', fontSize: '12px', fontWeight: 600,
                    background: frequency === f.value ? 'var(--acc)' : 'rgba(255,255,255,.08)',
                    color: frequency === f.value ? '#0b0b0c' : 'rgba(255,255,255,.7)', transition: 'all .15s' }}>
                  {f.label}
                </button>
              ))}
            </div>
          </div>

          <div style={{ display: 'flex', gap: '8px', marginTop: '4px' }}>
            <button onClick={() => setShowing(false)}
              style={{ flex: 1, height: '40px', borderRadius: '12px', background: 'rgba(255,255,255,.06)', border: '1px solid rgba(255,255,255,.1)', color: 'rgba(255,255,255,.6)', fontWeight: 600, fontSize: '13px', cursor: 'pointer' }}>
              Cancel
            </button>
            <button onClick={() => void handleCreate()}
              disabled={loading || !isAddress(toAddress) || !parseFloat(amount)}
              style={{ flex: 2, height: '40px', borderRadius: '12px', border: 'none',
                background: (!loading && isAddress(toAddress) && !!parseFloat(amount)) ? 'var(--acc)' : 'rgba(255,255,255,.12)',
                color: (!loading && isAddress(toAddress) && !!parseFloat(amount)) ? '#0b0b0c' : 'rgba(255,255,255,.3)',
                fontWeight: 700, fontSize: '13px', cursor: 'pointer',
                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px' }}>
              {loading ? <Loader2 style={{ width: '14px', height: '14px', animation: 'spin 1s linear infinite' }} /> : null}
              {loading ? 'Creating…' : 'Create schedule'}
            </button>
          </div>
        </div>
      )}

      {!showing && (
        <button onClick={() => setShowing(true)}
          style={{ width: '100%', height: '44px', borderRadius: '14px', border: '1px dashed rgba(255,255,255,.18)',
            background: 'transparent', color: 'rgba(255,255,255,.5)', fontWeight: 600, fontSize: '13px', cursor: 'pointer',
            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px', transition: 'all .2s' }}>
          <Plus style={{ width: '15px', height: '15px' }} />
          New scheduled payment
        </button>
      )}
    </div>
  )
}
