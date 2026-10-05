# Observatory — memory
> Last written: 2026-09-30 (Session 35, R-085 sent side; R-073 rows carry an address) · earlier: 2026-09-29 (Session 34, R-071)

## Session 35 (2026-09-30) — the summary reads OUR replies (R-085) and "Needs you today" rows carry who to write to (R-073)
- **`services/sent-side.js` (new, pure of I/O) reads the Sent folder of the caller's OWN mailboxes, live, when the Emails tab or the summary is asked for** (`routes/client-intel.js` `loadMessages(req, subject, {live:true})`). Replies typed in the in-app mailbox or straight from Gmail/Outlook were stored nowhere PACE reads and nothing is mirrored into Postgres, so the summary saw them write and never saw us answer. Search is by contact address; only mail actually ADDRESSED to that person counts (Gmail's search is loose); what PACE already sent (same subject, same person, within 30 min) is not counted twice; drafts skipped; ≤3 mailboxes × ≤5 addresses, ≤8 bodies per read; 5-minute per-person cache; 9-second timeout.
- **A failure is REPORTED, never read as "nothing was sent":** the response carries `sent_side:{ok, reason:'no_mailbox'|'unreadable'|'partial'|'slow', …}` and both timelines say so on screen. A failure is never cached. The daily digest does NOT read the mailbox (a busy desk costs the same as a quiet one).
- **`next-action.js` items now carry `email`** (threads and reminders; the reminders select adds `contact.email`) so a row can DO the task (surface's `naAct`). Pure function; `next-action-smoke` 49/49.
- Pinned: `test/sent-side-smoke.mjs` (20; fails with four deliberate breaks).


## Session 34 (2026-09-29) — R-071: admins are no longer exempt from D-0020 (`routes/next-actions.js`)
- **The owner's sentence:** *"Once the reminders are complete it doesn't go off
  from the dashboard."* One of five causes (the other four are surface's page
  faults): `GET /next-actions` did `isAdmin ? {mine: everything, team: []} :
  splitByOwner(...)`, so an admin's list carried EVERY user's reminders, each
  with a Done that `closeRefusal` correctly refuses. Live: the 3 pending
  reminders all belong to a BD Lead; the owner is one of 3 admins.
- **DECISIONS checked first:** nothing newer than D-0020 puts other people's
  tasks on an admin's list. D-0021's admin exception is the BRIEFING; D-0034's
  is SEEING ("extends D-0020 from acting to seeing"). The code comment calling
  the list exemption "the exception the app already makes everywhere else" was
  an engineering note, never an owner decision.
- **What is true now:**
  * **The list is the caller's own, for every role.** Non-admins are narrowed IN
    SQL (`.eq('assigned_to_bd'|'recruiter_id'|'user_id', me)` — was
    `.in(chain)`); admin still reads the org and is narrowed IN CODE to own +
    UNOWNED (`ownership.isMine` hands a null owner to the viewer, and a reply on
    an Unassigned-pool lead must be on somebody's list). Deliberately not an
    `.or('x.eq.me,x.is.null')`: the sandbox cannot run PostgREST, dispatch's
    fake treats `.or` as a no-op, and that filter failing renders a plausible
    empty list.
  * **Narrowed BEFORE ranking, not after.** `buildNextActions` keeps the top
    `limit` and counts stale nudges/overflow; ranked org-wide, colleagues'
    items pushed an admin's own off the end and put the org's "gone quiet" and
    "N more" under a personal list. So `stale_nudges`, `snoozed` and
    `overflow` are now the caller's own for managers too (they were chain-wide).
    `splitByOwner(after.items, …)` stays on the OUTPUT as the guarantee.
  * **The count and the review are ONE read — `openBeneath(req, view, cols)`.**
    The count used to be built from the list's items (replies, nudges,
    promises) while the review can only show and prompt REMINDERS: "14 open"
    opened onto 3 rows. Now `team.total === GET /next-actions/team`'s length by
    construction (same filters, order, limit 200; only the columns differ). It
    counts all PENDING reminders beneath you, due or not — "open" is the word
    both screens use. Team CONVERSATIONS live in the client digest.
  * **`oversight(req)`**: admin → the whole org (`neq me`), reports or not;
    else the chain minus self. Admin is read via `ownership.rolesOf` (exactly as
    `hasRole`) — the three ad-hoc `roles.includes||role===` copies are gone.
  * **Done can no longer "succeed" without closing.** An ownerless reminder is
    closable by the rule but the write was scoped `user_id = me` → 0 rows →
    `{success:true}`. Now scoped to the row's real owner state and it answers
    409 with a sentence if nothing changed. `openBeneath` drops ownerless rows
    explicitly, and prompting about one is a 400 ("nobody to ask").
