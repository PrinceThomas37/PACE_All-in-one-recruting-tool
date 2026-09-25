# Client intelligence — the email timeline and AI summary (design)

> Status: **DESIGNED, NOT BUILT, and OFF until the owner says** (D-0039).
> Roadmap `R-051` (timeline + summary) and `R-054` (industry playbooks).
> Written 2026-09-24, Session 31.

## What the owner asked for, in their words

> *"If it's switched on just like that, all the emails will be read and
> unlimited tokens will be used so we have to design that token usage to read
> the emails and make sense of it and match the to and from emails to the lead
> emails we have and store that data and retrieve it when needed and rewrite
> it … Which is not storage intensive, not AI intensive yet, give the right
> summary and suggested next steps based on current situation."*
>
> *"a lead management system that can run for any industry not just
> recruiting … the design engine we are building right now is flexible enough
> to work right. Right means relevant to that industry and company process."*

## What is true today (measured 2026-09-24)

* The reply sweep already reads connected inboxes and stores messages in
  `conversation_messages`, quote-stripped and capped at 4,000 characters
  (`conversation-intel.js`).
* **77 messages are stored, and 3 are tied to a lead contact.** The rest is
  noise: ZipRecruiter (7), Glassdoor (5), Google account alerts (3), our own
  domain (3), plus senders PACE knows nothing about. Storing all of that is
  exactly the waste the owner is worried about — and it is already happening,
  on a small scale.
* `conversation-intel.js` already reads a thread **without AI**: who owes whom
  a reply, how long each side has waited, open questions, promises with dates
  ("I'll get back to you Friday"), and an intent floor (interested / not now /
  not interested / out of office / unsubscribe). It is pure, tested, and free.

So the design is mostly about **what not to read**, and about spending AI only
on the last step.

---

## The design: four layers, each cheaper than the one above it

```
  inbox ──► 1. GATE ──► 2. FILE ──► 3. FACTS ──► 4. SUMMARY
            free        tiny         free          AI, rationed
          (drop noise) (store once) (rules)      (only when asked,
                                                  only what changed)
```

### Layer 1 — The gate: read only mail that belongs to a lead (no AI)

A message is kept only if one of these is true, checked in this order:

1. **The sender or a recipient is a contact on a lead or client** — exact
   address match against `contacts.email`. → file it on that contact.
2. **It is on a thread PACE started** — the thread id matches one of our own
   sent emails. → file it on that email's contact.
3. **Same company domain as a lead, different person** (e.g. a colleague
   replies instead of the POC). → do NOT file it silently; raise a small
   suggestion: *"Someone new from thermalconcepts.com wrote in — add them as a
   contact?"* One click files it; nothing is stored until then.

Everything else is **never stored**: job-board alerts, system mail, newsletters,
our own colleagues, personal mail. A short blocklist of known noise senders
(no-reply, notifications, job boards) is checked before anything else.

**Matching is a pure function** (`matchMessage(message, knownContacts,
knownThreads, companyDomains)` → `{ contact_id } | { suggest: domain } | null`),
so it is tested offline against real shapes, never against a live inbox.

Public email domains (gmail.com, outlook.com, yahoo.com…) never count as a
"company domain" — otherwise every Gmail user would look like a colleague of
every other Gmail user.

### Layer 2 — File it once, small

Per kept message we store what the timeline and the rules need, not the email:

| kept | size |
|---|---|
| who, to whom, when, direction, subject, thread id | ~200 bytes |
| the NEW text only (quote history and signature removed), capped at **1,500 characters** (down from 4,000) | ≤1.5 KB |
| the rules' facts for this message (layer 3) | ~300 bytes |

**≈2 KB per message.** A busy desk with 100 active clients × 20 messages each
is ~4 MB — a rounding error on the free database. The full original stays in
the mailbox; opening a message in the timeline fetches it live through the
mailbox connection PACE already has, and nothing extra is stored.

