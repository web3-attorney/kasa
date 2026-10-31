/**
 * FX Payment Router — server-side signing via developer-controlled wallet.
 */
import { useState, useEffect } from 'react'
import { erc20Abi, isAddress, createPublicClient, http } from 'viem'
import { ArrowLeftRight, Loader2, CheckCircle2, Info, ExternalLink } from 'lucide-react'
import { getUsdc, requireChain, buildTxExplorerUrl } from '@/onchain-facts'
import { Amount, parseAmount } from '@/onchain-money'
import { sendUsdc } from '@/kasaWallet'
import { ARC_CHAIN_ID, arcChain as arcChainDef } from '@/chain'
import { toast } from 'sonner'

const USDC = getUsdc(ARC_CHAIN_ID)!
const EURC = {
  symbol: 'EURC',
  address: ARC_CHAIN_ID === 5042
    ? '0xbEf5f6d51CB62b58e6A8f77868681825C6fe21c1'
    : '0x89B50855Aa3bE2F677cD6303Cec089B5F319D72a',
  decimals: 6,
}
type Token = typeof USDC | typeof EURC
const TOKENS: Token[] = [USDC, EURC]

const FX_RATES: Record<string, Record<string, number>> = {
  USDC: { USDC: 1.0, EURC: 0.924 },
  EURC: { EURC: 1.0, USDC: 1.082 },
}

const arcChainInfo = requireChain(ARC_CHAIN_ID)
const publicClient = createPublicClient({
  chain: { ...arcChainDef, contracts: {} },
  transport: http(arcChainInfo.rpcUrls[0], { timeout: 8000 }),
})

interface Props { walletId?: string; walletAddress?: string }

