# Kasa Mainnet Deployment Checklist

## What needs to change for mainnet

### 1. Smart contracts — redeploy on Arc Mainnet
- [ ] Deploy `KasaRegistry.sol` to Arc Mainnet
- [ ] Deploy `KasaRouter.sol` to Arc Mainnet
- [ ] Deploy `KasaSavings.sol` to Arc Mainnet (needs USDC mainnet address)
- Arc Mainnet RPC: `https://rpc.mainnet.arc.io`
- Arc Mainnet chain ID: `1038` (confirm from arc.io docs)
- USDC on Arc Mainnet: `0x3600000000000000000000000000000000000000` (same address — confirm with Circle)

### 2. Environment variables — update in Vercel dashboard
| Variable | Testnet value | Mainnet value |
|---|---|---|
| `VITE_REGISTRY_ADDRESS` | `0x6a86b61cb3205b8d017186b8ecc9629641c6dd21` | new deployed address |
| `VITE_ROUTER_ADDRESS` | `0x620140d0d4f7e1561800cec34d7c0d4a9f05f101` | new deployed address |
| `VITE_SAVINGS_ADDRESS` | `0xce160338e23cbd581bfecc8f5857c7c4f686d9b6` | new deployed address |

### 3. Circle credentials — upgrade to production
- [ ] Create a **production** Circle Standard Developer API Key (not TEST_API)
  → Circle Console → Developers → API Keys → Create Key (Production)
- [ ] Register a new entity secret for the production key
  → Run `register-entity-secret` flow again with the production key
- [ ] Update Supabase secrets: `CIRCLE_API_KEY`, `CIRCLE_ENTITY_SECRET`
- [ ] Update `.env` with the production keys (for local dev against mainnet)

### 4. Supabase secrets to update
```
CIRCLE_API_KEY=<production key>
CIRCLE_ENTITY_SECRET=<production entity secret>
VITE_REGISTRY_ADDRESS=<mainnet registry>
VITE_SAVINGS_ADDRESS=<mainnet savings>
```
Update via: Supabase Dashboard → Project Settings → Edge Functions → Secrets

### 5. Edge Function changes
- `wallet-get-or-create`: change `blockchains: ['ARC-TESTNET']` → `['ARC-MAINNET']` (confirm enum with Circle)
- `register-username`: no change needed (uses generic RPC + contract address)
- `inbound-watcher`: no change needed
- `autosave-watcher`: no change needed

### 6. Resend email — already using custom domain `mail.rovapay.xyz`
- [ ] Confirm `mail.rovapay.xyz` DNS records are verified in Resend dashboard
- [ ] No code change needed

### 7. Dev wallet funding
- The dev wallet (`0x0c903a9a9cb55205d822659c68d4e380ede417c4`) auto-funds new users with 1 USDC
- On mainnet this uses **real USDC** — ensure the dev wallet has sufficient mainnet USDC
- Suggested reserve: at least 50 USDC to cover ~50 new signups; top up as needed
- Set `DEV_WALLET_ID` in Supabase secrets to the mainnet developer wallet ID (will differ from testnet)

### 8. Vite config / frontend
- No RPC URLs are hardcoded in frontend — all goes through Edge Functions
- `VITE_SUPABASE_FUNCTIONS_URL` stays the same (Supabase doesn't change)
- Verify `src/config.ts` has the right chain ID for mainnet

### 9. Final test before going live
- [ ] Sign up a new account end-to-end on mainnet
- [ ] Send a small amount between two accounts
- [ ] Activate and withdraw an autosave plan
- [ ] Confirm transaction history shows all types
- [ ] Confirm `@username` send works

### 10. Things that are already production-ready
- Supabase Postgres — no changes needed
- All 16 Edge Functions — just need updated secrets
- Vercel frontend — just needs updated env vars
- Custom email domain `mail.rovapay.xyz`
- GitHub repo pushed and up to date

## Deployment order
1. Deploy contracts to Arc Mainnet → get addresses
2. Create production Circle API key + entity secret
3. Update Supabase secrets (all at once to avoid partial state)
4. Update Vercel env vars
5. Redeploy Vercel frontend
6. Fund dev wallet with mainnet USDC
7. Run end-to-end test
