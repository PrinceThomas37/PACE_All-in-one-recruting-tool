# PACE — handoff to Cursor (written 8 Oct 2026, end of Claude Code Session 43)

> Paste this to Cursor first: **"Read docs/CURSOR_HANDOFF.md, then docs/CONTEXT_WINDOW.md, then CLAUDE.md. Follow them. Ask me before anything that sends mail, touches the live database, or merges."**

## 1. Who you are working with (read twice)
The owner is the **product owner and end user — not an engineer.** They do not read code and do not use git/GitHub. Never ask them to review a diff, resolve a merge or operate GitHub. They judge the product **by using the running app** — screenshots and plain-English summaries are what you hand them, never code. They reply in short, informal messages (often with screenshots or a screen recording): treat each sentence literally, reproduce what it describes, then fix that.

They want, in every reply: the uncomfortable truth first; no flattery or "you're absolutely right"; a confidence tag ([Certain] / [Likely] / [Guessing]) before claims; disagreement stated as "I disagree because… I'd do instead… the risk of your approach is…"; no warm-up paragraph. When they push back without new information, hold your position.

You (the coding assistant) own **everything behind the product**: code, tests, branches, PRs, migrations, deploy. Confirm before anything outward-facing or hard to reverse.

## 2. What PACE is
A **recruiting ATS + lead-management SaaS sold to other companies** (competes with Ceipal, Bullhorn). **PACE is the product; Fute Global is one customer** — outbound customer content (cold-email wording, letterheads) is the *customer's* identity, per-organisation config, never hard-coded "PACE". Build philosophy: **spend nothing now, scale later** (free tiers; architecture choices that are cheap now and expensive to retrofit).

## 3. Where the code stands
- **`main` = the live release.** Render (`fute-lms-backend.onrender.com`) auto-deploys from `main` — **merging IS releasing.** Free tier: no frequent pingers.
- Last code merge: **#319** (`b20b326`); #320 is docs only. Full suite was **234/234 on Node 22** (final head) and **233/233 on Node 26.10.0** one commit earlier. The **Render deploy has not been watched** and the owner has not yet used this build live.
- Stack: Node/Express (`index.js` = lead/send engine; `routes/*.js`; `services/*.js`); plain `<script>` frontend `public/js/NN-*.js` + global `STATE`, no build step; Supabase Postgres project **`teiqievahzhllojvgsku`**, migrations in `migrations/` (**next is 063**). Map of what lives where: `ARCHITECTURE.md`. What PACE can already do (grep before building): `docs/territories/CAPABILITIES.md`. What the owner decided (never edit, reversals are new entries): `docs/territories/DECISIONS.md`. Live to-do list: `docs/ROADMAP.md`.
- **Migration 062 is already applied to the live database** (seven nullable `follow_ups` columns: `followup3..5_due_date`, `followup3..5_sent_at`, `chain_rules`). Never apply a migration to the live DB without the owner's fresh go-ahead, and apply it **before** merging code that uses it.

## 4. What shipped this session (owner's words → what exists)
| Decision | Behaviour now |
|---|---|
| D-0110/D-0111 | Imports and Find Leads accepts land **Unassigned**; the first email *written* claims the lead (writer becomes owner, mailbox recorded, stage Assigned). **Assign** button on the Leads page: to myself or anyone in my reporting chain, with a per-email-ID split of how many go from each mailbox. Wording can be one-for-all or per email ID; `{{sendercompany}}` per email ID. |
| D-0112 | Same-thread vs new-email choice per follow-up; a BD can make their own sequences; multiselect bulk stage change; admin "Assigned to" filter; typing no longer resets when a merge-field chip is clicked. |
| D-0113 | A new person starts **blank** (no stock wording); a plain BD sees only the sequences *they* made. The person chooses **0–5 follow-ups**, a day for each (each after the previous), thread choice for each. |
| **D-0114 (new architecture)** | **Default is NO follow-ups.** The follow-up chain is created **when the first email is actually SENT** (`services/followup-chain.js`, hooked in the send loop in `index.js`) for any lead, however it reached the person. A chain made under the new rules has `follow_ups.chain_rules = 'own'` and sends **only wording the person wrote** — never the organisation's or PACE's standard text; an unwritten follow-up sends nothing. **Rows that existed before (`chain_rules` NULL) keep the old behaviour, including the old stock-wording fallback.** |
| D-0116 | Admins **stay** in lead assignment; the RA lead's Assign Leads does **not** skip a manager's fresh imports (first to act wins; the pool conditions are on the update). Nothing to build. |
| R-188/R-189 | The sequence builder's preview and Compose reminder templates no longer use the **profile name** for `{{sender}}` — the email ID that sends. Rule (D-0075): stored text keeps `{{sender}}`/`{{senderemail}}`/`{{sendercompany}}`; the send fills them from the mailbox that sends. |

