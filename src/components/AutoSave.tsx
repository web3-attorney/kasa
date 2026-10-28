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
  const planActive     = planData ? planData[5] : false
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

  const handleWithdraw = async () => {
    setBusy(true); setBusyLabel('Withdrawing…')
    try {
      if (!walletId || !walletAddress) throw new Error('No wallet')
      await serverContractCall(walletId, KASA_SAVINGS_ADDR, 'withdraw()', [])
      // Deactivate server watcher after withdraw
      await registerServerPlan(walletId, walletAddress, 0)
      toast.success('Savings withdrawn!')
      await refetch()
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Failed') }
    setBusy(false)
  }

  const pctChips = [5, 10, 15, 20, 25, 30, 50]
  const dayChips = [7, 14, 30, 60, 90, 180, 365]

  const chipStyle = (active: boolean): React.CSSProperties => ({
    padding: '4px 10px', borderRadius: '10px', border: 'none', cursor: 'pointer', fontSize: '12px', fontWeight: 600,
    background: active ? 'var(--acc)' : 'rgba(255,255,255,.08)',
    color: active ? '#0b0b0c' : 'var(--t2)', transition: 'all .15s',
  })

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '10px 14px', borderRadius: '14px', background: 'rgba(255,255,255,.04)', border: '1px solid rgba(255,255,255,.08)' }}>
        <span style={{ fontSize: '12px', color: 'var(--t3)' }}>Wallet balance</span>
        <span className="mono" style={{ fontSize: '13px', fontWeight: 600, color: 'var(--t1)' }}>${balanceFmt} USDC</span>
      </div>

      {planActive ? (
        <div style={{ padding: '16px', borderRadius: '18px', background: 'rgba(34,197,94,.08)', border: '1px solid rgba(34,197,94,.2)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '12px' }}>
            <Activity style={{ width: '14px', height: '14px', color: '#22c55e' }} />
            <span style={{ fontSize: '13px', fontWeight: 600, color: '#4ade80' }}>Savings plan active</span>
            <span style={{ marginLeft: 'auto', fontSize: '11px', color: '#86efac' }}>{daysLeft(planEndTime)}</span>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: '8px', marginBottom: '12px' }}>
            {[['Saving', `${planPercent}%`], ['Duration', `${planDays}d`], ['Saved', `$${planBalanceFmt}`]].map(([label, val]) => (
              <div key={label} style={{ textAlign: 'center', padding: '8px', borderRadius: '12px', background: 'rgba(255,255,255,.04)' }}>
                <p style={{ margin: 0, fontSize: '10px', color: 'var(--t3)' }}>{label}</p>
                <p className="mono" style={{ margin: '2px 0 0', fontSize: '18px', fontWeight: 700, color: 'var(--t1)' }}>{val}</p>
              </div>
            ))}
          </div>

          {!hasApproval && (
            <div style={{ padding: '12px', borderRadius: '14px', background: 'rgba(251,191,36,.08)', border: '1px solid rgba(251,191,36,.2)', marginBottom: '10px' }}>
              <div style={{ display: 'flex', alignItems: 'flex-start', gap: '8px', marginBottom: '10px' }}>
                <AlertCircle style={{ width: '14px', height: '14px', color: '#fbbf24', flexShrink: 0, marginTop: '1px' }} />
                <p style={{ margin: 0, fontSize: '12px', color: '#fcd34d', fontWeight: 500 }}>One more step: approve Kasa to auto-save on your behalf</p>
              </div>
              <button onClick={() => void handleApprove()} disabled={busy}
                style={{ width: '100%', height: '36px', borderRadius: '12px', border: 'none',
                  background: busy ? 'rgba(255,255,255,.08)' : '#fbbf24', color: busy ? 'var(--t3)' : '#0b0b0c',
                  fontWeight: 700, fontSize: '12px', cursor: busy ? 'not-allowed' : 'pointer',
                  display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px' }}>
                {busy && busyLabel === 'Approving…' ? <Loader2 style={{ width: '13px', height: '13px', animation: 'spin 1s linear infinite' }} /> : <CheckCircle2 style={{ width: '13px', height: '13px' }} />}
                {busy && busyLabel === 'Approving…' ? 'Approving…' : 'Approve USDC'}
              </button>
            </div>
          )}

          {hasApproval && (
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '10px', fontSize: '12px', color: '#4ade80' }}>
              <CheckCircle2 style={{ width: '13px', height: '13px' }} />
              Watching for inbound USDC — auto-saving {planPercent}%
            </div>
          )}

          {planBalance > 0n && (
            <button onClick={() => void handleWithdraw()} disabled={busy}
              style={{ width: '100%', height: '40px', borderRadius: '12px',
                background: busy ? 'rgba(255,255,255,.08)' : 'rgba(255,255,255,.12)',
                border: '1px solid rgba(255,255,255,.18)', color: busy ? 'var(--t3)' : 'var(--t1)',
                fontWeight: 600, fontSize: '13px', cursor: busy ? 'not-allowed' : 'pointer',
                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px' }}>
              {busy && busyLabel === 'Withdrawing…' ? <Loader2 style={{ width: '14px', height: '14px', animation: 'spin 1s linear infinite' }} /> : <ArrowDownToLine style={{ width: '14px', height: '14px' }} />}
              {busy && busyLabel === 'Withdrawing…' ? 'Withdrawing…' : `Withdraw $${planBalanceFmt}`}
            </button>
          )}
        </div>
      ) : (
        <div style={{ padding: '16px', borderRadius: '18px', background: 'rgba(255,255,255,.04)', border: '1px solid rgba(255,255,255,.1)' }}>
          <p style={{ margin: '0 0 14px', fontSize: '11px', fontWeight: 600, letterSpacing: '.06em', textTransform: 'uppercase', color: 'var(--t3)' }}>New Savings Plan</p>

          <div style={{ marginBottom: '16px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px' }}>
              <span style={{ fontSize: '13px', color: 'var(--t2)' }}>Save % of every inbound</span>
              <span className="mono" style={{ fontSize: '22px', fontWeight: 700, color: 'var(--acc)' }}>{savePct}%</span>
            </div>
            <input type="range" min={1} max={100} value={savePct} onChange={e => setSavePct(Number(e.target.value))}
              style={{ width: '100%', accentColor: 'var(--acc)', marginBottom: '8px' }} />
            <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
              {pctChips.map(p => <button key={p} onClick={() => setSavePct(p)} style={chipStyle(savePct === p)}>{p}%</button>)}
            </div>
          </div>

          <div style={{ marginBottom: '16px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px' }}>
              <span style={{ fontSize: '13px', color: 'var(--t2)' }}>Save for</span>
              <span className="mono" style={{ fontSize: '22px', fontWeight: 700, color: 'var(--acc)' }}>{durationDays}d</span>
            </div>
            <input type="range" min={1} max={365} value={durationDays} onChange={e => setDurationDays(Number(e.target.value))}
              style={{ width: '100%', accentColor: 'var(--acc)', marginBottom: '8px' }} />
            <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
              {dayChips.map(d => <button key={d} onClick={() => setDurationDays(d)} style={chipStyle(durationDays === d)}>{d}d</button>)}
            </div>
          </div>

          <div style={{ display: 'flex', justifyContent: 'space-between', padding: '10px 12px', borderRadius: '12px',
            background: 'rgba(255,255,255,.04)', border: '1px solid rgba(255,255,255,.08)', fontSize: '12px' }}>
            <span style={{ color: 'var(--t3)' }}>On a $100 inbound</span>
            <span style={{ color: 'var(--t1)', fontWeight: 600 }}>
              → ${(100 * savePct / 100).toFixed(2)} saved · ${(100 * (1 - savePct / 100)).toFixed(2)} kept
            </span>
          </div>
        </div>
      )}

      {!planActive && (
        <button onClick={() => void handleActivate()} disabled={busy || !walletId}
          style={{ width: '100%', height: '48px', borderRadius: '16px',
            background: !busy && walletId ? 'var(--acc)' : 'rgba(255,255,255,.12)',
            border: 'none', color: !busy && walletId ? '#0b0b0c' : 'var(--t3)',
            fontWeight: 700, fontSize: '14px', cursor: !busy && walletId ? 'pointer' : 'not-allowed',
            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px', transition: 'all .2s' }}>
          {busy && busyLabel === 'Activating…'
            ? <><Loader2 style={{ width: '16px', height: '16px', animation: 'spin 1s linear infinite' }} />Activating…</>
            : <><PiggyBank style={{ width: '16px', height: '16px' }} />Activate — {savePct}% for {durationDays} days</>}
        </button>
      )}

      <div style={{ padding: '10px 14px', borderRadius: '12px', background: 'rgba(255,255,255,.03)', border: '1px solid rgba(255,255,255,.06)', fontSize: '11px', color: 'var(--t3)' }}>
        Auto-save runs server-side — your savings continue even when the app is closed. Check the History tab to see deposits.
      </div>

      <div style={{ padding: '12px 14px', borderRadius: '14px', background: 'rgba(255,255,255,.03)', border: '1px solid rgba(255,255,255,.06)', fontSize: '12px' }}>
        <p style={{ margin: '0 0 4px', fontWeight: 600, color: 'var(--t2)' }}>KasaSavings contract</p>
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
