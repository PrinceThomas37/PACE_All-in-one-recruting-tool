# Observatory — memory
> Last written: 2026-09-09 · seeded from `CLAUDE.md` and Session 21

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
- **AI is wired in six places and reachable in four.** Live: resume parsing, the
  JD scrub, the outreach generator, lead-distribution advice. **Dead:** the daily
  import briefing (`/ai/generate-summary` — works, nothing calls it) and
  cold-email drafting (`/ai/generate-email` — reachable only from the orphaned
  `12-manager-users.js`). Do not repeat "six AI features" without re-checking.
- **Groq's verified models (2026-09-05, from that account's own `/models`):**
  `openai/gpt-oss-20b` fast, `openai/gpt-oss-120b` quality. OpenRouter's are
  **still unverified** — no key is configured.
- **The sandbox can call `api.groq.com`** (allowlisted 2026-09-08). Key is in
  `app_settings.int_groq_api_key`. Node's `fetch` does not use the proxy; `curl`
  does. Write the key to a file, read it from there, delete it after.
- Resume parsing leads with **`unpdf`**, `pdf-parse` kept as a second chance.

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
- `REWRITE_LIMIT` is 3, enforced server-side (429), duplicated in
  `48-page-outreach-gen.js`. A test asserts they match.

## Open here
- Follow-up variants are still **rules-only**; the four first-outreach angles are
  AI-written, the three follow-up shapes are not.
- A per-call AI usage history (today's meter is a daily counter, not an audit
  log) would be its own table.
- The two dead features: wire the briefing, delete the orphaned drafter.

## Log
- **2026-09-09** — seeded. No work done by an agent yet.
