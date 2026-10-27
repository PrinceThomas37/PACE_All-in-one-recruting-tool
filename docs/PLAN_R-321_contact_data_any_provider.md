# R-321 — Contact data from ANY provider (plan, 27 Oct 2026, Session 54)

**Status: PLAN ONLY. Nothing is built. Waits on the owner's answers to the four questions at the end.**
Rule behind it: **D-0175** — no contact-data vendor is hard-wired; every company brings its own provider and key.

## What is true today (read from the code, not remembered)

- Exactly **one file talks to Apollo**: `services/people-apollo.js` (239 lines, five calls: find people, reveal one
  person's email, look up a company by website, search companies, read a company's job postings).
  That is already the right shape — the work is *putting a neutral layer in front of it*, not untangling Apollo
  from the whole app.
- Apollo is **named or assumed in about 13 production files** (≈360 mentions) and in a further ~15 test files that pin
  the behaviour: `routes/poc.js`, `routes/finder.js`, `routes/integrations.js`, `services/lead-finder.js`,
  `services/poc-targets.js`, `config/settings.js`, `config/integrations.js`, `config/sourcing.js`,
  `public/js/08-page-admin.js` (the Integrations window), `62-poc-finder.js`, `68-page-finder.js`.
- Two kinds of Apollo-ness, and they need different fixes:
  1. **The word** on screen and in settings ("Apollo credits a day", "Apollo is connected"). Easy; wording + setting names.
  2. **The shape**: the app reads Apollo's field names and quirks (employee *estimate* bands, `organization_id`, the
     reveal = 1 credit rule, "people search is free but returns no email"). Another vendor does not work like that
     (Hunter finds an email by name + domain; Lusha reveals phone; ZoomInfo is enterprise-contract only).
     This is the real work and it cannot be guessed.
- The key is already **per organisation** (`integrations.getSecret(..., 'apollo', 'api_key', orgId)`) — D-0055 is met
  for Apollo. The provider *choice* is not per organisation yet.

## The design (smallest thing that satisfies D-0175)

1. **One contract** in `services/contact-data/index.js`, four verbs a screen can ask for:
   `searchCompanies`, `companyDetails` (size, industry, website), `findPeople` (by company + titles),
   `revealContact` (the email / phone of one person). Plus `capabilities(provider)` so each provider says which
   verbs it really has and what each one costs ("free" / "1 lookup" / "not offered").
2. **Adapters**, one file per vendor, each returning the *same* normalised shapes (`normalizePerson`/`normalizeOrg`
   already exist and are reused). **Apollo is first and is the existing file moved behind the contract, not
   rewritten.** Every adapter keeps today's safety rules: never retried (a retry can be charged twice), key in a
   header, plain-sentence failures, injectable `fetchImpl` for tests.
3. **Each organisation picks its provider and pastes its key** in the Integrations window (one "Contact database"
   card with a provider dropdown, instead of an Apollo card). Stored per organisation, masked, never shared.
4. **Screens stop naming a vendor** and stop advertising what the chosen provider cannot do — the existing honesty
   rule (`config/sourcing.js`: `built` vs `available`, every unbuilt row carries a `blocker`) extends to
   per-provider capabilities.
5. **Credits become "lookups"** in plain words. The existing admin limits keep their stored values (settings are data —
   the old keys are read as a fallback, nothing is lost or reset to a default).

## Order of work (each step ships on its own, behaviour for current users unchanged)

| Step | What | Proof it changed nothing on screen |
|---|---|---|
| 1 | Contract + Apollo adapter (move, don't rewrite); routes call the layer | The existing ~15 Apollo test files pass **unmodified** — that is the point of doing it first |
| 2 | Provider choice per organisation + the Integrations card; neutral wording; settings fall back to old keys | `screens-fingerprint` before/after on Find Leads, the contact finder, Integrations |
| 3 | A **contract test** that every adapter must pass (fake HTTP), plus a deliberately different *fake* second adapter to prove nothing in the app is secretly Apollo-shaped | Reintroduce an Apollo-only assumption → the fake adapter test must fail |
| 4 | A **real** second vendor | Only after the owner names it and a customer gives a test key (see Q2) |

Step 1–3 are mine to build; **step 4 cannot be done honestly without that vendor's current API documentation and a
real key to try it with.** Building ZoomInfo / Lusha / Hunter adapters blind from memory would break the repo's own rule
("never quote a vendor's terms or tier from memory") and would ship something that has never run.

## Risks

- **This code spends money** (Apollo credits). The danger is a double charge or a silent change to *when* a credit is
  spent. Mitigation: step 1 is pinned by the existing credit tests before any move; no retries added anywhere.
- **R-160** — whether a vendor's terms allow its data inside a product PACE sells to others — is still unanswered and
  matters more once *every customer* uses their own key (their key, their terms; but PACE must not resell the data).
- **R-320** (compose rebuilt around contact lookup) is built on this layer, so it waits for step 1.
- Size: step 1–3 ≈ one focused session of work; the test files are most of the touched lines.

## Questions for the owner (plain words)

1. **Go on steps 1–3 now** (the layer, Apollo behind it, the provider picker) — yes / not yet?
2. **Which second provider do you want first, and does a customer have a test key for it?** Without a key I can build
   the slot but not the vendor.
3. **Should a company with no provider connected still see the contact finder** (as "connect a contact database to
   use this"), or should it be hidden until they do? Today an unconnected company sees the buttons disabled.
4. **R-160:** are you comfortable that each customer's own key is enough, or do you want the vendor's terms read for
   resale rules before more customers join?
