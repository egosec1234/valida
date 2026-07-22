-- Free preview / paid unlock split: the analyze function still generates
-- and stores the full report for every submission (so nothing needs to be
-- re-researched when a user pays), but the frontend only renders the full
-- detail once `unlocked` is true. Payment isn't wired up yet, so this stays
-- false for everyone until a future Lemon Squeezy webhook flips it.

alter table public.submissions
  add column if not exists unlocked boolean not null default false;