export default function FxRouter({ walletId, walletAddress }: Props) {
  const [to, setTo]         = useState('')
  const [amount, setAmount] = useState('')
  const [sendToken, setSendToken]       = useState<Token>(USDC)
  const [receiveToken, setReceiveToken] = useState<Token>(EURC)
  const [sending, setSending] = useState(false)
  const [txHash, setTxHash]   = useState<string | null>(null)
  const [balanceRaw, setBalanceRaw] = useState<bigint | undefined>()

  useEffect(() => {
    if (!walletAddress) return
    publicClient.readContract({
      address: sendToken.address as `0x${string}`,
      abi: erc20Abi,
      functionName: 'balanceOf',
      args: [walletAddress as `0x${string}`],
    }).then(setBalanceRaw).catch(() => {})
  }, [walletAddress, sendToken.address, txHash])

  const rate = FX_RATES[sendToken.symbol]?.[receiveToken.symbol] ?? 1
  const amountNum = parseFloat(amount) || 0
  const receiveAmount = (amountNum * rate).toFixed(2)
  const balance = balanceRaw !== undefined ? Amount.fromRaw(balanceRaw, sendToken.decimals).toFixed(2) : '—'

  const swap = () => { setSendToken(receiveToken); setReceiveToken(sendToken) }

  const canSend = isAddress(to) && amountNum > 0 && !!walletId && !sending

  const handleSend = async () => {
    if (!canSend || !walletId) return
    setSending(true)
    try {
      const parsed = parseAmount(ARC_CHAIN_ID, amount)
      const hash = await sendUsdc(walletId, to, parsed.raw)
      setTxHash(hash)
      toast.success(`Payment routed — ${amount} ${sendToken.symbol} sent!`)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Transaction failed')
    }
    setSending(false)
  }

  const inputStyle: React.CSSProperties = {
    width: '100%', padding: '12px 16px', borderRadius: '14px',
    background: 'var(--surface-muted)', border: '1px solid var(--border)',
    color: 'var(--t1)', fontSize: '14px', outline: 'none', fontFamily: 'Geist, sans-serif',
  }
  const labelStyle: React.CSSProperties = {
    fontSize: '11px', fontWeight: 600, letterSpacing: '.06em',
    textTransform: 'uppercase', color: 'var(--t3)', marginBottom: '6px', display: 'block',
  }
  const tokenBtn = (t: Token, active: boolean, onClick: () => void) => (
    <button key={t.symbol} onClick={onClick} style={{
      flex: 1, padding: '8px', borderRadius: '12px', border: 'none', cursor: 'pointer',
      background: active ? 'var(--acc)' : 'rgba(255,255,255,.08)',
      color: active ? '#0b0b0c' : 'var(--t2)', fontWeight: 700, fontSize: '12px', transition: 'all .2s',
    }}>{t.symbol}</button>
  )

  if (txHash) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '16px', padding: '24px 0', textAlign: 'center' }}>
        <div style={{ width: '48px', height: '48px', borderRadius: '50%',
          background: 'rgba(34,197,94,.15)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <CheckCircle2 style={{ width: '24px', height: '24px', color: 'var(--success)' }} />
        </div>
        <div>
          <p style={{ margin: 0, fontSize: '16px', fontWeight: 600, color: 'var(--t1)' }}>Payment routed!</p>
          <p style={{ margin: '4px 0 0', fontSize: '12px', color: 'var(--t3)' }}>
            {amount} {sendToken.symbol} → {receiveAmount} {receiveToken.symbol}
          </p>
        </div>
        <a href={buildTxExplorerUrl(ARC_CHAIN_ID, txHash)} target="_blank" rel="noopener noreferrer"
          style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: '12px', color: 'var(--t3)', textDecoration: 'none' }}>
          <ExternalLink style={{ width: '12px', height: '12px' }} /> View on explorer
        </a>
        <button onClick={() => { setTo(''); setAmount(''); setTxHash(null) }}
          style={{ height: '40px', padding: '0 24px', borderRadius: '12px',
            background: 'var(--surface)', border: '1px solid var(--border)',
            color: 'var(--t1)', fontWeight: 600, fontSize: '14px', cursor: 'pointer' }}>
          Send another
        </button>
      </div>
    )
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: '8px', padding: '12px 14px', borderRadius: '14px',
        background: 'var(--surface-muted)', border: '1px solid var(--border)' }}>
        <Info style={{ width: '14px', height: '14px', color: 'var(--t3)', flexShrink: 0, marginTop: '1px' }} />
        <p style={{ margin: 0, fontSize: '12px', color: 'var(--t3)', lineHeight: 1.5 }}>
          Both USDC and EURC are $1 stablecoins on Arc. The rate shown is illustrative.
        </p>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '10px 14px', borderRadius: '14px',
        background: 'var(--surface-muted)', border: '1px solid var(--border)' }}>
        <span style={{ fontSize: '12px', color: 'var(--t3)' }}>{sendToken.symbol} balance</span>
        <span className="mono" style={{ fontSize: '13px', fontWeight: 600, color: 'var(--t1)' }}>{balance}</span>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
        <div style={{ flex: 1 }}>
          <label style={labelStyle}>You send</label>
          <div style={{ display: 'flex', gap: '6px' }}>
            {TOKENS.map(t => tokenBtn(t, sendToken.symbol === t.symbol, () => {
              setSendToken(t)
              if (t.symbol === receiveToken.symbol) setReceiveToken(t.symbol === 'USDC' ? EURC : USDC)
            }))}
          </div>
        </div>
        <button onClick={swap} style={{ marginTop: '20px', padding: '8px', borderRadius: '12px',
          background: 'var(--surface)', border: '1px solid var(--border)',
          cursor: 'pointer', color: 'var(--t2)', flexShrink: 0 }}>
          <ArrowLeftRight style={{ width: '14px', height: '14px' }} />
        </button>
        <div style={{ flex: 1 }}>
          <label style={labelStyle}>They receive</label>
          <div style={{ display: 'flex', gap: '6px' }}>
            {TOKENS.map(t => tokenBtn(t, receiveToken.symbol === t.symbol, () => {
              setReceiveToken(t)
              if (t.symbol === sendToken.symbol) setSendToken(t.symbol === 'USDC' ? EURC : USDC)
            }))}
          </div>
        </div>
      </div>

      <div style={{ display: 'flex', justifyContent: 'space-between', padding: '10px 14px', borderRadius: '14px',
        background: 'var(--surface-muted)', border: '1px solid var(--border)' }}>
        <span style={{ fontSize: '12px', color: 'var(--t3)' }}>Rate</span>
        <span className="mono" style={{ fontSize: '12px', fontWeight: 600, color: 'var(--t2)' }}>
          1 {sendToken.symbol} = {rate.toFixed(4)} {receiveToken.symbol}
        </span>
      </div>

      <div>
        <label style={labelStyle}>Recipient</label>
        <input type="text" value={to} onChange={e => setTo(e.target.value.trim())} placeholder="0x…" style={inputStyle} />
        {to && !isAddress(to) && <p style={{ margin: '4px 0 0', fontSize: '11px', color: 'var(--danger)' }}>Enter a valid EVM address</p>}
      </div>

      <div>
        <label style={labelStyle}>Amount</label>
        <input type="number" min="0" step="0.01" value={amount} onChange={e => setAmount(e.target.value)} placeholder="0.00" style={inputStyle} />
        {amountNum > 0 && (
          <p style={{ margin: '4px 0 0', fontSize: '11px', color: 'var(--t3)' }}>
            Recipient gets <span style={{ color: 'var(--t1)', fontWeight: 600 }}>{receiveAmount} {receiveToken.symbol}</span>
          </p>
        )}
      </div>

      <button onClick={() => void handleSend()} disabled={!canSend}
        style={{ width: '100%', height: '48px', borderRadius: '16px',
          background: canSend ? 'var(--acc)' : 'rgba(255,255,255,.12)',
          border: 'none', color: canSend ? '#0b0b0c' : 'var(--t3)',
          fontWeight: 700, fontSize: '14px', cursor: canSend ? 'pointer' : 'not-allowed',
          display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px', transition: 'all .2s' }}>
        {sending
          ? <><Loader2 style={{ width: '16px', height: '16px', animation: 'spin 1s linear infinite' }} />Routing…</>
          : <><ArrowLeftRight style={{ width: '16px', height: '16px' }} />Route Payment</>}
      </button>
    </div>
  )
}
