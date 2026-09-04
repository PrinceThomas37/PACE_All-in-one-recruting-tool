# PACE — where things stand *right now*

> **Read this file, then `CLAUDE.md`. That is enough to start work.**
> History lives in `docs/CONTEXT_ARCHIVE.md` — open it only when you need the
> reasoning behind a past decision.

**Updated**: 2026-09-04 (end of Session 18, part 2) · **Repo**:
`PrinceThomas37/PACE_All-in-one-recruting-tool` · **Supabase**:
`teiqievahzhllojvgsku` · **Deploy**: Render, auto-deploys from `main` — merging
to `main` IS the release · **Last merged**: #167 (`b5b227e`)

---

## ⚠ HOW TO MAINTAIN THESE TWO FILES (do not skip)

**This file: current state only. REWRITE it each session, keep it under ~200
lines, delete anything no longer true.** `docs/CONTEXT_ARCHIVE.md`: everything
that ever happened, **append-only — never edited, never summarised away.** At
the end of a session, append the narrative to the archive, then rewrite this to
describe the new present.

If you're picking this up cold: `CLAUDE.md` is the durable source of truth for
anything this file and the archive don't cover — trust it over an old-looking
line here.

## What PACE is

An **ATS + lead-management platform sold to other companies** (SaaS). Fute Global
is a customer, not the owner of the product. Full product context and the owner
relationship are in `CLAUDE.md` — **read it, it is short and load-bearing.**

## What is live right now

- The recruiting ATS + BD lead engine, multi-tenant by `org_id`
- **Autonomous Recruiting Engine, all 5 steps** — scheduler, shared relevance
  engine, lead sourcing, candidate outreach, conversation intelligence
- **The in-app mailbox** (Session 13, restructured 15) — two panes, threaded
  reader. Its four inviolable rules are in `CLAUDE.md` Growth bets §3.
- **The shared UI kit** (Session 15) — one layout vocabulary for the whole app.
- **The outreach generator + composer** (Sessions 17-18), and **any AI provider
  behind a daily budget** (Session 18) — both below.
- **Self-serve signup built but switched OFF** (`SELF_SERVE_SIGNUP`). Pricing is
  deliberately `null`. No guest/demo bypass exists, so no product tour today.
- Lead distribution across every connected mailbox (Microsoft + Gmail); leads
  silent in `Assigned` 30+ days auto-recycle.
- SSO with Microsoft. Google *sign-in* needs `GOOGLE_CLIENT_ID`/`SECRET` —
  **distinct from** per-user Gmail *sending*, which is live.

## Migrations — 041 is the latest APPLIED (2026-08-24)

**The next migration number is 042. Never apply one to the live DB without a
fresh, explicit go-ahead**, even when the feature itself was already agreed.
042 is most likely the error column on `emails` — see "Parked by the owner".
Sessions 14-18 added no migration; Session 18 avoided one deliberately (both new
subsystems sit on `app_settings` and on `email_tracking.lead_id`, which has
existed unused since 024).

## ✅ Shipped (Session 18): AI became a setting, got a budget, and learned to explain itself

Seven PRs, all merged and live: **#159** provider layer, **#161** budget,
**#164** diagnosis + three Assign-Leads faults, **#165** the answer must be
visible, **#166** the answer must survive the trip, **#167** it answers without
being asked + the heartbeat alarm. (#160/#162 were the owner's own merges.)

**Any provider, behind a daily budget.** `services/ai-provider.js` is the one
door for every AI call; `services/ai-budget.js` decides what a call may cost
before it is made. Groq, OpenRouter and a self-hosted Ollama are selectable in
Admin → Integrations, keys pasted in the UI, no redeploy. **Both rulesets are
written out in `CLAUDE.md`** — read them there. The rule that must never be
softened: **`complete()` returning `null` is an ordinary outcome meaning "write
it with the rules", never an error.**

**AI can now explain its own silence.** Admin → Integrations has an "Is AI
actually working?" card that asks each configured provider for one word through
the real path, reports the provider's own error text, lists the models that
provider offers when an attempt fails, stores the result server-side
(`ai_last_test`) so reopening the screen shows it, and **runs itself on open**
when a provider is configured and nothing has been recorded.

**Owner's own merge, #160:** Compose is folded into the generator (the old
Compose "Send" only opened a mail deeplink and invented a sent record no backend
saw). Recipients come from a search across contacts *and* companies, or are
typed fresh; "Sent from here" shows Sent/Opened/Replied, and a **replied** row
(never a merely opened one) offers Convert to lead at stage **Connected**.

## ⚠ AI IS WIRED IN 6 PLACES BUT REACHABLE IN 4

Audited this session, and it did not match the code. Live and reachable:
**resume parsing**, **job-description scrub**, **outreach generator**,
**lead-distribution advice**. Dead:

- **Daily import briefing** (`/ai/generate-summary`) — works, and **nothing in
  the frontend calls it**. Worth wiring to the dashboard.
- **Cold-email drafting** (`/ai/generate-email`) — called only from
  `12-manager-users.js` (the orphaned page), and never invoked even there.
  Superseded by the generator; worth deleting.

