import { useReadContract } from 'wagmi'
import { ExternalLink, CircleUser, Wifi } from 'lucide-react'
import { buildAddressExplorerUrl, buildTxExplorerUrl } from '@/onchain-facts'

const IDENTITY_REGISTRY = '0x8004A818BFB912233c491871b3d84c89A494BD9e' as const
const ARC_TESTNET_ID = 5042002

const identityAbi = [
  {
    type: 'function',
    name: 'ownerOf',
    stateMutability: 'view',
    inputs: [{ name: 'tokenId', type: 'uint256' }],
    outputs: [{ name: '', type: 'address' }],
  },
  {
    type: 'function',
    name: 'getAgentWallet',
    stateMutability: 'view',
    inputs: [{ name: 'agentId', type: 'uint256' }],
    outputs: [{ name: '', type: 'address' }],
  },
] as const

interface AgentCardProps {
  agentId: bigint
  txHash: string
}

function truncate(addr: string) {
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`
}

export default function AgentCard({ agentId, txHash }: AgentCardProps) {
  const { data: owner } = useReadContract({
    address: IDENTITY_REGISTRY,
    abi: identityAbi,
    functionName: 'ownerOf',
    args: [agentId],
    chainId: ARC_TESTNET_ID,
  })

  const { data: agentWallet } = useReadContract({
    address: IDENTITY_REGISTRY,
    abi: identityAbi,
    functionName: 'getAgentWallet',
    args: [agentId],
    chainId: ARC_TESTNET_ID,
  })

  const rows = [
    { label: 'Agent ID', value: agentId.toString(), mono: true },
    { label: 'Owner', value: owner ? truncate(owner) : '…', mono: true, href: owner ? buildAddressExplorerUrl(ARC_TESTNET_ID, owner) : undefined },
    { label: 'Agent Wallet', value: agentWallet && agentWallet !== '0x0000000000000000000000000000000000000000' ? truncate(agentWallet) : 'Not set', mono: true, href: agentWallet && agentWallet !== '0x0000000000000000000000000000000000000000' ? buildAddressExplorerUrl(ARC_TESTNET_ID, agentWallet) : undefined },
    { label: 'Registry', value: truncate(IDENTITY_REGISTRY), mono: true, href: buildAddressExplorerUrl(ARC_TESTNET_ID, IDENTITY_REGISTRY) },
    { label: 'Namespace', value: `eip155:${ARC_TESTNET_ID}:${IDENTITY_REGISTRY}`, mono: true, small: true },
  ]

  return (
    <div className="rounded-2xl border border-[var(--border)] overflow-hidden">
      {/* Header */}
      <div className="p-5 bg-[var(--surface)] border-b border-[var(--border)] flex items-center gap-3">
        <div className="w-10 h-10 rounded-xl bg-[var(--accent)] flex items-center justify-center shrink-0">
          <CircleUser className="w-5 h-5 text-white" />
        </div>
        <div className="min-w-0">
          <p className="font-semibold text-[var(--ink)] text-sm">Kasa</p>
          <div className="flex items-center gap-1.5 mt-0.5">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 shrink-0" />
            <span className="text-xs text-[var(--muted)]">Active on Arc Testnet</span>
          </div>
        </div>
        <a
          href={buildTxExplorerUrl(ARC_TESTNET_ID, txHash)}
          target="_blank"
          rel="noopener noreferrer"
          className="ml-auto p-2 rounded-lg hover:bg-[var(--surface-muted)] transition-colors text-[var(--muted)] hover:text-[var(--ink)]"
          title="View registration transaction"
        >
          <ExternalLink className="w-4 h-4" />
        </a>
      </div>

      {/* Rows */}
      <div className="divide-y divide-[var(--border)]">
        {rows.map((row) => (
          <div key={row.label} className="flex items-center justify-between px-5 py-3 gap-4">
            <span className="text-xs text-[var(--muted)] shrink-0 uppercase tracking-widest">{row.label}</span>
            {row.href ? (
              <a
                href={row.href}
                target="_blank"
                rel="noopener noreferrer"
                className={`${row.mono ? 'font-mono' : ''} ${row.small ? 'text-[10px]' : 'text-xs'} text-[var(--accent)] hover:underline truncate max-w-[60%] text-right tabular-nums`}
              >
                {row.value}
              </a>
            ) : (
              <span className={`${row.mono ? 'font-mono' : ''} ${row.small ? 'text-[10px]' : 'text-xs'} text-[var(--ink-2)] truncate max-w-[60%] text-right tabular-nums`}>
                {row.value}
              </span>
            )}
          </div>
        ))}
      </div>

      {/* x402 badge */}
      <div className="px-5 py-4 bg-[var(--surface-muted)] border-t border-[var(--border)] flex items-center gap-2">
        <Wifi className="w-4 h-4 text-[var(--accent)] shrink-0" />
        <div className="text-xs text-[var(--muted)]">
          <span className="font-semibold text-[var(--ink-2)]">x402 payments enabled</span>
          <span className="mx-1.5 text-[var(--border-strong)]">·</span>
          POST <code className="font-mono bg-[var(--surface)] px-1 py-0.5 rounded">/api/agent-service</code>
          <span className="mx-1.5 text-[var(--border-strong)]">·</span>
          $0.01 USDC / call
        </div>
      </div>
    </div>
  )
}
