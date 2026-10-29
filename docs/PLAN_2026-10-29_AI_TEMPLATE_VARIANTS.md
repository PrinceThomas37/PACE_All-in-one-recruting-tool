# AI writes the variants, not every email — the owner's proposal, measured (29 Oct 2026, R-343)

Owner's idea: instead of AI writing every first email and follow-up, AI reads each lead's job description ONCE (skills,
industry, project area, on-site/remote …) and fills those blanks in templates; the templates themselves come in up to 10
AI-written variants per step (first email, FU1, FU2), written once from a "mother" template.

## What PACE spends today (live counters, `ai_usage_<org>_<day>`, Fute Global)

| Day | Tokens | AI calls | First emails (`engine_first_email`) | Follow-ups (`engine_followup`) |
|---|---|---|---|---|
| 26 Oct | 588k | 307 | 437k | 131k |
| 27 Oct | 408k | 252 | 217k | 151k |
| 28 Oct | 421k | 247 | 204k | 196k |
| 29 Oct | 436k | 259 | 208k | 172k |

≈ 430k tokens and ≈ 250 calls a day, ≈ 1,700 tokens a call. ~700 emails go out a day (≈ 340 first, ≈ 360 follow-ups), and only
35–45 % of them are AI-written: the rest fall back to the template (free-model limits, budget, a failed draft).

## What the AI-written emails actually earn (1–29 Oct, replies after our email)

| Step | AI-written | Template |
|---|---|---|
| First email | 29 / 2,356 = **1.23 %** | 11 / 2,021 = **0.54 %** |
| Follow-up 1 | 5 / 1,248 = 0.40 % | 10 / 1,130 = 0.88 % |
| Follow-up 2 | 1 / 711 = 0.14 % | 4 / 1,095 = 0.37 % |

Small numbers (55 replies in all), so read as direction, not proof: **an AI first email gets about twice the replies of a
template; AI follow-ups do not beat templates.**

## The comparison (per day, ~340 new leads, ~700 emails)

| | Today | Owner's design (all templates) | Recommended hybrid |
|---|---|---|---|
| First email | AI per lead (~210k, but only ~40 % covered) | template variant + AI-filled blanks | **AI per lead (unchanged)** |
| Follow-ups | AI per email (~170k) | template variants + the same blanks | **template variants + blanks** |
| Read the JD | inside every AI call, again for each email | once per lead, fast model (~1.1k tokens × 340 ≈ 375k)* | once per lead, reused by every step |
| Variant writing | — | ~3 calls × ~2.5k, once per sequence edit | same |
| Tokens / day | ~430k (and 60 % of emails get none) | ~0–375k* | ~210k first + 0 follow-ups (+ JD read*) |

\* PACE already stores a structured reading of the posting on each lead (`jobs.research`: skills, company expertise) that the
templates fill from today (`{{job_resp}}`, `{{company_service}}`). Where that is good enough the JD read costs nothing; an AI read
is only needed for fields it does not hold (on-site/remote, project type) — and then only once per lead, on the cheap model.

## Recommendation (needs the owner's yes before building)

1. **Follow-ups move to template variants now** (up to 10 per step, written once by AI from the person's mother template, picked
   at random per lead; blanks filled from the lead). Saves ~170k tokens a day (~40 %) with no measured loss — the data says
   AI follow-ups did worse.
2. **Keep AI on the first email** (the one place it doubles replies), and spend the freed allowance there so it covers MORE
   first emails (today it runs out and ~60 % fall back to the template).
3. Add the missing blanks (on-site/remote, project type) to the once-per-lead reading, so templates read as specific.
4. Re-measure after two weeks; if template first emails with the new blanks match AI ones, move first emails too.

Pieces PACE already has: versions per step (up to 2 today — `services/sequence-versions.js`, "Add a version with AI"), the
detail menu, the AI-teach "AI writes each one" switch. The build is: raise versions to 10, a per-step "AI writes / template"
choice instead of one switch, and the extra blanks.
