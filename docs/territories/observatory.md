# Observatory — memory
> Last written: 2026-09-23 (Session 30, C-0024) · seeded from `CLAUDE.md` and Session 21

## What is true here now
- **Every AI call goes through `services/ai-provider.js`** — `complete(supabase,
  {system, prompt, maxTokens, feature, orgId})`. Two wire formats only:
  `anthropic` and `openai` (Groq, OpenRouter and Ollama all speak the second).
- **Providers chain; the admin's pick only leads** (`int_ai_active`). Losing one
  costs a dropdown, not a feature.
- `services/ai-budget.js` trims input, clamps `max_tokens`, tiers the model
  (`fast` for extraction, `quality` for prose a prospect reads) and refuses once
  the org's daily ceiling is hit. Meter is `app_settings`, keyed
  `ai_usage_<org>_<YYYY-MM-DD>`. Defaults 150k tokens / 250 requests.
- **Blank cap means "use the default"; a typed 0 means "no AI today".**
- **AI is wired in seven places.** Live: resume parsing, the JD scrub, the
  outreach generator, lead-distribution advice, **the morning briefing**.
  **Dead:** cold-email drafting (`/ai/generate-email` — reachable only from the
  orphaned `12-manager-users.js`). Do not repeat a feature count without
  re-checking the UI; the code count and the product count differ.
- **THE MORNING BRIEFING — `services/morning-briefing.js` (PURE) +
  `GET /ai/morning-briefing`.** One or two sentences at the top of the dashboard
  saying what came in today. `rulesBriefing(facts)` is what ships; the AI is the
  upgrade. Rules that hold:
  * **A fact that is zero is not mentioned**, and an absent fact (a query that
    errored) is silent too — a briefing missing a clause stays true; one saying
    "0 leads" because a count failed does not.
  * **`checkBriefing()` is the guarantee, the prompt is only a request.** The
    load-bearing rule is `invented_number`: every integer in an AI draft must be
    one we handed over (`allowedNumbers()` is computed from the facts, never
    written twice). Also `invented_number_word` ("six"), and `vague_quantity` —
    "around a dozen leads" passes every digit check and is still not what
    happened.
  * **No repair turn here**, deliberately: the answer is two sentences, a second
    call costs as much as the first, and the rules draft is genuinely good.
    Contrast the outreach generator, where a prospect reads the result.
  * `/ai/generate-summary` (the old POST) now degrades to the SAME rules writer
    instead of "AI summary unavailable" — Admin → Integrations promises the daily
    briefing has a non-AI version, and until now that was untrue.
  * **Response shape is contracted in `_contracts.md` C-0001** — always 200,
    `summary` always a non-empty string, `engine: rules|ai`, `quiet`, `degraded`
    (database, not AI), `facts`. Surface renders it; do not change the shape
    without closing a new contract.
  * Leads are counted with the same filter `/jobs/today-summary` uses, so the two
    cannot disagree about a morning (C-0007).
- **Groq's verified models (2026-09-05, from that account's own `/models`):**
  `openai/gpt-oss-20b` fast, `openai/gpt-oss-120b` quality. OpenRouter's are
  **still unverified** — no key is configured.
- **The sandbox can call `api.groq.com`** (allowlisted 2026-09-08). Key is in
  `app_settings.int_groq_api_key`. Node's `fetch` does not use the proxy; `curl`
  does. Write the key to a file, read it from there, delete it after.
- Resume parsing leads with **`unpdf`**, `pdf-parse` kept as a second chance.

