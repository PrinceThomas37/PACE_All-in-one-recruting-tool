# PACE — where things stand *right now*

> **Read this file, then `CLAUDE.md`.** History is `docs/CONTEXT_ARCHIVE.md` (open a section, never the whole file). Handoff: `docs/CURSOR_HANDOFF.md`.

**Updated**: 2026-10-09 (end of the Claude Code session that continued after Cursor's first PR) · **Last merged to `main`**: #322 (`3ae8ddd`), after #320 (docs) and #319 (`b20b326`). Nothing unmerged except the open draft PRs listed under "Still open".
**Highest ids:** decision D-0118 · contract C-0038 · roadmap `R-192` (next `R-193`) · next migration `063` (062 is APPLIED).

## Now

The live site is #322 (Render redeploys from `main`; the deploy was NOT watched from the sandbox and the owner has not yet used #319 or #322 live). **Ask the owner to hard-refresh and try:** the Outreach Plan (blank start, "How many follow-ups?" at none), a new sequence's preview (name = the email ID's), a reminder template in Compose, Write with AI / Rewrite with AI, the formatting bar on New message and Reply, dragging a parked window. Do not send mail, do not touch the live database, do not merge without the owner's word.

**Already done on the live database. Do not repeat.** Four Find Leads leads were moved from Assigned back to Unassigned (no email had been written). Backup: `backups.leads_unassign_finder_20261008`.
- `b92277a4-d2ee-4ad9-bbb3-40415aa1d5ff` Business Network Consulting - BNC (BD Lead 1)
- `a43f3e5f-ecdc-4492-8e3a-d47d02a7f9d2` Equipment One Company (BD Lead 1)
- `52237021-141c-433f-b894-a22e1973d665` Xerxes Global (BD Lead 1)
- `1f696520-2556-446d-ac61-80a3cdee17dd` Peak Retirement Planning, Inc. (BD Lead 2)
Ash Sayyad's Finder lead was left alone. Cleared the same way as `releaseToPoolUpdate`.

**Merged in #322, live after the deploy (D-0117):**
- **Write with AI** (`services/sequence-draft.js`, `POST /wf/draft-email`) follows the instruction. Default 140–200 words, 3–4 short paragraphs. If they ask for shorter, that length. A draft that misses the topic is not used. Still short after one repair: used, and the note says so. The engine writer (`engine-draft.js`) was not retuned — it is still the short recruiting pitch.
- **Rewrite with AI** and **Write a variant** keep every `{{variable}}`. If they cannot, the person's own text comes back, never the ready-made starter. Buttons on the sequence step and on My wording.
- **AI writes first emails:** same as the company / on for me / off. Per email ID only when wording is per email ID. Follow-ups stay the person's wording. The send loop and the "AI writes at send" chip both use `services/ai-first-choice.js`.
- **Minimised windows:** drag the chip sideways along the bottom. A drag does not open it. A later click does. × closes it. The spot lasts until reload. Phone (860px and under) stays a scrolling row.

**Also merged in #322 (D-0118, R-192):** New message and Reply have bold, italic, underline, bullets, a numbered list, a link, and clear formatting. A paste that brings a font, a colour, or a highlight is stripped. The send-time writer was not touched.

## Still open (do not start unasked)

- **Open draft PR #321** (from an earlier Claude session, NOT Cursor): `company-site/` — a marketing home page, privacy and terms drafts, outside `public/` so the app does not serve it. Merging does NOT publish it today. Blocked on: the operator's legal name (the owner's "PACE inc." is not a registered company), a contact address, the lead-data providers list, Render static hosting, and a lawyer's review (owner removed the "not reviewed" banner and will have it reviewed later). It edits `docs/CONTEXT_ARCHIVE.md`, so expect a merge conflict there — keep both sides.
- **R-189 follow-up:** older mail-merge / email-preview screens still pass the profile name to `fillEmail`; they have no caller and open the person's own webmail, so they were left alone on purpose.
- **Owner decisions pending / standing:** D-0116 — admins stay in lead assignment, the RA lead's Assign Leads does not skip a manager's imports (nothing to build). The "Assigned to" filter and bulk stage bar stay.
- Watch the first real sends under the new follow-up rules (D-0114). The send-loop hook is tested through pure helpers, not against real mail.
- R-178's automatic "Enable AI variants" (one variant per email, unasked) is not built. The on-demand button is.
- R-067 per-organisation API keys before a second customer. D-0106 (a)–(e), R-149 notifications, R-150 industry playbook.
- Dead mailboxes if still dead: kristy.scott@fute-global.com, princethomasfute@gmail.com.
- `*.onrender.com` is blocked here. A merge is a release that this sandbox cannot watch.

## What is live

Leads engine, ATS, outreach, candidate outreach, in-app mailbox, reminders / needs you today, public apply page, ownership, retro look, search. Billing and self-serve signup are built and **off**.

D-0114 on the live build (migration 062 applied 8 Oct, 1,187 old `follow_ups` rows untouched, none marked): default no follow-ups; the chain is made when the first email is sent; a `chain_rules='own'` chain sends only the person's wording; older rows (NULL) keep the old behaviour.

| setting | value (read 2026-09-26) | meaning |
|---|---|---|
| `sys_engine_ai_first_email` | **1** | company switch: AI writes first emails. A person can now override it (D-0117, merged in #322). |
| `int_ai_active` | **groq** | Groq leads the chain |

A setting with no row reads its schema default (`config/settings.js`).

## Tests

Targeted this round: `sequence-brief-smoke` 11, `sequence-email-smoke` 34 (the short-draft repair assertion changed on purpose), `ai-first-choice-smoke` 18, `ai-wording-ui-smoke` 9, `window-dock-smoke` 30, `engine-draft-smoke` 17, `wording-scope-smoke` 45, `ai-style-smoke` 30, `sequence-builder-smoke` 31, `scope-emails-warmup-smoke` 52, `mail-format-smoke` 10, `mailbox-smoke` 136, `mailbox-page-smoke` 80. **Full suite at the merged head of #322: 238/238 on Node 22 and 238/238 on Node 26.10.0.** Two tests were fixed on purpose in #322 (`reply-window-smoke`, `window-dock-smoke` typed into the hidden store behind the new editor; they now type into the visible one). Sandbox Node 22; Render Node 26 — run Node 26 before a merge (download `node-v26.10.0-linux-x64`; give a background run a long `timeout`).

## How these two files stay true

This file is current state only, rewritten, under ~200 lines. `docs/CONTEXT_ARCHIVE.md` is append-only. `docs/ROADMAP.md` gets a row the turn a suggestion is made. `DECISIONS.md` gets an entry the moment the owner decides; never edit an old one. `node scripts/memory-check.mjs` before finishing.
