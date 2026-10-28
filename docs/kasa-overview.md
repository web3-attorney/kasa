# Kasa — Onchain Treasury Agent

## What is Kasa?

Kasa is an onchain financial agent built on Arc Testnet (Circle's blockchain where USDC is the native gas token). It gives any wallet holder a personal treasury — send USDC anywhere, route payments across stablecoin currencies, save automatically on every inbound transfer, and manage it all from one interface. Every action is a real blockchain transaction: no custodian holds your money, no backend can freeze your funds. Kasa is also a registered AI agent (ERC-8004) with a verifiable onchain identity and a pay-per-call API gate (x402), meaning other agents and services can discover it and pay it in USDC to use its capabilities.

---

## Architecture Overview

```
Browser (React + wagmi)
  │
  ├── Identity tab       ← ERC-8004 registration
  ├── Send tab           ← Direct USDC transfer
  ├── FX tab             ← Stablecoin routing (USDC ↔ EURC)
  └── Auto-Save tab      ← KasaSavings contract
          │
          └── KasaSavings.sol (Arc Testnet)
                 0xce160338e23cbd581bfecc8f5857c7c4f686d9b6

Vite dev server (port 5173)
  ├── GET  /api/agent.json     ← ERC-8004 registration file
  ├── POST /api/agent-service  ← x402-gated paid endpoint
  └── GET  /api/health         ← liveness check
```

---

## Components

### 1. Identity — ERC-8004 Agent Registration

**What it is:**
Every agent on Arc has an onchain identity — a unique ID minted as an NFT on the ERC-8004 IdentityRegistry contract. Kasa registers itself with a URI pointing to `/api/agent.json`, which describes what the agent does, what services it offers, and whether it supports x402 payments.

**What the registration file contains:**
- `name`: "Kasa"
- `description`: what the agent does
- `services`: the list of endpoints Kasa exposes
- `x402Support: true`: signals to other agents that Kasa accepts machine-to-machine USDC payments
- `agentWallet`: the deployer address that owns this identity

**Why it matters:**
Any other agent — whether running on Claude, GPT, or a custom model — can call `lookup_agent(agentId)` and discover Kasa's capabilities, endpoint, and payment method without any off-chain directory. The identity is permanent and immutable onchain.

**Flow:**
1. Paste or confirm the agent URI (pre-filled with this app's own `/api/agent.json`)
2. Call `register(agentURI)` on the IdentityRegistry — costs a small amount of USDC gas
3. Receive an `agentId` (NFT token ID) back
4. The agent card appears showing: agentId, owner address, agent wallet, namespace

---

### 2. Send — USDC Payment Agent

**What it is:**
A direct USDC transfer interface. Enter any EVM address and an amount; Kasa calls `transfer(recipient, amount)` on the USDC ERC-20 contract on Arc Testnet.

**Features:**
- Live USDC balance display (reads from chain on every render)
- Quick-pick amount buttons: $1, $5, $10, $25
- Address validation before the button activates
- Wrong-chain guard: prompts you to switch to Arc Testnet if you are on the wrong network
- Explorer link on every confirmed transaction

**Why onchain matters here:**
This is not a bank transfer or a custodied "send" button. You sign the transaction yourself, the USDC moves directly from your wallet to the recipient, and the transaction is permanent. No intermediary can reverse it or freeze it.

---

### 3. FX — Stablecoin FX Routing

**What it is:**
A currency routing layer that lets you send in one stablecoin and have the recipient receive a different one. Currently supports USDC and EURC (Circle's euro-denominated stablecoin) on Arc Testnet.

**How it works:**
1. Pick your "send" token (USDC or EURC)
2. Pick the "receive" token (the opposite)
3. Enter recipient address and amount
4. The rate panel shows the current exchange rate (e.g. 1 USDC = 0.924 EURC)
5. Kasa routes the transfer — sends the ERC-20 on behalf of the user

**Current implementation note:**
The exchange rate shown is illustrative (using the real USD/EUR relationship). Production FX routing would integrate a DEX or Circle's Swap Kit to get a live quote and execute the actual conversion atomically.

**Why this matters:**
A contractor in Europe who invoices in euros should be able to receive EURC without the sender needing to hold EURC themselves. Kasa handles the routing so the sender pays in their preferred stablecoin.

---

### 4. Auto-Save — KasaSavings Smart Contract

**What it is:**
The most complex and novel feature. A fully onchain savings plan backed by a custom Solidity contract (`KasaSavings.sol`) deployed on Arc Testnet.

**The concept:**
You set two parameters — a savings percentage (1–100%) and a duration in days (1–365). From that moment, every time USDC arrives in your wallet, Kasa automatically deposits the configured percentage into the KasaSavings contract. Your savings accumulate on-chain under your address and you can withdraw them at any time.

**The contract mechanics:**

*activatePlan(savingsPercent, durationDays)*
Creates your savings campaign. Stores: percent, duration, start time, computed end time. You can only have one active plan at a time — to start a new one, your balance must be zero (withdraw first).

*deposit(user, amount)*
Called by Kasa's auto-save watcher each time an inbound USDC transfer is detected. Pulls USDC from the user's wallet (user pre-approves the contract once) and locks it in the contract. Uses balance-delta accounting to be safe against any non-standard token behaviour.

*withdraw()*
Callable by the plan owner at any time — no lockup, no waiting period. Emergency withdrawal is always available. Transfers the full balance to the caller's wallet. Does not cancel an active plan — if the plan hasn't expired, future inbound transfers will still trigger auto-deposits.

*getPlan(user)*
Returns the full plan state: percent, days, start time, end time, accumulated balance, and whether the plan is currently active.

**The UI flow:**
1. Set % and days, tap "Activate Plan" — one transaction
2. Tap "Approve USDC" — one-time approval for the contract to pull from your wallet
3. App watches USDC Transfer events to your address in real time
4. Each inbound transfer fires a `deposit()` call automatically — you confirm each one in your wallet
5. "Withdraw $X" button always visible when balance > 0
6. Plan expires after chosen days — no more auto-deposits, balance stays until withdrawn

**Security properties:**
- No admin, no owner, no upgradeable proxy — the contract is fully permissionless and immutable
- Self-custodied: your funds are held under your address in the contract, not pooled
- Reentrancy guard on withdraw (OpenZeppelin)
- SafeERC20 for all transfers
- Custom errors (gas-efficient)
- 44/44 unit tests passing including fuzz tests and invariant tests

---

### 5. x402 Payment Gate

**What it is:**
The `/api/agent-service` endpoint is gated by the x402 protocol — an HTTP 402 "Payment Required" standard for machine-to-machine USDC micropayments. When any client (human browser or another AI agent) hits this endpoint without payment, they receive a 402 response with Circle Gateway challenge headers describing exactly what to pay and where.

**Why it matters for agents:**
Other AI agents that support x402 can autonomously pay Kasa per-call in USDC without any API key exchange, OAuth flow, or subscription. They read the 402 headers, make a Gateway nanopayment, retry the request with the payment proof, and get a response. The whole exchange is onchain-settled.

---

## Features We Could Add

### Near-term (ready to build now)

**Yield on savings**
Instead of idle USDC sitting in the KasaSavings contract, automatically deposit into a USDC yield protocol (e.g. a lending pool on Arc) when a deposit arrives. The contract would hold yield-bearing receipt tokens instead of raw USDC, and unwrap them on withdraw. Users earn passive yield while they save.

**Savings goals**
Let users set a target amount ("save until I have $500") alongside or instead of a time duration. The plan auto-deactivates when the balance hits the target. Useful for saving toward a specific purchase or milestone.

**Scheduled send (recurring payments)**
A companion contract that holds USDC and releases a fixed amount to a recipient address on a schedule (daily, weekly, monthly). Useful for payroll, subscriptions, or allowances. The user funds the contract once; Kasa executes the releases.

**Payment requests / invoices**
Generate a shareable link with a pre-filled recipient, amount, and memo. The recipient opens the link and pays in one tap. The link encodes all parameters as URL query params — no backend needed. Good for freelancers and small businesses.

**Multi-recipient split**
Instead of sending to one address, define a split table (e.g. 60% to wallet A, 30% to wallet B, 10% to savings). Every inbound transfer gets split automatically. Useful for teams sharing revenue or creators routing royalties.

**Spending limits / budgets**
A daily or weekly USDC spending cap. If a transaction would exceed the cap, it queues for the next period. Enforced by a smart contract so no app-level override is possible.

### Medium-term

**Cross-chain send via CCTP**
Use Circle's Cross-Chain Transfer Protocol to send USDC from Arc to Ethereum, Base, Arbitrum, or any CCTP-supported chain in one transaction from the UI. The Bridge Kit handles attestation and minting on the destination chain transparently.

**EURC savings plan**
A parallel savings plan denominated in EURC. Useful for users whose income or spending is euro-denominated. The KasaSavings contract already accepts any USDC-compatible token via its constructor — a EURC variant only needs a new deployment.

**Agent-to-agent escrow**
A contract where one AI agent locks payment for a task, another agent delivers a result hash, and the payment releases automatically on delivery. Built on the ERC-8183 job standard. Kasa would be the payer/payee agent with a UI for humans to initiate and monitor jobs.

**Push notifications**
A server-side webhook listener (Circle webhook or RPC subscription) that sends a browser push notification or email when an inbound transfer arrives, when an auto-save fires, or when a savings plan is about to expire. Keeps the savings system alive even when the browser tab is closed.

**Transaction history with categorization**
Pull all USDC Transfer events for the connected wallet, label them (inbound payment, auto-save deposit, manual send, FX route), and display a timeline with running balance. Exportable as CSV for accounting.

**Passkey wallet (no seed phrase)**
Replace the wagmi/MetaMask wallet connection with Circle Modular Wallets — a passkey-based smart account where the user registers with Face ID or Touch ID instead of a seed phrase. Fully non-custodial but with account recovery. Dramatically lowers the onboarding barrier for non-crypto users.

---

## Contract Addresses (Arc Testnet)

| Contract | Address |
|---|---|
| KasaSavings | `0xce160338e23cbd581bfecc8f5857c7c4f686d9b6` |
| ERC-8004 IdentityRegistry | `0x8004000000000000000000000000000000000000` |
| ERC-8004 ReputationRegistry | `0x8004B663056A597Dffe9eCcC1965A193B7388713` |
| USDC | `0x3600000000000000000000000000000000000000` |

## Tech Stack

| Layer | Technology |
|---|---|
| Blockchain | Arc Testnet (USDC as native gas, sub-second finality) |
| Smart contracts | Solidity 0.8.28, OpenZeppelin 5.1.0, Foundry |
| Frontend | React 18, TypeScript, Vite, Tailwind CSS |
| Onchain wiring | wagmi v2, viem, ConnectKit |
| Agent identity | ERC-8004 IdentityRegistry |
| Agent payments | x402 / Circle Gateway Nanopayments |
| Money math | @/onchain-money (Arc Studio) |
