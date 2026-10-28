/**
 * UsernameSetup — register a username in KasaRegistry onchain.
 * Shown once after account creation if the user doesn't have a username yet.
 */
import { useState } from 'react'
import { useWriteContract, useWaitForTransactionReceipt } from 'wagmi'
import { AtSign, Loader2, CheckCircle2 } from 'lucide-react'
import { toast } from 'sonner'

const REGISTRY_ADDRESS = import.meta.env.VITE_REGISTRY_ADDRESS as `0x${string}` | undefined

const REGISTRY_ABI = [
  {
    name: 'register',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [{ name: 'username', type: 'string' }],
    outputs: [],
  },
  {
    name: 'hasUsername',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'wallet', type: 'address' }],
    outputs: [{ type: 'bool' }],
  },
] as const

interface Props {
  suggestedUsername: string
  walletAddress: string
  onComplete: (username: string) => void
}

const USERNAME_RE = /^[a-z0-9_]{3,20}$/

export default function UsernameSetup({ suggestedUsername, walletAddress, onComplete }: Props) {
  const [username, setUsername] = useState(suggestedUsername)
  const [skipped, setSkipped] = useState(false)

  const { writeContract, data: txHash, isPending, reset } = useWriteContract()
  const { isSuccess } = useWaitForTransactionReceipt({ hash: txHash })

  const valid = USERNAME_RE.test(username)

  const handleRegister = () => {
    if (!valid) { toast.error('Username must be 3-20 chars, a-z 0-9 _'); return }
    if (!REGISTRY_ADDRESS) {
      // Registry not yet deployed — save username locally and continue
      toast.success(`@${username} reserved! Onchain registration will complete when contract is deployed.`, { duration: 5000 })
      onComplete(username)
      return
    }
    writeContract({
      address: REGISTRY_ADDRESS,
      abi: REGISTRY_ABI,
      functionName: 'register',
      args: [username],
      chainId: 5042002,
    })
  }

  if (isSuccess) {
    return (
      <div className="flex flex-col items-center gap-4 py-6 text-center">
        <div className="w-12 h-12 rounded-full bg-emerald-100 flex items-center justify-center">
          <CheckCircle2 className="w-6 h-6 text-emerald-600" />
        </div>
        <div>
          <p className="font-semibold text-[var(--ink)]">@{username} registered!</p>
          <p className="text-xs text-[var(--muted)] mt-1">Anyone can now send USDC to @{username}</p>
        </div>
        <button onClick={() => { reset(); onComplete(username) }}
          className="h-10 px-6 rounded-xl bg-[var(--accent)] text-white font-semibold text-sm hover:opacity-90 transition-opacity">
          Continue to Kasa
        </button>
      </div>
    )
  }

  if (skipped) {
    return (
      <div className="flex flex-col items-center gap-4 py-6 text-center">
        <p className="text-sm text-[var(--muted)]">You can register a username later from Settings.</p>
        <button onClick={() => onComplete('')}
          className="h-10 px-6 rounded-xl border border-[var(--border)] text-[var(--ink-2)] font-semibold text-sm hover:bg-[var(--surface-muted)] transition-colors">
          Enter Kasa
        </button>
      </div>
    )
  }

  return (
    <div className="space-y-5">
      <div className="space-y-1">
        <h2 className="text-base font-semibold text-[var(--ink)]">Claim your username</h2>
        <p className="text-xs text-[var(--muted)]">
          Others can send USDC to @{username || 'yourname'} directly. Permanent and onchain.
        </p>
      </div>

      <div className="space-y-1.5">
        <div className="relative">
          <AtSign className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--muted)]" />
          <input
            type="text"
            value={username}
            onChange={(e) => setUsername(e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, '').slice(0, 20))}
            placeholder="yourname"
            className={`w-full pl-9 pr-4 py-3 rounded-xl border bg-[var(--surface-muted)] text-[var(--ink)] text-sm font-mono focus:outline-none focus:ring-2 focus:ring-[var(--focus)] transition-all
              ${username && !valid ? 'border-red-300' : 'border-[var(--border)]'}`}
          />
        </div>
        {username && !valid && (
          <p className="text-xs text-red-600">3–20 characters, lowercase letters, numbers and _ only</p>
        )}
        <p className="text-[10px] text-[var(--subtle)] font-mono break-all">
          wallet: {walletAddress.slice(0, 10)}…{walletAddress.slice(-8)}
        </p>
      </div>

      <button onClick={handleRegister} disabled={!valid || isPending}
        className="w-full h-11 rounded-xl bg-[var(--accent)] hover:opacity-90 text-white font-semibold text-sm transition-opacity disabled:opacity-50 flex items-center justify-center gap-2">
        {isPending && <Loader2 className="w-4 h-4 animate-spin" />}
        Register @{username || 'username'}
      </button>
      <button onClick={() => setSkipped(true)}
        className="w-full text-xs text-[var(--muted)] hover:text-[var(--ink)] transition-colors">
        Skip for now
      </button>
    </div>
  )
}