## 5. Open items — ask the owner before starting any of these
1. **Four Find Leads leads** are Assigned with no email written (BD Lead 1 ×3, BD Lead 2 ×1) — make them Unassigned? (owner has not answered)
2. **The AI round the owner scheduled "next"** — not started:
   - **R-177:** a per-person switch for "AI writes first emails". Today it is ONE admin setting (`engine_ai_first_email`, default on) and it *replaces* the person's own first-email wording at send; follow-ups stay templates.
   - **R-178:** a **"Rewrite with AI"** button in the compose/template editors that keeps every `{{variable}}`; and **"Enable AI variants"** — the AI reads the main template and makes a variant of the same outreach for each email.
   - Reuse `services/ai-provider.js` + `services/ai-budget.js` (null on failure/over budget, never throws; rules-first), `checkDraft`, and the random-template deck. **Every AI call goes through `ai-provider.js`.**
3. **Watch the first real sends** under the new follow-up rules. **Honest limit:** the send-loop hook and the engine's strict-wording switch are covered by tests only through their pure parts (`test/followup-chain-smoke.mjs`, `followup-steps-smoke.mjs`) — not end to end against real mail.
4. **Old data fact:** `follow_ups` rows existed only for admin-distributed leads; 358 leads had active chains when the owner asked to make leads Unassigned (so a blanket "all → Unassigned" would have ended them — don't). A backup table `backups.leads_unassign_20261008` exists (Ash Sayyad's 38 leads were made Unassigned then restored to Assigned; no emails were sent).
5. Older: **per-organisation API keys (R-067) before a second customer**; D-0106 (a)–(e), R-149, R-150 — see `docs/CONTEXT_WINDOW.md`.

## 6. Rules that were each paid for with an incident (full list: `CLAUDE.md`)
- **Never send mail, and never change live data, as a test.** There are no Supabase credentials in a sandbox without the MCP; prefer mechanisms you can test locally with a fake DB.
- **Routes:** registration order is load-bearing — literal paths go ABOVE `:id` routes of the same prefix. Use `models/` / `db.forRequest(req)` for tenant tables; never hand-write `supabase.from()` on them. `org_id` everywhere.
- **Who sees what:** call `viewScope`/`canSee*` from `services/ownership.js`; never filter in the browser.
- **Email:** three pipelines stay three (`emails`, `email_tracking`, `candidate_outreach`). Sender resolved **at send time**; merge fields filled by the server then checked (`unresolvedVars`) — refuse with 400, never blank. All outbound HTTP via `http-client.js`. Never retry a `POST /me/sendMail`.
- **Frontend:** the render engine writes only what changed; a page registers with `UI.registerPage`; **a repaint under typing wipes text** (this bit us twice — update in place); text size/colour are classes (`fs-12`, `c-text3`), never inline; phone is first-class.
- **Tests:** `npm test` = `node test/run-all.mjs`, judged by **exit code**, read the count, **never pipe it**. **The sandbox runs Node 22; Render runs Node 26** — download `node-v26.10.0-linux-x64` from nodejs.org and re-run the suite with it before a merge. `bash test/verify-frontend.sh` checks syntax. Run a guard **without** the fix first and watch it fail. A test pinned to old behaviour must be changed *on purpose* and said so (five were, this session, for the new "no follow-ups by default").
- **Gotchas that cost time:** don't edit files during a full-suite run; a background command dies at 30 minutes unless you give it a longer `timeout`; `pkill -f <pattern>` kills your own shell if the pattern appears in your command; after any scripted edit re-read the file; never `git add -A` where something else is working.

## 7. How work gets done (keep the loop, drop the Claude-only machinery)
Build on a dev branch → run the targeted tests → show the owner (screenshots / the live app / a short summary) → they react as a user → iterate → **merge only when the owner says so**, then tell them plainly what is now live. Open a **draft PR**. The recent PRs (#317–#320) were squash-merged.

**Memory protocol (D-0008/D-0024 — standing owner decisions).** Claude Code enforced these with hooks; **Cursor will not**, so do them by hand in the *same change* as the code:
- the owning territory file `docs/territories/<surface|gateway|deep|harbour|observatory|guild|rampart|foundry|ledger>.md` (map: `docs/territories/README.md`),
- `docs/CONTEXT_ARCHIVE.md` (append-only history), `docs/CONTEXT_WINDOW.md` (current state, rewritten, < ~200 lines),
- `docs/territories/DECISIONS.md` the moment the owner decides something (never edit an entry — a reversal is a new one),
- `docs/territories/CAPABILITIES.md` for a new user-facing capability, `docs/ROADMAP.md` for every suggestion (`PENDING/DOING/DONE/CHANGED/DROPPED`).
- Run `node scripts/memory-check.mjs` before you finish — it names what is owed.
The nine "territory" subagents in `.claude/agents/` are a Claude Code feature; in Cursor just respect the boundaries in `docs/territories/_contracts.md` (a territory never edits another's paths without a contract entry; `index.js` belongs to gateway).

**Be proactive in plain language:** after finishing what was asked, suggest what else is worth building (product trends, high-leverage bets) as choices the owner can react to — and add each as a ROADMAP row the same turn.
