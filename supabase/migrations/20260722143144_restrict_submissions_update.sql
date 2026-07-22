-- Close a gap in the free-preview/paid-unlock split (see
-- 20260721162000_add_submission_unlocked.sql): the existing FOR ALL policy
-- let any authenticated user UPDATE their own submissions row directly from
-- the browser - including setting unlocked to true for free, or rewriting
-- score/report outright. Regular users only ever need to read their own row
-- and create the initial one; analyze/index.ts's write-back (score, report,
-- status, and any future unlocked flip from a payment webhook) now goes
-- through a service-role client instead, so it no longer needs client
-- update access. Split into narrower policies rather than widening the old
-- one, since "no update at all" is the correct shape here, not a tighter
-- update policy.

drop policy if exists "Enable users to view their own data only" on public.submissions;

create policy "Users can view their own submissions"
  on public.submissions for select
  to authenticated
  using ((select auth.uid()) = user_id);

create policy "Users can create their own submissions"
  on public.submissions for insert
  to authenticated
  with check ((select auth.uid()) = user_id);
