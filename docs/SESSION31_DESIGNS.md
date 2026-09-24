# Three designs for the owner to react to (Session 31, 2026-09-24)

Nothing in this file is built. Each is a plan in plain terms, with what it
costs and what has to be true first. Rows `R-051`–`R-053` in `ROADMAP.md`
track them.

---

## 1. The client page shows the real conversation, plus an AI summary (R-051)

**What the owner asked.** Clicking a client should show the emails actually
going back and forth with that client's contacts — including replies landing
in the connected inboxes — and an AI summary of "what is happening with this
client".

**What is true today (measured on the live database, 2026-09-24).**
* The client's **Emails** tab reads only one-off emails sent from the client
  page itself (`email_tracking`, 21 rows company-wide). The leads engine's
  cold emails and follow-ups to the same people (`emails`, 119 rows) never
  appear there.
* Replies ARE being read: the mailbox sweep stores conversation text in
  `conversation_messages` (77 messages). But only **3** of them are linked to
  a contact, so today PACE could only tie a handful of replies to a client.
* So the gap is mostly a **read**, plus better matching of replies to contacts
  — not a new mail system.

**Design.**
1. **One timeline per client**, read-only, oldest→newest: every email PACE
   sent to any contact at that company (from all three pipelines — the same
   merge the Email → All email tab already does, filtered to this company's
   contacts), interleaved with every reply stored for those contacts. Each
   message expandable to its full text. Same visibility rule as everywhere
   (D-0034/35): the lead/client owner and their managers see message bodies;
   others see that a conversation exists.
2. **Better reply matching.** When a reply's sender address matches a
   contact's email, stamp that contact on the stored message (today that link
   is mostly missing). Pure matching rule, testable offline.
3. **AI summary card at the top**: 4–6 lines — where the relationship stands,
   who is engaged, open questions or promises, and the suggested next step.
   Written from the timeline above, never from anything else.

**Token cost.** One summary ≈ 3,000–5,000 tokens in (the last ~15 messages,
trimmed) + ~300 out ≈ **4–5k tokens**. Written **once and cached** on the
client, re-written only when a new message arrives or someone presses
Refresh. At 20 client summaries a day that is ~100k tokens — inside today's
400k daily AI allowance, but it competes with cold-email writing, so it gets
its own line on the AI budget card. With no AI, the card says so ("Subscribe
to AI for a summary") — the same pop-up built this session.

**Needs.** No new table for the timeline. The summary cache is one small
column or an `app_settings` row per client (decide at build time). Rampart
review, because this shows email text across screens.

---

## 2. Create documents, not only upload them (R-052)

The owner said this will be designed later. Parked on purpose; the row exists
so it is not lost. Questions to settle when we pick it up: which documents
(proposal, rate card, contract, candidate profile / resume in house format?),
who fills them (template + merge fields from the client/job/candidate record,
like email templates), and the output (PDF attached to the record and
emailable). PACE already has one generated document — the formatted resume
(`36-resume-format.js`) — which is the natural starting point.

---

## 3. The contact-finder engine: four POCs per open job (R-053)

**What the owner asked.** For every lead (an open job at a company), find the
people who hire for it: **2 from HR / talent acquisition / recruiting**, and
**2 hiring managers** — the people the role reports to, about two levels up.
Firm size decides who that is:

| Employees | Class | Who the "hiring manager" pair is |
|---|---|---|
| under ~20 | small | owner, co-owner, president, founder |
| 20–50 | small | match the JD's skills/duties against people's titles and About text |
| 50–200 | medium | department head over the role (e.g. "Director of Service" for a technician) |
| 200–1,000 | mid-big | manager and director of that function |
| 1,000+ | big | function manager + director; HR pair becomes Talent Acquisition specifically |

Then either put the four into their own sequence or push them to the outreach
engine, with an email address when one can be found, otherwise name + title
for the user to finish.

**⚠ The honest part first.** PACE's Apollo card saves and tests a key, but
**nothing in PACE calls Apollo** (CLAUDE.md, re-checked Session 27). And
Apollo's free tier **does not include API access** — the people-search and
email-reveal API starts on their paid Organization plan. So this engine is
buildable, but its data source is a **paid decision**, not a key we already
hold. There is no LinkedIn API that searches people by title either, and
scraping LinkedIn is against their terms.

**Design — the part that is free and ours.** The *rules* are the valuable
part and they cost nothing:
1. **Size the company** — from the imported "employees" column when present,
   otherwise from the data source's company record.
2. **Decide the four titles to look for** — a pure function
   `pocTargets(jobTitle, jobDescription, companySize)` → e.g. for "HVAC
   Service Technician" at a 60-person firm: `Talent Acquisition / HR Manager`
   ×2, `Service Manager`, `Director of Operations`. Fully testable offline, no
   vendor involved.
3. **Search** those titles at that company through a **provider seam** —
   Apollo first (needs their paid API plan), with Hunter.io / manual entry as
   alternatives (D-0026 parked Hunter until there is a company email). Each
   result keeps where it came from.
4. **Rank** candidates for the manager pair by overlap between the JD's
   skills/duties and the person's title and About text (the match engine
   already does this kind of overlap).
5. **Land them as contacts on the lead**, marked "suggested", for a human to
   accept — never emailed automatically. Accepted ones can join a sequence or
   the outreach generator, which already exist.

**Cost.** Apollo credits per email reveal (their pricing, checked at build
time — not quoted from memory). One AI call per lead at most, only for step 4
when titles are ambiguous (~2k tokens), and the rules do it without AI.

**Needs before building.** The owner's call on the data source (Apollo paid
API plan, or start with rules + manual entry and add a vendor later). A
`suggested` flag on contacts (one small migration).
