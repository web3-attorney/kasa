import { useReadContract, useWriteContract, useWaitForTransactionReceipt, useAccount } from 'wagmi'
import { useState, useEffect } from 'react'
import { Star, Loader2, CheckCircle2, AlertCircle } from 'lucide-react'
import { keccak256, toBytes } from 'viem'
import { buildTxExplorerUrl } from '@/onchain-facts'
import { toast } from 'sonner'

const REPUTATION_REGISTRY = '0x8004B663056A597Dffe9eCcC1965A193B7388713' as const
const ARC_TESTNET_ID = 5042002

const reputationAbi = [
  {
    type: 'function',
    name: 'giveFeedback',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'agentId', type: 'uint256' },
      { name: 'value', type: 'int128' },
      { name: 'valueDecimals', type: 'uint8' },
      { name: 'tag1', type: 'string' },
      { name: 'tag2', type: 'string' },
      { name: 'endpoint', type: 'string' },
      { name: 'feedbackURI', type: 'string' },
      { name: 'feedbackHash', type: 'bytes32' },
    ],
    outputs: [],
  },
  {
    type: 'function',
    name: 'getSummary',
    stateMutability: 'view',
    inputs: [
      { name: 'agentId', type: 'uint256' },
      { name: 'clientAddresses', type: 'address[]' },
      { name: 'tag1', type: 'string' },
      { name: 'tag2', type: 'string' },
    ],
    outputs: [
      { name: 'count', type: 'uint64' },
      { name: 'summaryValue', type: 'int128' },
      { name: 'summaryValueDecimals', type: 'uint8' },
    ],
  },
  {
    type: 'function',
    name: 'getClients',
    stateMutability: 'view',
    inputs: [{ name: 'agentId', type: 'uint256' }],
    outputs: [{ name: '', type: 'address[]' }],
  },
] as const

interface ReputationPanelProps {
  agentId: bigint
}

export default function ReputationPanel({ agentId }: ReputationPanelProps) {
  const { address } = useAccount()
  const [score, setScore] = useState(90)
  const [comment, setComment] = useState('')

  const { data: clients } = useReadContract({
    address: REPUTATION_REGISTRY,
    abi: reputationAbi,
    functionName: 'getClients',
    args: [agentId],
    chainId: ARC_TESTNET_ID,
  })

  const { data: summary, refetch: refetchSummary } = useReadContract({
    address: REPUTATION_REGISTRY,
    abi: reputationAbi,
    functionName: 'getSummary',
    args: [agentId, clients && clients.length > 0 ? clients : ['0x0000000000000000000000000000000000000001'], '', ''],
    chainId: ARC_TESTNET_ID,
    query: { enabled: true },
  })

  const {
    writeContract,
    data: txHash,
    isPending,
    error: writeError,
    reset,
  } = useWriteContract()

  const { isLoading: isConfirming, isSuccess } = useWaitForTransactionReceipt({ hash: txHash })

  useEffect(() => {
    if (isSuccess) {
      toast.success('Feedback submitted onchain')
      void refetchSummary()
      reset()
    }
  }, [isSuccess]) // eslint-disable-line react-hooks/exhaustive-deps

  const handleFeedback = () => {
    if (!address) return
    const body = JSON.stringify({ rating: score, comment: comment || '' })
    writeContract({
      address: REPUTATION_REGISTRY,
      abi: reputationAbi,
      functionName: 'giveFeedback',
      args: [
        agentId,
        BigInt(score),
        0,
        'service-quality',
        '',
        '/api/agent-service',
        '',
        keccak256(toBytes(body)),
      ],
      chainId: ARC_TESTNET_ID,
    })
  }

  const avgScore =
    summary && summary[0] > 0n
      ? Number(summary[1]) / Math.pow(10, summary[2])
      : null

  const errorMsg = writeError
    ? writeError.message.includes('user rejected')
      ? null
      : writeError.message.includes('clientAddresses required')
        ? 'Registry: clientAddresses required. Leave feedback first, then the summary will show.'
        : 'Transaction failed. Agent owner cannot rate their own agent.'
    : null

  return (
    <div className="space-y-5">
      {/* Summary */}
      {summary && summary[0] > 0n && (
        <div className="flex items-center gap-4 p-4 rounded-2xl bg-[var(--surface-muted)] border border-[var(--border)]">
          <div className="flex items-center gap-1.5">
            <Star className="w-4 h-4 fill-amber-400 text-amber-400" />
            <span className="text-xl font-bold text-[var(--ink)] display tabular-nums">
              {avgScore !== null ? avgScore.toFixed(1) : '—'}
            </span>
          </div>
          <div className="text-xs text-[var(--muted)]">
            <span className="tabular-nums font-semibold text-[var(--ink-2)]">{summary[0].toString()}</span> feedback{summary[0] !== 1n ? 's' : ''} from{' '}
            <span className="tabular-nums font-semibold text-[var(--ink-2)]">{(clients ?? []).length}</span> client{(clients ?? []).length !== 1 ? 's' : ''}
          </div>
        </div>
      )}

      {/* Give feedback */}
      <div className="space-y-3">
        <p className="text-xs font-semibold uppercase tracking-widest text-[var(--muted)]">Leave feedback</p>

        <div className="space-y-1">
          <div className="flex justify-between text-xs text-[var(--muted)]">
            <span>Score</span>
            <span className="tabular-nums font-semibold text-[var(--ink)]">{score}/100</span>
          </div>
          <input
            type="range"
            min={0}
            max={100}
            value={score}
            onChange={(e) => setScore(Number(e.target.value))}
            className="w-full accent-[var(--accent)]"
          />
        </div>

        <input
          type="text"
          value={comment}
          onChange={(e) => setComment(e.target.value)}
          placeholder="Optional comment…"
          className="w-full px-4 py-3 rounded-xl border border-[var(--border)] bg-[var(--surface-muted)] text-[var(--ink)] text-sm placeholder:text-[var(--subtle)] focus:outline-none focus:ring-2 focus:ring-[var(--focus)] focus:border-transparent transition-all"
          disabled={isPending || isConfirming}
        />

        <button
          onClick={handleFeedback}
          disabled={!address || isPending || isConfirming}
          className="w-full h-11 rounded-xl bg-[var(--surface-muted)] hover:bg-[var(--surface)] border border-[var(--border)] text-[var(--ink)] font-semibold text-sm transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
        >
          {isPending ? (
            <><Loader2 className="w-4 h-4 animate-spin" />Confirm in wallet…</>
          ) : isConfirming ? (
            <><Loader2 className="w-4 h-4 animate-spin" />Confirming…</>
          ) : (
            <><Star className="w-4 h-4" />Submit feedback</>
          )}
        </button>

        {txHash && !isConfirming && (
          <a
            href={buildTxExplorerUrl(ARC_TESTNET_ID, txHash)}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1 text-xs text-[var(--muted)] hover:text-[var(--ink)] transition-colors"
          >
            <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" />
            View on Arc Explorer
          </a>
        )}

        {errorMsg && (
          <div className="flex items-start gap-2 p-3 rounded-xl bg-red-50 border border-red-200">
            <AlertCircle className="w-4 h-4 text-red-500 mt-0.5 shrink-0" />
            <p className="text-xs text-red-700">{errorMsg}</p>
          </div>
        )}

        <p className="text-xs text-[var(--subtle)]">
          Note: the ERC-8004 registry does not allow an owner to rate their own agent. Use a second wallet to leave feedback.
        </p>
      </div>
    </div>
  )
}


