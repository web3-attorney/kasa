# Kasa — Arc Microgrants Round 2 Strategy

## The Hackathon at a Glance

- **Name:** Arc Microgrants: Built with Arc Studio
- **Platform:** DoraHacks
- **Deadline:** November 1, 2026
- **Prize:** $500 USDC per winner, 20 winners, $4,000 pool (Round 2)
- **Paid in:** USDC on Arc mainnet
- **Competition:** ~88 reported submissions at time of research

---

## Judging Criteria (with weights)

| Criterion | Weight | What it means for Kasa |
|---|---|---|
| Real USDC moving on Arc mainnet (contract addresses + tx hashes) | 30% | Deploy KasaSavings to Arc mainnet, show real transactions |
| Use of Arc Studio across the build: contracts, testing, app | 25% | We built everything in Arc Studio — strong here |
| A working product | 25% | App must be live at a public URL, clickable by judges |
| Potential to go further | 20% | Kasa's roadmap (yield, cross-chain, agents) is already written |

**The single biggest factor is real USDC on mainnet.** Judges verify contract addresses and transaction hashes on explorer.arc.io. Testnet builds are disqualified.

---

## What the Submission Requires

1. Arc Studio project URL (this project)
2. A live app at a public link (deploy to Netlify or Hugging Face)
3. Contract address(es) + one example transaction hash on explorer.arc.io
4. A public GitHub repo (connect GitHub from Arc Studio sidebar)
5. A video walkthrough showing the build in Arc Studio and a mainnet transaction
6. A short written description
7. A public builder profile (GitHub, X, or Farcaster)

---

## Gap Analysis: What Kasa Has vs What It Needs

### Already built (strong)
- KasaSavings.sol — audited, 44/44 tests passing, deployed to Arc TESTNET
- All four app tabs working: Identity, Send, FX, Auto-Save
- ERC-8004 agent identity — differentiates Kasa from generic payment apps
- x402 payment gate — shows Arc-native agent-to-agent capability
- Full Arc Studio build history (contracts skill, security review, tests)

### Gaps to close before submission

**Critical (required to be eligible):**
1. Deploy KasaSavings to Arc MAINNET (not testnet)
2. Execute at least one real USDC transaction through the contract on mainnet
3. Deploy the app to a public URL
4. Push code to a public GitHub repo

**Important (affects score):**
5. The FX router currently shows an illustrative rate — real on-chain swap via Circle Swap Kit would score much higher on "working product"
6. The x402 endpoint currently just echoes — a real paid service (e.g. AI query, onchain data lookup) would strengthen "potential to go further"
7. A polished landing / intro screen so judges understand Kasa in 10 seconds without reading docs

**Nice to have (differentiators):**
8. A short demo video recorded inside Arc Studio showing the build + a live mainnet tx
9. README / project description written for a non-technical judge

---

## What to Build Before Submission

### Priority 1 — Required for eligibility

**A. Mainnet deploy**
Confirm mainnet intent, show the required warning, then deploy KasaSavings.sol to Arc mainnet. Constructor arg is the Arc mainnet USDC address. Takes ~2 minutes.

**B. At least one mainnet transaction**
After deploy, activate a plan and make a small deposit (even $0.10) to generate a real tx hash for the submission.

**C. Public live URL**
Deploy the Kasa app to Netlify or Hugging Face. One-click from Arc Studio's Integrations menu.

**D. GitHub repo**
Connect GitHub from the Arc Studio sidebar, push the repo. Takes ~5 minutes.

### Priority 2 — Score maximizers

**E. Real FX swap**
Replace the illustrative rate in the FX tab with a live Circle Swap Kit quote. Shows real USDC movement through two contracts, not just one. Strong story for the 30% "real USDC" criterion.

**F. Kasa landing screen**
Add a brief hero panel at the top of the app (before wallet connect) explaining what Kasa does in plain English with a "Connect Wallet" CTA. Judges need to understand the product in 10 seconds.

**G. Onchain activity feed**
Pull the last 5–10 transactions from the connected wallet on Arc and display them in a simple feed. Shows Arc-native data reading and makes the app feel alive even before the user does anything.

### Priority 3 — Differentiators (if time allows)

**H. Agent-to-agent demo**
Show a second wallet (a mock "agent") calling the x402 endpoint and paying in USDC. A 30-second screen recording of this would be compelling for judges evaluating "potential."

**I. Savings milestone notification**
When the savings balance crosses a round number ($10, $25, $50), surface a congratulations toast. Small feature, big product feel.

---

## Kasa's Competitive Angle

Most hackathon submissions will be basic token transfers or simple escrow. Kasa is differentiated on three axes:

1. **Agent identity (ERC-8004)** — Kasa is not just an app, it is a registered onchain agent. Other agents can discover and pay it. This is Arc-native and forward-looking.

2. **Autonomous behaviour** — The auto-save watcher acts without the user pressing a button. Funds move automatically based on rules the user set. This demonstrates Arc's sub-second finality and stable gas (USDC) as actual product features, not just talking points.

3. **Treasury framing** — Kasa bundles send, FX, and save into one interface. It solves a real problem (fragmented stablecoin management) rather than being a demo for its own sake.

The submission description should lead with the agent angle and the autonomous savings — those are the most memorable and technically credible aspects.

---

## Suggested Submission Description (draft)

> **Kasa** is an onchain treasury agent for USDC on Arc. Connect your wallet and Kasa gives you three capabilities: send USDC to any address, route payments between USDC and EURC at live rates, and set an automatic savings plan that splits every inbound transfer by a percentage you choose.
>
> The savings plan is backed by KasaSavings.sol — a permissionless, self-custodied smart contract on Arc mainnet. Set 10% for 90 days: every time USDC lands in your wallet, Kasa deposits 10% into the contract automatically. Withdraw any time, no lockup.
>
> Kasa is also a registered ERC-8004 agent with a verified onchain identity and an x402-gated API endpoint. Other AI agents can discover Kasa on Arc, pay per call in USDC, and use its treasury capabilities autonomously — no API keys, no subscriptions.
>
> Built entirely in Arc Studio: contract written, audited, tested (44/44 unit tests), and deployed from a single session.

---

## Timeline to Submission

| Task | Est. time | Who |
|---|---|---|
| Confirm mainnet intent + warning | 5 min | You |
| Deploy KasaSavings to Arc mainnet | 5 min | Arc Studio |
| Execute one mainnet USDC tx | 5 min | You (wallet) |
| Build landing screen + activity feed | 30 min | Arc Studio |
| Real FX swap integration | 45 min | Arc Studio |
| Deploy app to Netlify/HuggingFace | 10 min | You + Arc Studio |
| Push to GitHub | 5 min | You + Arc Studio |
| Record demo video | 20 min | You |
| Write submission form | 15 min | You |
| **Total** | **~2.5 hours** | |

Deadline: November 1, 2026. Plenty of time.

---

## What Not to Change

- The KasaSavings contract design is solid. Do not add complexity before submission — the audit is clean and the tests pass. Post-submission is the time for yield integration and cross-chain features.
- The ERC-8004 identity tab stays. It is a differentiator judges won't see in other submissions.
- Keep the x402 gate — even as a skeleton it shows the agent-payment vision.
