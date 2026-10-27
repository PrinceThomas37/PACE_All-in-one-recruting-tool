# To-do: security and sending fixes — done when PACE moves to the new (paid) Render service

Source: an outside read-only code review handed over by the owner on 27 Oct 2026 (reviewed commit `2db6cf0`). **Session 54 checked the findings against HEAD `66ddf8a` and confirmed 1.1–1.6 are all real.** Nothing here is built yet. The owner's instruction: "we will do this when we connect to the new Render service."
Related earlier decisions: D-0163 / D-0165 (the paid always-on server; owner: "I will pay in a couple of months before we go live"), R-205 (owner owes `MAILBOX_SECRET_KEY` on Render), R-292 (database move out of Seoul).

**Why waiting for the new service suits this list:** a new service means a new web address and a fresh set of environment settings — exactly what the sign-in return addresses, the allowed-website list and the secret key all depend on. Do these on the new service from day one rather than patching the old one twice.

## A. Owner's own steps (I cannot do these; I will walk through each in plain words)
- [ ] **A1. Make the secret key** (R-205): a fresh 64-character key, saved in a safe place **outside Render too** (a lost key = every connected mailbox must be reconnected). Add it to the new service as `MAILBOX_SECRET_KEY`.
- [ ] **A2. Set the new web address everywhere it lives:** Render settings `MICROSOFT_REDIRECT_URI`, `GOOGLE_REDIRECT_URI`; the same addresses registered in the Google Cloud and Azure app pages (and, for Google, the public privacy-policy address). Provider consoles change — I check their current instructions at the time.
- [ ] **A3. Take a database backup and test that a restore works** — before any stored token is rewritten (B2).
- [ ] **A4. Decide the policy questions in section D** (nothing in D is built until you choose).

## B. Fixes I build and test (each a separate, small change you can look at on the running app; nothing reaches the live database without your fresh "go")
Order matters — protect what is already at risk first.
- [ ] **B1. Encrypt mailbox tokens — the code that reads BOTH plain and encrypted** (1.1, step 1). Safe to ship first: nothing existing breaks. Adds a key label and a version so the key can later be changed without everyone reconnecting; fails closed (a wrong or missing key is an error, never "treat it as plain text"); never writes a token, key or ciphertext to a log.
- [ ] **B2. Convert the stored tokens** (1.1, step 2) — **only after A1 + A3 and your go.** Idempotent (safe to run twice), one table at a time (Gmail, then Outlook), reads back to prove each row. The "reads both" support stays until every row is converted, then a later change removes plain-text support.
- [ ] **B3. Encrypt the AI keys** (1.2) — same helper and rules; keys stay masked on screen; per-company scoping untouched.
- [ ] **B4. Allowed websites for the server** (1.3) — a list in a setting (`CORS_ORIGINS`); empty in production = refuse other websites (never "allow all"). Needs the new address from A2. Checks: the app loads, the Google/Outlook connect pop-up works, the open-tracking pixel still counts.
- [ ] **B5. One-click unsubscribe** (1.5) — before any volume sending. A signed, single-purpose link; it unsubscribes **only when the button is pressed (POST), never when a link scanner merely visits (GET)**; repeat presses are harmless; writes to the existing do-not-email list; the reply-"unsubscribe" footer stays. Headers go in where mail is handed to Gmail and to plain mail servers. **Outlook may refuse the standard header** — needs a real test mailbox and a received test email; if Outlook can't carry it, Outlook mailboxes are held back from bulk sending (reported, never shipped silently).
- [ ] **B6. (Optional) Stop asking Google for the extra "send" permission** (1.6) — safe because the other permission already covers sending; check with a connected test mailbox; people already connected see no change.

## C. Checks (no code)
- [ ] **C1. Scan the whole project history for leaked secrets** (the project is public) — once, before launch.
- [ ] **C2. Check the installed libraries for known holes** (`npm audit`); fix anything critical or high.
- [ ] **C3. Confirm `/privacy.html` and `/terms.html` open without signing in**, on the new address.
- [ ] **C4. Run the full test suite on the new setup** (Node 22 and the server's Node), then try the real thing: connect a fresh Gmail and a fresh Outlook mailbox; send; read; wait for an expired token to refresh.

## D. Decisions for the owner — NOT to be built until chosen
- [ ] **D1. The warm-up feature** (automated mail between our own mailboxes to build reputation). My advice: **retire it** — mail providers suspend accounts for artificial engagement and it risks customers' real mailboxes. Alternative: restrict to our own sending domains never connected through Google/Outlook sign-in (still not automatically allowed).
- [ ] **D2. Where volume sending goes from.** Google's rules forbid unsolicited bulk mail through a connected Gmail; a separate sending domain (plain-mail-server mailboxes already exist) keeps volume away from customers' Gmail, but consent and anti-spam law still apply there. Choose a policy per mailbox type.
- [ ] **D3. AI summaries of mailbox email.** Today none of a connected mailbox's content goes to any AI company. If ever wanted: privacy policy updated first, the AI company's data-use terms checked (not verified yet), or use the self-hosted option.

## Rules for doing this work
Each fix is its own change with its own tests (a new guard is broken on purpose to see it fail). Regression checks per fix: tokens — connect, send, read, refresh; allowed websites — load the app, connect pop-up, tracking pixel; sign-in return addresses — a full Google and Outlook connect on the new address. Keep this file and `docs/CONTEXT_WINDOW.md` updated as items are ticked.
