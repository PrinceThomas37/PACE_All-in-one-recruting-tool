-- 066 — a lead that has only sent an AUTOMATIC reply is tagged "Auto-replied" instead of being moved to Connected (owner, 14 Oct 2026).
-- Connected means a person is interested in profiles or terms; an out-of-office is not that. The reply sweep stamps this column
-- when it sees an automatic reply, and clears it when a real answer arrives. The Leads list shows it as a tag.
-- Safe: adds one nullable column, rewrites nothing. The app runs before and after: until this is applied the lead simply has no tag
-- (the history line is still written, and the lead is still NOT moved to Connected).
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS auto_replied_at TIMESTAMPTZ;
