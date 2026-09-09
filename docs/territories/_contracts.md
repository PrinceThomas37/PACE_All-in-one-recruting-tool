# The border ledger

Every request one territory has made of another. **Append only — close an entry,
never delete it.** Format is fixed so an agent can find its inbox by grepping its
own name after the arrow.

Status is `OPEN`, `ANSWERED` or `DECLINED`. An id is `C-` plus the next number.

---

### C-0001 · surface → observatory · OPEN · 2026-09-09
**Asks for:** a decision on the daily import briefing (`/ai/generate-summary`).
**Because:** the endpoint works and **nothing on any screen calls it.** Surface
can build the dashboard card, but needs to know the shape it returns and whether
it should render at all when `complete()` returns null.
**Blocked until answered:** yes — Surface will not build a card against a guessed
payload shape.

### C-0002 · surface → gateway · OPEN · 2026-09-09
**Asks for:** `/ai/generate-email` either wired to a real screen or deleted.
**Because:** it is reachable only from `12-manager-users.js`, which is orphaned —
unreachable via nav — and never invokes it even there. Two dead things propping
each other up.
**Blocked until answered:** no.

### C-0003 · rampart → gateway · OPEN · 2026-09-09
**Asks for:** `/bd-analytics/*` org-scoped, or retired into `/reports/recruiting`.
**Because:** it is the last known un-org-scoped surface in the app. Every other
read is scoped by construction through `models/`.
**Blocked until answered:** no — but this is a **cross-org read**, which is the
one class of defect that produces no error message.

### C-0004 · harbour → deep · OPEN · 2026-09-09
**Asks for:** an error column on `emails` (migration 043) recording *why* a send
failed.
**Because:** a dead mailbox sign-in marks each email `failed` with no retry, one
every ~90 seconds, and `friendlySendError`'s correct sentence goes only to an
in-memory cache and dies with the process. Eleven follow-ups were lost on 31 Aug
and nobody could see why from the database.
**Blocked until answered:** no. **⚠ The owner PARKED the wider Gmail expiry issue
on 2026-09-01** — "We will work on this but not now." Do not re-raise it as
blocking; this column is the cheap half and is worth having regardless.

### C-0005 · guild → surface · OPEN · 2026-09-09
**Asks for:** `/recruiting-dashboard` widgets hierarchy-scoped the way
`/reports/recruiting` already is, and the Reports page folded into the Dashboard.
**Because:** the owner asked for both. Today only the separate Reports page is
hierarchy-aware, so a manager sees one scope on one screen and another elsewhere.
**Blocked until answered:** no. Guild does the endpoint half; Surface does the
screen half. Neither is useful alone.

### C-0006 · foundry → rampart · OPEN · 2026-09-09
**Asks for:** `bd_lead`, `director` and `associate_director` added to
`test/helpers/enter-app.mjs`.
**Because:** a five-role sweep silently skips three roles real people hold. One
nav-icon collision affected `bd_lead` and went unseen for exactly this reason.
**Blocked until answered:** no — but every role-varying test is currently
under-covering until it is.
