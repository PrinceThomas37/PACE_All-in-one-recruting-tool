# PACE — where things stand *right now*

> **Read this file, then `CLAUDE.md`. That is enough to start work.**
> History lives in `docs/CONTEXT_ARCHIVE.md` — open it only when you need the
> reasoning behind a past decision.

**Updated**: 2026-09-05 (end of Session 19) · **Repo**:
`PrinceThomas37/PACE_All-in-one-recruting-tool` · **Supabase**:
`teiqievahzhllojvgsku` · **Deploy**: Render, auto-deploys from `main` — merging
to `main` IS the release · **Last merged**: #169 (`688d278`); Session 19's work
is on `claude/groq-ai-mobile-ui-tblkg9`, **not yet merged**

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
- **The shared UI kit** (Session 15) — one layout vocabulary for the whole app,
  plus **`public/mobile.css` (Session 19)**: below 860px the rail is an
  off-canvas drawer behind a hamburger, nothing scrolls sideways, dialogs are
  bottom sheets. Desktop is untouched.
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
Sessions 14-19 added no migration; Session 18 avoided one deliberately (both new
subsystems sit on `app_settings` and on `email_tracking.lead_id`, unused since
024), and Session 19's work was routing and CSS.

## ✅ Shipped (Session 19): the AI test button was never wired up, and the phone works now

Both of the owner's complaints, and the same shape underneath: the app was
telling nobody the truth about itself. Full write-up in the archive.

**1. Three routes were DEAD, silently.** `POST /admin/integrations/ai-test` sat
BELOW `POST /admin/integrations/:id`, so Express matched it as `id="ai-test"`;
the save handler answered **200 with a valid integrations payload**, the card's
check was only "is it an object", so it stored that as its diagnosis and redrew
its placeholder. The button had done nothing for four sessions and
`aiProvider.diagnose()` had never once run. Two more had it too:
`/admin/integrations/email-verify` and `GET /jobs/export`. All fixed;
**`test/route-shadowing-smoke.mjs` scans all 270 routes** and fails the build on
any literal behind a matching `:param`.

