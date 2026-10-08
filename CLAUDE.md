# PACE — project memory (read me first, every session)

> **This section is not optional and must be carried into every context window / handoff.**
> If you are summarizing this project for a future session, copy the two sections
> below ("Who I'm working with" and "What we're building") verbatim.

## Who I'm working with

The owner is the **product owner and the end user** — not an engineer.

- They **do not read code** and **do not use git/GitHub**. Never ask them to review a
  diff, read code, resolve a merge, mark a PR ready, or operate GitHub. That work is
  mine, fully.
- They evaluate the product the way a customer would: **by using it** — does it look
  right, feel right, make sense, and actually work? So the things I hand them are the
  **running app, screenshots, and plain-English explanations** — never code.
- **My role is everything behind the system:** coder, planner, architect, tester,
  release engineer. I own the branches, PRs, and (once they've approved a change by
  reacting to it) the merge and the deploy. I confirm before doing something
  outward-facing or hard to reverse, but I don't push code chores onto them.
- I am expected to be **proactive**: after doing what was asked, suggest what else is
  worth building — product trends and high-leverage technical bets — always in plain
  language, framed as choices they can react to, not code.

**The working loop:** I build on the dev branch → I show them (screenshots / the live
app / a short summary) → they react as a user → we iterate → when they're happy, I
merge and deploy so they can use the real thing → I tell them plainly what's now live.

## What we're building

PACE is a **recruiting ATS + lead-management platform sold to other companies**
(SaaS), competitive with the established ATS products (Ceipal, Bullhorn, and the
like). Every decision is a product decision in service of that.

**PACE is the product; Fute Global is a customer.** (It was named "futé" until
Session 9, when the owner renamed it and redefined the business model: enterprises
register their email domain and their people flow in, individuals can sign up
alone, and access is gated by plan. LinkedIn was the reference — per-user
workflows plus organisation-assigned ones.) Anywhere the code still says "Fute
Global" in **outbound customer content** — cold-email templates, the resume
letterhead — that is the CUSTOMER'S identity and must become per-org
configuration, NOT a rename to PACE.

**Build philosophy: spend nothing now, scale later.** Prefer free tiers and infra we
already have. Don't add paid services unless they clearly earn it. But make the
**architecture** choices now that are cheap today and expensive to retrofit later, so
we never have to rewrite to grow (see "Growth bets" below).

---


---

