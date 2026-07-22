-- Weekly monitoring engine: each row is one week's research pass for a
-- tracked_niches entry. status mirrors submissions (processing/complete/
-- failed) since each row involves its own async Claude call that can fail
-- independently of the others in a given weekly run.
create table public.niche_updates (
  id uuid primary key default gen_random_uuid(),
  tracked_niche_id uuid not null references public.tracked_niches(id) on delete cascade,
  status text not null default 'processing'
    check (status in ('processing', 'complete', 'failed')),
  summary text,
  notable_changes jsonb not null default '[]'::jsonb,
  has_meaningful_changes boolean,
  email_sent boolean not null default false,
  error_message text,
  created_at timestamptz not null default now()
);

create index niche_updates_tracked_niche_id_created_at_idx
  on public.niche_updates (tracked_niche_id, created_at desc);

alter table public.niche_updates enable row level security;

-- Read-only for users: rows are written exclusively by the weekly-monitor
-- Edge Function via the service-role key, which bypasses RLS entirely.
create policy "Users can view their own niche updates"
  on public.niche_updates for select
  to authenticated
  using (
    exists (
      select 1 from public.tracked_niches
      where tracked_niches.id = niche_updates.tracked_niche_id
        and tracked_niches.user_id = (select auth.uid())
    )
  );

-- Cron infrastructure for the weekly run.
create extension if not exists pg_cron with schema extensions;
create extension if not exists pg_net with schema extensions;

-- The shared secret authenticating cron -> weekly-monitor calls is stored
-- in Vault by name, not inlined here, so it never appears in a committed
-- migration. The project URL itself isn't sensitive (it's already public
-- in the frontend bundle), so that's inlined directly. Set the secret once
-- via:
--   select vault.create_secret('<random-value>', 'cron_secret');
-- and set the same value as the Edge Function secret CRON_SECRET.
select cron.schedule(
  'weekly-niche-monitor',
  '0 14 * * 1', -- every Monday at 14:00 UTC
  $$
  select net.http_post(
    url := 'https://mleusalfqvuwwztzoccz.supabase.co/functions/v1/weekly-monitor',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'cron_secret')
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 10000
  );
  $$
);
