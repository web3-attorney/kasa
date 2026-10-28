# Kasa — Onchain Treasury Agent

> Built with Arc Studio - money-powered apps in minutes

This is the **project memory** - what Arc Studio remembers about building this app. It helps future agents (or humans) understand and extend the project.

---

## What This App Does

Onchain agent identity registered via ERC-8004 on Arc Testnet + pay-per-call billing via x402 Circle Gateway Nanopayments.

- ERC-8004 IdentityRegistry (Arc Testnet): 0x8004A818BFB912233c491871b3d84c89A494BD9e
- ERC-8004 ReputationRegistry (Arc Testnet): 0x8004B663056A597Dffe9eCcC1965A193B7388713
- Agent registration JSON: /agent.json (served by Express backend at :3001, proxied via /api/agent.json in Vite)
- Paid endpoint: POST /api/agent-service ($0.01 USDC per call via Circle Gateway)
- VITE_SELLER_ADDRESS: set this in .env to your EVM address to receive payments
- KasaSavings contract (Arc Testnet): 0xce160338e23cbd581bfecc8f5857c7c4f686d9b6
- KasaRegistry contract (Arc Testnet): 0x6a86b61cb3205b8d017186b8ecc9629641c6dd21
- KasaRouter contract (Arc Testnet): 0x620140d0d4f7e1561800cec34d7c0d4a9f05f101

## Tech Stack

- Frontend: React 18, Vite, TypeScript, Tailwind CSS
- Web3: wagmi v2, viem v2, ConnectKit
- Contracts: Solidity 0.8.28 + Foundry. Sources in `contracts/`, unit tests in `contracts/test/*.t.sol`. Build with `bun run contracts:build` (`forge build`), test with `bun run contracts:test` (`forge test`).
- Wallet: injected (MetaMask, etc.)
- Chain: Arc Testnet (Chain ID: 5042002, imported from `viem/chains`)
- Token: USDC (6 decimals) (Address: 0x3600000000000000000000000000000000000000, Chain: Arc Testnet)
- Toasts: Sonner

## Key Files

- `src/App.tsx` - Main application logic
- `src/components/` - UI components
- `src/config.ts` - wagmi config (chains, connectors, transports)

## To Run

```bash
bun install
bun run dev
```
