# PACE engineering canon — the one-page digest (D-0218)

Five books, read in full 6-7 Nov 2026, are the reference for how PACE is built. **Read THIS page when designing or reviewing; open a book's notes in `docs/reading/<book>/` only for the topic in hand (grep first). Never reread a whole book's notes.** If the books disagree, the choice below is PACE's; if a book disagrees with a PACE rule in CLAUDE.md, CLAUDE.md wins and the tension is raised with the owner.

| Book | Notes folder | Use it for |
|---|---|---|
| Clean Code (Martin) | `clean-code/` | naming, functions, comments, error handling, tests, the smells checklist C1-T9 (`cc-4`) |
| Clean Architecture (Martin) | `clean-architecture/` | boundaries, dependency direction, "database/web/vendors are details", Main, partial boundaries |
| A Philosophy of Software Design (Ousterhout) | `philosophy-of-software-design/` | deep modules, pull complexity down, define errors out of existence, design it twice, 16 principles + 14 red flags (`posd-3`) |
| Designing Data-Intensive Applications (Kleppmann) | `designing-data-intensive-applications/` | transactions and races (`ddia-4`), "only once" (`ddia-5`), jobs and queues (`ddia-6`), correctness and privacy (`ddia-7`) |
| Fundamentals of Software Architecture (Richards & Ford) | `fundamentals-of-software-architecture/` | quality priorities, fitness functions, when to split, decision records, risk (`fosa-4`) |

## The seven principles (what all five agree on)
1. **Cost of change is the measure.** A design is good if changes stay cheap as PACE grows.
2. **Enforce, don't remember.** A rule that matters gets an automatic test (fitness function / ratchet); a rule only written down erodes.
3. **Business rules at the centre, tools at the edge.** Postgres, mail providers, AI and contact-data vendors, Express and the browser are details behind one module each; dependencies point toward the rules.
4. **Deep modules.** Each part hides a lot behind a small, documented promise. Split by responsibility and reason to change, not by line count; avoid pass-through layers and tiny shards.
5. **Never lose, duplicate or leak data.** Claim work in ONE atomic statement; a unique key per intended side effect (e.g. per email); record outcome with the provider's confirmation; retries only when provably safe; tenant isolation enforced in the database (RLS) AND in code.
6. **Failures are loud.** No silent catch; every job compares its output with the last run; uncertain outcomes are shown, not guessed.
7. **Strategic, not tactical.** ~15-20% of effort goes to structure every week; leave each file cleaner than found; no rewrites, no big-bang refactors.

## Where the books disagree — PACE's choice
- **Function size:** Ousterhout over Martin — keep related code together; the problem is 4,500-line files, not 40-line functions.
- **Comments:** each service/route opens with a description of what it promises (units, side effects, failure, tenant scope); delete comments that repeat code (R-411).
- **TDD:** test-first for every bug fix and every owner sentence turned into a rule; not mandatory for exploratory building.
- **Duplication:** merge only code that changes for the same reason; look-alike code that will diverge stays separate (Clean Architecture ch. 16).
- **Config knobs vs defaults:** D-0123 stands (customer limits are admin settings); every setting must ship with a sensible default (proposed amendment, owner to decide).
- **Test-only security bypasses:** never (CLAUDE.md Session 11 rule) — overrides Clean Architecture ch. 28.
- **Database as a detail:** yes for vendor/product choice, but tenant isolation stays in the database (RLS).

## Checklist before merging any change (apply, don't read)
- Does it add to a file already over 500 lines? Prefer a new deep module.
- Does any new code reach a tenant table outside `models/`? Not allowed.
- Is there a new external side effect (email, vendor call)? One claim, one key, outcome recorded, retry rule stated.
- Could it fail silently? Add the alert or the comparison.
- Did I write the description first for a new service/route?
- Big or hard to reverse? Design it twice and record the decision with what it gives up.
