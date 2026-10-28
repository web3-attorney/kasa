# Kasa Contract Security Audit

**Contracts audited:** KasaSavings.sol, KasaRegistry.sol, KasaRouter.sol  
**Chain:** Arc Testnet (chain ID 5042002)  
**Date:** 2026-10-28

---

## KasaSavings.sol

### [HIGH] Unauthorized deposit on behalf of any user
`deposit(address user, uint256 amount)` has no `require(user == msg.sender)` check. Any caller can trigger `transferFrom(user, contract, amount)` against any user who has approved the contract — forcing funds into savings at arbitrary times and amounts.  
**Fix:** Add `require(user == msg.sender, "only self")` or an explicit delegation allowlist.

### [HIGH] Direct ERC-20 transfers bypass internal ledger
Tokens sent directly to the contract (not via `deposit()`) are never credited to any plan. They become permanently stuck — real USDC loss for users who mistakenly transfer directly.  
**Fix:** Track `totalTracked` and add an owner-only `rescueStray()` function that can recover `balanceOf(this) - totalTracked`.

### [LOW] Off-chain enforced savings percentage
The contract accepts any `amount` — it does not verify that amount equals `savingsPercent % of inbound`. If the off-chain server sends a wrong amount, the contract silently accepts it.  
**Fix:** Accept `inboundAmount` as a parameter and compute `saveAmount = inboundAmount * savingsPercent / 100` on-chain, rejecting any deviation.

---

## KasaRegistry.sol

### [HIGH] Username front-run / MEV hijack
`register(username)` is a single-step reveal in the public mempool. Any bot watching the RPC can copy the username and submit with higher gas, permanently stealing the name before the legitimate user's tx confirms.  
**Fix:** Commit-reveal: `commit(keccak256(abi.encodePacked(username, salt)))` in step 1, `reveal(username, salt)` after N blocks. Or use off-chain signed reservations verified on-chain.

---

## KasaRouter.sol

No critical findings. Minor: `send()` does not check recipient is non-zero address — add `require(to != address(0))`.

---

## Summary

| Severity | Count | Contracts |
|---|---|---|
| High | 3 | KasaSavings (×2), KasaRegistry (×1) |
| Low | 1 | KasaSavings |

**For testnet/hackathon:** The deposit authorization bypass in KasaSavings is the most critical — fix before any real-funds use.
