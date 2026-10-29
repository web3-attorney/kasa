/**
 * AutoSave — backed by the on-chain KasaSavings contract.
 * Server-side signing via developer-controlled wallet — no passkeys.
 */
import { useState, useEffect, useCallback } from 'react'
import { erc20Abi, createPublicClient, http } from 'viem'
import { PiggyBank, Loader2, CheckCircle2, AlertCircle, Activity, ArrowDownToLine } from 'lucide-react'
import { getUsdc, requireChain, buildAddressExplorerUrl } from '@/onchain-facts'
import { Amount, usdcDecimalsFor } from '@/onchain-money'
import { arcTestnet } from 'viem/chains'
import { toast } from 'sonner'
import { apiFetch } from '@/kasaWallet'

const ARC_TESTNET_ID = 5042002
const usdcFact = getUsdc(ARC_TESTNET_ID)!
const USDC_ADDR = usdcFact.address as `0x${string}`
const KASA_SAVINGS_ADDR = '0xce160338e23cbd581bfecc8f5857c7c4f686d9b6' as const

const arcChain = requireChain(ARC_TESTNET_ID)
const publicClient = createPublicClient({
  chain: { ...arcTestnet, contracts: {} },
  transport: http(arcChain.rpcUrls[0], { timeout: 8000 }),
})

const kasaAbi = [
  { type: 'function', name: 'activatePlan', stateMutability: 'nonpayable',
    inputs: [{ name: 'savingsPercent', type: 'uint8' }, { name: 'durationDays', type: 'uint32' }], outputs: [] },
  { type: 'function', name: 'deposit', stateMutability: 'nonpayable',
    inputs: [{ name: 'user', type: 'address' }, { name: 'amount', type: 'uint256' }], outputs: [] },
  { type: 'function', name: 'withdraw', stateMutability: 'nonpayable', inputs: [], outputs: [] },
  { type: 'function', name: 'getPlan', stateMutability: 'view',
    inputs: [{ name: 'user', type: 'address' }],
    outputs: [
      { name: 'savingsPercent', type: 'uint8' }, { name: 'durationDays', type: 'uint32' },
      { name: 'startTime', type: 'uint64' }, { name: 'endTime', type: 'uint64' },
      { name: 'balance', type: 'uint256' }, { name: 'active', type: 'bool' },
    ] },
] as const

interface Props { walletId?: string; walletAddress?: string }

async function serverContractCall(walletId: string, contractAddress: string, sig: string, params: (string | number | boolean)[]): Promise<string> {
  const res = await apiFetch('/api/wallet/contract-call', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ walletId, contractAddress, abiFunctionSignature: sig, abiParameters: params }),
  })
  const data = await res.json() as { txId?: string; txHash?: string; error?: string }
  if (!res.ok) throw new Error(data.error ?? 'Contract call failed')
  return data.txHash ?? data.txId ?? ''
}

async function registerServerPlan(walletId: string, address: string, percent: number) {
  await apiFetch('/api/autosave/register', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ walletId, address, percent }),
  })
}

function daysLeft(endTime: bigint): string {
  const now = BigInt(Math.floor(Date.now() / 1000))
  if (endTime <= now) return 'expired'
  const secs = endTime - now
  const days = Number(secs / 86400n)
  if (days >= 1) return `${days}d left`
  return `${Number(secs / 3600n)}h left`
}

