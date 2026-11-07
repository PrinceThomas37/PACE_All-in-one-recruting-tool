# FOSA part 4: Part III intro, Ch.19-24, Appendix (notes)

(Slice begins with the Part III intro: techniques and soft skills. Noted only.)

## Chapter 19 - Architecture Decisions

### 1. Core argument
An architect's core duty is to make architecture decisions: gather enough information, justify, document and communicate them to the right people. A good decision guides teams to right technical choices. Three anti-patterns appear in sequence: fear of deciding (Covering Your Assets), decisions with no recorded why (Groundhog Day), decisions nobody can find (Email-Driven Architecture). The remedy for the last two is the Architecture Decision Record (ADR): a one-to-two page text file per decision, with a single system of record. ADRs double as architecture documentation and as a way to justify (or kill) standards.

### 2. Concepts, techniques, rules
**Anti-pattern 1: Covering Your Assets** - avoiding or deferring a decision out of fear of being wrong. Two cures: (a) decide at the *last responsible moment* (enough information to justify and validate, but not so late that teams are blocked or analysis paralysis sets in); (b) keep collaborating with the developers so a bad decision can be adjusted fast. Example: decision to share product reference data via a read-only replicated cache owned by the catalog service (reduces coupling, avoids inter-service calls); developers discovered some services lacked the memory for it; close collaboration let the architect adjust quickly.

**Anti-pattern 2: Groundhog Day** - nobody knows why a decision was made, so it is re-debated forever. Cause: missing or incomplete justification. Give BOTH technical and business justification. Example: splitting a monolith is technically justified by decoupling and independent deploys, but the business case (faster time to market, lower cost of new features) is what is usually missing. Business value is also a litmus test: if a decision has none, reconsider it. Four common business justifications: cost, time to market, user satisfaction, strategic positioning. Match the justification to what the stakeholders actually care about (cost savings mean little to someone who cares about speed).

**Anti-pattern 3: Email-Driven Architecture** - people lose, forget, or never learn a decision was made. Rules: (1) never put the decision itself in the email body (creates multiple systems of record, drops the justification, and nobody gets the revision when it changes); put the nature/context in the email and link to the single system of record (wiki page or file). (2) Notify only people the decision directly affects. Template: "Hi Sandra, I've made an important decision regarding communication between services that directly impacts you. Please see the decision using the following link..." If it does not affect the person, do not bother them.

**Architecturally significant (Michael Nygard)** - decisions affecting: structure (patterns/styles; e.g. sharing data between microservices), nonfunctional characteristics (the -ilities; a tech choice that affects an important characteristic becomes an architecture decision), dependencies (coupling points), interfaces (how services are accessed; contracts, versioning, deprecation), construction techniques (platforms, frameworks, tools, processes that affect the architecture). "It names a technology, so it is not architecture" is not always true.

**ADR basics** - short text file (1-2 pages), usually Markdown/AsciiDoc or wiki template; promoted by Nygard, "adopt" on the ThoughtWorks Radar; tool ADR-tools (Nat Pryce) manages numbering, location, superseding.