- **THE CANDIDATE SEND WINDOW IS A SWITCH, AND IT IS OFF** (owner, 2026-09-09
  evening, reversing their own call from that morning: *"remove the barricade of
  timezone for candidate emails and individual emailing, Only the outreach goes
  within the time zone"*). Eight real emails sat `pending` with `send_after` long
  past because every candidate was below the 17:00 weekday opening in their own
  state. The window was the only thing holding them.
  * The pure hours logic is **kept, not deleted** — `candidateWindowState` /
    `describeWindowOpens` / `normalizeWindow` are unchanged in behaviour and
    still fully tested. `normalizeWindow` now carries `enabled`, which defaults
    to **true** *in the service* (its job is only "make sense of a config") and
    is decided **off** by the caller, `routes/candidate-outreach.js`, from
    `app_settings.candidate_send_window_enabled`
    (`gen.CANDIDATE_SEND_WINDOW_KEY`, parsed by `gen.windowEnabledFromSetting`).
  * **Unset, unparseable or an unreadable settings table all mean OFF.** A
    barricade the owner removed must never come back through a failed query.
  * With it off, `candidateWindowState` returns `{open:true, disabled:true}` for
    every hour, so the queue's `wait` reason resolves to `due` on its own, and
    the drain skips the per-row `candidates` lookup entirely.
  * `GET /candidate-outreach/sender` returns `window.enabled` and a ready-made
    `window.sentence` — the page used to assemble prose around `window.label`
    and would otherwise still promise a wait (C-0008, surface).
  * **THE BD LEAD WINDOW IS UNTOUCHED.** Only candidate outreach lost its hours.
    Nothing in this router may call `isInLeadSendWindow` /
    `getSendWindowHours` / `formatWindowOpensLabel`; a test still fails if it does.
  * **THE DRIP IS NOT THE WINDOW.** 6 per tick, 75-105s between REAL sends,
    `send_after` spacing at queue time — all untouched, and that is what stops
    the released backlog going out back to back.

- **THE JOB DESCRIPTION TRAVELS INSIDE THE EMAIL, AS A PANEL** (owner,
  2026-09-10, `DECISIONS.md` D-0012: *"remove the job description sending thing
  and attach the job description in a formatted window format when asking the
  candidates about their interest to jobs"* — **no file attachments**, asked and
  answered). `jobBlock(job)` in `services/candidate-outreach.js`, still pure.
  * **THE PLAIN TEXT IS THE ORIGINAL; THE CARD IS A RENDERING OF IT.** The panel
    is written into the STORED body as a fenced text block, and
    `jobBlockHtmlFromText()` builds the bordered card by parsing that text back.
    `jobBlock(job).html === jobBlockHtmlFromText(splitJobBlock(storedBody).block)`
    — proven, not asserted. Consequences worth keeping: the card can never carry
    a fact the text does not; a text-only client loses only the border; and the
    drain, which holds the row and not the job order, needs **no second query**
    and cannot disagree with the preview even if somebody edits the job order
    between queueing and sending. This is `briefFor()`'s one-loader rule taken
    one step further — do not "simplify" it into a second builder that reads
    `job_orders` at send time.
  * **THE PANEL IS THE LAST THING IN THE BODY, AFTER THE SIGN-OFF.**
    `buildHtmlEmailBody(text, extraHtml)` (gateway's) can only append markup
    AFTER the text, so anywhere else would render in one order as text and
    another as HTML. Order in both: prose → Thanks/{{sender}} → panel → answer
    buttons → signature → compliance footer.
  * **A FIELD THAT IS ABSENT IS NOT A ROW**, and a filled-in field meaning
    "nothing to say" is not either — `EMPTY_ANSWERS` drops `Clearance: None`,
    `Work authorisation: Any`, `n/a`, `tbd`. A panel that would carry nothing
    but the title is not printed at all (the title-only job order: the subject
    line already says that much). Rows: Company, Location, Employment
    (`f.terms`, so `remoteTerm` has already turned "No" into "on site"), Pay
    (+`payPeriod`), Experience (`exp_min/max`), Skills (through `prettySkill`),
    Work authorisation, Clearance. **`start_date` is deliberately NOT a row** —
    a stale date reads as a broken system.
  * **`checkCandidateDraft` NOW SPLITS PROSE FROM PANEL, AND THAT SPLIT IS WHAT
    MAKES THE PANEL SAFE.** Everything it checks reads `proseOf(email)`; only
    `placeholder`, `missing_role` and `missing_location` see the whole thing.
    The panel is a **projection of the job_orders row, never model output**, so:
    `invented_pay` has nothing to say about a figure the client posted;
    `invented_experience` cannot repeat its worst failure (it read the JOB's
    "2-3 years" as a claim about the reader and skipped 3 of 4 real people, and
    a quoted posting is full of such sentences); and the word bands still police
    our four angles rather than being flattened by an identical panel appended
    to all of them. `words` on a variant is now PROSE words.
  * **THE DUPLICATION QUESTION, DECIDED:** title and location are printed twice
    by construction (the checker REQUIRES them in the prose and the owner
    requires them in the panel), so "no fact twice" was never achievable.
    `direct` therefore drops its tabulating pay/terms sentence — the panel does
    that better — and **`specifics` keeps it**, because dropping it left an
    angle that was a paraphrase of `direct` and 55 words long. One deliberate
    overlap on one of four angles. No `duplicate_fact` check: the only version
    that could exist would reject our own `specifics`.
  * **A PASTED JD IS CLEANED, NOT REWRITTEN.** `cleanDescription()` strips tags,
    normalises bullets, drops punctuation-only rules, caps at 1,200 chars / 12
    lines cutting on a sentence or word boundary with a trailing "…". The
    client's own marketing words, exclamation marks and posted rates SURVIVE —
    it is their posting, quoted, and PACE's own prose is what our checks are
    for. **One exception, and it is commercial:** a sentence carrying an
    apply/submit/send verb AND a link is dropped (`APPLY_INSTRUCTION`), because
    it hands the candidate to the client's own form. Sentence-level, not
    line-level: "Pay up to $3,200 per week. Apply at https://…" must keep the
    rate.
  * **DROPPING A PUNCTUATION-ONLY LINE IS WHAT MAKES THE FENCE SAFE.** A pasted
    JD very often carries its own rule of dashes, and one inside the block would
    look exactly like the fence and split the email in the wrong place.
  * Two live defects found while rendering the first real drafts, both fixed
    here: `rulesJobBrief` printed **raw lowercase skills** ("The work centres on
    hvac, epa and boilers" — the exact sentence `prettySkill` was written for,
    applied to the why-clause and missed in the brief), and `indefinite()` said
    "**a** HVAC Service Technician". The article fix is a **LIST, not a rule**
    (`VOWEL_SOUND_ACRONYM`): the rule fires on ALL-CAPS English — "an SALES
    Manager" — and missing an acronym only reproduces today's reading, so the
    list is the safe direction to be incomplete in.

## Fragile — touch with care
- **Groq free tier is 8,000 tokens/minute; one outreach angle is ~2,100.** Four
  in quick succession rate-limits. The quality→fast fallback absorbs it because
  the limit is per model. Sleep ~20s between calls in the sandbox.
- **A reasoning model bills its thinking against `max_tokens`.**
  `PROVIDERS[id].reasoningModels` marks the gpt-oss family; `modelParams()` sends
  `reasoning_effort:'low'` and **nothing else** — an unknown parameter is a 400.
  `answerCeiling()` adds `REASONING_HEADROOM` (512) on top of the feature's
  ceiling. Without it, lead distribution returned truncated, billed, unparseable
  JSON reported to the user as "no AI provider answered".
- **`checkDraft` rules that fired wrong on first live use:** the model dropped
  the greeting reading "identity in sentence one" literally, and
  `double_signoff_name` read the last four lines — the whole email on a compact
  draft. **`invented_experience` read a fact about the vacancy as a claim about
  the person** and skipped 3 of 4 real candidates; it now requires a
  second-person attribution.
- **Proving the drain behaves needs three stub tricks** (the window work): the
  fake `candidate_outreach` query must honour `.limit()` or the 6-per-tick cap
  looks broken; the chain needs `.upsert()` for `email_send_log`, without which
  every send is counted **failed after the mail has already gone**; and
  overriding `global.setTimeout` to record `ms` and fire immediately turns a
  seven-minute drip into a millisecond assertion. Every window assertion
  currently in `test/candidate-outreach-smoke.mjs` is a **grep over the router
  source**, not a run — see C-0009.
- `REWRITE_LIMIT` is 3, enforced server-side (429), duplicated in
  `48-page-outreach-gen.js`. A test asserts they match.
- **`test/candidate-outreach-smoke.mjs` GREPS THE ROUTER'S SOURCE FOR TWO EXACT
  EXPRESSIONS.** `renderStoredEmail(row, mailbox)` in the drain and
  `renderStoredEmail({ subject: v.subject, body: v.email }, mailbox)` in the
  preview. Rewriting either line — even into something better — fails a suite
  that is not about your change. It is foundry's file; work around it or open a
  contract.
- **The whole drain path can be run offline for real**, which is how the panel
  was proved rather than reasoned about: the stub harness in
  `test/candidate-outreach-drip-smoke.mjs` plus a verbatim copy of
  `buildHtmlEmailBody` + `COMPLIANCE_FOOTER_HTML` from `index.js` (gateway's —
  copied into a scratch file, never imported: requiring `index.js` boots a
  server). Capture `sendMailboxNewMessage`'s `htmlBody`, write it to a file,
  screenshot it with `playwright-core` at 760px. That is a picture of the real
  email in about a minute.

## Open here
- Follow-up variants are still **rules-only**; the four first-outreach angles are
  AI-written, the three follow-up shapes are not.
- A per-call AI usage history (today's meter is a daily counter, not an audit
  log) would be its own table.
- One dead feature left: delete the orphaned cold-email drafter (C-0002 is
  gateway's).
- **The briefing's AI path has NOT been exercised against live Groq.** This
  sandbox had no `.env` and no Supabase credentials this session, so the key in
  `app_settings.int_groq_api_key` was unreachable — `curl` to `api.groq.com`
  needs a key I could not get. The rules path is verified end-to-end through the
  real router; the AI path is verified only against hand-written model outputs
  through `chooseBriefing()`. **Check `.env` exists before promising a live
  model run.**
- The briefing is org-wide for every role, not hierarchy-scoped. If a recruiter
  should see only their own arrivals, that is guild's scoping question (C-0005
  territory), not a change to the writer.
- **The JD panel is not on screen yet.** `POST /candidate-outreach/preview`
  returns `preview_prose` + `block_html` per variant; until surface renders
  those (C-0019) the page keeps showing `preview_email`, which contains the
  fenced TEXT — readable and complete, just not the card. Nothing is broken in
  the meantime, by design.
- **The panel has no test of its own** (C-0020, foundry). The 201 assertions in
  `candidate-outreach-smoke.mjs` all pass with it in place, which proves it
  broke nothing; nothing yet pins the fence-collision case, the prose/panel
  split in the checker, or the text→html round-trip.
- **`GET /candidate-outreach/queue` returns `body` in full**, so its payload
  grew by the panel (~1.5KB a row, up to 100 rows). Left deliberately: that
  field answers "what did we actually send them" and must stay complete. If the
  page wants the card there too, that is a split-per-row I did not add unasked.
- Still no live model run possible from this sandbox: **no `.env`, no Supabase
  credentials**, so `app_settings.int_groq_api_key` is unreachable. The panel
  needs no AI at all (it is a projection of `job_orders`), and the AI *brief*
  was exercised against the real cached brief off the live HVAC job order — but
  a fresh Groq call was not made. Check `.env` exists before promising one.

## Session 27 — OpenRouter's model had been dead for two months

- **`meta-llama/llama-3.2-3b-instruct:free` was the OpenRouter FAST tier and
  OpenRouter removed that free variant on 2026-07-19.** Written from memory and
  never verified, because no OpenRouter key had ever been configured to verify
  it against. The owner obtaining a key is what prompted the re-check.
- **It would have been completely silent**: a retired name is a 404,
  `complete()` turns that into `null`, and null means "write it with the
  rules" — under a green *Key valid* tick, which only ever proved the KEY was
  accepted.
- **Both tiers now point at `meta-llama/llama-3.3-70b-instruct:free`**, the one
  variant confirmed live. **Deliberately NOT replaced with a smaller model name
  picked from memory** — guessing is the mistake being fixed, twice over now
  (Groq did this in Session 19). Use the health card, which reads the account's
  own `/models` list, to set a genuinely fast one.
- **Treat every hardcoded model name in `services/ai-provider.js` as expiring
  stock, never a constant.** Two providers, same bug, two sessions apart.

## Log
- **2026-09-10** — put the job description INSIDE the candidate email as a
  formatted panel (D-0012), so nothing is lost when "Email JD to candidates" is
  removed. `jobBlock` / `splitJobBlock` / `jobBlockHtmlFromText` /
  `cleanDescription` in the pure service; the drain and the preview split the
  same stored text with the same function. Proved by running the REAL
  `drainDueOutreach()` over three job shapes and screenshotting the exact
  `htmlBody` handed to the provider. 66/66 rules drafts across 6 job shapes × 3
  candidate shapes × every angle still pass their own checker; full suite 70/70
  (log-grepped, never piped to `tail`). Fixed two live defects found while
  looking at real output: lowercase skills in the rules brief, and "a HVAC".
  Raised C-0019 (surface, render the card in the preview) and C-0020 (foundry,
  pin the panel — including the branch hazard below).
  **⚠ INCIDENT:** midway through this job another agent checked out `main` and
  then `claude/handoff-current` in the same working tree and committed with
  `-a`, sweeping **337 lines of my half-finished service file** into commit
  `48311e3` ("docs: bring the handoff current"). Its router half is NOT in that
  commit, so **`claude/handoff-current` merged alone would ship an email with
  the raw fence and panel text visible to candidates.** I recovered by backing
  both files up to the scratchpad, `git checkout -f claude/merge-candidate-email`
  and restoring them; the work is complete and uncommitted on the right branch.
  Lesson worth keeping: **check `git branch --show-current` before you finish,
  not just before you start** — a shared working tree can move under you, and
  `node --check` plus a green suite will not tell you which branch you are on.
- **2026-09-09 (evening)** — switched the candidate send window OFF by default
  behind `app_settings.candidate_send_window_enabled`, keeping the hours logic
  intact. Proved with the real `drainDueOutreach` over 8 overdue rows: flag off
  → `{sent:6, deferred:0}` with pauses `[98308, 79425, 102006, 84928, 93565]`ms;
  flag on → `{sent:0, deferred:6}`. Full suite 67/67. Raised C-0008 (surface,
  the on-screen promise), C-0009 (foundry, pin the pacing behaviourally),
  C-0010 (gateway, the four hour descriptions).
- **2026-09-09** — seeded. No work done by an agent yet.
- **2026-09-09** — built the morning briefing (`services/morning-briefing.js`,
  `GET /ai/morning-briefing`), converted `/ai/generate-summary` off its apology,
  answered C-0001 (response shape) and C-0007 (keep both counters). Verified the
  no-AI path through the real router with a stubbed database: busy day, quiet
  day and the legacy endpoint all return true sentences with no provider
  configured. All six observatory suites green.
- **2026-09-22** — found and fixed OpenRouter's retired fast model; both tiers now on the one variant confirmed live.
- **2026-09-23** — C-0024 answered: the Generator's pickers show only the viewer's desk (D-0034), a Generator lead is owned by its sender (D-0020), convert-lead is own-sends-only and accepts `id`, and a colleague's existing lead is not enrolled. Raised C-0028 (surface: key the Sent list on `id`). outreach-generator-smoke 138/138, outreach-ai-quality 66/66, the six observatory suites green, scratch harness 35/35 with 7/7 mutations caught.

## Session 29 — AI writes the engine's first emails (D-0032, D-0033)
`services/engine-draft.js` (pure; `complete` injected) turns a lead row into the
Generator's input and runs ONE draft + at most ONE repair through `checkDraft`;
any failure returns `skipped` and the queued template goes out. Budget feature
`engine_first_email` (in 3000 / out 800 / quality). **Title-only leads are the
norm** (49/49 on 2026-09-23 — the importer writes `jd_raw: "Title: X"`), so
`thin_posting` (< 300 chars) adds a prompt line forbidding invented duties/
requirements/pay and lowers `too_short` to 35 words — a 60-word floor with no
facts is an instruction to invent. Measured size: ~1,690 tokens in, ~230 out
plus reasoning ≈ 2,100-2,400 per lead; a real JD adds roughly 700-1,100 more.
The stored text has the sender's name/address put back as `{{sender}}` /
`{{senderemail}}` (`deferSender`) so the send-time rendering rule holds.
**Not yet seen live:** no real AI sample was produced — the sandbox refused a
call with the stored Groq key. Check the first AI-written rows in production.

- **2026-09-23 (Session 29, R-041)** — budget feature `engine_first_email_thin` (tier `fast`) for title-only leads; `engine_first_email` (quality) only when a real posting exists. Also splits the meter so the two show separately.

## Session 29 — R-040: provider-reported limits
`readRateLimits(headers)` (pure) reads `x-ratelimit-{limit,remaining,reset}` for
`-requests`, `-tokens` and the plain form; `recordLimits()` keeps one entry per
provider/model in `app_settings.ai_provider_limits`, written on success AND on
refusal (a 429 is exactly when the numbers matter), from both `complete()` and
`diagnose()`. Best-effort, never throws. `LIMIT_WINDOWS.groq` = requests per
DAY, tokens per MINUTE (Groq's documented meaning); other providers are shown
as reported with no window claimed. **Use these numbers, not memory, whenever
the owner asks whether a free tier is enough.**

## Session 29 — OpenRouter free models are looked up, not remembered
The owner connected OpenRouter and the health card answered **HTTP 404 — this
model is unavailable for free** for `meta-llama/llama-3.3-70b-instruct:free`,
the one variant Session 27 had confirmed live. **Third expired model name.**
`freeModelsFor()` reads OpenRouter's public `/models` (prices per token),
`rankFreeModels()` (pure) keeps zero-priced text writers, largest context
first; cached 6h in `app_settings.ai_openrouter_free_models`, a stale list used
if the catalogue is unreachable. `candidateModels()` applies it to OpenRouter
only and only without an admin override, in both `complete()` and `diagnose()`.
The sandbox cannot reach openrouter.ai, so the real list has not been seen here
— the owner's health card is where it shows.

## Session 30 — D-0034 in the Generator (C-0024, answered)
- **THE RECIPIENT PICKERS SHOW ONLY YOUR DESK.** `/outreach/recipients` and
  `/outreach/company-contacts/:id` searched every contact in the org, so a BD
  could pick and cold-email a colleague's contact. Now: `viewerScope(req)`
  (ownership.js `viewScope` + hierarchy.js `reportingChainIds`, nothing
  re-derived) → `sightClauses(scope)` → `visibleContacts(scope, build, limit)`.
  **One query per clause of `canSeeLead`** (`jobs.assigned_to_bd` / `created_by`
  / `assigned_to` `in` the scope ids, plus `jobs.assigned_to_bd is null` for
  pool roles) on a `jobs!inner` join, each with its own LIMIT, merged, then
  `canSeeContact` as the final gate. Why not one PostgREST OR across the
  embedded table: nothing here can run PostgREST, and the per-clause filter is
  the exact shape (`jobs!inner` + `.eq('jobs.company_id')`) already live in
  production. The URLs were captured from real supabase-js 2.108 and match that
  shape. Admin = one unfiltered clause; an empty scope = no query at all.
  **Companies stay org-wide.** D-0034 left the client list undecided, so picking
  a company still works and then offers only the people on leads you may see.
- **A GENERATOR LEAD HAS AN OWNER.** `createLeadFromOutreach` now writes
  `assigned_to_bd` = the sender and `assigned_at` (both paths: send+sequence →
  `Assigned`, convert-lead → `Connected`). Before this the lead was `Assigned`
  and owned by nobody, so it was missing from its own sender's Leads page.
  **Behaviour change worth knowing:** with `assigned_at` set, an `Assigned`
  generator lead now goes through the 30-day recycler like any distributed
  lead. Before, it could never recycle. The sequence path already resolved
  its BD as `job.assigned_to_bd || enrollment.enrolled_by`
  (index.js), so step routing is unchanged.
- **convert-lead converts your own send only.** It is looked up with
  `.eq('sent_by', req.user.id)`, and anyone else's row is a 404. It also accepts `id`
  (the tracking row) as well as `token`. `/outreach/sent` returns `id` now; the
  `token` stays in that select ONLY until surface keys the page on `id`
  (C-0028), then drop it. Ledger worried the token opens `/i/<token>/opt-out`.
  **It does not**: that route reads `candidate_outreach.track_token`, and
  `/outreach/sent` returns `channel='outreach'` rows only.
- **A typed address already on a colleague's lead is not enrolled.** The email
  still goes, and it is linked to that lead (true, and its owner can see it),
  but `canTouchJob` must pass before `wfEngine.enroll`. Otherwise
  `sequence.error` says the follow-ups stay with the colleague. The pickers
  closing did not close the typed path, and this is what does.
- **Backfill NOT run** (no credentials here; never without a go-ahead).
  Generator leads from before this change still have `assigned_to_bd` null. The
  query and its reasoning are in the C-0024 report. Both creating paths shipped
  2026-09-08, so none of those leads is older than the 30-day recycle threshold.
- **Proof:** a scratch harness ran the REAL router through real supabase-js with
  a `global.fetch` that interprets the PostgREST URL against fixtures (8 users
  across two chains, a pool, 30 invisible matches queued ahead of a visible
  one). 35/35. **Seven reintroduced bugs each failed it**, including the quiet
  one: predicate kept but SQL narrowing removed gives B1 an EMPTY picker (the
  limit was spent on rows they may not see). The harness is scratch, not
  committed. Foundry is asked to pin it (report, not a contract).

## Fragile — added Session 30
- **`outreach-generator-smoke`'s "calls no function it does not define" is a
  regex, and it misreads an arrow parameter inside a call.** `.map((c) => c(x))`
  is flagged, because its param regex swallows the `(` of `map(` into the name.
  Write a named arrow (`const runClause = (clause) => …; list.map(runClause)`).
  The suite is foundry's; do not edit it to suit.
- **Session 30 (rampart review):** the candidate opt-out (`routes/candidate-outreach.js:374`) now passes `row.org_id` to `addToSuppression`, so the suppression row is filed under the sending org, not the default one (whose admin could delete it and re-open email). It was the only suppression write in Observatory's files.
