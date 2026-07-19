-- Free-tier limit: one active (processing or complete) submission per user,
-- enforced at the database level so it can't be bypassed by calling the
-- analyze Edge Function directly. Failed submissions don't count against the
-- limit, since a system failure shouldn't burn the user's one free score.
--
-- Admin/unlimited accounts are flagged via auth.users.raw_app_meta_data
-- ({"is_admin": true}, set only through the service-role Admin API - never
-- user-editable) and are exempt from this constraint. Postgres partial
-- indexes can't reference another table in their predicate, so the one
-- known admin account is excluded explicitly below; add further admin
-- user_ids here if more are granted unlimited access.
create unique index if not exists submissions_one_active_per_user
  on public.submissions (user_id)
  where status in ('processing', 'complete')
    and user_id <> 'f3496eee-b550-4c87-8a10-6e87ec87369d';
