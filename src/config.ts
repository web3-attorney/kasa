/**
 * wagmi configuration
 * Built with Arc Studio — https://studio.arc.io
 */

import { http, createConfig } from 'wagmi'
import { mainnet } from 'wagmi/chains'
import { arc, arcTestnet } from 'viem/chains'
import { injected } from 'wagmi/connectors'
import { registerChain } from './tracing'
import { ARC_CHAIN_ID } from './chain'

const isMainnet = ARC_CHAIN_ID === arc.id

// Pre-register chain RPC URLs so trace events show correct chain names immediately
registerChain(
  isMainnet ? arc.id : arcTestnet.id,
  isMainnet ? arc.rpcUrls.default.http[0] : arcTestnet.rpcUrls.default.http[0],
)

export const config = isMainnet
  ? createConfig({
      chains: [arc, mainnet],
      connectors: [injected()],
      transports: {
        [arc.id]: http(arc.rpcUrls.default.http[0]),
        [mainnet.id]: http(),
      },
    })
  : createConfig({
      chains: [arcTestnet, mainnet],
      connectors: [injected()],
      transports: {
        [arcTestnet.id]: http(arcTestnet.rpcUrls.default.http[0]),
        [mainnet.id]: http(),
      },
    })