**ADR template sections** (five core + two the authors add; extend with e.g. Alternatives but stay consistent and concise):
1. **Title** - sequential number + short descriptive phrase, e.g. "42. Use of Asynchronous Messaging Between Order and Payment Services"; unambiguous yet concise.
2. **Status** - Proposed (needs approval from higher decision maker/governance board), Accepted (approved, ready to implement), Superseded (replaced by another ADR; always was Accepted - a Proposed ADR is simply modified until accepted). Cross-link both ways: "Superseded by 68" / "Accepted, supersedes 42"; this trail pre-empts the "what about messaging?" question. Add a status **Request for Comments (RFC)** with a deadline date (e.g. "Request For Comments, Deadline 09 JAN 2010") to get wider input without analysis paralysis; after the date, analyse comments, decide, set Proposed (or Accepted if the architect can self-approve). The status forces the conversation with your boss about when you may self-approve. Starter criteria: **cost** (licences, hardware, level of effort = hours x FTE rate), **cross-team impact**, **security**. Exceeding a limit (e.g. "costs over EUR 5,000 go to the architecture review board") means Proposed status; any cross-team or security impact cannot be self-approved. Document the thresholds so every architect knows.
3. **Context** - the forces at play: "what situation is forcing me to make this decision?" State the situation and concisely the alternatives (move deep analysis of each to an extra Alternatives section). Describing context also documents the architecture. Example: order service must pass info to payment service; REST or async messaging.
4. **Decision** - the decision plus full justification, stated in an affirmative commanding voice ("We will use asynchronous messaging between services", not "I think ... would be best"). Emphasise the WHY more than the HOW (how can be read off diagrams; why cannot). Example: years ago gRPC chosen for low latency (at the cost of tight coupling); a later architect, not knowing why, swapped to messaging for decoupling, latency rose, upstream timeouts followed.
5. **Consequences** - overall impact, good and bad; forces thinking about whether impacts outweigh benefits; records trade-off analysis (cost, or against other -ilities). Example: fire-and-forget posting of reviews cut response from 3,100 ms to 25 ms, accepting complex error handling (e.g. bad words); a later critic would not know the business already accepted that trade-off.
6. **Compliance** (authors' addition) - how the decision will be measured/governed: manual check or automated fitness function; how the fitness function is written, where it lives, how/when it runs, and any code changes needed. Example: "shared objects used by business objects reside in the shared services layer" checked with ArchUnit (Java) / NetArchTest (C#): test that classes annotated @SharedService reside in package "..services..", with a "because" message; needs new stories to create and apply the annotation.
7. **Notes** (authors' addition) - metadata: original author, approval date, approved by, superseded date, last modified date, modified by, last modification. Useful even with Git.

**Storing ADRs** - one file or wiki page per decision. Git with the code gives versioning, BUT for larger organisations the authors caution: not everyone has repo access, and it suits poorly decisions outside one application (integration, enterprise-wide). Recommendation: a wiki (template) or shared directory. Structure: Application (with `common` subfolder for all-app decisions, and one subfolder per application), Integration (communication between systems/services), Enterprise (global, e.g. "all access to a system database only from the owning system"). Names are a suggestion; be consistent.

**ADRs as documentation** - no documentation standard exists (C4, ArchiMate are for diagrams). Context describes the area and alternatives; Decision gives the why (best architecture documentation); Consequences add trade-offs.

**ADRs for standards** - people dislike standards as control. Use an ADR: Context says what forces the standard, Decision says what and, more importantly, why; if you cannot justify it, maybe it should not be a standard; understanding the why makes people follow it; Consequences may show it should not be applied.

**Example** - Going, Going, Gone auction case study: decisions such as event-driven microservices, split bidder/auctioneer UIs, RTP for video, single API layer, pub/sub. Every decision, however obvious, should be documented and justified. ADR 76 "Asynchronous Pub/Sub Messaging Between Bidding Services" (figure not in text) covers pub/sub between bid capture, bid streamer and bid tracker.

### 3. Pitfalls / anti-patterns
Covering Your Assets; Groundhog Day; Email-Driven Architecture; Analysis Paralysis (mentioned); decision stated as opinion; justification with technical reasons only; ADR kept only in a repo some stakeholders cannot reach; superseding a decision without knowing its why.

### 4. Key terms
- Last responsible moment: latest time to decide without blocking others and with enough info.
- Architecturally significant: decision affecting structure, -ilities, dependencies, interfaces or construction techniques.
- ADR: short per-decision record (Title, Status, Context, Decision, Consequences, + Compliance, Notes).
- Superseded: replaced by a later accepted ADR, with two-way link.
- RFC status: ADR circulated for comment with a deadline.
- Fitness function: automated test of an architecture rule.
- Single system of record: one place where the decision lives; others link to it.

### 5. Quotes
- "Understanding why a decision was made is far more important than understanding how something works." (paraphrase-close; Decision section)
- "Email is a great tool for communication, but it makes a poor document repository system."
- "Every architecture decision made in a system, no matter how obvious, should be documented and justified."

### 6. Relevance to PACE (my additions marked [mine])
- PACE's DECISIONS.md is already an ADR log (append-only, reversal = new entry = supersede). Strong match with Superseded two-way linking.
- [mine] Template for each DECISIONS.md entry, in plain English: Number+Title; Status (Proposed / Accepted by owner / Superseded by D-xxxx); Context (what is forcing this, options in one line each); Decision (affirmative "We will..."); Why (business reason first: cost, speed, customer satisfaction, positioning; then technical); Consequences (what we give up, what gets harder); How we will know it is being followed (a named test/guard, or "manual"); Notes (date, who decided, supersedes/superseded by).
- [mine] Status rule maps to the owner: the AI builder may mark Proposed; only the owner's reaction makes it Accepted. Thresholds for "needs the owner's yes": anything outward-facing, costing money, touching security/tenant data, or hard to reverse (this mirrors the book's cost / cross-team / security criteria).
- [mine] Use an RFC-style status with a date for decisions the owner wants to think over, so they do not drift.
- [mine] Last responsible moment: do not decide growth questions (e.g. per-org roles) before real need; do decide cheap-now/expensive-later ones.
- ROADMAP.md rows should link to the DECISIONS id; one system of record each; never restate the decision in chat summaries, link/cite the id (Email-Driven antipattern).
- The book's Compliance idea matches PACE's "a guard must fail when the rule is violated" practice: name the test beside each decision.


## Chapter 20 - Analyzing Architecture Risk

### 1. Core argument
Every architecture carries risk (availability, scalability, data integrity...). Continually analysing it lets the architect fix weaknesses before production. The chapter gives a simple two-dimension scoring matrix to cut subjectivity, a report format (risk assessment) with direction-of-trend, and a collaborative workshop (risk storming) because no single person sees all the risk. Mitigation costs money, so the outcome feeds a negotiation with business stakeholders; the process is repeated through the life of the system.

### 2. Concepts
**Risk matrix**: two dimensions, each rated Low=1, Medium=2, High=3: *overall impact* of the risk and *likelihood* of it occurring. Multiply: products 1-2 = low (green), 3-4 = medium (yellow), 6-9 = high (red). (Possible products are 1,2,3,4,6,9; no 5/7/8.) Rule: consider impact FIRST, likelihood second. Example: central database availability: impact high (3 -> would be 3, 6 or 9); but clustered on highly available servers, likelihood low (1) => 3 = medium.
**Unknown/unproven technology**: always assign the top rating (9), because the matrix cannot be applied.
**Risk assessment**: summary report of risk (from the matrix) against assessment criteria (e.g. availability, performance, scalability, data integrity) by service / domain area (e.g. customer registration, order fulfilment). Accumulate scores per criterion and per area to find the worst criterion/area (example: data integrity total 17 highest, availability 10 lowest; customer registration riskiest area, order fulfilment lowest); track over time for improvement or degradation. **Filter** before presenting (e.g. show only high-risk cells) to raise signal-to-noise. Use shading as well as colour for black-and-white printing and colour blindness.
**Direction of risk**: snapshot is not enough. Up/down arrows are ambiguous (about 50/50 people read up as worse vs better), and a key does not help once scrolled away. Use + / - beside the rating (plus green = improving, minus red = worsening, none = stable; e.g. performance 4 with minus = heading to high), or an arrow plus the rating it is trending toward (red worse, green better) which needs no key. Direction can be measured continuously using fitness functions.
**Risk storming**: collaborative exercise for one risk *dimension* (unproven technology, performance, scalability, availability incl. transitive dependencies, data loss, single points of failure, security). Include architects, senior devs and tech leads (devs bring implementation view and learn the architecture). Uses an up-to-date architecture diagram (comprehensive for holistic, contextual for a specific area). Three activities:
 1. *Identification* (individual, no collaboration so people do not steer each other): invitation 1-2 days ahead with diagram (or location), the dimension, date and place; participants rate each area with the risk matrix; write green/yellow/red Post-its with the number. Prefer a single dimension per session; if several, write the dimension on each note and discuss separately.
 2. *Consensus* (collaborative): stick notes on a big printed (or on-screen) diagram; discuss only disagreements and singletons. Example (EC2/Elastic Load Balancer/Nginx/MySQL/Redis/MongoDB logging/push expansion servers): load balancer 3,3,6 - the 6 was justified by system-wide impact, others convinced likelihood is low, settles at 3; push expansion servers rated 9 by one person from bad experience with them failing under load, which nobody else knew (value of the method); Redis rated 9 by one dev who did not know it (unknown tech = 9, and it shows why to include developers); MySQL 3,3,3 and MongoDB 2,2,2 need no discussion.
 3. *Mitigation* (collaborative): change the architecture to reduce/eliminate risk (sometimes large redesign, sometimes a small refactor like a queue for back pressure). It costs money, so stakeholders weigh cost vs risk. Example: DB availability medium (4); cluster plus split DB costs $20,000 - rejected; alternative of just splitting the DB into two for $8,000 mitigated most of the risk and was accepted.
**Agile story risk analysis**: same matrix on user stories during grooming: impact if the story is not completed in the iteration x likelihood of not completing; track and prioritise the high ones.
**Worked example: nurse diagnostics call-center system** (250 concurrent nurses, up to hundreds of thousands of self-service patients, third-party diagnostics engine ~500 req/s, medical records exchange, HIPAA, flu season spikes, call routing by nurse profile; three web UIs, call accepter and router, API gateway, four services, REST throughout). Three sessions:
 - *Availability*: central DB high (6 = impact 3 x likelihood 2); diagnostics engine 9 (impact 3 x unknown likelihood 3); medical records exchange 2 (not required for the system to run). Fixes: split DB into a clustered nurse-profile DB and a single-instance case-notes DB (also protects notes from admin access; caching profiles in the call router rejected because the router may be third party); for external systems look up published SLA (contractual, binding) vs SLO (not binding): diagnostics engine 99.99% (about 52.6 min downtime a year), records exchange 99.9% (about 8.77 h a year); that was enough to remove the risk; SLAs written on the diagram.
 - *Elasticity*: diagnostics interface 9, since 500 req/s cannot keep up with self-service load in outbreaks. Fix: async queues between gateway and engine for back-pressure; **Ambulance Pattern** (two channels, nurses prioritised over self-service); plus a Diagnostics Outbreak Cache Server so outbreak/flu questions never reach the engine; capacity then tens of thousands of concurrent requests.
 - *Security*: the single API gateway rated high (6 = impact 3 x medium likelihood 2) because admin and self-service callers share a path to medical records; the architect had said 2 but was convinced. Fix: separate API gateways per user type (admin, self-service, nurses).
Risk storming is continuous: repeat per dimension after major features or at the end of iterations, depending on change frequency.

### 3. Pitfalls
Subjective low/medium/high labels; single-person risk review; collaborating before individual scoring (anchoring); mixing dimensions in one session; ambiguous trend arrows; unfiltered reports; leaving unproven tech unrated; skipping developers; one-time risk exercise.

### 4. Key terms
Risk matrix; risk assessment; direction of risk; risk storming (identification/consensus/mitigation); SLA vs SLO; back pressure; Ambulance Pattern; fitness function (for trend).

### 5. Quotes
- "When leveraging the risk matrix to qualify the risk, consider the impact dimension first and the likelihood dimension second."
- "For unproven or unknown technologies, always assign the highest risk rating (9) since the risk matrix cannot be used for this dimension."
- "Risk storming is not a one-time process."

### 6. Relevance to PACE ([mine] unless stated)
- The owner's current scale (complexity / error chance / effort) can be mapped: *Impact if it goes wrong* (1-3) x *Chance it goes wrong* (1-3) = 1-9 with green/yellow/red; keep complexity and effort as separate cost columns since mitigation costs money (book: cost vs risk negotiation). Impact first, chance second. In plain English: "if this breaks, how bad for a customer? how likely?"
- Anything the builder has not used before or cannot test in the sandbox (e.g. no Supabase credentials, Node 26 vs 22, live email providers) = automatic 9, with a note on how to reduce it.
- A "risk list" per feature in ROADMAP.md: criterion (e.g. data leak between companies, double-send of email, cost overrun, lost data), score, trend (+/-), mitigation, cost. Show only the red ones to the owner (filtering).
- Risk storming for a solo owner: the owner and AI builder cannot be a team, but the AI can do the "individual identification" per dimension first (security, email deliverability, tenant isolation, free-tier limits, vendor lock-in), then walk the owner through only the disagreements/high items and a priced mitigation menu (like the $20k vs $8k choice) for the owner to decide. Single dimension per pass. Repeat after each major feature.
- Direction of risk can be tied to the existing guards/tests (fitness functions): a failing guard = worsening.

## Chapter 21 - Diagramming and Presenting Architecture

### 1. Core argument
Technical brilliance fails if the architect cannot convince managers to fund and developers to build it, so diagramming and presenting are core skills. Both are visual media for the same architecture vision; the unifying idea is representational consistency (always show where a part sits in the whole before zooming). Start diagrams low-fidelity to avoid over-attachment, then choose tools and conventions deliberately; in presentations, control time (transitions, animations, incremental builds) and use slides as only half of the story.

### 2. Concepts
- **Representational consistency**: before drilling into a part, show the whole topology and where the part sits (example: Silicon Sandwiches plug-ins shown within the full architecture).
- **Diagramming tools**: learn one tool deeply, but early on use low-fidelity artifacts. **Irrational Artifact Attachment anti-pattern**: attachment to an artifact is proportional to the time spent producing it, so cheap ephemeral drafts (whiteboard, index cards, sticky notes; a tablet on an overhead projector beats whiteboard photos: unlimited canvas, copy/paste what-ifs, digital, no glare) let you throw away and iterate. Create the polished diagram only after the team has iterated. Baseline tool features: **layers** (hide/show detail; build slides incrementally), **stencils/templates** (library of reusable shapes for consistency and speed), **magnets** (snap points for lines); plus lines, colour, export formats. (The authors used OmniGraffle.)
- **Standards**: *UML* (unified three 1980s approaches; little impact outside mandating organisations; class and sequence diagrams survive). *C4* (Simon Brown): Context, Container (deployment boundaries; meeting point for ops and architects), Component (closest to the architect's view), Class (UML-style); a reasonable standard but best for monoliths, weaker for distributed/microservices. *ArchiMate* (The Open Group; open enterprise-architecture modelling language; aims to be "as small as possible"; popular).
- **Diagram guidelines**: *Titles* on every element (or well known; rotate to keep them attached); *Lines* thick enough, arrows for direction, consistent arrowhead meaning; the one near-standard: solid = synchronous, dotted = asynchronous; *Shapes*: no universal standard (authors use 3-D boxes for deployable artifacts, rectangles for containership); *Labels* on each item where ambiguous; *Color*: use when it distinguishes things (example: two different microservices in unique colours rather than two instances of one); *Keys* whenever shapes are ambiguous - a misleading diagram is worse than none.
- **Presenting** (Neal Ford's book Presentation Patterns): presentation differs from document because the presenter controls time. *Manipulating time*: transitions (slide to slide, one per slide) and animations (build in, build out, actions). Use subtle transitions (dissolve) to hide slide boundaries and tell one story across slides (anti-pattern *Cookie-Cutter*: padding ideas to fill slide size; ideas have no fixed word count); use a distinct transition (door, cube) to mark end of a topic.
- **Incremental builds**: avoid *Bullet-Riddled Corpse* (slides are the speaker notes, audience reads ahead, presenter reads aloud, one channel overloaded, one starved). Two channels, verbal and visual: build graphics up bit by bit; hide part of an image with a white box and build it out, keeping suspense (example: feature branching kept alive too long).
- **Infodecks vs presentations**: infodecks are slide decks meant to be read like a magazine article (no time elements, comprehensive, standalone); presentation slides are deliberately half the content, the speaker the other half. If slides are comprehensive, email them instead.
- **Invisibility**: insert a blank black slide to switch off the visual channel and pull attention to the speaker.

### 3. Pitfalls
Showing a part without context; polishing early (Irrational Artifact Attachment); ambiguous shapes without key; monochrome only when colour disambiguates; Cookie-Cutter; Bullet-Riddled Corpse; comprehensive slides in a live talk; using C4 for microservices as a cure-all.

### 4. Key terms
Representational consistency; Irrational Artifact Attachment; layers/stencils/magnets; UML, C4, ArchiMate; infodeck; incremental build; invisibility; Cookie-Cutter; Bullet-Riddled Corpse.

### 5. Quotes
- "Nothing is worse than a diagram that leads to misinterpretation, which is worse than no diagram." (paraphrase-close; Keys section)
- "Representational consistency is the practice of always showing the relationship between parts of an architecture ... before changing views." (close paraphrase)
- Slides are meant to be "half of the presentation, the other half being the person standing there talking."

### 6. Relevance to PACE ([mine])
- The owner reads screenshots and plain English, not code: hand over simple pictures (boxes/arrows, solid = happens immediately, dotted = happens later in the background) with a title, labels and a key; always a "you are here" overview before a zoom (representational consistency).
- Draw rough first, polish only after the owner reacts (avoid Irrational Artifact Attachment): quick sketches/ASCII boxes in chat before building any formal diagram or artifact page.
- One-page infodeck style summaries (read at the owner's pace) suit async updates; if the owner wants a walkthrough, build up the picture step by step rather than a wall of bullets.
- C4's Context and Container levels are enough for the owner; component/class level stays with the builder. The ARCHITECTURE.md map could carry one Context picture.

## Chapter 22 - Making Teams Effective

### 1. Core argument
The architect is responsible not just for the design but for guiding the team to implement it; architects who work in silos hand off designs that teams struggle to build. The architect sets the "box" of constraints: too tight (control freak) frustrates and drives people away; too loose (armchair architect) leaves the team doing the architect's job unguided; the effective architect sets just the right boundary, picks the right level of control using five factors, watches for team-size warning signs, uses small well-chosen checklists, and gives guidance as design principles with justification. The authors insist this role belongs to the architect, not only to the project manager.

### 2. Concepts
- **Team boundaries**: the architect creates and communicates the constraints (box). Too tight: no access to needed tools/libraries/practices -> frustration, attrition. Too loose: team becomes the architect, runs proofs of concept and design battles -> confusion. Goal: right tools and libraries in place.
- **Three personalities**:
  - *Control freak*: decides at too fine-grained a level (bans open source, dictates naming/class design/method length, writes pseudocode); steals the art of programming; easy trap for new architects coming from developer roles. Example: architect identifies Reference Manager component and its operations (GetData, SetData, ReloadCache, NotifyOnUpdate) but should not dictate internal parallel-loader/cache design. Sometimes control is appropriate depending on complexity and team skill.
  - *Armchair*: hasn't coded in a long time, ignores implementation details, disconnected, moves from project to project after the diagrams; or is over their head. "Easy to fake it as an architect"; the stock-trading diagram that is too high-level to be useful. Indicators: not enough time with the team, not understanding domain/tech, little hands-on experience, not considering implementation implications; also happens by being spread too thin. Cure: get involved in the technology and the business domain.
  - *Effective*: right constraints, team works well, right tools, removes roadblocks, earns respect.
- **Elastic leadership (Roy Osherove, adapted)**: five factors set how much control (and how many teams you can handle): *Team familiarity* (know each other = less control; new = more), *Team size* (>12 big, <=4 small; larger = more control), *Overall experience* (junior-heavy = more control/mentoring; seniors = facilitator), *Project complexity* (higher = more control/availability), *Project duration* (short ~2 months = less control, since the team already has urgency; long ~2 years = more control; average 6 months). Reassess continuously over the project life. Scoring: each factor on a 20-point scale, minus = armchair (less control), plus = control freak (more control), sum them. Scenario 1: new team (+20), 4 members (-20), all experienced (-20), simple (-20), 2 months (-20) = -60 -> mostly hands-off facilitator. Scenario 2: know each other (-20), 12 members (+20), mostly junior (+20), high complexity (+20), 6 months (-20) = -20 ... [sic: the book's table lists -20 total] -> involved day to day as mentor/coach but not disruptive. Factors can be weighted for the situation; the score is a gauge, not exact. (Note: scenario 2's listed ratings sum to +20 by simple arithmetic, the book prints -20; flagged for reader.)
- **Team warning signs** (size-related): *Process loss* (Brooks's law: more people, more time; actual productivity falls short of group potential; sign: frequent merge conflicts; fix: find parallel work areas, challenge adding people with no parallel streams); *Pluralistic ignorance* (everyone publicly agrees with a norm while privately rejecting it, fearing they miss something obvious; "Emperor's New Clothes"; example: messaging chosen between two services though a firewall blocks it and the one dissenter stayed quiet; architect watches facial expressions/body language, invites the person to speak and backs them); *Diffusion of responsibility* (unclear who owns what, dropped items; broken-down car on a quiet country road vs busy highway where everyone assumes someone else called).
- **Checklists** (Gawande's Checklist Manifesto; pilots; surgical checklists near-zero staph infection vs rising control): use them when a process has no strict order or dependent tasks and is error-prone or often skipped; NOT for procedural step sequences (the bad "create database table" example: cannot verify the table before submitting the form) or simple well-known frequent error-free tasks. Keep each as small as possible, remove automatable items, state the obvious (obvious steps are what get missed), do not make everything a checklist (diminishing returns).
  - *Hawthorne effect*: people observed behave better; to stop ticking boxes without doing the work, explain why, involve developers in writing the lists, and tell them checklists will be verified while only spot-checking.
  - **Developer code-completion checklist** (= definition of done): formatting/standards not in tools, frequently overlooked items (e.g. swallowed exceptions), project-specific standards, special team instructions; automate what can be (e.g. "only public methods call setFailure()"; "@ServiceEntrypoint on API class" maybe not).
  - **Unit and functional testing checklist**: unusual and edge-case tests (special characters in text/number fields, min/max ranges, extreme cases, missing fields); add any case QA finds to it; remove items once automated (e.g. negative shares in a BUY); bridges developers and testers.
  - **Software release checklist**: most error-prone phase; most volatile list; items such as config changes (servers/external config), third-party libraries added, database updates and migration scripts; after any failed build or deploy, root-cause it and add an entry.
- **Providing guidance via design principles**: example = third-party library ("layered stack") governance: developer first answers (1) overlap with existing functionality? (2) justification - technical AND business. Story: Mark's team member obsessed with Scala; asked for a business justification (training, rewrite cost) he found none, became a helpful member, and the two threatening-to-leave developers stayed. Graphic of categories with who decides: *special purpose* (PDF rendering, barcode scanning; developer decides), *general purpose* (wrappers on language API, e.g. Apache Commons/Guava; developer may do overlap analysis + justification but architect approves), *framework* (persistence, IoC like Hibernate/Spring; invasive layers; architect decides, no analysis by the team).
- **Summary**: elastic leadership, checklists, guidance. Making teams effective is the architect's job, not delegated to a manager, because the architect observes team dynamics and leads implementation.

### 3. Pitfalls
Control freak; armchair; wrong box size; ignoring the team; large teams (process loss, pluralistic ignorance, diffusion of responsibility); procedural steps disguised as checklists; too many/too long checklists; ticking without doing; unjustified technology wishes.

### 4. Key terms
Boundary/box; control freak / armchair / effective architect; elastic leadership; process loss (Brooks's law); pluralistic ignorance; diffusion of responsibility; Hawthorne effect; definition of done; layered stack.

### 5. Quotes
- "Checklists work."
- "Don't worry about stating the obvious in a checklist. It's the obvious stuff that's usually skipped or missed."
- "Writing program code is really hard to fake" (versus architecture, where "it's really easy to fake it as an architect"). [paraphrased from the text]

### 6. Relevance to PACE ([mine])
- PACE's team is one owner + AI builder (+ occasional helper agents). The "box" is CLAUDE.md/ARCHITECTURE.md: too tight stops the builder using good tools; too loose lets it make owner-level decisions. Keep the rule "builder picks internals; owner decides product/cost/outward-facing".
- Use the library-governance table for new dependencies: special-purpose (builder may add with a one-line justification), general-purpose (needs a reason + overlap check), framework-level or paid vendor (owner decides). This matches CLAUDE.md's "no new library for something a few lines can do".
- Checklists already exist as guards/hooks; keep a short release checklist (migration applied before merge, Node 22 + 26 run, screenshots) and append a line after every failed deploy (book: root-cause then add). Don't turn procedures with dependent steps into checklists.
- Business justification before adopting any tech wish (Scala story) = cost/time/customer-value one-liner in the DECISIONS entry.
- Pluralistic ignorance has an AI twist: the builder should say plainly when it doubts a plan rather than agreeing; the owner should ask "what could be wrong with this?".
- Elastic leadership at team-of-one: control level = how closely the owner reviews; high for risky/outward-facing/irreversible work, light for small reversible fixes.


## Chapter 23 - Negotiation and Leadership Skills

### 1. Core argument
Almost every architecture decision will be challenged (by developers, other architects, and cost/time-minded stakeholders), so negotiation and facilitation are central, and about half of being effective is people, facilitation and leadership skill. The chapter gives tactics by counterpart (business stakeholders, other architects, developers), then leadership practices: avoid accidental complexity (the 4 C's), balance pragmatic and visionary, lead by example not title, use collaborative grammar, and manage meetings so the architect is present with the team.

### 2. Concepts
**Negotiating with business stakeholders** (Scenario 1: sponsor insists on five nines; architect knows three nines suffice; sponsor dislikes being corrected or patronised, half-technical):
 1. *Use the stakeholder's grammar and buzzwords as information*: "needed it yesterday" = time to market matters; "lightning fast" = performance; "zero downtime" = availability.
 2. *Gather information before negotiating*; convert "nines" to hours/minutes. Table: 90% = 36 d 12 h/yr (2.4 h/day); 99% = 87 h 46 min (14 min/day); 99.9% = 8 h 46 min (86 s/day); 99.99% = 52 min 33 s (7 s/day); 99.999% = 5 min 35 s (1 s/day); 99.9999% = 31.5 s (86 ms/day). Validate their concern first ("availability is very important"), then talk in minutes/seconds, not nines.
 3. *When all else fails, state things in cost and time* - but save it for last, since opening with "that costs a lot" / "no time" starts negotiation badly; settle on substance first, then cost/time.
 4. *Divide and conquer* (Sun Tzu): qualify which part of the system actually needs the hard requirement, shrinking cost and scope.
**Negotiating with other architects** (Scenario 2: messaging vs REST, repeated friction): do not pull rank; *demonstration defeats discussion* (benchmark both in a production-like environment, since every environment differs and "Google it" is no proof); *stay calm and concise; don't get personal*; if heated, stop and resume later.
**Negotiating with developers**: don't use the title; avoid Ivory Tower architecture (dictating from on high). *Give the justification first*, and depersonalise: not "You must go through the business layer" but "Since change control is most important to us, we have a closed layered architecture, which means all database calls come from the business layer" - which moves the conversation to how to make simple queries fast within the constraint. People stop listening once they hear something they disagree with, so lead with the reason. *Have the developer arrive at the solution* (Framework X vs Y: let them show how Y meets the security requirement; either they fail and own the decision, or they succeed and you gain a better option - a win either way). Respect earned through collaboration makes later negotiation easier.
**Architect as leader**
- **4 C's**: communication, collaboration, clarity, conciseness. Antidote to *accidental complexity* ("we made a problem hard", e.g. an unreadable bank information-flow diagram; sometimes done to look needed or for job security) as opposed to *essential complexity* ("we have a hard problem", e.g. six nines). Quote from Neal: developers are drawn to complexity like moths to a flame.
- **Pragmatic yet visionary**: visionary = strategic, planning for architectural vitality; pragmatic = account for budget, time, team skill level, trade-offs, technical limits. Example: facing elasticity, a visionary might propose a data mesh; the pragmatic questions: has the company used it, what are the trade-offs, would it solve the problem? First find the bottleneck (database? a called service?) and consider caching.
- **Lead by example, not title**: captain/sergeant story (soldiers look to the sergeant). Weinberg: "No matter what the problem is, it's a people problem." Calling a suggestion "a dumb idea" silences the whole team. Grammar: not "What you need to do is use a cache" but "Have you considered using a cache? That might fix the problem" / "What about..." - returns control to the other person; coach team members on this grammar.
- **People-skills tactics**: use people's names and pronounce them correctly (repeat and confirm); firm 2-3 second handshake with eye contact for first/occasional meetings (not every morning); never hug in a professional setting; **turn a request into a favour** (use the person's name, admit being in a bind, ask if they can squeeze it in, thank them, "I owe you one") because people dislike orders but want to help (example: asking Sridhar to split the payment service into five by payment type); become the go-to person: step in when someone struggles technically; notice colleagues who seem down and offer a coffee walk, back off if signals say so; host brown-bag lunches on a technique or technology.
- **Integrating with the team: meetings**. Imposed upon: ask why you're needed (meeting notes can keep you informed), ask for the agenda in advance, attend only the relevant part, send yourself in place of the tech lead ("take one for the team"). Imposed by: only call if more important than the work interrupted (email may do), always set and stick to an agenda, protect developers' *flow* by scheduling first thing, after lunch, or end of day. Sit with the team rather than in a cubicle apart; if not possible, walk around and be seen, block time daily for the team; same with ops and business stakeholders.
- Closing quote: Theodore Roosevelt, success depends most on knowing how to get along with people.

### 3. Pitfalls
Egoistic or forceful analysis; opening with cost/time; arguing opinions instead of demonstrating; "you must" commands; Ivory Tower; accidental complexity; theory-only visionary or anti-visionary pragmatist; using title instead of respect; dismissive remarks; calling needless meetings; hiding in a cubicle.

### 4. Key terms
Five nines (etc.); divide and conquer; Ivory Tower architecture; essential vs accidental complexity; 4 C's; pragmatic yet visionary; flow; imposed-upon / imposed-by meetings; go-to person.

### 5. Quotes
- "Demonstration defeats discussion."
- "When all else fails, state things in terms of cost and time."
- "Developers are drawn to complexity like moths to a flame—frequently with the same result."

### 6. Relevance to PACE ([mine])
- The owner-builder relationship is a standing negotiation: the AI should state the reason first, then the option, in the owner's vocabulary (time, money, customer effect). Translate technical targets into plain terms, as with nines to minutes ("down about 9 hours a year" vs "about 5 minutes").
- Use the owner's own words as signals ("I need this today" = speed; "customers will hate this" = satisfaction). Ask what they mean before building.
- Use "divide and conquer" on requirements: which part of PACE really needs the expensive guarantee (e.g. email never double-sent, tenant isolation) versus the rest.
- Demonstration beats discussion: show a screenshot or a working prototype rather than argue; pairs with the owner's by-using-it evaluation.
- Guard against accidental complexity: prefer the smallest option that fully works (already in CLAUDE.md); say plainly when something is essential complexity.
- Pragmatic yet visionary maps to "spend nothing now, scale later": cheap-now decisions that avoid expensive retrofits; avoid the data-mesh-style over-build.
- Phrase suggestions as "Have you considered / what about" choices the owner can react to (matches the proactive-suggestions rule).

## Chapter 24 - Developing a Career Path

### 1. Core argument
Becoming an architect is hard and managing the path after is also tricky; the field changes so fast that continuous learning is required, and breadth matters more than depth. Practical habits: the 20-minute rule (learn something every day, first thing in the morning before email), a personal technology radar (adapted from ThoughtWorks) to formalise what to explore and avoid, and social media/weak links as discovery channels. Skill comes from practice (architecture katas), and the 'why' of decisions matters more than the 'how'.

### 2. Concepts
- **Continuous learning**: Clipper expert anecdote - vast knowledge became useless; software people discard knowledge faster than most groups. Maintain a personal stockpile of resources (no list in the book as they expire; ask colleagues what they use).
- **20-minute rule**: spend at least 20 minutes a day learning something new or deepening a topic (e.g. InfoQ, DZone Refcardz, ThoughtWorks Radar); google unfamiliar buzzwords to turn "don't know you don't know" into "know you don't know" (ties to the knowledge triangle of Ch.2). Lunch and evenings fail in practice; do it first thing in the morning after getting coffee and before checking email (go in a bit early).
- **Personal radar**: Neal's Clipper/DOS company vanished when Windows took over; lesson: ignoring the march of technology is perilous; *bubble living* (memetic echo chamber, vendor-created bubbles are worst; collapse unnoticed from inside). A radar is a living document assessing risks/rewards of existing and emerging technology. ThoughtWorks Technology Advisory Board (twice-yearly face-to-face, advising the CTO) produces the Technology Radar; other companies copy it.
  - *Quadrants*: Tools; Languages and frameworks; Techniques; Platforms.
  - *Rings (outer to inner)*: Hold (originally "hold off for now", now "don't start anything new with this"; fine on existing projects), Assess (worth exploring to understand organisational impact: spikes, research, conference sessions), Trial (worth pursuing; pilot a low-risk project), Adopt (the industry should adopt).
  - *Personal version*: Hold also includes habits to break (e.g. low-value forum gossip), Assess = promising things heard about but not yet evaluated (staging area), Trial = active spikes to enable trade-off analysis, Adopt = what you're most excited about and best practices.
  - Treat a technology portfolio like a financial one: diversify; track in-demand skills but also take some gambits (open source, mobile). Exercise matters more than the outcome; it provides an excuse to carve out time. Tool: ThoughtWorks Build Your Own Radar (Nov 2016; Google spreadsheet input, HTML5 canvas output; one sheet per quadrant).
- **Social media and weak links** (McAfee, Enterprise 2.0): strong links (family, coworkers; know their lunch last week), weak links (acquaintances), potential links (people not yet met). The next job tends to come from weak links; follow respected technologists to find items for the Assess ring.
- **Parting advice**: Brooks - "great designers design"; Ted Neward - architects rarely get many chances, so practice with the architecture katas (companion site). No answer key: "no right or wrong answers in architecture - only trade-offs". Authors stopped archiving kata drawings because they captured topology/decisions but not ADRs; the why holds the trade-offs, keeping only the how is half the story. "Always learn, always practice."

### 3. Pitfalls
Ignoring technology shifts; bubble living; ad hoc technology picking; lunch/evening learning plans; checking email first; keeping only the how, not the why.

### 4. Key terms
20-minute rule; technology radar (quadrants, rings Hold/Assess/Trial/Adopt); bubble living; strong/weak/potential links; architecture kata; breadth vs depth.

### 5. Quotes
- "There are not right or wrong answers in architecture—only trade-offs."
- "Great designers design, of course." (Fred Brooks, quoted)
- "Always learn, always practice, and go do some architecture!"

### 6. Relevance to PACE ([mine])
- Career path itself is not the owner's concern, but the radar is useful as a **vendor/technology watch list for the product**, using the four rings: Hold (e.g. anything tied to one vendor, expiring free AI models), Assess (contact-data providers, payment providers, AI models), Trial (low-risk pilot behind a flag), Adopt (in production). Put as one ROADMAP.md section; fits "no vendor hard-wired" and "hosted model name is expiring stock".
- The 20-minute rule has a PACE analogue: a short periodic check of what competitors (Ceipal, Bullhorn) and AI tooling changed; surface in plain language as a menu of choices.
- The "why over how" closing point supports the DECISIONS.md habit: record the why with each trade-off.

## Appendix - Self-Assessment Questions (book intends answers from the corresponding chapters; one-line answer areas, paraphrased)

**Ch.1 Introduction**
1. Four dimensions defining software architecture -> structure, architecture characteristics, architecture decisions, design principles.
2. Architecture decision vs design principle -> decision is a rule/constraint to follow; principle is guidance with some flexibility.
3. Eight core expectations of an architect -> make decisions, continually analyse, keep current, ensure compliance, diverse exposure/experience, business domain knowledge, interpersonal skills, understand and navigate politics.
4. First Law of Software Architecture -> everything in software architecture is a trade-off.
**Ch.2 Architectural Thinking**
1. Traditional architecture vs development split and why it fails -> architects design in isolation and hand off; feedback and agility needs require collaboration.
2. Three levels of the knowledge triangle -> stuff you know, stuff you know you don't know, stuff you don't know you don't know (with examples).
3. Why breadth over depth -> architects must weigh many options and trade-offs, not master one.
4. Staying hands-on -> proofs of concept, frequent coding of small pieces, tackling technical debt/bug fixes, automation, code reviews.
**Ch.3 Modularity**
1. Connascence -> two components are connascent if a change in one requires a change in the other.
2. Static vs dynamic connascence -> source-code-level coupling vs runtime coupling.
3. Connascence of type -> components must agree on types; static.
4. Strongest form -> identity (static strongest per the ordering; dynamic forms like identity/value/timing are strongest overall; answer from the chapter's ordering).
5. Weakest form -> name.
6. Preferred -> static over dynamic.
**Ch.4 Architecture Characteristics Defined**
1. Three criteria -> specifies a non-domain design consideration, influences a structural aspect of design, is critical or important to application success.
2. Implicit vs explicit -> implicit rarely stated (e.g. security); explicit written in requirements (e.g. a stated availability).
3. Operational example -> availability, performance, scalability, reliability etc.
4. Structural example -> modularity, maintainability, portability, etc.
5. Cross-cutting example -> security, accessibility, legal, etc.
6. Availability vs performance -> neither universally; depends on context/trade-offs.
**Ch.5 Identifying Architecture Characteristics**
1. Why limit the -ilities -> each added characteristic complicates the design; supports trade-off clarity.
2. Most characteristics come from business requirements/user stories? -> false; they come from many sources (domain concerns, stakeholders, requirements, implicit knowledge).
3. Time-to-market driver -> agility, testability, deployability (and arguably maintainability).
4. Scalability vs elasticity -> scalability = handle growth over time; elasticity = handle bursts/spikes.
5. Acquisitions -> scalability, elasticity, interoperability, performance, data/integration concerns.
**Ch.6 Measuring and Governing Characteristics**
1. Why cyclomatic complexity -> indicator of code complexity, testability, maintainability and modularity.
2. Fitness function -> automated check of an architecture characteristic, used for governance and continuous verification.
3. Scalability fitness function example -> automated load test checking response time at increasing users.
4. Most important criterion -> the characteristic must be objectively measurable/definable.
**Ch.7 Scope of Architecture Characteristics**
1. Architectural quantum -> independently deployable artifact with high functional cohesion, high static coupling, and synchronous dynamic coupling; matters because characteristics apply per quantum.
2. UI + four services each with own DB -> one quantum, as the shared UI couples synchronously (assuming it requires all).
3. Admin + customer portions -> two quanta because they need different characteristics; they could share a DB, which then sits within one quantum (typically the admin quantum owning it).
**Ch.8 Component-Based Thinking**
1. How components manifest -> as packages/namespaces/directories (and services).
2. Technical vs domain partitioning -> by technical layers vs by business domain; examples.
3. Advantage of domain partitioning -> models how the business works; aligns with Conway's law and cross-functional teams.
4. When technical partitioning wins -> when change is mostly within a layer, or organisation is by technical specialty.
5. Entity trap -> turning entities into components creates generic CRUD services, not a real design.
6. Workflow over actor/actions -> when the system is workflow-oriented rather than driven by distinct user roles.
**Ch.9 Architecture Styles**
1. Eight fallacies of distributed computing -> network reliable, latency zero, bandwidth infinite, network secure, topology doesn't change, one administrator, transport cost zero, network homogeneous.
2. Three distributed challenges -> e.g. network issues, transactions/data consistency, contract management, observability, complexity.
3. Stamp coupling -> passing a large data structure when only part is needed.
4. Addressing it -> smaller private contracts, field-level selectors, consumer-driven contracts.
**Ch.10 Layered**
1. Open vs closed layer -> closed requires passing through the next layer; open may be bypassed.
2. Layers of isolation -> changes in one layer don't affect others; benefit is change containment.
3. Sinkhole anti-pattern -> requests pass through layers doing nothing; problem when too many (rule of thumb 80/20).
4. Drivers for layered -> simplicity, low cost, familiarity, small apps.
5. Why testability weak -> (per the chapter's ratings) hard to test layers/whole app in isolation; note the book rates it moderate.
6. Why agility weak -> monolithic deployment, high coupling, risk of change.
**Ch.11 Pipeline**
1. Bidirectional pipes? -> no, unidirectional.
2. Four filter types -> producer, transformer, tester, consumer.
3. Filter output to multiple pipes? -> yes (tester can).
4. Partitioning -> technically partitioned.
5. Modularity support -> filters are independent, replaceable.
6. Two examples -> ETL, Unix shell pipelines, MapReduce, etc.
**Ch.12 Microkernel**
1. Other name -> plug-in architecture.
2. Plug-in dependent on plug-in when -> only when unavoidable and kept minimal.
3. Tools to manage plug-ins -> OSGi, Jigsaw, Penrose, Jeeves, Prism.
4. Non-conforming third-party plug-in -> write an adapter.
5. Two examples -> Eclipse IDE, browsers, JIRA, Jenkins, etc.
6. Partitioning -> domain partitioned.
7. Always single quantum -> shared core system with one deployment and shared data.
8. Domain/architecture isomorphism -> architecture shape matches the problem domain's shape.
**Ch.13 Service-Based**
1. Number of services -> typically 4 to 12 (about 7).
2. Must the DB be split? -> no, a single shared DB is common.
3. When to split -> to reduce risk of change or improve fault tolerance/scalability.
4. Managing DB changes -> logical partitioning of shared DB / shared library of entity classes with careful change control.
5. Containers needed? -> no.
6. Well supported -> deployability, testability, fault tolerance, availability, overall cost/simplicity.
7. Elasticity weak -> coarse-grained services, shared DB.
8. More quanta -> split the database and/or UI by domain.
**Ch.14 Event-Driven**
1. Broker vs mediator -> broker has no central orchestrator, mediator coordinates with an event mediator.
2. Better workflow control -> mediator.
3. Broker model -> usually pub/sub with topics.
4. Two advantages of async -> responsiveness and performance/decoupling (non-blocking).
5. Request-based example -> user requests order history.
6. Event-based example -> user places a bid or submits a trade.
7. Initiating vs processing event -> initiating starts the flow; processing events are produced by processors during flow.
8. Preventing data loss -> persistent queues, synchronous send, client acknowledge mode, last participant support.
9. Three driving characteristics -> performance, scalability, fault tolerance (responsiveness).
10. Poorly supported -> simplicity, testability.
**Ch.15 Space-Based**
1. Name origin -> tuple space.
2. Differentiator -> removes the central database from the transaction path using replicated in-memory data grids.
3. Four middleware components -> messaging grid, data grid, processing grid, deployment manager.
4. Messaging grid -> manages request/session input and routes to a processing unit.
5. Data writer -> asynchronously writes in-memory data updates to the DB.
6. Data reader access -> when cache has no data (cold start/ cache miss/ failure).
7. Small cache and collision -> increases collision chance.
8. Replicated vs distributed cache -> replicated copies in each unit (used here) vs central distributed cache.
9. Strong characteristics -> elasticity, scalability, performance.
10. Low testability -> complexity of load/scale testing.
**Ch.16 Orchestration-Driven SOA**
1. Driving force -> enterprise reuse (and resource sharing/ cost).
2. Four service types -> business, enterprise, application, infrastructure.
3. Downfall factors -> complexity, coupling, orchestrator bottleneck, poor agility, cost.
4. Partitioning -> technically partitioned.
5. Reuse -> domain reuse via coupling and orchestration; operational reuse via central services.
**Ch.17 Microservices**
1. Bounded context critical -> each service encapsulates its domain with its data, decoupling.
2. Granularity checks -> purpose, transactions, choreography.
3. Sidecar functionality -> operational concerns (monitoring, logging, security, service mesh).
4. Orchestration vs choreography -> central coordinator vs distributed; microservices favour choreography; choreography is easier in terms of the style's decoupling.
5. Saga -> pattern for managing distributed transactions via compensating actions.
6. Why agility/testability/deployability high -> small, independent, highly decoupled services.
7. Two performance reasons -> network calls and security checks between services.
8. Partitioning -> domain partitioned.
9. Single quantum topology -> shared UI/database or synchronously coupled by the user interface.
10. Reuse -> domain reuse by duplication; operational reuse by sidecars/service mesh.
**Ch.18 Choosing the Appropriate Style**
1. How data architecture influences style -> the shape/partitioning of data may constrain or favour a style.
2. How it influences the choice -> e.g. highly coupled data steers toward monolith/less distribution.
3. Steps -> determine monolith vs distributed, then data placement, then sync vs async communication.
4. Factor toward distributed -> need for differing architecture characteristics per part (e.g. scalability, availability).
**Ch.19 Architecture Decisions**
1. Covering Your Assets -> avoiding decisions from fear of being wrong.
2. Avoid email-driven architecture -> link to single system of record; notify only those affected; no decision in email body.
3. Five factors of architecturally significant -> structure, nonfunctional characteristics, dependencies, interfaces, construction techniques.
4. Five basic ADR sections -> Title, Status, Context, Decision, Consequences.
5. Justification section -> Decision.
6. Alternatives (if no separate section) -> Context.
7. Three criteria for Proposed status -> cost, cross-team impact, security.
**Ch.20 Analyzing Architecture Risk**
1. Two dimensions -> impact and likelihood.
2. Showing direction -> plus/minus, arrows with target rating, colours; other ideas welcome.
3. Why collaborative -> no one sees all risk.
4. Why identification is individual -> to avoid influencing/anchoring.
5. Three say high (6), one says medium (3) -> discuss; the dissenter explains the rationale and the group reaches consensus.
6. Unknown technology -> 9.
**Ch.21 Diagramming and Presenting**
1. Irrational artifact attachment -> attachment proportional to time invested; use low-fidelity first.
2. C4's four C's -> Context, Container, Component, Class.
3. Dotted lines -> asynchronous communication.
4. Bullet-riddled corpse and avoidance -> text-heavy slides read aloud; use incremental builds and graphics.
5. Two channels -> verbal and visual.
**Ch.22 Making Teams Effective**
1. Three personalities and boundaries -> control freak (tight), armchair (loose), effective (right).
2. Five control factors -> team familiarity, team size, overall experience, project complexity, project duration.
3. Three warning signs of too-big team -> process loss, pluralistic ignorance, diffusion of responsibility.
4. Three checklists -> developer code completion, unit/functional testing, software release.
**Ch.23 Negotiation and Leadership**
1. Why negotiation important -> nearly every decision gets challenged.
2. Five nines vs three -> use their grammar, gather info (hours/minutes), validate concern, divide and conquer, cost/time last.
3. "I needed it yesterday" -> time to market is the concern.
4. Why cost/time last -> opening with it derails; substance first.
5. Divide and conquer -> qualify which part truly needs the requirement; e.g. five nines only for the trade-execution part.
6. 4 C's -> communication, collaboration, clarity, conciseness.
7. Pragmatic and visionary -> vision without feasibility or practicality without direction both fail.
8. Reducing meetings -> ask why needed, ask for agenda, attend only relevant part, send the architect instead of tech lead, call fewer meetings.
**Ch.24 Developing a Career Path**
1. 20-minute rule -> 20 minutes daily on learning; best first thing in the morning before email.
2. Four radar rings -> Hold, Assess, Trial, Adopt, with the personal reinterpretations.
3. Depth vs breadth -> architects should maximise breadth.

(NOTE: the appendix gives questions only, no answers; the answer areas above are drawn from this slice's chapters 19-24 where present, and for Ch.1-18 are my paraphrase from general knowledge of the book, NOT verified against the text in this slice. Treat Ch.1-18 answers as [mine, unverified].) Slice-verified: Ch.19-24 answers, and the question wording for all chapters.

## Overall relevance to PACE: how to do decision records and risk assessment ([mine])
1. **Decision records** - keep DECISIONS.md as the single system of record; give each entry: number, title, status (Proposed / Accepted-by-owner / Superseded by Dxxxx), context, decision (affirmative), why (business first), consequences/trade-offs given up, how enforced (guard or manual), date and who decided. Never edit; reversal = new entry that supersedes and links back. Mention ids, not decision text, in ROADMAP rows and messages. Add a "Request for comments until <date>" status for decisions the owner wants to sleep on.
2. **Self-approval thresholds** - write down once which decisions the AI builder may take alone (small, reversible, internal, no money, no customer data/security impact) and which need the owner's yes (cost, outward-facing, security/tenant data, hard to reverse). Matches CLAUDE.md.
3. **Risk assessment** - for each ROADMAP item add Impact (1-3) x Chance (1-3) = score with colour, trend (+/-), plus the owner's existing complexity and effort as the cost of fixing; anything the builder cannot test or has never used = 9; present only the red/yellow items; offer a priced mitigation menu (e.g. cheap partial fix vs full fix) so the owner can trade cost against risk. Re-run a single-dimension "risk storm" (security, tenant isolation, email deliverability, free-tier limits, vendor lock-in, data loss) after each major feature.
4. **Communication** - plain English, "you are here" overview before detail, sketches before polish, a key on every picture, one-line statement of what was skipped.

## Coverage
Read lines 1-3086 of the slice file in full (Part III intro lines 1-8; Ch.19 lines 10-481; Ch.20 484-961; Ch.21 963-1257; Ch.22 1259-1942; Ch.23 1944-2546; Ch.24 2548-2805; Appendix 2807-3086). Figures were not in the text (captions only); the ADR 76 example (Fig 19-5), risk matrix grid (Fig 20-1) and several diagrams are referenced but their contents are not extractable. Table 22-2 prints an accumulated score of -20 while the listed ratings (-20,+20,+20,+20,-20) sum to +20; flagged in notes. Tables 22-1/23-1 were slightly scrambled by extraction but readable. Appendix answers for Ch.1-18 are outside this slice and are labelled as unverified paraphrases.
