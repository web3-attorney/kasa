# Kasa — Supabase Backend Deploy Guide

Everything you need to go from zero to a live Kasa backend on Supabase in about 15 minutes.

---

## 1. Create a Supabase project

1. Go to [supabase.com](https://supabase.com) and sign up (free)
2. Click **New project**, give it a name ("kasa"), pick a region, set a strong database password
3. Wait ~2 minutes for it to spin up

---

## 2. Run the database migration

1. In the Supabase dashboard, click **SQL Editor** in the left sidebar
2. Click **New query**
3. Open the file `supabase/migrations/001_kasa_schema.sql` from this project, copy all of it, paste it into the editor
4. Click **Run** — all 7 tables will be created

---

## 3. Get your Supabase credentials

In your Supabase project dashboard:

- **Project URL**: Settings → API → Project URL (looks like `https://xxxx.supabase.co`)
- **Service Role Key**: Settings → API → `service_role` key (NOT the anon key — keep this secret)

---

## 4. Deploy all Edge Functions

Install the Supabase CLI on your machine:

```bash
npm install -g supabase
```

Log in:
```bash
supabase login
```

Link to your project (get your project ref from the dashboard URL: `https://supabase.com/dashboard/project/<ref>`):
```bash
supabase link --project-ref YOUR_PROJECT_REF
```

Deploy all functions at once:
```bash
supabase functions deploy --no-verify-jwt
```

This deploys all 13 functions in one command:
`send-otp`, `verify-otp`, `wallet-get-or-create`, `wallet-balance`, `wallet-send`,
`wallet-contract-call`, `registry-check`, `registry-lookup`, `autosave-register`,
`tx-history`, `contacts`, `schedules`, `pay-links`, `limits`

---

## 5. Set function secrets

In the Supabase dashboard → **Edge Functions** → **Manage secrets**, add these:

| Secret name | Value |
|---|---|
| `CIRCLE_API_KEY` | Your Circle API key |
| `CIRCLE_ENTITY_SECRET` | Your Circle entity secret (hex, 64 chars) |
| `JWT_SECRET` | Any long random string (e.g. `openssl rand -hex 32`) |
| `RESEND_API_KEY` | Your Resend API key |
| `VITE_SAVINGS_ADDRESS` | `0xce160338e23cbd581bfecc8f5857c7c4f686d9b6` |
| `VITE_REGISTRY_ADDRESS` | `0x6a86b61cb3205b8d017186b8ecc9629641c6dd21` |
| `VITE_ROUTER_ADDRESS` | `0x620140d0d4f7e1561800cec34d7c0d4a9f05f101` |
| `SUPABASE_URL` | Auto-set by Supabase |
| `SUPABASE_SERVICE_ROLE_KEY` | Auto-set by Supabase |

---

## 6. Update the frontend to point to Supabase

Once deployed, your function base URL is:
```
https://YOUR_PROJECT_REF.supabase.co/functions/v1
```

Update `.env` in this project:
```
VITE_API_BASE_URL=https://YOUR_PROJECT_REF.supabase.co/functions/v1
```

Then update `src/kasaWallet.ts` — replace the `apiFetch` base path:
```ts
const API_BASE = import.meta.env.VITE_API_BASE_URL ?? ''

export async function apiFetch(url: string, init?: RequestInit) {
  // Map /api/xxx routes to Supabase function names
  const supaUrl = url
    .replace('/api/auth/send-otp', `${API_BASE}/send-otp`)
    .replace('/api/auth/verify-otp', `${API_BASE}/verify-otp`)
    .replace('/api/wallet/get-or-create', `${API_BASE}/wallet-get-or-create`)
    .replace('/api/wallet/balance', `${API_BASE}/wallet-balance`)
    .replace('/api/wallet/send', `${API_BASE}/wallet-send`)
    .replace('/api/wallet/contract-call', `${API_BASE}/wallet-contract-call`)
    .replace('/api/registry/check', `${API_BASE}/registry-check`)
    .replace('/api/registry/lookup', `${API_BASE}/registry-lookup`)
    .replace('/api/autosave/register', `${API_BASE}/autosave-register`)
    .replace('/api/tx-history', `${API_BASE}/tx-history`)
    .replace('/api/contacts', `${API_BASE}/contacts`)
    .replace('/api/schedules', `${API_BASE}/schedules`)
    .replace('/api/pay-links', `${API_BASE}/pay-links`)
    .replace('/api/limits', `${API_BASE}/limits`)
  return fetch(supaUrl, init)
}
```

---

## 7. Auto-save watcher (handle separately)

The auto-save background poller (`pollAutoSave` — runs every 15s) cannot run as an Edge Function because Edge Functions are stateless. Options:

- **Supabase pg_cron** (recommended): Create a Postgres function and schedule it every minute via pg_cron in the SQL editor
- **GitHub Actions cron**: A workflow that hits a `poll-autosave` Edge Function every minute
- **Keep the Express server just for the watcher**: Deploy only `server/index.ts` as a minimal Render free instance, but point all other routes to Supabase

---

## File layout

```
supabase/
  migrations/
    001_kasa_schema.sql       ← run once in SQL editor
  functions/
    _shared/
      cors.ts                 ← shared CORS + response helpers
      circle.ts               ← Circle REST API + RPC helpers
    send-otp/index.ts
    verify-otp/index.ts
    wallet-get-or-create/index.ts
    wallet-balance/index.ts
    wallet-send/index.ts
    wallet-contract-call/index.ts
    registry-check/index.ts
    registry-lookup/index.ts
    autosave-register/index.ts
    tx-history/index.ts
    contacts/index.ts
    schedules/index.ts
    pay-links/index.ts
    limits/index.ts
```
