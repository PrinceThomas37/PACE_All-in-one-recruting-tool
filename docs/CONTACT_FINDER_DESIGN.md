# The POC finder (R-053) — design for the owner to react to

> **Status:** DESIGN, Session 33 (2026-09-27, D-0048: *"We have to design R-053.
> That's the big job in this chat."*). Nothing here is built. Supersedes the
> sketch in `docs/SESSION31_DESIGNS.md` §3, which stays as the original ask.
> Decisions the owner makes on this design go to `DECISIONS.md` the moment they
> are made; this file records the design and the measurements behind it.

---

## 0. In one paragraph

For every lead, PACE shows **four slots — two HR people and two hiring
managers** — on the lead's own row (the panel R-012 just made the standard).
The people PACE already knows fill slots first. For the empty ones, PACE works
down a **ladder of sources, cheapest first**: people it already knows at that
company → the job posting → the company's own website → the company's email
format → (only if the owner switches it on) a paid people database. Every
person found is a **suggestion a human accepts**; an accepted person becomes an
ordinary contact and the existing engine writes and sends their first email
(two per company per day — already built). **An address that is only a guess
is never sent automatically.** The rules that decide *who* to look for are free
and testable; *where the names come from* is the one real money decision.

---

## 1. What was asked (Session 31, `SESSION31_DESIGNS.md` §3)

For every lead — an open job at a company — find the people who hire for it:
**2 from HR / talent acquisition / recruiting** and **2 hiring managers** (the
people the role reports to, about two levels up), with firm size deciding who
the "hiring manager" pair is. Then put the four into their own sequence or into
the outreach engine, with an email when one can be found, otherwise name +
title for the user to finish.

## 2. What is true today (measured 2026-09-27, live database)

| Fact | Number | What it means for the design |
|---|---|---|
| Live leads | **82**, one company each, imported 23 and 25 Sep | ~25 a working day ≈ **500 a month** ≈ **2,000 people** at four per lead |
| Contacts on them | **203** — every one with an email, 88 with a phone, **0** with LinkedIn | The finding is being done today — **by hand, before import** |
| Contacts per lead | 49 have 3+, 23 have 2, 10 have 1, **none have 0** | Slots start part-filled; the finder fills the gap, it does not start from zero |
| Titles picked by hand | President/Owner/Partner/CEO ~40 · HR ~25 · Ops/GM/project managers ~25 | The owner's rule is already roughly what the researchers do |
| Emails on the company's own domain | **162 of 203 (80%)** | Patterns can be learned from them |
| Companies whose email format PACE can already learn | **64 of 82 (78%)** | For these, a newly found *name* gets a reliable address for free |
| Most common format in this market | **first initial + surname** (`jsmith@`) at 42 companies; `first@` 13; `first.last@` 10 | `enrichment.js` currently ranks `first.last` first — wrong prior for this market; learn it from our own data |
| Companies with a website on file | **82 of 82** | The website rung can run for every lead |
| Automatic lead finder (free job boards) | **0 leads so far** (`sourced_jobs_raw` empty) | Every lead today comes from research + import |
| Company size on file | **none** — no column anywhere | The size rule needs a source (§4.3) |

**What PACE already has** (do not rebuild — `CAPABILITIES.md` rule):
`enrichment.js` (email-format guessing + domain check + role mailboxes like
careers@, used by the lead finder), `email-verify.js` (ZeroBounce, NeverBounce
and Hunter verifier adapters), Apollo and Hunter key slots in Admin →
Integrations (test only — nothing calls them), the per-company limit of **2
first emails a day** (D-0046), sequences, AI-written first emails (D-0045),
suppression/opt-out, the bounce sweep and the mailbox auto-pause at >5% bounces.

**The owner's Apollo account** (checked 2026-09-27 through the connected
Apollo tool, read-only): 175 credits, none used; waterfall enrichment off; and
**the plan does not include People API Search** — a search returned *"your
Apollo plan does not include People API Search"*. So Apollo cannot be the
source without a plan change.

**Vendor facts, with how sure we are** (apollo.io is blocked from this
workspace, so its own pricing page could not be read):
- **Hunter** (its own pages): a free account gets an API key with **50
  credits/month**; Email Finder 1 credit when an email is found; Domain Search
  1 credit per email returned; **Email Verifier 0.5 credit** (≈100 checks a
  month free). **Signing up needs a company email address — D-0026 parked Hunter
  for exactly that reason (21 Sep).** Its re-open condition may now be met:
  `prince.thomas@futeglobal.com` is a connected mailbox in PACE. Asked, not
  assumed — whether that address is the owner's to use is theirs to say.
