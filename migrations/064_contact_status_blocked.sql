-- 064 — a contact's email status may now be "blocked" (owner, 13 Oct 2026).
-- The address is right, but the recipient's side (their security team, a gateway, an allow-list) rejects our mail. PACE stops
-- mailing a blocked contact, exactly as it does for invalid and deactivated, but keeps the difference visible.
--
-- The column has a CHECK that allows only four values, so without this the new choice is refused by the database.
-- Safe: every existing row already satisfies the wider list; nothing is rewritten. Run it once in the Supabase SQL editor.
-- The app runs before and after: until this is applied, choosing "Blocked" answers with a plain message instead of failing.

ALTER TABLE contacts DROP CONSTRAINT IF EXISTS contacts_email_status_check;
ALTER TABLE contacts ADD CONSTRAINT contacts_email_status_check
  CHECK (email_status = ANY (ARRAY['valid'::text, 'invalid'::text, 'deactivated'::text, 'out_of_office'::text, 'blocked'::text]));
