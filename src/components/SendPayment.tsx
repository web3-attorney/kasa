import { useState } from 'react'
import { useAccount, useWriteContract, useWaitForTransactionReceipt, useSwitchChain, useReadContract } from 'wagmi'
import { erc20Abi, isAddress } from 'viem'
import { ArrowRight, Loader2, CheckCircle2, AlertCircle, ExternalLink } from 'lucide-react'
import { getUsdc, buildTxExplorerUrl } from '@/onchain-facts'
import { parseAmount, Amount, usdcDecimalsFor } from '@/onchain-money'

const ARC_TESTNET_ID = 5042002
const usdcFact = getUsdc(ARC_TESTNET_ID)!

const QUICK_AMOUNTS = ['1', '5', '10', '25']

function parseOnchainError(e: unknown): string {
  const msg = (e as { message?: string })?.message?.toLowerCase() ?? ''
  if (msg.includes('user rejected') || msg.includes('user denied')) return ''
  if (msg.includes('insufficient') || msg.includes('exceeds balance')) return 'Insufficient USDC balance.'
  if (msg.includes('reverted')) return 'Transaction reverted. Check your balance.'
  return 'Transaction failed — please try again.'
}

export default function SendPayment() {
  const { address, chainId } = useAccount()
  const { switchChain, isPending: isSwitching } = useSwitchChain()
  const [to, setTo] = useState('')
  const [amount, setAmount] = useState('')

  const { data: balanceRaw } = useReadContract({
    address: usdcFact.address as `0x${string}`,
    abi: erc20Abi,
    functionName: 'balanceOf',
    args: [address ?? '0x0000000000000000000000000000000000000000'],
    chainId: ARC_TESTNET_ID,
    query: { enabled: Boolean(address) },
  })

  const balance = balanceRaw !== undefined
    ? Amount.fromRaw(balanceRaw, usdcDecimalsFor(ARC_TESTNET_ID)).toFixed(2)
    : '—'

  const { writeContract, data: txHash, isPending, error: writeError, reset } = useWriteContract()
  const { isLoading: isConfirming, isSuccess } = useWaitForTransactionReceipt({ hash: txHash })

  const isWrongChain = address && chainId !== ARC_TESTNET_ID
  const toValid = isAddress(to)
  const amountNum = parseFloat(amount)
  const amountValid = !isNaN(amountNum) && amountNum > 0

  const handleSend = () => {
    if (!toValid || !amountValid || !address) return
    const parsed = parseAmount(ARC_TESTNET_ID, amount)
    writeContract({
      address: usdcFact.address as `0x${string}`,
      abi: erc20Abi,
      functionName: 'transfer',
      args: [to, parsed.raw],
      chainId: ARC_TESTNET_ID,
    })
  }

  const errorMsg = writeError ? parseOnchainError(writeError) : null

  if (isSuccess && txHash) {
    return (
      <div className="space-y-4">
        <div className="flex items-start gap-3 p-4 rounded-2xl bg-emerald-50 border border-emerald-200">
          <CheckCircle2 className="w-5 h-5 text-emerald-600 mt-0.5 shrink-0" />
          <div>
            <p className="font-semibold text-emerald-800 text-sm">Sent!</p>
            <p className="text-emerald-700 text-xs mt-0.5">
              <span className="tabular-nums font-semibold">${parseFloat(amount).toFixed(2)}</span> USDC to{' '}
              <span className="font-mono">{to.slice(0, 6)}…{to.slice(-4)}</span>
            </p>
          </div>
        </div>
        <a href={buildTxExplorerUrl(ARC_TESTNET_ID, txHash)} target="_blank" rel="noopener noreferrer"
          className="flex items-center gap-2 text-xs text-[var(--muted)] hover:text-[var(--ink)] transition-colors">
          <ExternalLink className="w-3.5 h-3.5" /> View on Arc Explorer
        </a>
        <button onClick={() => { reset(); setTo(''); setAmount('') }}
          className="text-xs text-[var(--muted)] underline underline-offset-2 hover:text-[var(--ink)] transition-colors">
          Send again
        </button>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {/* Balance */}
      {address && (
        <div className="flex items-center justify-between px-4 py-3 rounded-xl bg-[var(--surface-muted)] border border-[var(--border)]">
          <span className="text-xs text-[var(--muted)]">Your USDC balance</span>
          <span className="text-sm font-bold text-[var(--ink)] tabular-nums display">${balance}</span>
        </div>
      )}

      {/* Recipient */}
      <div className="space-y-1.5">
        <label className="text-xs font-semibold uppercase tracking-widest text-[var(--muted)]">Recipient</label>
        <input
          type="text"
          value={to}
          onChange={(e) => setTo(e.target.value.trim())}
          placeholder="0x…"
          className={`w-full px-4 py-3 rounded-xl border bg-[var(--surface-muted)] text-[var(--ink)] text-sm font-mono placeholder:text-[var(--subtle)] focus:outline-none focus:ring-2 focus:ring-[var(--focus)] transition-all
            ${to && !toValid ? 'border-red-300 bg-red-50' : 'border-[var(--border)]'}`}
          disabled={isPending || isConfirming}
        />
        {to && !toValid && <p className="text-xs text-red-600">Enter a valid EVM address</p>}
      </div>

      {/* Amount */}
      <div className="space-y-1.5">
        <label className="text-xs font-semibold uppercase tracking-widest text-[var(--muted)]">Amount (USDC)</label>
        <div className="relative">
          <span className="absolute left-4 top-1/2 -translate-y-1/2 text-sm font-semibold text-[var(--muted)]">$</span>
          <input
            type="number"
            min="0"
            step="0.01"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder="0.00"
            className="w-full pl-8 pr-4 py-3 rounded-xl border border-[var(--border)] bg-[var(--surface-muted)] text-[var(--ink)] text-sm tabular-nums placeholder:text-[var(--subtle)] focus:outline-none focus:ring-2 focus:ring-[var(--focus)] transition-all"
            disabled={isPending || isConfirming}
          />
        </div>
        {/* Quick amounts */}
        <div className="flex gap-2">
          {QUICK_AMOUNTS.map((q) => (
            <button key={q} onClick={() => setAmount(q)}
              className={`flex-1 py-1.5 rounded-lg text-xs font-semibold border transition-colors
                ${amount === q ? 'bg-[var(--accent)] text-white border-[var(--accent)]' : 'bg-[var(--surface-muted)] text-[var(--muted)] border-[var(--border)] hover:border-[var(--accent)] hover:text-[var(--ink)]'}`}>
              ${q}
            </button>
          ))}
        </div>
      </div>

      {/* CTA */}
      {isWrongChain ? (
        <button onClick={() => switchChain({ chainId: ARC_TESTNET_ID })} disabled={isSwitching}
          className="w-full h-12 rounded-2xl bg-amber-500 hover:bg-amber-600 text-white font-semibold text-sm transition-colors disabled:opacity-50 flex items-center justify-center gap-2">
          {isSwitching && <Loader2 className="w-4 h-4 animate-spin" />} Switch to Arc Testnet
        </button>
      ) : (
        <button onClick={handleSend}
          disabled={!address || !toValid || !amountValid || isPending || isConfirming}
          className="w-full h-12 rounded-2xl bg-[var(--accent)] hover:bg-[var(--accent-hover)] text-white font-semibold text-sm transition-colors disabled:opacity-50 flex items-center justify-center gap-2">
          {isPending ? <><Loader2 className="w-4 h-4 animate-spin" />Confirm in wallet…</>
            : isConfirming ? <><Loader2 className="w-4 h-4 animate-spin" />Confirming…</>
            : <><ArrowRight className="w-4 h-4" />Send USDC</>}
        </button>
      )}

      {!address && <p className="text-xs text-center text-[var(--subtle)]">Connect your wallet to send</p>}
      {errorMsg && (
        <div className="flex items-start gap-2 p-3 rounded-xl bg-red-50 border border-red-200">
          <AlertCircle className="w-4 h-4 text-red-500 mt-0.5 shrink-0" />
          <p className="text-xs text-red-700">{errorMsg}</p>
        </div>
      )}
    </div>
  )
}