Hardened with it: the card rejects a well-formed answer from the wrong endpoint
and names it as a PACE bug; **`diagnose()` tests every model tier a feature can
ask for** (probing only `fast` could report green while the outreach generator
fell back on a renamed `quality` model — one up and one down is now amber "half
working"); and `ai_last_error`, a real feature's failure, always renders under
the test result instead of being suppressed by it.

**2. The phone — `public/mobile.css`.** All three of the owner's screenshots
were reproduced in Chromium before anything changed. Causes: the rail's `:hover`
sticks on touch (hover-expand is now gated on `(hover:hover) and (pointer:fine)`,
never on width) with a real off-canvas drawer behind a hamburger below 860px;
`#content` dragged the whole page sideways (Leads 572→390, Candidates 500→390,
Admin 926→390); the dashboard clock was positioned over the greeting. Plus
bottom-sheet dialogs, 40-44px targets, 16px inputs so iOS does not zoom.
**Desktop is untouched** and the suite asserts it.
`test/mobile-layout-smoke.mjs` walks every element of **16 pages × 5 roles at
390px** — that is what makes `#content{overflow-x:hidden}` safe, since an
overflow that no longer drags is one that is clipped and gone.

A latent DESKTOP bug fell out: `UI.ic()` inside a `.btn` had no size rule, so
those icons were **0×0 and invisible on desktop** (75px tall on a phone).

## ⚠ AI IS WIRED IN 6 PLACES BUT REACHABLE IN 4

Live and reachable: **resume parsing**, **job-description scrub**, **outreach
generator**, **lead-distribution advice**. Dead: the **daily import briefing**
(`/ai/generate-summary` — works, nothing in the frontend calls it; worth wiring
to the dashboard) and **cold-email drafting** (`/ai/generate-email` — reachable
only from the orphaned `12-manager-users.js`, never invoked even there;
superseded by the generator, worth deleting). Do not repeat "six AI features"
without re-checking the UI.

## ⚠ The merge trap — read before editing a shared file

#159 deleted a local helper (`aiConfigured`); #160, written in another session
against the same file, added a call to it elsewhere. Git saw a deletion in one
region and a call in another, merged both cleanly, and `main` shipped a 500 on
every load of the Compose tab (#162 fixed it).

- **A clean merge is not a correct merge when one side deletes a symbol and the
  other adds a use of it.** Merge `main` in and re-run the suite *immediately
  before* merging, not after.
- The guard that works reads the **source** and asks whether every function a
  file calls is defined in it (`test/outreach-generator-smoke.mjs`). The first
  attempt awaited the database and timed out before reaching the bad line, so it
  passed with the bug still in place. Extend it rather than re-inventing it.

## ⏭ PICK THIS UP FIRST (Session 20)

**1. Ask the owner to open Admin → Integrations and read the card.** It now
actually runs — that is the change. The card self-runs on open, no click.
- 🟢 green → AI is live; move to the comparison below.
- 🟡 amber "half working" → one model name is wrong. The card prints the models
  Groq DOES offer; the fix is one paste into that provider's model box.
- 🔴 red → the provider's own message names the fix. Leading suspect is still
  that the Groq/OpenRouter model names in `PROVIDERS` were written from memory
  and have never met a real response (this sandbox cannot reach those hosts).

**2. Then: free model vs the rules writer, side by side, on a real posting.**
The six prompts were written for Claude; free open models follow tone
instructions less well. The honest verdict for the *email generator* may be
"keep the rules version" while the free tier earns its place on resume parsing
and JD cleanup. **This needs the owner's eyes on real output — do not decide it
for them.**

**3. Show the owner the phone build and take their reaction.** The layout is
measured-clean, but "clean" and "right" are different questions and only they
can answer the second. Obvious next candidates if they want more: a bottom tab
bar for the 4 most-used destinations, and card-shaped rows instead of a
side-scrolling table on the list pages.

**4. The two dead AI features** — wire the briefing to the dashboard, delete the
cold-email drafter. See the audit above.

**5. Finish the UI-kit rollout.** Every list-shaped page is converted. Still on
their own markup: the dashboards (`05-page-dashboard.js`, `16-insights.js`),
Admin (`08-page-admin.js`), the pipeline board (`28-page-pipeline.js`), My Team
(`42-page-myteam.js`), Assign Leads (`21-assign-leads.js`), the orphaned Manager
Users page. Card- and board-shaped, so each needs its own judgement.

**6. Growth bets not offered recently.** `CLAUDE.md` still flags **CSV
import/export + a small public API** as the highest-leverage unstarted bet.

## ⏸ Parked by the owner — do NOT re-raise as blocking

**The Gmail 7-day expiry.** On 2026-09-01 the owner said: *"We will work on this
but not now."* That is a decision. Do not open a session by asking about it.
Raise it only on a fresh visible incident, or if the owner asks what is open.

- **Symptom:** a dead Gmail sign-in destroys queued emails — `failed` with no
  retry, one every ~90s, reason never persisted (`emails` has no error column,
  so `friendlySendError`'s sentence dies with the process). Eleven follow-ups
  were lost this way on 31 Aug; they can still be re-queued.
- **Root cause is Google-side:** the consent screen is in **"Testing"**, where
  refresh tokens expire after exactly 7 days. If `futeglobal.com` is on Google
  Workspace, switching the app to "Internal" removes the limit with no code.
- **Three code defects worth fixing whatever Google says:** release to `pending`
  not `failed` on an auth failure (the thread-deferral path already does this);
  stop a mailbox on the FIRST auth failure; add the error column (**migration
  042**, still unclaimed).

## Rendering and the UI kit — read before touching any screen

Both rulesets are written out in `CLAUDE.md` (stack §Frontend). Do not work from
a paraphrase. The ones broken most often: a page registers with
`UI.registerPage()` and paints via `paintPageContent()`, **never**
`content.innerHTML`; anything that must survive a repaint (iframes, media,
internal scroll) needs its own region; **a repaint that changes nothing must
write nothing — not even the same class back**; build with
`UI.page({tabs, strip, toolbar, body})` rather than a twelfth hand-rolled table;
a strip never fabricates a number. Pinned by `test/screen-stability-smoke.mjs`.

Four more since Session 19: **hover-expand is gated on `(hover:hover) and
(pointer:fine)`, never on width**; **the phone menu is one class on `<body>`,
never a render** (`toggleNav()`); **`#content` is `overflow-x:hidden` below
860px, so nothing may overflow it** — a wide thing scrolls in its own box, and
`test/mobile-layout-smoke.mjs` is what makes that trade safe; **an inline style
cannot be responsive** — a block that must reflow needs a class first
(`.dash-tile`, `.fpair`, `.banner-clock` were all inline copies until they had
to move).

## Owner actions outstanding

1. **Report what the Admin → Integrations card says.** It now actually runs —
   the endpoint behind it was unreachable until Session 19. A free Groq key is
   already saved (`••••10c6`, marked "use first") and the card self-runs on
   open, no click. **That one line is the input Session 20 needs.**
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
fallback, route registration order, both AI blocks and the four mobile rules.
**Read it; these are the ones it does not cover.**

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
  GitHub delivers the 30-minute schedule every 3-5 hours (measured 2026-09-04).
  Jobs are delayed, never skipped — due-ness lives in the database. Only 8h+ of
  silence is worth checking `CRON_KEY` over.
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

`npm test` (**58 suites**, judged by **exit code** — and read the count, not
just the exit code: `npm test | tail -3` in a pipeline masks a failure) ·
`bash test/verify-frontend.sh` · build on the dev branch → test → screenshot/show
→ draft PR → **merge only on an explicit "merge it"** → apply a migration only on
a fresh explicit go-ahead, right before merge, never on general feature
agreement. **The owner does not read code**; show them the running app and plain
English.

**Habits these sessions paid for:**

- **When a feature reports nothing, check that its request reaches its handler
  BEFORE improving what the handler says.** Four sessions of work went into a
  diagnostic that was never once invoked, because the route was shadowed and
  answered 200.
- **Reproduce a visual complaint in the browser before changing CSS.** All three
  of the owner's phone faults were reproduced pixel-for-pixel first, which is
  how the cause turned out to be a stuck `:hover` rather than the width rule
  anyone would have reached for.
- **A fallback that protects the user must never be invisible to the operator.**
  Graceful degradation without observability is indistinguishable from broken.
- **A test that pins WORDING is not a test that pins BEHAVIOUR.** Ask which one
  a red test was pinning — that is the difference between fixing a test and
  weakening one — and never relax a safety assertion to make a redesign pass.
- **Re-run the suite against freshly merged `main` immediately before merging.**
  Two clean merges have now broken production between them.
- **Answer a cost question with measured numbers**, not reassurance.
- **Do not wait on `npm test` with `pgrep -f run-all.mjs`** — the waiter matches
  its own command line and never exits. Run it in the foreground with a long
  timeout.
