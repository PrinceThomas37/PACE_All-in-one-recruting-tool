# PACE — the map (ARCHITECTURE.md)

> **What this is:** the *map*. `CLAUDE.md` is the *rules* (what must never be softened);
> this file says what is where, who owns it, and what to do when two rules pull apart.
> It is an index — it points at the files that hold the detail and does not copy them.
> **Pass 1 (2026-10-05, R-115).** Sections 1, 2, 3, 6 and 8 are written from the existing
> notes. Sections 4, 5 and 7 are marked *pass 2*: they still need checking against the
> code, and that only happens on the owner's go.

## 1. What is in the system

PACE is a recruiting ATS + lead-management platform sold to other companies (multi-tenant).

```
 Browser  public/index.html + public/js/NN-*.js   plain scripts, no build step, global STATE
    │  HTTPS (JSON)
 Server   Node/Express  index.js (the leads/sales engine) + routes/*.js + routes/recruiting/*.js (the ATS)
    │
 Services services/*.js   business rules, each in ONE place (see §2)
    │
 Models   models/index.js + models/tables.js   every database read/write, scoped to the caller's company
    │
 Data     Supabase: Postgres (migrations/, schema.sql) + the `candidate-docs` storage bucket
```

Outside the box (each reached through exactly one door — §4): Microsoft Graph and Gmail
(mail), Apollo (finding contacts), AI providers, Sentry (errors). Hosting: Render
(auto-deploys from `main`; free tier, so no frequent pingers); a GitHub workflow
(`.github/workflows/heartbeat.yml`) keeps it awake every 30 minutes.

What the product does, in owner's terms: `docs/territories/CAPABILITIES.md` (grep it before
building anything). What is live right now: `docs/CONTEXT_WINDOW.md`. The live to-do list:
`docs/ROADMAP.md`.

## 2. Who is responsible for what

Nine territories, each with a border, a memory file and a way to ask another for something.
The protocol is `docs/territories/README.md`; the machine-readable map is
`docs/territories/_map.json` (`node scripts/territory-map.mjs` after adding a file).

| Territory | Owns | Memory |
|---|---|---|
| **surface** | everything the user sees: `public/js/*`, `ui.css`, `mobile.css`, the render engine, the UI kit | `docs/territories/surface.md` |
| **gateway** | the server: `index.js`, `routes/*`, request wiring, outbound HTTP | `gateway.md` |
| **deep** | data and schema: `models/`, `migrations/`, `schema.sql` | `deep.md` |
| **harbour** | everything that sends or receives mail: send loop, queue, mailboxes, tracking, reply sweeps | `harbour.md` |
| **observatory** | AI, scoring, intelligence: provider layer, budget, prompts, parsing, matching, next actions | `observatory.md` |
| **guild** | the recruiting domain: `routes/recruiting/*`, stages, candidates, jobs, submissions, sourcing | `guild.md` |
| **rampart** | security, login, roles, tenant isolation (every `org_id` guarantee) | `rampart.md` |
| **foundry** | tests, verification, release, the deploy | `foundry.md` |
| **ledger** | plans, limits, billing, consent, suppression, opt-outs | `ledger.md` |
| *dispatch* | the front door: reads a plain-English report and routes it | — |

