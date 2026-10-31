import { useState, useEffect, useRef } from 'react'
import {
  useAccount,
  useWriteContract,
  useWaitForTransactionReceipt,
  useSwitchChain,
} from 'wagmi'
import { parseEventLogs } from 'viem'
import { Fingerprint, ExternalLink, Loader2, CheckCircle2, AlertCircle } from 'lucide-react'
import { buildTxExplorerUrl, buildAddressExplorerUrl } from '@/onchain-facts'

import { ARC_CHAIN_ID as ARC_TESTNET_ID } from '@/chain'

const IDENTITY_REGISTRY = '0x8004A818BFB912233c491871b3d84c89A494BD9e' as const

const identityAbi = [
  {
    type: 'function',
    name: 'register',
    stateMutability: 'nonpayable',
    inputs: [{ name: 'agentURI', type: 'string' }],
    outputs: [{ name: 'agentId', type: 'uint256' }],
  },
  {
    type: 'event',
    name: 'Registered',
    inputs: [
      { name: 'agentId', type: 'uint256', indexed: true },
      { name: 'agentURI', type: 'string', indexed: false },
      { name: 'owner', type: 'address', indexed: true },
    ],
  },
] as const

interface AgentRegistrationProps {
  onRegistered: (agentId: bigint, txHash: string) => void
}

