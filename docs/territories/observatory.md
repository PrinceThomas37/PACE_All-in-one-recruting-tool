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

## Log
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
