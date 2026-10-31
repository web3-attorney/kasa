/**
 * NotificationBell — polls tx-history every 10s for new transactions
 * and shows toast notifications. Works on any hosting (no SSE needed).
 */
import { useEffect, useRef, useState, useCallback } from 'react'
import { Bell, ArrowDownLeft, ArrowUpRight, Repeat2, Zap, Clock } from 'lucide-react'
import { toast } from 'sonner'
import { apiFetch, triggerInboundWatch } from '@/kasaWallet'

interface TxRecord {
  txHash: string
  direction: 'out' | 'in' | 'save' | 'fx' | 'schedule'
  amount: string
  counterparty: string
  memo: string
  timestamp: number
  label?: string
}

interface Props {
  walletId?: string
  walletAddress?: string
  onNewTx?: (tx: TxRecord) => void
}

function txIcon(dir: TxRecord['direction']) {
  if (dir === 'in')       return <ArrowDownLeft style={{ width: 14, height: 14, color: 'var(--success)' }} />
  if (dir === 'save')     return <Zap style={{ width: 14, height: 14, color: 'var(--acc)' }} />
  if (dir === 'fx')       return <Repeat2 style={{ width: 14, height: 14, color: '#60a5fa' }} />
  if (dir === 'schedule') return <Clock style={{ width: 14, height: 14, color: '#c084fc' }} />
  return <ArrowUpRight style={{ width: 14, height: 14, color: 'var(--danger)' }} />
}

function txLabel(tx: TxRecord): string {
  if (tx.label) return tx.label
  if (tx.direction === 'in')       return 'Received'
  if (tx.direction === 'save')     return 'Auto-Saved'
  if (tx.direction === 'fx')       return 'FX Swap'
  if (tx.direction === 'schedule') return 'Scheduled Send'
  return 'Sent'
}

function txColor(dir: TxRecord['direction']): string {
  if (dir === 'in')       return '#4ade80'
  if (dir === 'save')     return 'var(--acc)'
  if (dir === 'fx')       return '#60a5fa'
  if (dir === 'schedule') return '#c084fc'
  return '#f87171'
}

