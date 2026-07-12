-- Support async processing: the analyze Edge Function now inserts a row
-- immediately with status 'processing', does the Claude call in the
-- background (EdgeRuntime.waitUntil), then updates this same row when done.

alter table public.submissions
  add column if not exists status text not null default 'processing'
    check (status in ('processing', 'complete', 'failed')),
  add column if not exists error_message text;

-- Backfill rows created before this column existed.
update public.submissions set status = 'complete' where report is not null;