> **This file is the RULES, trimmed on 2026-09-29 (R-088, owner's yes) from ~142 KB to a short constitution,
> because every message and every helper agent reads it.** Nothing was deleted: the full text — every
> "why", every incident — is in **`docs/CLAUDE_MD_FULL_SESSION34.md`** (search it by the bold heading
> named in a rule below when you need the reasoning). Open it only for that; never read it whole.

## How we spend effort (D-0060, R-088 — the owner's money)

- **No helper agent is started or resumed without the owner saying so in their own words.** Before one:
  say what it is for and roughly what it costs, then wait for a yes.
- **Small, clear fixes are done directly**, not through an agent. Run the targeted suite for what you touched;
  run ONE full `node test/run-all.mjs` (read the count) before a merge, plus Node 26 (below).
- **Read only what the next step needs**: `docs/CONTEXT_WINDOW.md` (top), the ROADMAP rows and DECISIONS entries
  involved, and the ONE territory memory + contract for the files being touched. Never read the archive whole.
- Agents, when approved, run on lower effort with targeted tests, and are told which files to read.

## The stack

**The map is `ARCHITECTURE.md`** (what is where, who owns it, the "one home" for each business rule, and the
stop-and-ask rule). This file is the rules; that one is the map — read it when you do not know where something belongs.

- **Backend:** Node/Express. `index.js` = the sales/lead engine (leads, send loop, follow-ups, mailbox sweeps);
  `routes/*.js` + `routes/recruiting/*.js` = the ATS (registered on `app` directly); shared helpers in
  `services/`. **Frontend:** plain `<script>` files `public/js/NN-*.js` loaded in order by `public/index.html`;
  no build step; global `window.*` + `STATE`. **Data:** Supabase (Postgres + storage bucket `candidate-docs`),
  project `teiqievahzhllojvgsku`, migrations in `migrations/` (next is 057 — check the folder).
  **Deploy:** Render (`fute-lms-backend.onrender.com`) auto-deploys from `main` — **merging to `main` IS the
  release.** Render is on the FREE tier: instance hours are a hard budget, so no frequent pingers (the GitHub
  heartbeat is every 30 min on purpose).
- **The sandbox runs Node 22; Render runs Node 26.** Something that works here and fails there: get the
  server's Node (`nodejs.org/dist/v<VER>/node-v<VER>-linux-x64.tar.xz`) and re-run `test/run-all.mjs` with it.
- **Tests:** `npm test` = `node test/run-all.mjs`, judged by exit code; **read the count, and never pipe it**
  (`| tail` masks a failure). `bash test/verify-frontend.sh` checks syntax. Browser suites (Playwright,
  Chromium at `$PLAYWRIGHT_BROWSERS_PATH`) enter via `test/helpers/enter-app.mjs`; `npm install` first.
  **Never add a product-side bypass to make a test easier** (no guest mode — Session 11).

## Rules that must never be softened (each was paid for with a real incident; full story in the FULL file)

**Routes and data**
- **Registration order is load-bearing in every router.** A literal path registered after a matching `:param`
  route is dead and fails silently. New literal endpoints go ABOVE the `:id` routes of their prefix.
  `test/route-shadowing-smoke.mjs` and `recruiting-routes-mounted.mjs` pin it.
- **Use `models/`, not hand-written `supabase.from()` on tenant tables:** `db.forRequest(req)` scopes to the
  caller's org; `db.global` for the 7 org-less tables; `db.crossOrg` is the greppable escape hatch.
  A migration adding a table with `org_id` must add it to `models/tables.js`. **Apply a migration BEFORE
  merging the code that uses it, and never to the live DB without the owner's fresh go-ahead.**
- **Multi-tenancy:** `org_id` NOT NULL everywhere, RLS on all tables, `orgIdFor()`'s default-org fallback is
  deliberate (do not make it return null). **Every customer company brings its own keys (D-0055 → R-067)** —
  today API keys are deployment-wide; fix before a second customer.
- **Who sees what (D-0034/35/36):** you see what you own plus your reporting chain's; admin sees the company;
  the Unassigned pool only to admin/ra_lead. Call `viewScope`/`scopeLeads`/`scopeEmails`/`canSee*`; **never
  filter in the browser**; narrow in SQL before any `.limit()`; unseeable by id → 404.
- **Ownership is defined once, in `services/ownership.js` (D-0020):** one responsible person per record; a
  to-do list holds only your own; managers review and prompt, never reach in. **A thing you can see, appear to
  act on, and not actually change is worse than showing it plainly or hiding it.** A briefing is about the
  reader's desk (D-0021). Per-user preferences live per user, not in the browser (D-0022).
- **A rule that decides whether an action is allowed lives where the action is OFFERED, not only where it is
  taken** (double-send guard → `services/outreach-dedup.js`). **A task PACE cannot carry out is not created.**
  A row that asks someone to do something says who asked (`services/reminder-source.js`).
- **Business terms are defined once and made callable** (submission counts: `services/submission-stages.js` —
  two published numbers, `Sourced` is NOT a submission, an unknown stage counts as nothing). Releasing a lead
  to the pool goes through `releaseToPoolUpdate()` and stamps `last_recycled_at`.
- **Stages:** 11 ATS stages on `submissions.stage` (Sourced … On Hold); `33-stage-modal.js` is canonical on the
  frontend, `services/recruiting-core.js` on the server; `normalizeStage()` maps legacy values. **Inside a job
  everybody starts at Sourced — "Tagged" is not a step (D-0057).** A submission = sent to the client; adding a
  person to a job is not one and carries no `submitted_at`. Recruiters move only up to "Submitted to BDM".
- **A guarded call to a function that does not exist is dead code** — cross-module calls go to a NAMED global
  (`window.atsReloadCandidates`, `window.bdReloadSubmissions`); a scope error is a runtime error only running
  the code finds.

**Email (three pipelines, and they stay three)**
- `emails` (leads engine), `email_tracking` (one-off sends) and `candidate_outreach` (batches) stay separate;
  `routes/email-history.js` merges them for DISPLAY only. Never merge them for sending.
- **The sender is resolved at SEND time from the mailbox that sends**; stored bodies keep `{{sender}}`/
  `{{senderemail}}`; **every reader of a stored body calls `renderStoredEmail(row, mailbox)`** and every
  preview resolves from the selected mailbox, never the session user. **A merge field is filled by the server
  and then checked (`unresolvedVars`) — refuse with a 400, never blank it.** `VAR_SYNONYMS` maps the sales and
  recruiting vocabularies; a direct hit beats an alias.
- **Anything composing mail calls `fillSignatureHtml`**; the body never signs itself on top of a template signature.
- **Send-queue order is a business decision** (`send-queue-order.js`); never drop the `ORDER BY` on the paginated
  pending fetch. **Failed sends retry only when TEMPORARY** (`services/send-retry.js`); an uncertain one never
  retries; `recordSendFailure()` is the only writer. A Gmail thread id belongs to one mailbox (fresh email + quote
  only on a definite 404). A row left at 'sending' by a dead process moves at boot to "Didn't send".
- **All outbound HTTP goes through `http-client.js`** (timeouts; retries safe methods only — never retry a
  `POST /me/sendMail`). Public pages (`/i/:token`, `/apply/:token`) never hang on the DB (4s bounds), never report
  an unsaved write as saved, and answer every miss identically. The in-app mailbox: nothing mirrored into
  Postgres, your own mailboxes only (404 otherwise), nothing destroys mail, body in a sandboxed iframe.
- **Candidate outreach:** AI called ONCE per job order (cached brief), not per candidate; own send window
  (weekday evenings / weekends in the CANDIDATE's timezone); the answer is two buttons and the link must NOT
  record (mail scanners fetch links); only the explicit opt-out suppresses. **An AI draft is checked, not
  trusted** (`checkDraft`/`checkCandidateDraft`); the rules writer must pass its own checker. The generator
  sends the CUSTOMER's name (per-org config), never "Fute Global" hard-coded.

**AI**
- **Every AI call goes through `services/ai-provider.js`** and its budget (`services/ai-budget.js`): `complete()`
  returns NULL, never throws, and null means "write it with the rules"; over budget is NOT an error; a caller with
  no `feature` gets the tightest allowance. **Everything ships rules-first** (no funded key). **A hosted model name
  is expiring stock** — if AI goes quiet check the model name first (OpenRouter free models are looked up at
  runtime). A fallback that protects the user must be visible to the operator (`diagnose()`, `ai_last_error`).
- **Apollo:** only `services/people-apollo.js` calls it (POC finder: people search free, one lookup = one
  credit, never retried, key in a header). The Sourcing page's Apollo/Indeed/Monster/Dice/LinkedIn rows are
  NOT integrated — **a screen must not advertise what does not exist** (`config/sourcing.js`: `built` vs
  `available`, every unbuilt row carries a `blocker`). Never quote a vendor's free tier from memory.
- **Free job sources:** only `services/jobs-jsearch.js` calls JSearch; the key belongs to the ORGANISATION using it (per-organisation, masked, never shared — the vendor's terms do not allow one key for many customers to be assumed), counted per organisation per day BEFORE the call, never retried, and a card it makes shows only what it knows (no invented size or people).
- **Resume parsing uses `unpdf`, not `pdf-parse`** (Node 26 breaks the old one) and says which of five ways it
  failed (`describePdfFailure`); failures are recorded, best-effort.

**Recruiting flows**
- **Candidates apply to us via `routes/apply.js`:** the token is the secret; an applicant NEVER lands in
  `candidates` (staged in `sourcing_candidates`); the client's name is never on a public page; publishing only
  via `POST /job-orders/:id/apply-link`. Applicants are a VIEW of the sourcing queue (one list, one import path,
  `services/applicants.js` is the only reader of `raw`). Applicant score "—" never 0.
- **Conversation intelligence** (`conversation-intel.js`, pure, injectable clock) feeds one "needs you today"
  queue; opted-out threads never produce an action; every row has an exit (fingerprinted snooze, not delete).
- **Billing:** `services/plans.js` is data, a limit that is not enforced is a claim (402 on create), being over a
  limit never deletes anything, only the signed webhook changes a plan. Pricing stays `null` (owner's call).

**Frontend and layout**
- **The render engine writes only what changed.** A page module never writes `#content` itself: it registers with
  `UI.registerPage(name, renderFn, paintFn?)` and calls `paintPageContent()`; a record detail is a drawer via
  `UI.registerOverlay`; **anything that must survive a repaint needs its own region; an idle repaint writes
  nothing; a repaint on a timer is a repaint under the user's hands.** Everything entering `#layer` goes through
  `overlayWrap()`. Build screens with the `UI` kit (`public/ui.css` + `00-ui-kit.js`), not another hand-rolled table.
- **Text size and colour are classes, not inline (R-013):** `fs-12`, `c-text3` … (one generated block at the end of `ui.css`). Never write `style="font-size:…"` or `color:var(--…)` in new markup. `scripts/inline-to-classes.mjs` converts AND proves each change in the real app; `scripts/screens-fingerprint.mjs` (run on two checkouts, then `--diff`) is the before/after proof for any work that must change nothing on screen. `test/utility-classes-smoke.mjs` fails if a class is used but not defined.
- **Phone is first-class (`public/mobile.css`):** hover gated on `(hover:hover) and (pointer:fine)`, never width;
  the menu is a class on `<body>`, never a render; nothing may overflow `#content` (a wide thing scrolls in its
  own box); **an inline style cannot be responsive, re-themed or re-scaled — give it a class**; reflow, never shrink;
  inputs are 16px and the whole phone scale comes up to meet it. `mobile-layout-smoke` is what makes hiding overflow safe.
- **Themes:** every palette (`ui.css` has its own), every state (hover/open), every self-painting thing (canvas)
  must be told the palette; inversion is not a theme-safe colour; **a float is opaque (`--card-solid`), `--card` is
  glass**; glass belongs to floating surfaces, not controls (≤12 layers/screen); **never `transition: all`**;
  colour is scarce on a list (calm by default, state = 3px stripe + one chip). This sandbox cannot measure
  smoothness — count layers/nodes/pixels and say how it FEELS is the owner's call.
- **Every list has a horizon and an exit** (`services/view-horizon.js`, `UI.partition/horizonBar/pager`): 90-day
  default, search reaches all history, say how many are hidden, pickers past 15 become search fields, finished
  things leave (never deleted). The stage vocabulary lives in `33-stage-modal.js`.

**Testing lessons (each guard was found vacuous at least once)**
- **A guard must fail when the thing is ABSENT, not only when it is ugly** (a crashed page outscores a working
  one on every quality metric — `page-renders-smoke` exists for that). **A probe that cannot measure must FAIL, never
  pass.** Never anchor a DOM assertion on a nesting depth; **a test that greps source text cannot tell a live rule
  from a dead one — make the rule callable.** A fake db must project rows to the route's own select. A suite only
  covers the screens it renders: drive sub-states (tabs) and the logged-out screen. A "young" seeded account must
  be RECENT. **Reintroduce the bug and watch the new guard fail before trusting it.**
- **A syntax check proves a file parses, not that it still does anything.** Prefer an edit anchored on the exact
  text replaced over a start/end slice. A `TEST_USERS` set is not the user set (`bd_lead`, `director`,
  `associate_director` are missing). Two green runs are not two runs of the same thing — read what was IN the run.
- **A bug report is data, usually more precise than it first reads — reproduce the sentence, not your hypothesis.**
  Prefer the mechanism you can test here over the one you cannot (no Supabase credentials in the sandbox).
- **Never `git add -A`** where an agent is working — stage the paths the commit is about. **Never pipe `git push`
  into `tail`.** Before moving any file read `docs/CONTEXT_ARCHIVE.md` § "DEPENDENCY MAP".

## Working conventions

Implement → `node --check` → targeted smoke → screenshot → commit → push to the session's dev branch → open a
**draft PR** → when the owner approves, merge + let it deploy. Keep commits/PRs clean.

- **`docs/CONTEXT_WINDOW.md`** = current state only, under ~200 lines, REWRITTEN each session (what a new session
  reads). **`docs/CONTEXT_ARCHIVE.md`** = full history, APPEND-ONLY, **written as the work lands (D-0024)**, closing
  synthesis last. Keep this file current too.
- **Hooks enforce the protocol (D-0027, `.claude/settings.json`):** SessionStart injects it; a Stop hook blocks
  finishing with memory unwritten (`node scripts/memory-check.mjs` names what is owed). Satisfy it by writing the
  memory properly or an honest one-line placeholder in the archive — never by writing nothing.
- **`docs/ROADMAP.md` is the live list (D-0030):** every suggestion is a row the turn it is made
  (`PENDING`/`DOING`/`DONE`/`CHANGED`/`DROPPED`; `CHANGED` is not `DONE`; nothing is deleted); mirror changes to
  the artifact `NQ4HUuMfAWJk34g9Vs5EdQ` (collections `items`, `shipped`). When asked "what's left", READ the file.
- **Nine territories (`docs/territories/README.md`):** `surface`, `gateway`, `deep`, `harbour`, `observatory`,
  `guild`, `rampart`, `foundry`, `ledger` (+ `dispatch` as the front door). A territory never edits another's
  paths (open a request in `docs/territories/_contracts.md`); a shared file has one owner (`index.js` is gateway's);
  foundry and rampart review everything. Memory: `docs/territories/<name>.md`; what PACE can already do:
  `CAPABILITIES.md` (**grep it before building anything**, in the owner's terms); what the owner decided:
  `DECISIONS.md` (written the moment it is decided; never edited — a reversal is a new entry).
  `node scripts/territory-map.mjs` after any restructure.

## The current build and growth bets (one paragraph each — details in the FULL file)

- **The Autonomous Recruiting Engine (`docs/AUTONOMOUS_ENGINE_PLAN.md`) is shipped, all five steps.** ₹0 budget,
  no funded Anthropic key, runs inside PACE (not Make), US + India. Conversation intelligence, one reply sweep for
  Outlook and Gmail (do not add a second), migration 037 `conversation_messages` applied.
- **Growth bets, offered to the owner in plain language, never built unasked:** multi-tenancy (done through RLS;
  self-serve signup built and OFF via `SELF_SERVE_SIGNUP`), configurable per-org roles/permissions (hierarchy
  done, permission differences open), app-tracked candidate email (done), match scoring (done), reporting (on the
  Dashboard), CSV import/export + a small public API, an audit trail everywhere, PWA polish, billing (built,
  payments OFF), clients as first-class (done). Full status per bet: FULL file "Growth bets".
