# Kasa — Onchain Treasury Agent

Kasa is a USDC-native treasury wallet for Arc Testnet. Sign in with your email, get a wallet automatically, and manage your onchain money without ever thinking about gas or private keys.

Built with [Arc Studio](https://studio.arc.io)

## Features

- **Send USDC** — pay any address with a memo; spending limits enforce a daily cap with email confirmation
- **Scheduled payments** — set up recurring sends (daily, weekly, biweekly, monthly); executed automatically server-side
- **Payment links** — generate a shareable link anyone can use to pay you USDC without signing up
- **Spending limits** — set a daily USDC cap; sends above it require a 6-digit email confirmation code
- **Transaction history** — all sends with amounts, counterparties, memos, and explorer links
- **Auto-Save** — onchain savings plan via KasaSavings contract; set a % of every inbound to save automatically
- **FX routing** — USDC ↔ EURC conversion
- **x402 payment gate** — $0.01 USDC per agent API call (ERC-8004 + x402)
- **Email OTP auth** — sign in with a 6-digit code; wallet created silently on first sign-in

## Tech Stack

- React + TypeScript + Vite
- Circle Developer-Controlled Wallets (server-side signing, no passkeys)
- Arc Testnet (USDC as native gas)
- KasaSavings — deployed Solidity contract on Arc Testnet
- Resend — email OTP and spend-limit confirmation emails
- viem — onchain reads
- Sonner — toast notifications

## Development

### Prerequisites

- [Bun](https://bun.sh) >= 1.0
- Node 18+

### Install

```bash
bun install
```

### Environment variables

| Variable | Purpose |
|---|---|
| `CIRCLE_API_KEY` | Circle Standard Developer API key |
| `CIRCLE_ENTITY_SECRET` | Circle entity secret for server-side wallet signing |
| `RESEND_API_KEY` | Resend API key for OTP and confirmation emails |
| `VITE_SUPABASE_URL` | (optional, legacy) Supabase project URL |
| `VITE_SUPABASE_ANON_KEY` | (optional, legacy) Supabase anon key |
| `VITE_SAVINGS_ADDRESS` | Deployed KasaSavings contract address on Arc Testnet |
| `VITE_CLIENT_KEY` | Circle Modular Wallets client key (optional, legacy) |
| `VITE_CLIENT_URL` | Circle Modular Wallets client URL (optional, legacy) |

Copy `.env.example` to `.env` and fill in the values. `RPC_PROXY_BASE_URL` is optional outside Arc Studio.

### Run

```bash
bun run dev
```

App runs at `http://localhost:5173`. All API routes are served by the Vite dev server middleware — no separate backend needed.

### Build

```bash
bun run build
```

### Test contracts

```bash
cd contracts && forge test
```

## Contracts

| Contract | Address (Arc Testnet) | Tests |
|---|---|---|
| KasaSavings | See `VITE_SAVINGS_ADDRESS` in `.env` | 44/44 passing |
| KasaRegistry | Not deployed (pending) | — |
| KasaRouter | Not deployed (pending) | — |

## Arc Microgrants Round 2

Submitted for the Arc Microgrants Round 2 hackathon (deadline Nov 1 2026). Kasa demonstrates USDC-as-gas on Arc Testnet with zero friction for end users — no gas token needed, no seed phrase, no passkey prompts.