export default function AutoSave({ walletId, walletAddress }: Props) {
  const [savePct, setSavePct]           = useState(10)
  const [durationDays, setDurationDays] = useState(30)
  const [busy, setBusy]                 = useState(false)
  const [busyLabel, setBusyLabel]       = useState('')

  const [planData, setPlanData] = useState<readonly [number, number, bigint, bigint, bigint, boolean] | null>(null)
  const [balanceRaw, setBalanceRaw] = useState<bigint | undefined>()
  const [allowanceRaw, setAllowanceRaw] = useState<bigint | undefined>()

  // Persist the "user cancelled" override across tab switches via sessionStorage.
  // Key is wallet-specific so different accounts don't share state.
  const [withdrawn, setWithdrawnState] = useState(() =>
    sessionStorage.getItem(`kasa-autosave-cancelled-${walletAddress ?? ''}`) === '1'
  )
  const setWithdrawn = useCallback((val: boolean) => {
    const key = `kasa-autosave-cancelled-${walletAddress ?? ''}`
    if (val) sessionStorage.setItem(key, '1')
    else sessionStorage.removeItem(key)
    setWithdrawnState(val)
  }, [walletAddress])

  const refetch = useCallback(async () => {
    if (!walletAddress) return
    const addr = walletAddress as `0x${string}`
    const [plan, bal, allow] = await Promise.all([
      publicClient.readContract({ address: KASA_SAVINGS_ADDR, abi: kasaAbi, functionName: 'getPlan', args: [addr] }),
      publicClient.readContract({ address: USDC_ADDR, abi: erc20Abi, functionName: 'balanceOf', args: [addr] }),
      publicClient.readContract({ address: USDC_ADDR, abi: erc20Abi, functionName: 'allowance', args: [addr, KASA_SAVINGS_ADDR] }),
    ])
    setPlanData(plan)
    setBalanceRaw(bal)
    setAllowanceRaw(allow)
  }, [walletAddress])

  // eslint-disable-next-line react/set-state-in-effect
  useEffect(() => { void refetch() }, [refetch])

  const planPercent    = planData ? Number(planData[0]) : 0
  const planDays       = planData ? Number(planData[1]) : 0
  const planEndTime    = planData ? planData[3] : 0n
  const planBalance    = planData ? planData[4] : 0n
  // withdrawn overrides onchain active — contract keeps endTime set after withdraw
  const planActive     = withdrawn ? false : (planData ? planData[5] : false)
  const planBalanceFmt = Amount.fromRaw(planBalance, usdcDecimalsFor(ARC_TESTNET_ID)).toFixed(2)
  const balanceFmt     = balanceRaw !== undefined ? Amount.fromRaw(balanceRaw, usdcDecimalsFor(ARC_TESTNET_ID)).toFixed(2) : '—'
  const hasApproval    = allowanceRaw !== undefined && allowanceRaw > 0n

  const handleActivate = async () => {
    setBusy(true); setBusyLabel('Activating…')
    try {
      if (!walletId || !walletAddress) throw new Error('No wallet')
      await serverContractCall(walletId, KASA_SAVINGS_ADDR, 'activatePlan(uint8,uint32)', [savePct, durationDays])
      // Register server-side watcher so auto-save fires even when app is closed
      await registerServerPlan(walletId, walletAddress, savePct)
      setWithdrawn(false) // clear override so onchain state takes over
      toast.success('Savings plan activated!')
      await refetch()
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Failed') }
    setBusy(false)
  }

  const handleApprove = async () => {
    setBusy(true); setBusyLabel('Approving…')
    try {
      if (!walletId) throw new Error('No wallet')
      const MAX = '115792089237316195423570985008687907853269984665640564039457584007913129639935'
      await serverContractCall(walletId, USDC_ADDR, 'approve(address,uint256)', [KASA_SAVINGS_ADDR, MAX])
      toast.success('Approved — auto-save is live!')
      await refetch()
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Failed') }
    setBusy(false)
  }

  const resetToSetup = useCallback(() => {
    setSavePct(10)
    setDurationDays(30)
    setWithdrawn(true)
    void refetch()
  }, [refetch, setWithdrawn])

  // Listen for server-pushed reset (maturity auto-withdraw or manual reset from server)
  useEffect(() => {
    if (!walletId) return
    const token = sessionStorage.getItem('kasaToken') ?? ''
    const es = new EventSource(`/api/events?token=${token}`)
    const handler = (e: MessageEvent) => {
      try {
        const msg = JSON.parse(e.data as string) as { type: string; reason?: string }
        if (msg.type === 'autosave-reset') {
          toast.success(msg.reason ?? 'Auto-save plan completed — set a new plan to continue saving')
          resetToSetup()
        }
      } catch { /* ignore */ }
    }
    es.addEventListener('message', handler)
    return () => { es.removeEventListener('message', handler); es.close() }
  }, [walletId, resetToSetup])

  const handleWithdraw = async () => {
    if (planBalance === 0n) {
      // Nothing saved yet — just deactivate the plan without calling withdraw()
      // (contract reverts on ZeroBalance)
      if (walletId && walletAddress) await registerServerPlan(walletId, walletAddress, 0)
      toast.success('Plan cancelled. Set a new plan whenever you\'re ready.')
      resetToSetup()
      return
    }
    setBusy(true); setBusyLabel('Withdrawing…')
    try {
      if (!walletId || !walletAddress) throw new Error('No wallet')
      await serverContractCall(walletId, KASA_SAVINGS_ADDR, 'withdraw()', [])
      // Deactivate server watcher after withdraw
      await registerServerPlan(walletId, walletAddress, 0)
      toast.success('Savings withdrawn! Set a new plan to start saving again.')
      resetToSetup()
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Failed') }
    setBusy(false)
  }

  const pctChips = [5, 10, 15, 20, 25, 30, 50]
  const dayChips = [7, 14, 30, 60, 90, 180, 365]

  const chipStyle = (active: boolean): React.CSSProperties => ({
    padding: '5px 12px', borderRadius: '10px', cursor: 'pointer', fontSize: '12px', fontWeight: 600,
    background: active ? 'var(--acc)' : '#fff',
    color: active ? '#fff' : 'var(--t2)',
    border: active ? 'none' : '1px solid var(--border-strong)',
    boxShadow: active ? '0 2px 8px rgba(91,80,240,.25)' : '0 1px 2px rgba(13,21,38,.05)',
    transition: 'all .15s',
  })

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
      {/* Balance pill */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '12px 16px', borderRadius: '14px', background: '#fff', border: '1px solid var(--border)',
        boxShadow: '0 1px 4px rgba(13,21,38,.06)' }}>
        <span style={{ fontSize: '12px', fontWeight: 600, color: 'var(--t3)', textTransform: 'uppercase', letterSpacing: '.05em' }}>Wallet balance</span>
        <span className="mono" style={{ fontSize: '15px', fontWeight: 700, color: 'var(--t1)' }}>${balanceFmt} USDC</span>
      </div>

      {planActive ? (
        /* ── Active plan card ── */
        <div style={{ padding: '18px', borderRadius: '20px',
          background: 'linear-gradient(135deg, rgba(91,80,240,.08) 0%, rgba(91,80,240,.03) 100%)',
          border: '1.5px solid rgba(91,80,240,.18)',
          boxShadow: '0 2px 12px rgba(91,80,240,.08)' }}>

          {/* Header */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '16px' }}>
            <div style={{ width: 28, height: 28, borderRadius: '50%', background: 'rgba(91,80,240,.12)',
              display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <Activity style={{ width: '14px', height: '14px', color: 'var(--acc)' }} />
            </div>
            <span style={{ fontSize: '14px', fontWeight: 700, color: 'var(--t1)' }}>Savings plan active</span>
            <span style={{ marginLeft: 'auto', fontSize: '11px', fontWeight: 600,
              color: 'var(--acc)', background: 'rgba(91,80,240,.10)', padding: '2px 8px',
              borderRadius: '20px' }}>{daysLeft(planEndTime)}</span>
          </div>

          {/* Stats */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: '8px', marginBottom: '14px' }}>
            {[['Saving', `${planPercent}%`], ['Duration', `${planDays}d`], ['Saved', `$${planBalanceFmt}`]].map(([label, val]) => (
              <div key={label} style={{ textAlign: 'center', padding: '10px 8px', borderRadius: '14px',
                background: '#fff', border: '1px solid var(--border)',
                boxShadow: '0 1px 3px rgba(13,21,38,.05)' }}>
                <p style={{ margin: 0, fontSize: '10px', fontWeight: 600, color: 'var(--t3)', textTransform: 'uppercase', letterSpacing: '.05em' }}>{label}</p>
                <p className="mono" style={{ margin: '4px 0 0', fontSize: '20px', fontWeight: 800, color: 'var(--t1)' }}>{val}</p>
              </div>
            ))}
          </div>

          {/* Approve banner */}
          {!hasApproval && (
            <div style={{ padding: '12px', borderRadius: '14px',
              background: 'rgba(234,179,8,.08)', border: '1px solid rgba(234,179,8,.25)', marginBottom: '12px' }}>
              <div style={{ display: 'flex', alignItems: 'flex-start', gap: '8px', marginBottom: '10px' }}>
                <AlertCircle style={{ width: '14px', height: '14px', color: '#b45309', flexShrink: 0, marginTop: '1px' }} />
                <p style={{ margin: 0, fontSize: '12px', color: '#92400e', fontWeight: 600 }}>Approve Kasa to auto-save on your behalf</p>
              </div>
              <button onClick={() => void handleApprove()} disabled={busy}
                style={{ width: '100%', height: '36px', borderRadius: '12px', border: 'none',
                  background: busy ? 'var(--surface-muted)' : '#d97706',
                  color: busy ? 'var(--t3)' : '#fff',
                  fontWeight: 700, fontSize: '12px', cursor: busy ? 'not-allowed' : 'pointer',
                  display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px' }}>
                {busy && busyLabel === 'Approving…' ? <Loader2 style={{ width: '13px', height: '13px', animation: 'spin 1s linear infinite' }} /> : <CheckCircle2 style={{ width: '13px', height: '13px' }} />}
                {busy && busyLabel === 'Approving…' ? 'Approving…' : 'Approve USDC'}
              </button>
            </div>
          )}

          {/* Watching status */}
          {hasApproval && (
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '12px',
              fontSize: '12px', fontWeight: 600, color: 'var(--success)',
              background: 'rgba(15,123,77,.07)', padding: '8px 12px', borderRadius: '10px' }}>
              <CheckCircle2 style={{ width: '13px', height: '13px' }} />
              Watching for inbound USDC — auto-saving {planPercent}%
            </div>
          )}

          {/* Withdraw button */}
          <button onClick={() => void handleWithdraw()} disabled={busy}
            style={{ width: '100%', height: '42px', borderRadius: '14px',
              background: busy ? 'var(--surface-muted)' : '#fff',
              border: '1.5px solid var(--border-strong)',
              color: busy ? 'var(--t3)' : 'var(--t1)',
              fontWeight: 700, fontSize: '13px', cursor: busy ? 'not-allowed' : 'pointer',
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px',
              boxShadow: '0 1px 4px rgba(13,21,38,.06)' }}>
            {busy && busyLabel === 'Withdrawing…'
              ? <><Loader2 style={{ width: '14px', height: '14px', animation: 'spin 1s linear infinite' }} />Withdrawing…</>
              : <><ArrowDownToLine style={{ width: '14px', height: '14px', color: 'var(--acc)' }} />
                  {planBalance > 0n ? `Withdraw $${planBalanceFmt}` : 'Cancel plan'}</>}
          </button>
        </div>
      ) : (
        /* ── Setup card ── */
        <div style={{ padding: '20px', borderRadius: '20px', background: '#fff',
          border: '1px solid var(--border)', boxShadow: '0 2px 12px rgba(13,21,38,.06)' }}>
          <p style={{ margin: '0 0 18px', fontSize: '13px', fontWeight: 700, color: 'var(--t1)',
            display: 'flex', alignItems: 'center', gap: '6px' }}>
            <PiggyBank style={{ width: '15px', height: '15px', color: 'var(--acc)' }} />
            New Savings Plan
          </p>

          {/* % slider */}
          <div style={{ marginBottom: '20px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: '10px' }}>
              <span style={{ fontSize: '13px', color: 'var(--t2)', fontWeight: 500 }}>Save % of every inbound</span>
              <span className="mono" style={{ fontSize: '28px', fontWeight: 800, color: 'var(--acc)', lineHeight: 1 }}>{savePct}%</span>
            </div>
            <input type="range" min={1} max={100} value={savePct} onChange={e => setSavePct(Number(e.target.value))}
              style={{ width: '100%', accentColor: 'var(--acc)', marginBottom: '10px' }} />
            <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
              {pctChips.map(p => <button key={p} onClick={() => setSavePct(p)} style={chipStyle(savePct === p)}>{p}%</button>)}
            </div>
          </div>

          {/* Duration slider */}
          <div style={{ marginBottom: '20px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: '10px' }}>
              <span style={{ fontSize: '13px', color: 'var(--t2)', fontWeight: 500 }}>Save for</span>
              <span className="mono" style={{ fontSize: '28px', fontWeight: 800, color: 'var(--acc)', lineHeight: 1 }}>{durationDays}d</span>
            </div>
            <input type="range" min={1} max={365} value={durationDays} onChange={e => setDurationDays(Number(e.target.value))}
              style={{ width: '100%', accentColor: 'var(--acc)', marginBottom: '10px' }} />
            <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
              {dayChips.map(d => <button key={d} onClick={() => setDurationDays(d)} style={chipStyle(durationDays === d)}>{d}d</button>)}
            </div>
          </div>

          {/* Preview row */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center',
            padding: '10px 14px', borderRadius: '12px',
            background: 'rgba(91,80,240,.06)', border: '1px solid rgba(91,80,240,.14)', fontSize: '12px' }}>
            <span style={{ color: 'var(--t3)', fontWeight: 500 }}>On a $100 inbound</span>
            <span style={{ color: 'var(--acc)', fontWeight: 700 }}>
              ${(100 * savePct / 100).toFixed(2)} saved · ${(100 * (1 - savePct / 100)).toFixed(2)} kept
            </span>
          </div>
        </div>
      )}

      {/* Activate button */}
      {!planActive && (
        <button onClick={() => void handleActivate()} disabled={busy || !walletId}
          style={{ width: '100%', height: '50px', borderRadius: '16px',
            background: !busy && walletId ? 'var(--acc)' : 'var(--surface-muted)',
            border: 'none', color: !busy && walletId ? '#fff' : 'var(--t3)',
            fontWeight: 700, fontSize: '15px', cursor: !busy && walletId ? 'pointer' : 'not-allowed',
            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px',
            boxShadow: !busy && walletId ? '0 4px 16px rgba(91,80,240,.30)' : 'none',
            transition: 'all .2s' }}>
          {busy && busyLabel === 'Activating…'
            ? <><Loader2 style={{ width: '16px', height: '16px', animation: 'spin 1s linear infinite' }} />Activating…</>
            : <><PiggyBank style={{ width: '16px', height: '16px' }} />Activate — {savePct}% for {durationDays} days</>}
        </button>
      )}

      {/* Info footer */}
      <div style={{ padding: '10px 14px', borderRadius: '12px',
        background: 'rgba(91,80,240,.05)', border: '1px solid rgba(91,80,240,.12)',
        fontSize: '11px', color: 'var(--t2)', lineHeight: 1.5 }}>
        Auto-save runs server-side — your savings continue even when the app is closed. Check the History tab to see deposits.
      </div>

      <div style={{ padding: '12px 14px', borderRadius: '14px', background: '#fff', border: '1px solid var(--border)', fontSize: '12px', boxShadow: '0 1px 3px rgba(13,21,38,.04)' }}>
        <p style={{ margin: '0 0 4px', fontWeight: 700, color: 'var(--t1)' }}>KasaSavings contract</p>
        <a href={buildAddressExplorerUrl(ARC_TESTNET_ID, KASA_SAVINGS_ADDR)} target="_blank" rel="noopener noreferrer"
          style={{ fontFamily: 'monospace', fontSize: '11px', color: 'var(--acc)', wordBreak: 'break-all', textDecoration: 'none' }}>
          {KASA_SAVINGS_ADDR}
        </a>
        <p style={{ margin: '8px 0 0', color: 'var(--t3)', lineHeight: 1.5 }}>
          Your USDC is self-custodied in this contract. Withdraw any time — no lock enforced.
        </p>
      </div>
    </div>
  )
}
