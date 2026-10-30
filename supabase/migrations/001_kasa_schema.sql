-- Kasa schema migration
-- Run this in the Supabase SQL editor before deploying Edge Functions

-- ── Profiles (userId → username, permanent) ───────────────────────────────────
create table if not exists profiles (
  user_id     text primary key,
  username    text not null unique,
  created_at  bigint not null default extract(epoch from now())::bigint * 1000
);

-- ── Transaction history ───────────────────────────────────────────────────────
create table if not exists tx_history (
  id            bigserial primary key,
  wallet_id     text not null,
  tx_hash       text not null,
  direction     text not null check (direction in ('in','out','save','fx','schedule')),
  amount        text not null,
  counterparty  text not null default '',
  memo          text not null default '',
  label         text,
  timestamp     bigint not null,
  unique (wallet_id, tx_hash)
);
create index if not exists tx_history_wallet on tx_history(wallet_id, timestamp desc);

-- ── Contacts ──────────────────────────────────────────────────────────────────
create table if not exists contacts (
  id          text primary key default gen_random_uuid()::text,
  wallet_id   text not null,
  name        text not null,
  address     text not null,
  memo        text,
  created_at  bigint not null default extract(epoch from now())::bigint * 1000,
  unique (wallet_id, address)
);
create index if not exists contacts_wallet on contacts(wallet_id);

-- ── Scheduled payments ────────────────────────────────────────────────────────
create table if not exists schedules (
  id          text primary key,
  wallet_id   text not null,
  to_address  text not null,
  amount      text not null,
  label       text not null default '',
  interval_ms bigint not null,
  next_run    bigint not null,
  last_run    bigint,
  active      boolean not null default true,
  tx_hashes   text[] not null default '{}'
);
create index if not exists schedules_wallet on schedules(wallet_id);

-- ── Pay links ─────────────────────────────────────────────────────────────────
create table if not exists pay_links (
  id            text primary key,
  to_wallet_id  text not null,
  to_address    text not null,
  to_username   text not null default '',
  amount        text not null,
  memo          text not null default '',
  created_at    bigint not null default extract(epoch from now())::bigint * 1000,
  paid_tx_hash  text
);

-- ── Spend limits ──────────────────────────────────────────────────────────────
create table if not exists spend_limits (
  wallet_id         text primary key,
  daily_limit_usdc  numeric not null default 0,
  spent_today       numeric not null default 0,
  reset_at          bigint not null
);

-- ── OTP store ─────────────────────────────────────────────────────────────────
create table if not exists otp_store (
  email     text primary key,
  code      text not null,
  expires   bigint not null
);

-- ── Auto-save plans ───────────────────────────────────────────────────────────
create table if not exists autosave_plans (
  wallet_id         text primary key,
  wallet_address    text not null,
  savings_percent   int not null default 0,
  active            boolean not null default false,
  user_deactivated  boolean not null default false,
  end_time          bigint not null default 0,
  updated_at        bigint not null default extract(epoch from now())::bigint * 1000
);