A territory never edits another's paths — it opens a request in `docs/territories/_contracts.md`.
A shared file has one owner (`index.js` is gateway's). foundry and rampart review everything.

**"One home" — a business rule lives in exactly one place and everything else calls it:**

| Rule | Its home |
|---|---|
| who owns a record, who may act | `services/ownership.js` |
| what counts as a submission | `services/submission-stages.js` |
| the 11 ATS stages | `public/js/33-stage-modal.js` (browser), `services/recruiting-core.js` (server) |
| plan limits and what a plan allows | `services/plans.js`, `services/entitlements.js` |
| every AI call and its daily budget | `services/ai-provider.js`, `services/ai-budget.js` |
| every outbound HTTP call | `http-client.js` |
| finding contacts with Apollo | `services/people-apollo.js` |
| the double-send guard | `services/outreach-dedup.js` |
| retrying a failed send | `services/send-retry.js` |
| open tracking (recipient's opens only) | `services/open-tracking.js` |
| "today" is the viewer's own day | `services/viewer-time.js` |
| long lists: a horizon and an exit | `services/view-horizon.js` |
| who a reminder came from | `services/reminder-source.js` |
| one MAIN email/phone per person (candidate or lead contact) + extras; the opt-out rule across ALL of a person's addresses; what a lead import tidies | `services/contact-points.js` |
| turning HTML entities back into text | `services/html-entities.js` |
| reading a conversation (needs-you-today queue) | `conversation-intel.js` |
| error reporting to Sentry | `services/error-report.js` |

## 3. Why it is built this way

The reasons are the owner's decisions, kept in `docs/territories/DECISIONS.md` (never
edited; a reversal is a new entry; each says when to re-open it). Check it before
proposing anything. The ones that shape the structure most:

- **Who sees what:** you see what you own plus your reporting chain's — D-0034, D-0035, D-0036.
- **Ownership is defined once:** D-0020, D-0021, D-0022.
- **Every customer brings their own API keys:** D-0055 (not yet built — R-067).
- **Inside a job everybody starts at Sourced:** D-0057.
- **Failed emails retry on a ladder:** D-0031. **A follow-up leaves from the mailbox that sent the first email:** D-0067.
- **A day is the viewer's own day:** D-0065. **Open tracking counts the recipient only:** D-0068.
- **How work is run:** the roadmap is a live list (D-0030); memory is written as the work lands
  (D-0024); hooks enforce it (D-0027); no helper agents without the owner's words (D-0060);
  merges happen on the owner's approval (D-0062).

Why the engine is shaped the way it is (rules-first AI, no funded key, runs inside PACE):
`docs/AUTONOMOUS_ENGINE_PLAN.md`. The full history behind `CLAUDE.md`'s rules:
`docs/CLAUDE_MD_FULL_SESSION34.md` (open it only for a "why").

## 4. What may touch what — *pass 2 (from `CLAUDE.md`, not yet re-checked against the code)*

Direction of travel is browser → routes → services → `models/` → Supabase. The crossings
the rules ban:

- the browser filtering or deciding who sees what (the server scopes: `viewScope`, `scopeLeads`, `scopeEmails`, `canSee*`);
- a hand-written `supabase.from()` on a tenant table instead of `db.forRequest(req)` (`db.global` for the 7 company-less tables; `db.crossOrg` is the greppable escape hatch);
- an outbound HTTP call that does not go through `http-client.js`;
- an AI call that does not go through `services/ai-provider.js`;
- a second email pipeline (`emails`, `email_tracking` and `candidate_outreach` stay three; `routes/email-history.js` merges them for display only);
- a page module writing `#content` itself (it registers with `UI.registerPage` and calls `paintPageContent()`).

## 5. How data moves — *pass 2, not written*

Four flows to be traced from the code: lead → email → reply → recycle · applicant → candidate
→ submission · the send pipeline · sign-up → login → provisioning. Until then, the nearest
written versions are in `docs/AUTONOMOUS_ENGINE_PLAN.md` (leads engine), `docs/CANDIDATE_OUTREACH_PLAN.md`,
and `docs/ATS_RECRUITING_PLAN.md`. Open tracking (R-110) adds one step to the email flow:
a pixel on leads emails, sorted on arrival into the recipient's opens versus scanners and the
sender's own.

## 6. What can never break

`CLAUDE.md` § "Rules that must never be softened" is the list — each rule was paid for with a
real incident, and the full story is in the FULL file under the bold heading named there.
In short: **route registration order**, **tenant scoping and RLS**, **who sees what**, **one owner
per record**, **the three email pipelines stay three**, **the sender is resolved at send time**,
**a merge field is filled and then checked, never blanked**, **AI returns null and never throws**,
**no screen advertises what does not exist**, **applicants never land in `candidates`**, **a
limit that is not enforced is a claim**, and **the render engine writes only what changed**.
Tests guard these; a guard must fail when the thing is absent, and a new guard is not trusted
until it has been seen to fail (see `CLAUDE.md`, "Testing lessons").

## 7. Where new code belongs — *pass 2, not written*

An "adding X → put it in Y" table. Until then: grep `docs/territories/CAPABILITIES.md` first
(the job may be *extend*, not *build*); put a new endpoint ABOVE the `:id` routes of its router;
a new table with `org_id` goes into `models/tables.js` and gets a migration (next number: check
`migrations/`); a new page registers with `UI.registerPage`; a new rule that decides whether an
action is allowed lives where the action is *offered*, not only where it is taken.

## 8. When to stop and ask

If a change would break a rule in §6, contradict a decision in §3, or need a file outside your
territory:

1. **STOP.** Do not make the change that "mostly works".
2. **Name the conflict** — which rule or decision, in one sentence.
3. **Show what it affects** — which screens, data or people.
4. **Suggest the smallest fix that does not break it** — and ask.

The owner does not read code: ask in plain words, with the choices they can react to.
Anything outward-facing or hard to reverse (a merge, a deploy, a live-database change,
a sent email) is confirmed first, every time.