The outbound side costs nothing new: what PACE sent is already stored in its
three email pipelines. The timeline reads those as they are.

**Retention.** Kept while the lead/client is active. When a lead is recycled
or a client goes quiet for a year, the text is dropped and only the one-line
record (who/when/subject) stays. One setting, per company.

### Layer 3 — Facts, free, on arrival (rules)

When a message is filed, the existing rules run once on it and the result is
stored with it: intent, questions asked, promises and their dates, who owes a
reply. **The state of a client is the running total of those facts** — no AI,
recomputed from small stored records in milliseconds:

> *Waiting on you 3 days · they asked about rates on the 12th · they said
> "call me next week" · last heard from Maria (HR) · 4 threads, 2 active.*

This alone answers most of "what is happening with this client", and it is
what shows whenever AI is off, over budget, or not subscribed.

### Layer 4 — The AI summary: on demand, incremental, capped

AI writes the human paragraph and the suggested next steps — and only under
these rules:

1. **Only when someone opens the client and the facts have changed since the
   last summary.** Never on a schedule, never for every client, never on mail
   arrival. A client nobody looks at costs nothing.
2. **Incremental, not from scratch.** The model gets: the previous summary
   (~150 words) + the facts that changed + the new messages' short text only.
   Typical input **1,500–2,500 tokens**, output ~250. The whole history is
   read once, the first time, capped at the latest 10 messages.
3. **Fingerprinted.** The summary is stored with the id of the last message it
   covered. Same fingerprint → shown from storage, **zero tokens**.
4. **Checked, not trusted** — the same rule as the email writer: a suggested
   next step must refer to something in the facts; a summary that invents a
   date, a price or a person is thrown away and the rules sentence is shown.
5. **Its own budget line.** A new feature `client_summary` in the AI budget,
   with its own daily cap (default proposal: **40 summaries or 80k tokens a day
   per company**, whichever comes first), inside the company's overall daily
   AI allowance. When it is spent, the page shows the free facts and says why.

**Cost, worked through.** 50 active clients, each with news twice a week, each
opened once after that news: ~100 summaries a week × ~2.5k tokens ≈ **35k
tokens a day** — under a tenth of today's 400k daily AI allowance. The worst
case is bounded by the cap, not by the size of anyone's inbox.

### The switches — everything starts OFF

| switch | default | what it does |
|---|---|---|
| `client_intel_enabled` | **off** | layers 1–3: gate, file, timeline, free facts |
| `client_intel_ai_enabled` | **off** | layer 4: the AI summary |
| `client_intel_ai_daily_calls` / `_tokens` | 40 / 80k | the summary's own cap |
| `client_intel_lookback_days` | 90 | how far back the first read goes |
| `client_intel_retention_days` | 365 | when stored text is dropped |

All are rows in the existing settings schema (`config/settings.js`), so they
appear in Admin → System Settings with no new screen. **Turning layer 1 on
does not read anyone's past mail by itself** — the first read of a client's
history happens only when that client is opened.

---

## Any industry: a "playbook", not code

The engine above is industry-neutral: it matches addresses, stores small
records, extracts facts, and summarises. What makes it *right* for a company
is **what the summary and the next steps talk about** — and that is data, not
code. Each company gets a **playbook**:

| part of the playbook | recruiting (today's default) | e.g. commercial cleaning | e.g. B2B software |
|---|---|---|---|
| words for things | lead · client · job order · candidate | lead · account · site · quote | lead · account · opportunity · demo |
| the stages a lead moves through | Assigned → Connected → Job order | Enquiry → Site visit → Quote → Contract | Contacted → Demo → Trial → Proposal → Closed |
| what counts as a buying signal | "send resumes", "how soon", rates | "walkthrough", "square feet", "start date" | "pricing", "security review", "trial" |
| the next steps it may suggest, per stage | send profiles · book intake call · ask for the JD | book a site visit · send a quote · follow up on quote | book a demo · send proposal · loop in finance |
| what a summary must mention | open roles, candidates sent, fee talk | sites, visit dates, quote status | seats, decision maker, timeline |

* The **rules** read the playbook: the signal words tune the intent detector,
  and the next-step library is what the free suggestions are chosen from.
* The **AI prompt** reads the playbook: it is told the company's words, its
  stages and its allowed next steps, and must pick from them — so a cleaning
  company is never told to "send resumes".
* **Presets** ship for a handful of industries; an admin picks one at sign-up
  and edits it on one settings screen. Recruiting is preset #1 and is exactly
  today's behaviour.

**What this does NOT fix yet, said plainly:** PACE's lead stages and the ATS
screens (job orders, candidates, submissions) are still recruiting-shaped in
code — the stage list alone lives in six places. The playbook makes the
**intelligence** industry-aware from day one; making the **screens and stages**
configurable is a separate, larger piece of work (`R-054`), done after this and
before selling to a non-recruiting company.

---

## Build order (each step shippable, each behind the switch)

1. **Gate + filing** — `matchMessage` (pure, tested), the noise blocklist, the
   suggestion for same-domain senders, the 1,500-char cap. The sweep stops
   storing noise immediately (a free win even with the feature off).
2. **Timeline on the client page** — reads our three send pipelines + the
   filed replies for that client's contacts; full text fetched live on open.
3. **Free facts card** — the running state from layer 3.
4. **AI summary** — incremental, fingerprinted, checked, capped, on its own
   switch.
5. **Playbook** — recruiting preset extracted from today's hard-coded words,
   then 2–3 more presets.

Rampart reviews steps 1–2. **Who may read (D-0040): the record's OWNER only** sees
email text, the timeline and the AI summary. A manager gets a **team roll-up**
built from the free facts alone (no email text shown, none sent to AI). Deep writes one migration for step 1 (a `company_id`
and a `facts` column on `conversation_messages`, a `summary` cache table or
column). **No migration is applied without the owner's fresh go-ahead.**

---

## Who sees what (D-0040, 2026-09-25)

| | owner of the client | their manager | anyone else |
|---|---|---|---|
| email text + timeline | ✅ | ❌ | ❌ |
| AI summary + next steps | ✅ | ❌ | ❌ |
| team roll-up (facts only) | — | ✅ for their reports | ❌ |

**The team roll-up** is a manager's card: *"This week on your team — Priya:
Acme replied (waiting 2 days), Beta promised a PO by Friday · Sam: 3 clients
quiet 14+ days · 2 clients moved to Job order."* Built from layer-3 facts, so
it costs **no AI by default**. Optionally one AI paragraph per manager per day
(~2–3k tokens), fed the facts only — never an email's text.

## How the daily limit is worked out

    limit = share of the company's daily AI allowance you are willing to give
            to summaries  ÷  cost of one summary

* Allowance today: **400,000 tokens/day**. Busiest real day so far: **~50,000**
  (10 Sep; 38,705 on 24 Sep), so ~350k sits unused on a normal day.
* One summary ≈ **2,500 tokens** (incremental; 0 when nothing changed).
* Give summaries **a quarter** of the allowance so resume reading, cold emails
  and the rest can never be starved: 100,000 ÷ 2,500 = **40 summaries a day**.
* Sanity check against real work: today 1 lead is Connected and ~78 messages a
  week arrive (most of it noise the gate will drop), so real use would be a
  handful a day. 40 is headroom, not a target.
* The AI card shows used / left for this feature; after two weeks of real use
  the number is set from what was actually used (× 2 for headroom).

## The limit scales with the company (D-0041, 2026-09-25 — supersedes the fixed "40")

The owner corrected the method above: the count depends on users, outreach,
replies and active clients, and today's database is test data. So:

**What drives the number of summaries in a day**

    summaries/day  =  owners  ×  active clients per owner
                      ×  share of those clients with something NEW that day
                      ×  opened after the news (at most once — it is cached)

* **Outreach volume** drives it indirectly: more emails out → more replies →
  more clients with news. Emails with no reply cost nothing.
* **Tokens per summary** grow a little with how many new messages there are
  since the last summary (incremental), roughly 1,500 + 400 per new message.

**Worked example — a described company, not our data:** 10 BD users, each
working 30 active clients, 15% of clients get news on a given day, and the
owner opens most of those: 10 × 30 × 0.15 ≈ **45 summaries/day** ×
~2.5k tokens ≈ **110k tokens/day**. The same company at 3 users ≈ 14/day.

**So the setting is per user, not per company:**
* `client_intel_ai_per_user_daily` — default **15 summaries per owner per day**
  (30 active clients × 15% news × ~2 for busy days, rounded up).
* Company ceiling = per-user × number of users, **capped at 25% of the
  company's daily AI allowance** so resume reading and cold emails can never
  run short.
* When a user's allowance is spent, their clients show the free facts card
  and say so; nobody else is affected.
* After two weeks of real use the per-user default is re-set from what was
  actually used (× 2 headroom). The live database today is test data and is
  not used for this.

## The "Summarise" button, and why 2 years of email stays cheap (D-0042, 2026-09-25)

**Supersedes layer 4's trigger.** Nothing is summarised automatically. The
client page has a **Summarise** button; a summary exists only where someone
pressed it. At 100+ managers, most clients are never summarised at all, and
they cost nothing.

**Every email is read by the rules once, when it arrives — never again.** The
gate files it, the free rules record its facts (layer 3). Pressing the button
reads those stored small records from our own database, not the inbox.

**What one click sends to the AI — capped, whatever the history:**

| part | how big | where it comes from |
|---|---|---|
| the playbook (words, stages, allowed next steps) | ~300 tokens | company settings |
| the **fact ledger** for the whole history | **≤800 tokens**, fixed | free rules: first/last contact, who is involved, stage changes with dates, open questions, promises still due, how often each side replied, last 5 key events |
| the **latest messages as text** | **≤8 messages × ≤250 tokens ≈ 2,000** | newest first, quotes and signatures already stripped |
| the previous summary (if any) | ~200 tokens | stored |

**Hard ceiling ≈ 3,300 tokens in + ~300 out per click.** A client with 5
emails and a client with 2 years and 900 emails cost about the same: the old
history arrives as the fact ledger, not as the emails themselves.

**Repeat clicks:**
* Nothing new since the last summary → the saved one is shown, button reads
  "Up to date", **0 tokens**.
* Something new → the previous summary + the ledger + only the NEW messages
  (still capped at 8). Usually ~1.5–2.5k.
* "Rewrite anyway" is allowed once a day per client, so a stray double-click
  never doubles the bill.

**Before the call, the button says what it will cost** from that person's daily
allowance ("uses 1 of your 15 today"); when the allowance is spent it shows the
free facts card instead and says why.

**If the capped version ever misses old context** (D-0042's re-open condition):
optional **monthly digests**: each finished month of a client's mail is
summarised once (~1.5k tokens), stored as ~80 words, and never re-read. A
2-year client costs ~36k tokens once, then nothing. Not built unless needed.

## Where it shows, and the daily update (D-0043, 2026-09-25)

* **Client page → Emails tab**: the timeline, newest first, with **Generate
  AI summary** at the top. The saved summary shows with its date ("Summary to
  25 Sep") and the button changes to "Up to date" or "Update summary (3 new
  emails)".
* **The daily update re-uses, never re-reads.** The morning briefing
  (`routes/ai.js` `gatherFacts`) gains a "your clients" section built from the
  free facts (who replied, who is waiting on you, promises due today) and, for
  clients the owner has already summarised, one line from the saved summary.
  **No new AI call per client** — at most the briefing's own single call, as
  today.
* A manager's daily update gets the team roll-up (facts only, D-0040).
