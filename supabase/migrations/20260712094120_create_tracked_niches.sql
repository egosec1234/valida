-- Scaffolding only: this table captures user intent to subscribe to weekly
-- niche monitoring. No cron job, email sending, or billing is implemented
-- yet -- rows just sit at status 'pending_upgrade' until that ships.

create table if not exists public.tracked_niches (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  submission_id uuid not null references public.submissions(id) on delete cascade,
  niche text,
  status text not null default 'pending_upgrade'
    check (status in ('pending_upgrade', 'active', 'canceled')),
  created_at timestamptz not null default now()
);

alter table public.tracked_niches enable row level security;

create policy "Users can view their own tracked niches"
  on public.tracked_niches for select
  using (auth.uid() = user_id);

create policy "Users can insert their own tracked niches"
  on public.tracked_niches for insert
  with check (auth.uid() = user_id);

create policy "Users can update their own tracked niches"
  on public.tracked_niches for update
  using (auth.uid() = user_id);

create policy "Users can delete their own tracked niches"
  on public.tracked_niches for delete
  using (auth.uid() = user_id);
