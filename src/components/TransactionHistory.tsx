/**
 * TransactionHistory — persistent record of all sends, receives, saves,
 * FX swaps, and scheduled payments. Re-fetches whenever refreshKey changes.
 */
import { useState, useEffect, useCallback } from 'react'
import { ArrowUpRight, ArrowDownLeft, ExternalLink, Clock, RefreshCw, Zap, Repeat2 } from 'lucide-react'
import { buildTxExplorerUrl } from '@/onchain-facts'
import { apiFetch } from '@/kasaWallet'
import { toast } from 'sonner'
import { ARC_CHAIN_ID } from '@/chain'

interface TxRecord {
  txHash: string
  direction: 'out' | 'in' | 'save' | 'fx' | 'schedule'
  amount: string
  counterparty: string
  memo: string
  timestamp: number
  label?: string
}
interface Props { walletId?: string; walletAddress?: string; refreshKey?: number }

function timeAgo(ts: number): string {
  const diff = Date.now() - ts
  if (diff < 60_000) return 'just now'
  if (diff < 3600_000) return `${Math.floor(diff / 60_000)}m ago`
  if (diff < 86400_000) return `${Math.floor(diff / 3600_000)}h ago`
  return new Date(ts).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

function dirIcon(dir: TxRecord['direction']) {
  const s = { width: 15, height: 15 }
  if (dir === 'in')       return <ArrowDownLeft {...s} style={{ ...s, color: 'var(--success)' }} />
  if (dir === 'save')     return <Zap           {...s} style={{ ...s, color: 'var(--acc)' }} />
  if (dir === 'fx')       return <Repeat2       {...s} style={{ ...s, color: '#3b82f6' }} />
  if (dir === 'schedule') return <Clock         {...s} style={{ ...s, color: '#7c3aed' }} />
  return                         <ArrowUpRight  {...s} style={{ ...s, color: 'var(--danger)' }} />
}

// Light-mode icon background tints
function dirBg(dir: TxRecord['direction']): string {
  if (dir === 'in')       return 'rgba(15,123,77,.10)'
  if (dir === 'save')     return 'rgba(91,80,240,.10)'
  if (dir === 'fx')       return 'rgba(59,130,246,.10)'
  if (dir === 'schedule') return 'rgba(124,58,237,.10)'
  return                         'rgba(192,57,43,.10)'
}

// Amount colours readable on light backgrounds
function dirAmountColor(dir: TxRecord['direction']): string {
  if (dir === 'in')       return 'var(--success)'
  if (dir === 'save')     return 'var(--acc)'
  if (dir === 'fx')       return '#2563eb'
  if (dir === 'schedule') return '#6d28d9'
  return 'var(--danger)'
}

function dirTitle(tx: TxRecord): string {
  if (tx.label) return tx.label
  if (tx.direction === 'in')       return 'Received'
  if (tx.direction === 'save')     return 'Auto-Saved'
  if (tx.direction === 'fx')       return 'FX Swap'
  if (tx.direction === 'schedule') return 'Scheduled Send'
  return 'Sent'
}

function dirPrefix(dir: TxRecord['direction']): string {
  return dir === 'in' || dir === 'fx' ? '+' : '-'
}

export default function TransactionHistory({ walletId, refreshKey }: Props) {
  const [txs, setTxs]         = useState<TxRecord[]>([])
  const [loading, setLoading] = useState(false)

  const load = useCallback(async () => {
    if (!walletId) return
    setLoading(true)
    try {
      const res = await apiFetch(`/api/tx-history?walletId=${walletId}`)
      if (res.ok) {
        const data = await res.json() as TxRecord[]
        setTxs(data.slice().sort((a, b) => b.timestamp - a.timestamp))
      }
    } finally { setLoading(false) }
  }, [walletId])

  // eslint-disable-next-line react/set-state-in-effect
  useEffect(() => { void load() }, [load, refreshKey])

  const rowStyle: React.CSSProperties = {
    padding: '14px', borderRadius: '16px',
    background: '#fff',
    border: '1px solid var(--border)',
    boxShadow: '0 1px 3px rgba(13,21,38,.05)',
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '2px' }}>
        <p style={{ margin: 0, fontSize: '11px', fontWeight: 600, letterSpacing: '.06em', textTransform: 'uppercase', color: 'var(--t3)' }}>
          {txs.length} transaction{txs.length !== 1 ? 's' : ''}
        </p>
        <button onClick={() => { void load(); toast.success('Refreshed') }}
          style={{ padding: '5px', borderRadius: '8px', background: 'transparent', border: 'none', cursor: 'pointer', color: 'var(--t3)' }}>
          <RefreshCw style={{ width: '13px', height: '13px' }} className={loading ? 'animate-spin' : ''} />
        </button>
      </div>

      {txs.length === 0 && !loading && (
        <div style={{ ...rowStyle, textAlign: 'center', padding: '32px 20px' }}>
          <Clock style={{ width: '28px', height: '28px', color: 'var(--t3)', margin: '0 auto 10px' }} />
          <p style={{ margin: 0, fontSize: '13px', color: 'var(--t2)' }}>No transactions yet</p>
          <p style={{ margin: '4px 0 0', fontSize: '12px', color: 'var(--t3)' }}>Sends, receives, saves and FX will appear here</p>
        </div>
      )}

      {txs.map((tx, i) => {
        const short = tx.counterparty.startsWith('0x')
          ? `${tx.counterparty.slice(0, 6)}…${tx.counterparty.slice(-4)}`
          : tx.counterparty
        const explorable = tx.txHash && !tx.txHash.startsWith('recv-')
        return (
          <div key={tx.txHash + i} style={rowStyle}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              {/* Direction icon bubble */}
              <div style={{ width: '34px', height: '34px', borderRadius: '50%', flexShrink: 0,
                background: dirBg(tx.direction),
                display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                {dirIcon(tx.direction)}
              </div>

              {/* Title + counterparty */}
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: '13px', fontWeight: 600, color: 'var(--t1)' }}>{dirTitle(tx)}</div>
                <p style={{ margin: '2px 0 0', fontSize: '11px', color: 'var(--t3)',
                  overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {tx.direction === 'in' || tx.direction === 'fx' ? 'From ' : 'To '}{short}
                  {tx.memo && tx.memo !== 'Received' ? ` · "${tx.memo}"` : ''}
                </p>
              </div>

              {/* Amount + timestamp */}
              <div style={{ textAlign: 'right', flexShrink: 0 }}>
                <p style={{ margin: 0, fontSize: '13px', fontWeight: 700, fontFamily: 'monospace',
                  color: dirAmountColor(tx.direction) }}>
                  {dirPrefix(tx.direction)}{tx.amount} USDC
                </p>
                <div style={{ display: 'flex', alignItems: 'center', gap: '4px', justifyContent: 'flex-end', marginTop: '3px' }}>
                  <span style={{ fontSize: '10px', color: 'var(--t3)' }}>{timeAgo(tx.timestamp)}</span>
                  {explorable && (
                    <a href={buildTxExplorerUrl(ARC_CHAIN_ID, tx.txHash)} target="_blank" rel="noopener noreferrer"
                      style={{ color: 'var(--t3)', display: 'flex', alignItems: 'center' }}>
                      <ExternalLink style={{ width: '10px', height: '10px' }} />
                    </a>
                  )}
                </div>
              </div>
            </div>
          </div>
        )
      })}
    </div>
  )
}
