-- Enable pg_cron (run once in Supabase SQL editor)
-- Note: pg_cron must be enabled in Supabase Dashboard → Database → Extensions → pg_cron

-- Auto-save watcher: runs every minute, triggers the autosave-watcher Edge Function
-- This replaces the 15s Express server poll with a 1-minute Supabase cron job

select cron.schedule(
  'kasa-autosave-watcher',
  '* * * * *',  -- every minute
  $$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'supabase_url') || '/functions/v1/autosave-watcher',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'service_role_key')
    ),
    body := '{}'::jsonb
  );
  $$
);
