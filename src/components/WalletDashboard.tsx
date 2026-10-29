/**
 * WalletDashboard — finance-bento dark hero card.
 * Reads USDC balance directly via viem public client (no wagmi wallet connect needed).
 */
import { useState, useEffect } from 'react'
import { createPublicClient, http, erc20Abi } from 'viem'
import { arcTestnet } from 'viem/chains'
import { Copy, ExternalLink, AtSign, RefreshCw, Eye, EyeOff } from 'lucide-react'
import { getUsdc, requireChain, buildAddressExplorerUrl } from '@/onchain-facts'
import { Amount, usdcDecimalsFor } from '@/onchain-money'
import { toast } from 'sonner'

const ARC_TESTNET_ID = 5042002
const usdcFact = getUsdc(ARC_TESTNET_ID)!
const arcChain  = requireChain(ARC_TESTNET_ID)

const publicClient = createPublicClient({
  chain: { ...arcTestnet, contracts: {} },
  transport: http(arcChain.rpcUrls[0], { timeout: 8000 }),
})

interface Props { walletAddress: string; username: string; walletId?: string }

export default function WalletDashboard({ walletAddress: address, username }: Props) {
  const [balanceRaw, setBalanceRaw] = useState<bigint | undefined>(undefined)
  const [refreshing, setRefreshing]  = useState(false)
  const [hidden, setHidden] = useState(() => localStorage.getItem('kasa-balance-hidden') === '1')

  const toggleHidden = () => {
    const next = !hidden
    setHidden(next)
    if (next) localStorage.setItem('kasa-balance-hidden', '1')
    else localStorage.removeItem('kasa-balance-hidden')
  }

  const fetchBalance = async () => {
    if (!address) return
    setRefreshing(true)
    try {
      const raw = await publicClient.readContract({
        address: usdcFact.address as `0x${string}`,
        abi: erc20Abi,
        functionName: 'balanceOf',
        args: [address as `0x${string}`],
      })
      setBalanceRaw(raw)
    } catch { /* silent */ }
    setRefreshing(false)
  }

  useEffect(() => {
    void fetchBalance()
    const id = setInterval(() => { void fetchBalance() }, 10000)
    return () => clearInterval(id)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [address])

  const balance = balanceRaw !== undefined
    ? Amount.fromRaw(balanceRaw, usdcDecimalsFor(ARC_TESTNET_ID)).toFixed(2)
    : '—'

  const copy = (val: string, label: string) => {
    void navigator.clipboard.writeText(val)
    toast.success(`${label} copied!`)
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>

      {/* ── Balance hero ─────────────────────────────────────────────────── */}
      <div style={{ position: 'relative' }}>
        {/* Glow core */}
        <div style={{ position: 'absolute', inset: 0, borderRadius: '18px', overflow: 'hidden', pointerEvents: 'none' }}>
          <div style={{ position:'absolute', left:'10%', right:'10%', top:'-20%', bottom:'-10%',
            borderRadius: '90px', background: 'rgba(108,99,255,.12)', filter: 'blur(40px)' }} />
        </div>
        <div style={{ position: 'relative', zIndex: 1 }}>
          <p className="cap" style={{ marginBottom: '6px', color: 'var(--t2)' }}>USDC Balance</p>
          <div style={{ display: 'flex', alignItems: 'flex-end', gap: '12px' }}>
            {/* Tap balance or eye icon to toggle visibility */}
            <button onClick={toggleHidden}
              style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer',
                display: 'flex', alignItems: 'flex-end', gap: '10px' }}>
              <p className="mono" style={{ margin: 0, fontSize: '48px', fontWeight: 200,
                letterSpacing: '-.04em', lineHeight: 1, color: 'var(--t1)',
                userSelect: 'none' }}>
                {hidden ? '••••••' : `$${balance}`}
              </p>
              <span style={{ marginBottom: '10px', color: 'var(--t3)', display: 'flex', alignItems: 'center' }}>
                {hidden
                  ? <Eye    style={{ width: '15px', height: '15px' }} />
                  : <EyeOff style={{ width: '15px', height: '15px' }} />}
              </span>
            </button>
            <button onClick={() => void fetchBalance()} disabled={refreshing}
              style={{ marginBottom: '6px', padding: '6px', borderRadius: '10px',
                background: 'var(--surface)', border: '1px solid var(--border)',
                cursor: 'pointer', color: 'var(--t2)', display: 'flex', alignItems: 'center' }}>
              <RefreshCw style={{ width: '13px', height: '13px' }} className={refreshing ? 'animate-spin' : ''} />
            </button>
          </div>
          <p style={{ margin: '4px 0 0', fontSize: '11px', color: 'var(--t3)' }}>Arc Testnet · USDC</p>
        </div>
      </div>

      {/* ── Identity rows ─────────────────────────────────────────────────── */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
        {username && (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            padding: '10px 14px', borderRadius: '14px',
            background: 'rgba(108,99,255,.08)', border: '1px solid rgba(91,80,240,.2)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              <AtSign style={{ width: '14px', height: '14px', color: 'var(--acc)' }} />
              <div>
                <p style={{ margin: 0, fontSize: '10px', color: 'var(--t3)', textTransform: 'uppercase', letterSpacing: '.06em' }}>Username</p>
                <p style={{ margin: 0, fontSize: '14px', fontWeight: 600, letterSpacing: '-.02em' }}>@{username}</p>
              </div>
            </div>
            <button onClick={() => copy(`@${username}`, 'Username')}
              style={{ padding: '6px', borderRadius: '8px', background: 'transparent',
                border: 'none', cursor: 'pointer', color: 'var(--t3)' }}>
              <Copy style={{ width: '13px', height: '13px' }} />
            </button>
          </div>
        )}

        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '10px 14px', borderRadius: '14px',
          background: 'var(--surface)', border: '1px solid var(--border-strong)' }}>
          <div style={{ minWidth: 0, flex: 1 }}>
            <p style={{ margin: 0, fontSize: '10px', color: 'var(--t3)', textTransform: 'uppercase', letterSpacing: '.06em' }}>Wallet</p>
            <p className="mono" style={{ margin: 0, fontSize: '12px', color: 'var(--t2)',
              overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{address}</p>
          </div>
          <div style={{ display: 'flex', gap: '4px', marginLeft: '8px', flexShrink: 0 }}>
            <button onClick={() => copy(address, 'Address')}
              style={{ padding: '6px', borderRadius: '8px', background: 'transparent', border: 'none', cursor: 'pointer', color: 'var(--t3)' }}>
              <Copy style={{ width: '13px', height: '13px' }} />
            </button>
            <a href={buildAddressExplorerUrl(ARC_TESTNET_ID, address)} target="_blank" rel="noopener noreferrer"
              style={{ padding: '6px', borderRadius: '8px', color: 'var(--t3)', display: 'flex', alignItems: 'center' }}>
              <ExternalLink style={{ width: '13px', height: '13px' }} />
            </a>
          </div>
        </div>


      </div>

      {/* ── Receive hint ──────────────────────────────────────────────────── */}
      <div style={{ padding: '12px 14px', borderRadius: '14px',
        background: 'var(--surface)', border: '1px solid var(--border)' }}>
        <p style={{ margin: 0, fontSize: '11px', fontWeight: 600, color: 'var(--t2)', marginBottom: '3px' }}>Receive USDC</p>
        <p style={{ margin: 0, fontSize: '12px', color: 'var(--t3)', lineHeight: 1.5 }}>
          Share your {username ? `@${username} or ` : ''}wallet address to receive USDC from anyone on Kasa.
        </p>
      </div>
    </div>
  )
}
