/**
 * NotificationBell — connects to the SSE stream and shows real-time
 * toast notifications for every transaction. Also shows a bell icon
 * with an unread count badge.
 */
import { useEffect, useRef, useState } from 'react'
import { Bell, ArrowDownLeft, ArrowUpRight, Repeat2, Zap, Clock } from 'lucide-react'
import { toast } from 'sonner'

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
  onNewTx?: (tx: TxRecord) => void
}

function txIcon(dir: TxRecord['direction']) {
  if (dir === 'in')       return <ArrowDownLeft style={{ width: 14, height: 14, color: '#4ade80' }} />
  if (dir === 'save')     return <Zap style={{ width: 14, height: 14, color: '#E8FF1F' }} />
  if (dir === 'fx')       return <Repeat2 style={{ width: 14, height: 14, color: '#60a5fa' }} />
  if (dir === 'schedule') return <Clock style={{ width: 14, height: 14, color: '#c084fc' }} />
  return <ArrowUpRight style={{ width: 14, height: 14, color: '#f87171' }} />
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
  if (dir === 'save')     return '#E8FF1F'
  if (dir === 'fx')       return '#60a5fa'
  if (dir === 'schedule') return '#c084fc'
  return '#f87171'
}

export default function NotificationBell({ walletId, onNewTx }: Props) {
  const [unread, setUnread] = useState(0)
  const [open, setOpen]     = useState(false)
  const [log, setLog]       = useState<TxRecord[]>([])
  const esRef               = useRef<EventSource | null>(null)

  useEffect(() => {
    if (!walletId) return
    const token = sessionStorage.getItem('kasa_token') ?? ''
    const es = new EventSource(`/api/notifications/stream?walletId=${walletId}&token=${encodeURIComponent(token)}`)
    esRef.current = es

    es.onmessage = (e) => {
      try {
        const msg = JSON.parse(e.data as string) as { type: string; tx: TxRecord }
        if (msg.type !== 'tx') return
        const tx = msg.tx
        setLog(prev => [tx, ...prev].slice(0, 50))
        setUnread(n => n + 1)
        onNewTx?.(tx)

        // Show toast
        const label = txLabel(tx)
        const color = txColor(tx.direction)
        const prefix = tx.direction === 'in' || tx.direction === 'fx' ? '+' : (tx.direction === 'save' ? '→ saved ' : '-')
        toast.custom(() => (
          <div style={{
            display: 'flex', alignItems: 'center', gap: 10,
            background: '#1a1a1c', border: '1px solid rgba(255,255,255,.1)',
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
              <p style={{ margin: 0, fontSize: 13, fontWeight: 600, color: '#fff' }}>{label}</p>
              <p style={{ margin: '2px 0 0', fontSize: 12, color: 'rgba(255,255,255,.45)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                <span style={{ color, fontWeight: 700 }}>{prefix}{tx.amount} USDC</span>
                {tx.memo ? ` · ${tx.memo}` : ''}
              </p>
            </div>
          </div>
        ), { duration: 5000 })
      } catch { /* ignore parse errors */ }
    }

    return () => { es.close(); esRef.current = null }
  }, [walletId, onNewTx])

  if (!walletId) return null

  return (
    <div style={{ position: 'relative' }}>
      <button
        onClick={() => { setOpen(o => !o); setUnread(0) }}
        style={{
          width: 36, height: 36, borderRadius: '50%',
          background: 'rgba(255,255,255,.06)', border: '1px solid rgba(255,255,255,.1)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          cursor: 'pointer', position: 'relative', flexShrink: 0,
        }}
      >
        <Bell style={{ width: 15, height: 15, color: unread > 0 ? '#E8FF1F' : 'rgba(255,255,255,.5)' }} />
        {unread > 0 && (
          <span style={{
            position: 'absolute', top: -4, right: -4,
            background: '#E8FF1F', color: '#000',
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
          {/* backdrop */}
          <div
            onClick={() => setOpen(false)}
            style={{ position: 'fixed', inset: 0, zIndex: 99 }}
          />
          <div style={{
            position: 'absolute', top: 44, right: 0, zIndex: 100,
            width: 300, maxHeight: 400, overflowY: 'auto',
            background: '#141416', border: '1px solid rgba(255,255,255,.1)',
            borderRadius: 16, padding: '12px 0',
            boxShadow: '0 16px 48px rgba(0,0,0,.6)',
          }}>
            <p style={{ margin: '0 14px 10px', fontSize: 11, fontWeight: 600, letterSpacing: '.06em', textTransform: 'uppercase', color: 'rgba(255,255,255,.3)' }}>
              Recent activity
            </p>
            {log.length === 0 && (
              <p style={{ margin: '20px 14px', fontSize: 13, color: 'rgba(255,255,255,.3)', textAlign: 'center' }}>
                No notifications yet
              </p>
            )}
            {log.map((tx, i) => (
              <div key={tx.txHash + i} style={{
                display: 'flex', alignItems: 'center', gap: 10,
                padding: '9px 14px',
                borderBottom: i < log.length - 1 ? '1px solid rgba(255,255,255,.05)' : 'none',
              }}>
                <div style={{
                  width: 28, height: 28, borderRadius: '50%', flexShrink: 0,
                  background: `${txColor(tx.direction)}18`,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}>
                  {txIcon(tx.direction)}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <p style={{ margin: 0, fontSize: 12, fontWeight: 600, color: '#fff' }}>{txLabel(tx)}</p>
                  <p style={{ margin: '1px 0 0', fontSize: 11, color: 'rgba(255,255,255,.35)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    <span style={{ color: txColor(tx.direction) }}>{tx.amount} USDC</span>
                    {tx.memo ? ` · ${tx.memo}` : ''}
                  </p>
                </div>
                <span style={{ fontSize: 10, color: 'rgba(255,255,255,.2)', flexShrink: 0 }}>
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
