-- Prevent duplicate waitlist rows from a double-clicked "Notify me" button.
-- A given user can only have one tracked_niches row per submission.
alter table public.tracked_niches
  add constraint tracked_niches_user_submission_unique unique (user_id, submission_id);
