-- 049 — protect the two 10 Sep clean-up backup tables (R-050).
--
-- `emails_purged_20260910` and `follow_ups_closed_20260910` were made by hand
-- during the 10 Sep email clean-up. They were the only two public tables with
-- row-level security OFF, and `anon` held every privilege on them — anyone
-- with the public app key could read, change or wipe them. Measured
-- 2026-09-26: both hold 0 rows (the 23 Sep production reset emptied them) and
-- nothing in the code reads or writes them.
--
-- This puts them under the same rule as every other table (RLS on, one
-- service-role policy, no anon/authenticated grants). Dropping them is the
-- owner's call and is NOT done here.
alter table public.emails_purged_20260910     enable row level security;
alter table public.follow_ups_closed_20260910 enable row level security;

drop policy if exists service_all on public.emails_purged_20260910;
drop policy if exists service_all on public.follow_ups_closed_20260910;
create policy service_all on public.emails_purged_20260910     for all to service_role using (true) with check (true);
create policy service_all on public.follow_ups_closed_20260910 for all to service_role using (true) with check (true);

revoke all on public.emails_purged_20260910     from anon, authenticated;
revoke all on public.follow_ups_closed_20260910 from anon, authenticated;