- **Proof:** scratch harness `scratchpad/obs-r071/na-harness.cjs` — the REAL
  router compiled from source over dispatch's `repro/fake-supabase.cjs`, driven
  over HTTP as admin / director / BD Lead / BD: **21/21**. Four deliberate breaks
  compiled from mutated source, each failing its own checks: admin exemption
  back (15/21 — reproduces the report: `r1:403:pending`), narrowing after the
  ranking (19/21), the old silent Done (19/21), count drifting from the review
  (19/21). The harness first caught a real hole: the fake's `neq` keeps a NULL
  owner where SQL's `<>` drops it, so the review listed an ownerless reminder
  whose "Ask them" is refused — now filtered in code, not left to NULL
  semantics.
- **Raised C-0031 (surface):** the page returns early on an empty list and never
  draws the team line, so an admin who owns nothing sees "Nothing waiting on
  you." with no count and no Review — the owner's likely case. Server side done.
- **For R-073 (row actions, later):** a row's actions must come from the SERVER's
  rule, never re-derived in the page — every item on `items` is now the
  caller's own or unowned, so "act" is always allowed there and "prompt" lives
  only on the review. Only reminders are promptable (`/:reminderId/prompt`); a
  thread item has no reminder id, so prompting a reply/nudge needs a new prompt
  shape. `reminder_type` (`ooo_return`, `bd_touch`, `manager_prompt`…) and
  `contact_id`/`job_id` on the item are what a per-kind action would key on;
  `routes/reminders.js` already returns a `compose` block per reminder (ledger)
  — reuse it rather than rebuild it here.
- **Still open here:** admin's org-wide thread fetch is still capped at 300
  jobs / 300 contacts / 300 submissions / 200 reminders, UNORDERED, so in a big
  org an admin's own rows can fall outside the fetch (pre-existing; production
  is 82 leads). The fix is own + pool as two narrowed queries. `teamSummary`'s
  "open across your team" reads oddly for an admin with no reports (rampart's
  wording; noted in C-0031). A deleted user's reminders stay on the admin's
  review with nobody able to close them — D-0020's "Re-open when"
  (reassignment), not built.

## Session 33 (2026-09-28, later) — R-063 BUILT: the finder knows law, accounting and architecture firms (D-0052); the title search's Apollo call (R-068)
- **`poc-targets.js` `FIRMS`** (law / accounting / architecture), matched on the
  lead's INDUSTRY (`firmOf`). A PRACTICE job (the profession's own work, per
  firm regex) gets the firm's heads — law: Managing Partner / Supervising
  Attorney / Managing Attorney / Partner; accounting: Tax Partner… for tax,
  Audit Partner… for audit, else partners/shareholders; architecture:
  Principal / Managing Principal / Studio Director. ANY job at a firm gets the
  firm's own leadership as "the top" (`fn.top`, replacing
  President/Owner/CEO/GM) — a non-practice job keeps its function's heads (a
  construction PM at a planning firm still reports to the project side; an
  earlier draft prepended the firm administrator there and sent that PM to the
  Office Manager — caught by printing the slots, removed). At 1–20 people the
  second manager slot is the practitioner (`fn.managers`), not a repeat of the
  partners. HR at firms ≤200: `hrFirst` (Firm Administrator, Director of
  (Firm) Administration, Practice Manager, Studio Manager) tried first.