export default function NotificationBell({ walletId, walletAddress, onNewTx }: Props) {
  const [unread, setUnread]   = useState(0)
  const [open, setOpen]       = useState(false)
  const [log, setLog]         = useState<TxRecord[]>([])
  const seenRef               = useRef<Set<string>>(new Set())
  const initializedRef        = useRef(false)

  // Counter to throttle inbound-watcher calls (every 3rd poll = every 30s)
  const pollCountRef = useRef(0)

  const poll = useCallback(async () => {
    if (!walletId) return
    try {
      // Every 3rd poll, sync inbound transfers from Circle into tx_history
      pollCountRef.current++
      if (walletAddress && pollCountRef.current % 3 === 1) {
        triggerInboundWatch(walletId, walletAddress).catch(() => { /* non-fatal */ })
      }

      const res = await apiFetch(`/api/tx-history?walletId=${walletId}`)
      if (!res.ok) return
      const data = await res.json() as TxRecord[]
      if (!Array.isArray(data)) return

      const sorted = data.slice().sort((a, b) => b.timestamp - a.timestamp).slice(0, 50)

      if (!initializedRef.current) {
        // First load — seed seenRef, show no toasts
        sorted.forEach(tx => seenRef.current.add(tx.txHash))
        setLog(sorted)
        initializedRef.current = true
        return
      }

      // Find genuinely new transactions
      const newTxs = sorted.filter(tx => !seenRef.current.has(tx.txHash))
      if (newTxs.length === 0) return

      newTxs.forEach(tx => {
        seenRef.current.add(tx.txHash)
        onNewTx?.(tx)

        const label = txLabel(tx)
        const color = txColor(tx.direction)
        const prefix = tx.direction === 'in' || tx.direction === 'fx' ? '+' : (tx.direction === 'save' ? '→ saved ' : '-')
        toast.custom(() => (
          <div style={{
            display: 'flex', alignItems: 'center', gap: 10,
            background: 'var(--surface)', border: '1px solid var(--border-strong)',
            borderRadius: 14, padding: '11px 14px', minWidth: 240, maxWidth: 320,
            boxShadow: '0 8px 32px rgba(0,0,0,.4)',
          }}>
            <div style={{
              width: 32, height: 32, borderRadius: '50%', flexShrink: 0,
              background: `${color}18`,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}>
              {txIcon(tx.direction)}
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <p style={{ margin: 0, fontSize: 13, fontWeight: 600, color: 'var(--t1)' }}>{label}</p>
              <p style={{ margin: '2px 0 0', fontSize: 12, color: 'var(--t2)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                <span style={{ color, fontWeight: 700 }}>{prefix}{tx.amount} USDC</span>
                {tx.memo ? ` · ${tx.memo}` : ''}
              </p>
            </div>
          </div>
        ), { duration: 5000 })
      })

      setLog(sorted)
      setUnread(n => n + newTxs.length)
    } catch { /* ignore poll errors */ }
  }, [walletId, onNewTx])

  useEffect(() => {
    if (!walletId) return
    const first = setTimeout(() => { void poll() }, 0)
    const id = setInterval(() => { void poll() }, 10_000)
    return () => { clearTimeout(first); clearInterval(id) }
  }, [walletId, poll])

  if (!walletId) return null

  return (
    <div style={{ position: 'relative' }}>
      <button
        onClick={() => { setOpen(o => !o); setUnread(0) }}
        style={{
          width: 36, height: 36, borderRadius: '50%',
          background: 'var(--surface)', border: '1px solid var(--border-strong)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          cursor: 'pointer', position: 'relative', flexShrink: 0,
        }}
      >
        <Bell style={{ width: 15, height: 15, color: unread > 0 ? 'var(--acc)' : 'var(--t2)' }} />
        {unread > 0 && (
          <span style={{
            position: 'absolute', top: -4, right: -4,
            background: 'var(--acc)', color: '#fff',
            fontSize: 9, fontWeight: 800, lineHeight: 1,
            width: 16, height: 16, borderRadius: '50%',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            {unread > 9 ? '9+' : unread}
          </span>
        )}
      </button>

      {open && (
        <>
          <div onClick={() => setOpen(false)} style={{ position: 'fixed', inset: 0, zIndex: 99 }} />
          <div style={{
            position: 'absolute', top: 44, right: 0, zIndex: 100,
            width: 300, maxHeight: 400, overflowY: 'auto',
            background: 'var(--surface)', border: '1px solid var(--border)',
            borderRadius: 16, padding: '12px 0',
            boxShadow: '0 16px 48px rgba(0,0,0,.4)',
          }}>
            <p style={{ margin: '0 14px 10px', fontSize: 11, fontWeight: 600, letterSpacing: '.06em', textTransform: 'uppercase', color: 'var(--t3)' }}>
              Recent activity
            </p>
            {log.length === 0 && (
              <p style={{ margin: '20px 14px', fontSize: 13, color: 'var(--t3)', textAlign: 'center' }}>
                No notifications yet
              </p>
            )}
            {log.map((tx, i) => (
              <div key={tx.txHash + String(i)} style={{
                display: 'flex', alignItems: 'center', gap: 10,
                padding: '9px 14px',
                borderBottom: i < log.length - 1 ? '1px solid var(--border)' : 'none',
              }}>
                <div style={{
                  width: 28, height: 28, borderRadius: '50%', flexShrink: 0,
                  background: `${txColor(tx.direction)}18`,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}>
                  {txIcon(tx.direction)}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <p style={{ margin: 0, fontSize: 12, fontWeight: 600, color: 'var(--t1)' }}>{txLabel(tx)}</p>
                  <p style={{ margin: '1px 0 0', fontSize: 11, color: 'var(--t2)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    <span style={{ color: txColor(tx.direction) }}>{tx.amount} USDC</span>
                    {tx.memo ? ` · ${tx.memo}` : ''}
                  </p>
                </div>
                <span style={{ fontSize: 10, color: 'var(--t3)', flexShrink: 0 }}>
                  {new Date(tx.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                </span>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  )
}