Do not repeat "six AI features" without re-checking the UI.

## ⚠ The merge trap — read before editing a shared file

#159 **deleted** a local helper (`aiConfigured`); #160, written in another
session against the same file, **added a call to it** elsewhere. Git saw a
deletion in one region and a call in another, merged both, and `main` shipped a
500 on every load of the Compose tab. **#162** fixed it.

- **A clean merge is not a correct merge when one side deletes a symbol and the
  other adds a use of it.** Merge `main` in and re-run the suite *immediately
  before* merging, not after.
- **The first guard written for it passed with the bug still in place** — the
  handler awaits the database and times out before reaching the bad line. The
  working guard reads the **source** and asks whether every function a file
  calls is defined in it (`test/outreach-generator-smoke.mjs`). Extend it rather
  than re-inventing it.

## ⏭ PICK THIS UP FIRST (Session 19)

**1. THE ONE OPEN QUESTION: does the AI actually run?** Unknown at session end.
The owner pasted a valid Groq key (card shows Connected, `••••10c6`, and Groq's
own test replies "Key valid · 14 models available") and **every feature still
wrote with its rules.** Four rounds of work went into making that explicable;
none of it has yet produced a verdict, because the owner had not reported the
result when the session ended.

**Ask them to open Admin → Integrations and read the card** (it runs itself on
open — no click). Then:
- 🟢 green → done, AI is live, move to the comparison below.
- 🔴 red with a provider message → **that message names the fix.** Leading
  suspect: the Groq model names in `PROVIDERS` (`llama-3.1-8b-instant` /
  `llama-3.3-70b-versatile`) were **written from memory and have never been
  checked against a real response** — this sandbox cannot reach
  `api.groq.com`. If they are wrong, the card now prints the valid names and
  the fix is one word in the Groq card's model box.
- 🟡 "no provider connected" → the save is not sticking; that is a new bug.

**2. Then: free model vs the rules writer, side by side, on a real posting.**
The six prompts were written for Claude; free open models follow tone
instructions less well. The honest verdict for the *email generator* may be
"keep the rules version" while the free tier earns its place on resume parsing
and JD cleanup. **This needs the owner's eyes on real output — do not decide it
for them.**

**3. The two dead AI features** — wire the briefing to the dashboard, delete the
cold-email drafter. See the audit above.

**4. Finish the UI-kit rollout.** Every list-shaped page is converted. Still on
their own markup: the dashboards (`05-page-dashboard.js`, `16-insights.js`),
Admin (`08-page-admin.js`), the pipeline board (`28-page-pipeline.js`), My Team
(`42-page-myteam.js`), Assign Leads (`21-assign-leads.js`), the orphaned Manager
Users page. Card- and board-shaped, so each needs its own judgement.

**5. Growth bets not offered recently.** `CLAUDE.md` still flags **CSV
import/export + a small public API** as the highest-leverage unstarted bet.

## ⏸ Parked by the owner — do NOT re-raise as blocking

**The Gmail 7-day expiry.** On 2026-09-01 the owner said: *"We will work on this
but not now."* That is a decision. **Do not open a session by asking about it,
and do not treat it as blocking.** Raise it only on a fresh visible incident, or
if the owner asks what is outstanding.