- **`contactKind(designation, size, firm)`** — firm-aware: `hrAdmin` (firm/legal
  administrator…) is HR at ANY size at that firm; `leaders` (attorney, counsel,
  lawyer) are managers ONLY at a law firm. Everywhere: `shareholder`,
  `founding member`, `managing member` are leaders; HR_WORDS gained People &
  Culture / Chief People / Head of People / VP People / People Partner /
  employee relations|experience|engagement / total rewards / compensation /
  L&D / staffing coordinator. `pocTargets` returns `firm`; `fillSlots` and
  `pickPeople(…, firm)` pass it. Construction leads are unchanged (pinned).
- **Measured on the owner's live titles: 6 people now read correctly** — two
  Attorneys and a Senior Litigation Attorney at law firms, a CPA/Shareholder, a
  Founding Member (other → leader) and "People and Culture Director" (leader →
  HR). `poc-targets-smoke` 75 → 95.
- **`people-apollo.js searchPeople`**: blank titles → the title filter and
  `include_similar_titles` are OMITTED (not sent empty); keeps Apollo's masked
  surname as `last_name_hint` ("Sm***h") — never as the name; returns
  `total` from `pagination.total_entries`. `poc-apollo-smoke` 44 → 49.

## Session 33 (2026-09-28, latest) — R-063: does the finder read titles right FOR THIS MARKET? (measured, nothing built)
- The owner asked whether the finder looks for "HR manager or HR generalist" and
  can "search by responsibility". **Apollo's People API has no person-level
  department filter** (its spec, via the Apollo connector's schema: titles +
  `include_similar_titles`, `person_seniorities`, `q_keywords`, company filters;
  `organization_department_or_subdepartment_counts` is a COMPANY filter and a
  paid-plan one). The earlier third-party `departmentIds` note is not real.
