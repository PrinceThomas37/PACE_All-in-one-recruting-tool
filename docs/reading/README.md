# Reading notes (books the owner asked PACE's builder to read and apply)

Paraphrased chapter notes written by reading helpers (Sonnet) over the full text, with spot-checks by the lead session against the original (Clean Code: 5 claims; Clean Architecture: 6 claims, all matched). No book text or PDFs are stored here; quotes are short (one sentence).

| Book | Notes | Read |
|---|---|---|
| Clean Code, Robert C. Martin (2008), 462 pp | `clean-code/cc-1..cc-5` (front + ch. 1-5, ch. 6-12, ch. 13-16, ch. 17 smells C1..T9 + appendices A/C, appendix B) | 6 Nov 2026 |
| A Philosophy of Software Design, John Ousterhout (2nd ed. 2021), 200 pp | `philosophy-of-software-design/posd-1..posd-3` (front + ch. 1-7, ch. 8-13, ch. 14-22 + the 16 principles and 14 red flags). `posd-0` is notes on a Bookey summary received first: NOT the book, kept only as a warning. Spot-check: 6 claims matched. | 7 Nov 2026 |
| Designing Data-Intensive Applications, Martin Kleppmann (2017), 613 pp | `designing-data-intensive-applications/ddia-1..ddia-7` (preface + ch. 1-2, ch. 3-4, ch. 5-6, ch. 7-8, ch. 9, ch. 10-11, ch. 12 + glossary). Spot-check: fencing tokens, end-to-end argument, write skew, exactly-once, idempotence, read-your-writes, and "read committed is the default in PostgreSQL" all found in the text. NOTE: the word "outbox" and Postgres-specific tips (FOR UPDATE SKIP LOCKED, advisory locks, VACUUM) are the helpers' own additions, not the book's. | 7 Nov 2026 |
| Clean Architecture, Robert C. Martin (2017), 429 pp | `clean-architecture/ca-1..ca-5` (front + ch. 1-6, ch. 7-14, ch. 15-26, ch. 27-34, appendix A; this copy has no Afterword) | 6 Nov 2026 |

How these were applied to PACE: roadmap R-403..R-408 and `docs/CONTEXT_ARCHIVE.md` (6 Nov 2026 entries). Earlier, only partial previews/summaries were seen of "Adaptive Code" (G. M. Hall, 2017); no notes kept.

Where Ousterhout disagrees with Clean Code (he names Martin twice: function length 9.8, comments 12.6; also rejects TDD as tactical, endorses test-first only for bug fixes) see the 7 Nov synthesis in `docs/CONTEXT_ARCHIVE.md`.

Where the two books disagree and PACE's own rule wins: test-only security bypasses (Clean Architecture ch. 28) are NOT allowed in PACE (Session 11 rule, no product-side bypass); tenant isolation stays enforced in the database (RLS) even though "the database is a detail" (ch. 30).

Next: the owner will send more books (said 6 Nov); read them the same way (full text, chapter slices, helpers on a cheaper model with the owner's yes, notes saved here).