- **Apollo** (its own docs, via search): API access exists on all plans with
  limits by plan; **the people-search endpoint does not use credits**; revealing
  an email uses credits. Prices per third-party 2026 write-ups only: Basic ≈
  $49, Professional ≈ $79, Organization ≈ $119 per user per month (annual).
  **Confirm on apollo.io before buying anything.**

## 3. What the user sees

On the lead's row panel (Leads list — the gesture R-012 made standard), a new
block under Contacts:

```
PEOPLE TO REACH                                  2 of 4 found · Find the rest
HR ─────────────────────────────────────────────────────────────────────────
 ✓ Maria Lopez · HR Manager · mlopez@acme.com          Confirmed · on file
 ○ Looking for: Office Manager / HR                    Find · Add by hand
HIRING MANAGERS ─────────────────────────────────────────────────────────────
 ✓ John Smith · President · jsmith@acme.com            Confirmed · on file
 ◐ Dave Reed · Director of Estimating · dreed@acme.com Likely · from their
                                                       website, format jsmith@
                                                       [Accept] [Not this person]
```

- **Slots, not a list.** Each slot names the *title being looked for*, so a
  researcher can see exactly who is missing. Existing contacts fill slots first
  (the researcher's work counts; nothing is looked up twice).
- **Every found person is a suggestion.** Accept → it becomes a normal contact
  on the lead. Not this person → it is remembered and never suggested again for
  that lead.
- **Each email says how sure it is and where it came from**: *Confirmed*
  (published by the company, or checked by a verifier), *Likely* (built from
  the company's own format, learned from a real address there), *Guess*
  (a common format, unchecked).
- **What happens next is what already happens**: accepted people are emailed by
  the existing engine — AI-written first email, two people per company per day
  (four people = two today, two tomorrow, each a different angle, D-0046) — or
  added to a sequence from the same panel.

## 4. The rules — who to look for (free, testable, no vendor)

One pure function, `pocTargets(job, company)` → four slots, each with the
titles to look for in priority order. Pinned by tests offline.

### 4.1 The HR pair
| Company size | HR slot 1 | HR slot 2 |
|---|---|---|
| under ~50 | Office Manager / HR (small firms rarely have an HR department) | Owner's assistant / Administrator |
| 50–1,000 | HR Manager / HR Director | HR Generalist / Recruiter |
| 1,000+ | Talent Acquisition Manager | Recruiter for the function (e.g. "Technical Recruiter") |

### 4.2 The hiring-manager pair (the owner's table)
| Company size | Who |
|---|---|
| under ~20 | Owner, co-owner, President, Founder |
| 20–50 | Match the job's function to people's titles (an Estimator → Chief Estimator / Director of Estimating) |
| 50–200 | The head of that department (a Service Technician → Service Manager / Director of Service) |
| 200–1,000 | Manager **and** Director of that function |
| 1,000+ | Function manager + director |

**The job's function** comes from its title and posting through a small
dictionary (estimating, project management, field service, engineering,
operations, sales, finance/accounting, office/admin, IT…). It is recruiting- and
construction-shaped today; **R-054 (a playbook per industry) is where it becomes
per-company** — this design leaves the seam for it rather than hard-coding more.

### 4.3 Company size — nothing holds it today
Three honest options (decision D4):
1. **A size pick on the lead panel** — five bands, one click, remembered for the
   company. Free, immediate, a human's judgement.
2. **An "Employees" column in the import sheet** — the importer already keeps
   extra columns.
3. **From a paid database's company record** — Apollo's company enrichment costs
   a credit per company; only if the paid rung is switched on.

**Until size is known, PACE assumes "under ~50"** — the owner/president plus the
function head, and the office manager for HR — which is exactly what the
researchers already pick for these companies (President was the single most
common title on file).

## 5. Where names and emails come from — the ladder

Each rung runs only for slots still empty, and stops as soon as the slots are
full. Every result records its source and date (a prospect may one day ask
*"where did you get my email?"* — the answer must exist).

| Rung | Source | Gives | Cost | Honest expectation |
|---|---|---|---|---|
| **R0** | **People PACE already knows at this company** — contacts on its other leads, the client record, people who replied | names, titles, confirmed emails | free | Grows with every lead; today each company has one lead |
| **R1** | **The job posting** (the box R-056 added + the import's description column) | a named contact, an application email (careers@, jobs@) | free | Sometimes; application inboxes often |
| **R2** | **The company's own website** — team / about / leadership / contact pages | names + titles; published emails teach the format | free; polite (robots.txt, ~5 pages a company, one at a time) | Good for owners/presidents of small firms, weak for HR |
| **R3** | **The company's email format** — learned from a real address there (R0/R2), else the most common format in our own data | an address for a name we have | free | **78% of current companies have a learnable format** |
| **R4** | **A verifier** checks a *Guess* before it may send — Hunter's free key (≈100 checks/month) or the ZeroBounce/NeverBounce slots already built | Confirmed / invalid | free tier, then pennies | Only spent on Guesses, never on Confirmed/Likely |
| **R5** | **A paid people database** — Apollo (people search free, 1 credit per email) or Hunter Domain Search | names, titles, emails | paid, **per customer's own key** | The only rung that reliably finds HR at small firms |

**Not on the ladder, on purpose:** LinkedIn (no API that searches people;
scraping breaks their terms and is a due-diligence problem for a product we
sell), scraping Google results of LinkedIn, and bought lists.

**R5 is "bring your own key".** PACE is sold to other companies; a paid
database is each customer's own account, entered in their Admin →
Integrations (the slots already exist). PACE itself stays at ₹0 — the D-0001
rule — and a customer with no key still gets rungs R0–R4.

## 6. Safety rules (non-negotiable)

1. **A Guess is never emailed automatically.** Only *Confirmed* or *Likely*
   addresses can be sent to without a person looking. A bounce costs the
   sending domain's reputation, which is the most valuable thing the leads
   engine has — the auto-pause at >5% bounces exists because of it.
2. **A human accepts every suggested person.** Nothing lands in the send queue
   from the finder directly.
3. **Suppression first.** Someone who opted out is never suggested, at any
   company.
4. **One person, one conversation.** The same human found for two leads is one
   person, not two contacts emailed twice (contacts hang off a lead today — the
   finder checks by email before suggesting).
5. **A domain that bounced a formatted address stops being guessed at.**
6. **A company inbox (careers@, hr@) is labelled as an inbox**, never shown as
   a person.

## 7. Cost at your volume

~500 leads a month × up to 2 missing people each ≈ **1,000 look-ups a month**.

| Rung | Monthly cost at that volume |
|---|---|
| R0–R3 | ₹0 (server time only — a few website pages per lead, on the free Render tier's budget: run in the heartbeat, a few leads per tick) |
| R4 Hunter free | ₹0 up to ~100 checks; only Guesses use it |
| R5 Apollo | Plan price + ~1 credit per email found; allowance per plan must be checked on apollo.io |
| AI | Not needed. An optional small step to read a messy team page (~1–2k tokens a company) stays **off** unless the rules cannot parse a page |

## 8. What gets built, in order (each step is useful alone)

1. **The slots + rules + "Add by hand"** — the People-to-reach block, filled
   from existing contacts, with `pocTargets`; adding a person by hand suggests
   the email from the company's learned format and checks the domain. Free.
   *Researchers immediately see who is missing and type less.*
   **BUILT 2026-09-27 (D-0049).** As built: the slots *replace* the plain
   contact list on the lead row (every person keeps the valid/invalid control;
   anyone who fits no slot is listed as "Also on this lead"); the size pick sits
   under the slots; the email is filled only from a LEARNED format — with none,
   the form leaves it empty and says PACE will not guess. The domain check is
   left to the existing classifier on `POST /contacts`.
2. **Learned formats** — every company's format learned from its real addresses
   (64 of 82 today) and a market-wide prior (first initial + surname) replacing
   `enrichment.js`'s hard-coded ranking.
3. **The posting and website readers (R1, R2)** — suggestions to accept.
4. **Verification (R4)** — a Guess goes to the verifier before it can be
   accepted for sending.
5. **The paid switch (R5)** — only when the owner decides; per-customer key.
6. **Running it automatically** for new leads (in the heartbeat, free rungs
   only), if the owner wants it (D2).

## 9. Decisions only the owner can make

| # | Question | Options |
|---|---|---|
| **D1** | Where names come from **now** | Free ladder only · free + Hunter free key · upgrade Apollo now · keep researchers, PACE assists |
| **D2** | When it runs | A button on each lead · automatically for every new lead · both |
| **D3** | May PACE ever email a *Guess* | Never · only after a verifier says yes · after a person OKs it |
| **D4** | Company size | A size pick on the lead · an import column · assume small until a paid source exists |

**Answered 2026-09-27 (D-0049):** D1 — the owner will connect an Apollo account
whose plan allows API use · D2 — both (automatically for new leads, and a
button) · D3 — never · D4 — a size pick on the lead.