- **Symptom:** a dead Gmail sign-in destroys queued emails — `failed` with no
  retry, one every ~90s, reason never persisted (`emails` has no error column,
  so `friendlySendError`'s correct sentence dies with the process). Eleven
  follow-ups were lost this way on 31 Aug; they can still be re-queued.
- **Root cause is Google-side:** the OAuth consent screen is in **"Testing"**,
  where refresh tokens expire after exactly 7 days. **If `futeglobal.com` is on
  Google Workspace, switching the app to "Internal" removes the limit with no
  code at all.** That question is the owner's to answer when they choose to.
- **Three code defects worth fixing whatever Google says:** release to `pending`
  not `failed` on an auth failure (the thread-deferral path already does this);
  stop a mailbox on the FIRST auth failure; add the error column (**migration
  042**, still unclaimed).

## Rendering and the UI kit — read before touching any screen

Both rulesets are written out in `CLAUDE.md` (stack §Frontend). Do not work from
a paraphrase; the four that get broken most often are: a page registers with
`UI.registerPage()` and paints via `paintPageContent()`, **never**
`content.innerHTML`; anything that must survive a repaint (iframes, media,
internal scroll) needs its own region; **a repaint that changes nothing must
write nothing — not even the same class back**; and you build with
`UI.page({tabs, strip, toolbar, body})` rather than hand-rolling a twelfth table.
A strip never fabricates a number — show `·` until real counts land. Pinned by
`test/screen-stability-smoke.mjs`.

## Owner actions outstanding

1. **Report what the Admin → Integrations card says.** A free Groq key is
   already pasted and saved (`••••10c6`, marked "use first"); the card runs
   itself on open, no click. **That one line is the input Session 19 needs** —
   see "Pick this up first".
2. **Google *sign-in*** (distinct from Gmail *sending*, which works) —
   `GOOGLE_CLIENT_ID`/`SECRET` in Render if login-with-Google is wanted.
3. **Verify one real Greenhouse/Lever board** via "Test it" — adapters have
   never met a live feed (the sandbox blocks those hosts).
4. **Set prices, decide on card payments** — `services/plans.js`, one line.
5. **Turn on `SELF_SERVE_SIGNUP`** whenever strangers should be able to sign up.

## Traps that will bite you (learned the hard way)

`CLAUDE.md` carries the durable ones — `models/` for tenant tables, the six-place
stage vocabulary, the free-tier instance budget, `renderStoredEmail` on every
reader of `emails.body`, safe-methods-only retries, the deliberate `orgIdFor()`
fallback, `routes/recruiting/*` registration order, and both AI blocks. **Read
it; these are the ones it does not cover.**

**Before moving ANY file** → archive § "DEPENDENCY MAP" (Session 8). Ten things
break on a naive move and several fail *silently*.

- **Any mailbox-selection path must check BOTH `microsoft_tokens` and
  `gmail_tokens`, exclude `refresh_failed`, and filter `is_active`.**
- **A job whose sending mailbox goes inactive silently skips its pending emails
  forever** — any path that deactivates/disconnects/deletes a `user_emails` row
  must call `reassignJobsOffMailbox` first.
- **`emails.sent_at` defaults to `CURRENT_DATE`** — an unsent draft already
  carries a send date, so "sent on X" reports count drafts.
- **Graph's `/move` returns a NEW message id**; Gmail's never changes.
- **Injectable clocks are not optional** in `conversation-intel.js`,
  `next-action.js`, and `lead-ingest.js`'s `ingestSource`.
- **The rail is GROUPED**, so nav order is not a flat index; de-duplicate by id.
- **An overlay's data must repaint the overlay, not `#content`** —
  `41-page-clients.js`'s `paintDetail()` is the pattern.
- **Browser tests never need a production bypass** — `test/helpers/enter-app.mjs`.
- **When a claim about behaviour is load-bearing, test the claim** — and check
  it fails with the bug reintroduced, or it may be pinning nothing.
- **"Background engine: not receiving its heartbeat" is usually NOT a fault.**
  GitHub delivers the 30-minute schedule every 3-5 hours (measured 2026-09-04:
  five runs, every one HTTP 200 with all six jobs). Jobs are delayed, never
  skipped — due-ness lives in the database. Only 8h+ of silence is worth
  checking `CRON_KEY` over.
- **A destructive DB action needs, in order:** check FK cascade rules, verify
  scope with counts, snapshot, explicit confirmation, verify after.

## Deliberately open, not forgotten

- Cold-email templates and the resume letterhead still say "Fute Global" — the
  **customer's** identity, must become per-org config.
- "Log In with your Organization" routes by domain; **not** full SAML.
- `/bd-analytics/*` is legacy and un-org-scoped.
- The orphaned "Manager Users" page + its `email_accounts` subsystem.
- The card/board pages are not on the UI kit yet (see "Pick this up first" §2).
- Growth bets not started: per-role permissions, **CSV import/export + public
  API**, generalized audit trail, PWA polish.
- In-app mailbox v1 gaps: read-only drafts, no move-to-folder picker in the UI
  (the API supports it), no shared/delegated mailboxes, unread badge is a 60s
  cached poll not a live push.
- A per-call AI usage history (the meter is a daily counter, not an audit log).

## Working rules

`npm test` (**56 suites**, judged by **exit code** — and read the count, not
just the exit code: `npm test | tail -3` in a pipeline masks a failure) ·
`bash test/verify-frontend.sh` · build on the dev branch → test → screenshot/show
→ draft PR → **merge only on an explicit "merge it"** → apply a migration only on
a fresh explicit go-ahead, right before merge, never on general feature
agreement. **The owner does not read code**; show them the running app and plain
English.

**Habits these sessions paid for:**

- Ask whether a broken test pinned **behaviour** or **markup** — and never relax
  a safety assertion to make a redesign pass.
- **Measure before theorising** when the owner reports something visual, and say
  plainly when a piece of evidence shows nothing.
- When a placeholder is left in stored data, find EVERY reader before declaring
  it fixed.
- **Answer a cost question with measured numbers**, not reassurance. The owner
  asked what a token costs per email/lead/JD; the answer that was useful was a
  table of real per-request figures, and the feature that came out of it was a
  meter they can see.
- **Re-run the suite against freshly merged `main` immediately before merging.**
  Two clean merges have now broken production between them.
- **A test that pins WORDING is not a test that pins BEHAVIOUR.** #167 turned
  `engine-card-smoke` red; its safety assertions passed untouched and only the
  text had moved, because the old text was wrong. Read that distinction
  correctly — it is the difference between fixing a test and weakening one.
- **Do not wait on `npm test` with `pgrep -f run-all.mjs`** — the waiter matches
  its own command line and never exits. Wait on the node process, or run the
  suite in the foreground with a long timeout.
- **A fallback that protects the user must never be invisible to the operator.**
  Four rounds this session were one bug in four places: the product degraded
  gracefully and told nobody. Graceful degradation without observability is
  indistinguishable from being broken.
