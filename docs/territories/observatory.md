# Observatory — memory
> Last written: 2026-09-09 (evening) · seeded from `CLAUDE.md` and Session 21

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