export default function AgentRegistration({ onRegistered }: AgentRegistrationProps) {
  const { address, chainId } = useAccount()
  const { switchChain, isPending: isSwitching } = useSwitchChain()
  const [agentUri, setAgentUri] = useState(
    typeof window !== 'undefined'
      ? `${window.location.origin}/api/agent.json`
      : 'https://ideqs3zwnt6ek0nn4yzuf.preview.studio.arc.io/api/agent.json'
  )
  const notifiedRef = useRef(false)

  const {
    writeContract,
    data: txHash,
    isPending,
    error: writeError,
    reset,
  } = useWriteContract()

  const { isLoading: isConfirming, isSuccess, data: receipt } = useWaitForTransactionReceipt({
    hash: txHash,
  })

  const isWrongChain = address && chainId !== ARC_TESTNET_ID

  // Fire onRegistered exactly once when tx confirms
  useEffect(() => {
    if (isSuccess && receipt && txHash && !notifiedRef.current) {
      const logs = parseEventLogs({ abi: identityAbi, eventName: 'Registered', logs: receipt.logs })
      if (logs.length > 0) {
        notifiedRef.current = true
        onRegistered(logs[0].args.agentId, txHash)
      }
    }
  }, [isSuccess, receipt, txHash]) // eslint-disable-line react-hooks/exhaustive-deps

  const handleRegister = () => {
    if (!agentUri.trim()) return
    notifiedRef.current = false
    writeContract({
      address: IDENTITY_REGISTRY,
      abi: identityAbi,
      functionName: 'register',
      args: [agentUri.trim()],
      chainId: ARC_TESTNET_ID,
    })
  }

  const errorMessage = writeError
    ? writeError.message.includes('user rejected') || writeError.message.includes('User rejected')
      ? null
      : writeError.message.includes('reverted')
        ? 'Transaction reverted. Check that you have USDC for gas.'
        : 'Transaction failed. Please try again.'
    : null

  if (isSuccess && receipt) {
    const logs = parseEventLogs({ abi: identityAbi, eventName: 'Registered', logs: receipt.logs })
    const agentId = logs[0]?.args.agentId

    return (
      <div className="space-y-4">
        <div className="flex items-center gap-3 p-4 rounded-2xl bg-emerald-50 border border-emerald-200">
          <CheckCircle2 className="w-5 h-5 text-emerald-600 shrink-0" />
          <div className="min-w-0">
            <p className="font-semibold text-emerald-800 text-sm">Agent registered!</p>
            {agentId !== undefined && (
              <p className="text-emerald-700 text-xs mt-0.5 font-mono tabular-nums">
                Agent ID: {agentId.toString()}
              </p>
            )}
          </div>
        </div>
        {txHash && (
          <a
            href={buildTxExplorerUrl(ARC_TESTNET_ID, txHash)}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-2 text-xs text-[var(--muted)] hover:text-[var(--ink)] transition-colors"
          >
            <ExternalLink className="w-3.5 h-3.5" />
            View transaction on Arc Explorer
          </a>
        )}
        <button
          onClick={() => { reset(); notifiedRef.current = false }}
          className="text-xs text-[var(--muted)] underline underline-offset-2 hover:text-[var(--ink)] transition-colors"
        >
          Register another
        </button>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <label className="text-xs font-semibold uppercase tracking-widest text-[var(--muted)]">
          Agent URI
        </label>
        <input
          type="url"
          value={agentUri}
          onChange={(e) => setAgentUri(e.target.value)}
          placeholder="https://example.com/agent.json"
          className="w-full px-4 py-3 rounded-xl border border-[var(--border)] bg-[var(--surface-muted)] text-[var(--ink)] text-sm font-mono placeholder:text-[var(--subtle)] focus:outline-none focus:ring-2 focus:ring-[var(--focus)] focus:border-transparent transition-all"
          disabled={isPending || isConfirming}
        />
        <p className="text-xs text-[var(--subtle)]">
          Points to your ERC-8004 registration JSON file — pre-filled with this app's endpoint.
        </p>
      </div>

      {isWrongChain ? (
        <button
          onClick={() => switchChain({ chainId: ARC_TESTNET_ID })}
          disabled={isSwitching}
          className="w-full h-12 rounded-2xl bg-amber-500 hover:bg-amber-600 text-white font-semibold text-sm transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
        >
          {isSwitching ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
          Switch to Arc
        </button>
      ) : (
        <button
          onClick={handleRegister}
          disabled={!address || isPending || isConfirming || !agentUri.trim()}
          className="w-full h-12 rounded-2xl bg-[var(--accent)] hover:bg-[var(--accent-hover)] text-white font-semibold text-sm transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
        >
          {isPending ? (
            <><Loader2 className="w-4 h-4 animate-spin" />Confirm in wallet…</>
          ) : isConfirming ? (
            <><Loader2 className="w-4 h-4 animate-spin" />Confirming…</>
          ) : (
            <><Fingerprint className="w-4 h-4" />Register Agent</>
          )}
        </button>
      )}

      {!address && (
        <p className="text-xs text-center text-[var(--subtle)]">Connect your wallet to register</p>
      )}

      {errorMessage && (
        <div className="flex items-start gap-2 p-3 rounded-xl bg-red-50 border border-red-200">
          <AlertCircle className="w-4 h-4 text-red-500 mt-0.5 shrink-0" />
          <p className="text-xs text-red-700">{errorMessage}</p>
        </div>
      )}

      <div className="p-3 rounded-xl bg-[var(--surface-muted)] border border-[var(--border)] text-xs text-[var(--muted)] space-y-1">
        <p className="font-medium text-[var(--ink-2)]">What happens onchain</p>
        <p>Calls <code className="font-mono bg-[var(--surface)] px-1 rounded">register(agentURI)</code> on the ERC-8004 IdentityRegistry at</p>
        <a
          href={buildAddressExplorerUrl(ARC_TESTNET_ID, IDENTITY_REGISTRY)}
          target="_blank"
          rel="noopener noreferrer"
          className="font-mono text-[var(--accent)] hover:underline break-all"
        >
          {IDENTITY_REGISTRY}
        </a>
        <p className="pt-1">Mints an agent NFT (ERC-721) and returns a unique <code className="font-mono bg-[var(--surface)] px-1 rounded">agentId</code>. Gas is paid in USDC (~0.006 USDC).</p>
      </div>
    </div>
  )
}