- `contactKind` over 26 invented modern HR titles: 10 right, 10 read as
  MANAGERS (every "People"/"Culture" title; "People Partner" because `partner`
  is a manager word), 6 missed. **But over the owner's REAL 205 contact titles:
  53 read as HR, and only ONE HR person is misread ("People and Culture
  Director").** Generic reasoning overstated it; the market is traditional.
- **The real gap is firm TYPE, not HR vocabulary.** 11 of 82 live leads are law
  or accounting firms and 5 architecture. `jobFunction` sends a paralegal to
  GENERAL/admin (heads: General Manager / Operations Manager / Office Manager),
  a Tax Manager or Audit Accountant to finance (Controller / CFO — a company's
  own books, not a CPA firm's partners), a Project Architect to engineering
  (Engineering Manager). And `contactKind` reads **Attorney, Managing Attorney,
  Shareholder, CPA/Shareholder, Founding Member, Member, Of Counsel** as
  `other` — ignored. The researchers picked Partner / Managing Partner /
  Attorney / Principal / Law Firm Administrator there. `INDUSTRY_HEADS` (the
  automotive override) is exactly the shape a fix takes. **R-063 re-scoped to
  this; the owner's call.**

## Session 33 (2026-09-28, later) — Apollo company lookups; size bands; same-company check (D-0050)
- **`people-apollo.js` `enrichOrganization({key, domain})`** → GET
  `/api/v1/organizations/enrich?domain=` (key in `X-Api-Key`). **1 credit when
  found, 0 when not** (Apollo's own MCP tool description, read 2026-09-28 — the
  docs site is blocked from the sandbox). A 404 or an empty record is
  `{ok:true, found:false}` — an answer, not an error. Returns `{id, name,
  domain, website, employees (null for 0/absent — never "0 people"), industry,
  founded_year, linkedin_url, city, state, country}`. **Never retried** even
  though it is a GET (a retry after a timeout can be charged twice).
  `describeApolloError(status, data, what)` now names what was refused
  ("company lookups" vs "people search").
- **`callRecord(call, result, at)`** — the diagnostics row shape (call, ok,
  status, error, found, people count); never the key; the clock comes from the
  caller.
- **Apollo's documented costs (checked 2026-09-28, not from memory):** people
  search free; person lookup 1 credit per email (phone 8 — never asked for);
  company enrichment 1 if found / 0 if not; organization search by name and
  organization job postings "consume credits" (number not confirmed). Field
  `departmental_head_count` could NOT be confirmed — nothing relies on it.
- **`poc-targets.js`:** `sizeBandFor(count)` (≤20 / ≤50 / ≤200 / ≤1000 / more;
  unknown → null) and `sameCompany(ours, theirs)` (legal suffixes and filler
  ignored; first real word equal, same letters run together, or one name inside
  the other). poc-targets-smoke **75**, poc-apollo-smoke **44**.

## Session 33 (2026-09-28) — PACE now calls Apollo: `services/people-apollo.js` (R-053 slice 2, D-0049)
- **The first code in PACE that calls Apollo** (CLAUDE.md's "Apollo is a key
  slot" note was true until now; the Sourcing page's Apollo row is still a
  different, unbuilt use). Two calls, nothing else:
  * `searchPeople({key, domains, titles, perPage})` → POST
    `/api/v1/mixed_people/api_search` — **free, no emails**, needs a plan with
    API access + a master key (the owner's plan refused it 2026-09-27).
    Titles capped at 25, `include_similar_titles`, page size clamped to 100,
    several domains (website + the mail domain its people use).
    **A hidden surname (`last_name_obfuscated`) is read as HIDDEN** —
    `last_name:''`, `last_name_masked:true` — never as a name.
  * `revealPerson({key, id})` → POST `/api/v1/people/match` by Apollo's id,
    `reveal_personal_emails:false`, `reveal_phone_number:false` (a phone is 8
    credits). **One credit when an email comes back. NEVER retried** — a retry
    after a timeout can spend a second credit on the same person.
    `email_verified` is true ONLY for Apollo's `verified`; `extrapolated`,
    `guessed`, `unverified`… are guesses and D-0049 drops them.
  * `checkPeopleSearch({key})` — the Integrations card's Test (free).
- **The key rides in the `X-Api-Key` header, never a URL** (a URL ends up in
  logs; the old Integrations test put it in the query string).
- **Every refusal is a sentence** (`describeApolloError`): 401 key, 403/plan/
  master-key, 429 rate limit, 422, 5xx, unreachable — never a bare code.
- No db, no clock; `fetchImpl` injectable. The caller (routes/poc.js) owns
  credits, the ceiling and what is stored.
- **`services/poc-targets.js` gained `pickPeople(slots, people, exclude, size,
  skip)`** — for each EMPTY slot the best person from a search whose title
  makes them the right KIND (HR / manager), best title fit first; never
  somebody already on file (by name), already suggested or turned down (by
  source id), never one person for two slots; `skip` = slots with somebody
  already waiting. Same `contactKind`/`fitScore` as `fillSlots`.
- **`learnFormat` ignores a BOUNCED address** (`email_status`
  invalid/deactivated): it may be somebody's wrong guess at the format, and
  learning from it repeats the mistake on every new name (design §6 rule 5).
  `out_of_office` still teaches. Callers now select `email_status` on the
  sibling-lead contacts too.
- Pinned by `test/poc-apollo-smoke.mjs` (**33**, a fake fetch; fails 28/33
  with a guess marked verified, 30/33 with the key in the URL) and
  `test/poc-targets-smoke.mjs` (**71**: pickPeople cases + three bounce cases).

## Session 33 (2026-09-27) — R-053 design touches `enrichment.js`
- **`enrichment.js`'s pattern prior is wrong for this owner's market.** It ranks
  `first.last` (0.45) above `flast` (0.20). Measured on the 203 hand-found
  contacts: **first initial + surname is the most common format (42 companies)**,
  then `first@` (13), then `first.last@` (10); 64 of 82 companies have a format
  learnable from a real address. The R-053 design (`docs/CONTACT_FINDER_DESIGN.md`
  §5, §8 step 2) learns the format per company and derives the prior from our own
  data. Not built yet — waiting on the owner's answers.
- **BUILT (slice 1): `services/poc-targets.js`** — pure. `jobFunction(title,
  industry)` (first match wins; estimating before HR before project before
  service…; a dealership's estimator/technician reports into
  collision/service), `pocTargets(job, size)` → 4 slots (the owner's size
  table; unknown size → '21-50' with `size_known:false`), `contactKind` (at
  ≤50 people an office manager counts as HR), `fillSlots` (best fit first,
  one person per slot, the rest returned as `others` — nobody dropped),
  `learnFormat(contacts, website)` (the domain the PEOPLE use, free-mail never
  counts, majority format), `emailFor` — **refuses to build an address without
  a learned format (D-0049); the market prior `flast` is never used to send**.
  `enrichment.js` is not changed yet; step 2 hands it the learned format.
  Pinned by `test/poc-targets-smoke.mjs` (57; the never-guess guard fails
  56/57 when a prior fallback is put back).


## Session 31 (2026-09-24)
- **`aiProvider.availability(supabase, {feature, orgId})`** → `{available,
  reason}` with reason `not_configured` or `daily_limit`, estimated like
  `complete()`. For buttons that must SAY why there is no AI instead of
  silently falling back (the owner's "Subscribe AI to rewrite" pop-up).
- Candidate outreach (`routes/candidate-outreach.js`): **the page may choose
  the sending mailbox, but only among the caller's OWN connected, active
  mailboxes** (`ownSendingMailboxes` / `sendingMailboxFor`); any other id →
  404, never used. Preview and queue both take `mailbox_id`; the row stores it
  and the drain sends from it. **The first queued row is due now** (spacing is
  BETWEEN emails) and the queue kicks the drain right after responding;
  `drainDueOutreach` has a module-level in-flight guard so the kick and the
  10-minute heartbeat can never send one row twice. `GET /candidate-outreach/
  queue?status=pending` feeds Email → Pending.
- Live check 2026-09-24: all 21 candidate emails queued 15:34 UTC went out
  15:41–16:24 (6–18 min after their slot: 10-min tick × 6 per tick). Nothing
  was stuck; they were invisible in Pending, which read only `emails`.

## Session 31 (2026-09-25) — client summary (D-0039 … D-0043)
- **`services/client-intel.js` (PURE)**: gate, 1,500-char filing, per-message
  facts, the fixed-size fact ledger (≤3,200 chars) for any history, the capped
  request (≤8 latest emails as text, ≤13,600 chars ≈ 3,400 tokens per click
  whatever the history), `canGenerate` (nothing new → refused/0 tokens;
  "rewrite anyway" once a day; per-person allowance), `checkSummary` (next
  steps only from the playbook; no invented money/%/email address),
  `rulesSummary` (the free answer), and PLAYBOOKS (recruiting preset, plus
  services and software starters — R-054).
- New budget feature `client_summary` (in 3500 / out 450, quality tier).
- **Measured live on Groq (gpt-oss-120b, reasoning low), 2026-09-25**: a
  synthetic 310-email, 2-year client → 836 prompt + 204 completion = **1,040
  tokens**, summary passed the checker and chose reply / send_profiles /
  check_promise. Without the cap the same test history measured 232k tokens.
- `conversation-intel.js`: headlines say "today" instead of "today ago".

- 2026-09-25: `fullEmailText(html)` (pure) — the reading view: everything incl. quoted history as "> " lines, markup stripped. The AI still only sees the capped copy.

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

- 2026-09-25 (D-0046, R-056): `services/lead-posting.js` (PURE, owned here) — what the AI first-email writer reads. `postingState` answers "does the AI have the posting" with engine-draft's own `postingOf` + `THIN_POSTING_CHARS` (300), so the screen and the writer cannot disagree. Measured live: all 82 leads were title-only (median 34 chars); 80 link to LinkedIn/SimplyHired/Indeed/Glassdoor, which PACE cannot read. The import's "Job Description" column already reached `jd_raw` (jd-parser buildResearchFromLeadData) — the sheets simply never had it. Also claimed `services/client-intel.js` here in territory-map (it had been orphaned since it was written).

- 2026-09-26 (R-051 remainder, D-0040/D-0043): `services/client-intel.js` gains the daily digest — `digestItem` (a lead where the other side has written; state, headline, next step, and the owner's saved summary's first sentence ONLY when the summary covers the latest message), `teamItem` (the manager's facts-only copy: no summary, no next step, no question/promise wording; headline turned third-person by `thirdPerson` — a manager must never read "You haven't replied" about a report's thread), `sortDigest`, `teamRollup` (per owner: waiting, promises due). No AI anywhere in it.

- 2026-09-26 (R-007, closes C-0002): **`POST /ai/generate-email` DELETED** from `routes/ai.js` (only `/ai/generate-summary` remains there). It was unreachable, hard-coded "Fute Global LLC" into every org's prompt, filled `{{sender}}` from the logged-in user rather than the sending mailbox, and ran no `checkDraft`. The Outreach Generator is the ONE cold-email writer. `ai-budget.js`'s `cold_email` feature entry is deliberately KEPT: `ai-budget-smoke` uses it as a fixture and older meter rows carry spend under that name. `backend-smoke` asserts the route 404s and generate-summary still 401s.

- 2026-09-26 (R-031, from the LIVE `ai_last_test` record): **Groq is what runs** (gpt-oss-20b fast / 120b quality, both ok). Two more expired-stock faults found and fixed:
  * **Anthropic quality `claude-sonnet-4-20250514` was NOT in that account's own model list** (the 4th expired hard-coded name). Now `claude-sonnet-4-6` (on the list); haiku-4-5 stays (on the list). The account also has **no credit** ("credit balance is too low") — it cannot answer until funded, independent of the name.
  * **OpenRouter's free-model picker led with Google LYRIA (music generators).** `rankFreeModels` matched `includes('text')` on a modality string that reads INPUT->OUTPUT (so `text->audio` passed), and "free" was prompt+completion = 0 (a per-clip/per-request price also reads that way). Now `writesOnlyText()` requires the OUTPUT side to be text only, and `pricedAtZero()` requires EVERY listed price to be zero unless the id is `:free`. The cache is versioned (`FREE_CACHE_VERSION` 2) so the poisoned 2026-09-23 list is never reused, not even as the stale fallback. `ai-free-models-smoke` 15 — six new checks, all fail on the old code.
  * `defaultModelHint(id)` (pure, exported) — what the Integrations card's empty Model box says; derived from PROVIDERS so it cannot drift (the Groq placeholder read a retired Llama name and the owner read it as the model in use).

- 2026-09-29 (Session 34, R-071): admins lose their exemption from the D-0020 split in `/next-actions`; count and review become one read (`openBeneath`); Done can no longer report success without closing. Full account at the top of this file ("Session 34").

- 2026-10-01 (R-099, D-0066): `services/client-intel.js` `completionItem(it)` is the one definition of what a "completed" tick on a client conversation is recorded against (`client_conversation:lead:<id>`, fingerprinted by `last_contact` + state); `GET /client-intel/digest` (routes/client-intel.js) filters my conversations through `services/next-action-dismissals.js` and returns `complete` on each row and a `completed` count. No AI call is involved.

- 2026-10-02 (R-109): a leads-engine send is stored with a DATE only (`emails.sent_at` is `date`, the UTC day), so `services/sent-side.js` `alreadyHave` could never join it to the same email read live from the Sent folder (half-hour rule) — every leads email showed twice on a lead's Emails tab, and the date-only copy read as the previous day west of Greenwich. `alreadyHave` now matches (1) the provider message id (`emails.graph_message_id`, passed as `message_id` by `routes/client-intel.js`), (2) a stored time within 30 min (unchanged), (3) a stored DATE: exact subject + same address + real send inside that UTC day (±30 min); `isDateOnly` exported. Tests: `sent-side-smoke.mjs` part 1b (31; fails on the old code).

- 2026-10-05 (R-111): `routes/next-actions.js` decodes HTML entities in a stored `contacts.reply_snippet` when it builds the conversation (older Gmail replies were stored with codes); `services/candidate-outreach.js` now imports `decodeEntities` from `services/html-entities.js` (harbour's) instead of its own identical copy. No behaviour change in the outreach writer (`candidate-outreach-smoke` 201/201, `outreach-generator-smoke` 138/138).
