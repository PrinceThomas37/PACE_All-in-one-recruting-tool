-- 065 — a job's pay can say what it is PER (owner, 14 Oct 2026): hourly, weekly, monthly or yearly.
-- A job had a currency and a min–max but no period, so "USD 22–26" could be an hourly or a yearly figure — and the candidate emails,
-- which print the pay, had to guess. The new column is text, empty when nobody chose (older jobs stay exactly as they are).
-- Safe: adds one nullable column, rewrites nothing. Run once in the Supabase SQL editor, BEFORE the code that uses it is merged.
ALTER TABLE job_orders ADD COLUMN IF NOT EXISTS pay_period TEXT;
