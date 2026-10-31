/**
 * Chain configuration — switches between testnet and mainnet via VITE_ARC_CHAIN_ID.
 * Set VITE_ARC_CHAIN_ID=5042 for Arc Mainnet, 5042002 for Arc Testnet (default).
 */
import { arc, arcTestnet } from 'viem/chains'

export const ARC_CHAIN_ID: number =
  Number(import.meta.env.VITE_ARC_CHAIN_ID ?? 5042002)

export const arcChain = ARC_CHAIN_ID === 5042 ? arc : arcTestnet
