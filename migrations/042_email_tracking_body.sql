-- 042 — keep the text of what we sent.
--
-- `email_tracking` has always recorded WHO an email went to, its subject, when
-- it was opened and whether it was replied to — but never the email itself. So
-- "what did we actually say to this client?" had no answer inside PACE; the
-- only copy was in whichever mailbox happened to send it.
--
-- `candidate_outreach.body` has stored exactly this since that table was added,
-- and the candidate queue reads it. This brings the other five channels —
-- client, candidate, candidate_sequence, interview and the outreach generator —
-- up to the same standard.
--
-- Additive and nullable: every existing row stays as it is and reads back with
-- a null body, which the UI reports honestly ("the text of this one was not
-- recorded") rather than pretending it has nothing to show. Nothing backfills,
-- because the text of those emails no longer exists anywhere we can reach.
--
-- ORDERING MATTERS: apply this BEFORE deploying the code that writes the
-- column. An insert naming a column that does not exist fails, and it fails
-- AFTER the email has already gone out.

alter table public.email_tracking
  add column if not exists body text;

comment on column public.email_tracking.body is
  'The plain-text body as composed, before the HTML wrap, signature and tracking pixel. Null for anything sent before migration 042.';
