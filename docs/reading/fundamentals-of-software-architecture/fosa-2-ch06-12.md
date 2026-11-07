# Fundamentals of Software Architecture (Richards & Ford, 2020) — slice 2: Ch. 6-12

(Slice begins mid-way: first lines are the Ch. 6 opener. Ends in Ch. 12. "[mine]" marks my own additions.)

---
# CHAPTER 6 — Measuring and Governing Architecture Characteristics

## 1. Core argument
Architecture characteristics ("-ilities") are usually vague, defined differently by different teams, and often composite (agility = modularity + deployability + testability). The fix is objective, organisation-wide definitions that break composites into measurable parts. Characteristics can be measured operationally (response time, scalability), structurally (cyclomatic complexity, coupling) and via process (test coverage, deployment success). Because important-but-not-urgent concerns (modularity) get crowded out by urgent work, architects need governance, and the modern tool is the fitness function: any mechanism that gives an objective integrity check of an architecture characteristic, run automatically (in CI, in production) like a checklist. They are not a framework but a new view of existing tools (metrics, monitors, unit tests, chaos engineering).

## 2. Concepts, section by section
**Measuring Architecture Characteristics - three problems:** (a) "They aren't physics": terms like agility/deployability mean different things to different people; (b) wildly varying definitions even inside one org (performance for dev vs ops); (c) too composite. Remedy: agree concrete definitions (a ubiquitous language), unpack composites into measurable pieces.

**Operational measures.** Obvious ones (performance, scalability) still have nuance. Average response time hides outliers (1% of requests 10x slower may vanish in an average) so also measure max / percentiles. "Many flavors of performance": performance budgets for specific parts, e.g. first-page render target ~500 ms; "K-weight" budgets (max bytes of libraries/frameworks per page) grounded in network physics; first contentful paint, first CPU idle. Mature teams use statistical models: measure scale over time, build a prediction model, alarm when real-time metrics leave the model (either the model is wrong or something is wrong, both worth knowing). New measurable things keep emerging.

**Structural measures.** No comprehensive code-quality metric exists, but narrow ones do. *Cyclomatic complexity (CC)*, McCabe 1976: graph-theory count of decision points/execution paths. Function with no branches = 1; one conditional = 2. Formula CC = E - N + 2 (single function), general CC = E - N + 2P (P = connected components). Example function with if / else-if / else: CC = 3. Overly complex code is a smell that harms modularity, testability, deployability; unwatched, complexity dominates. "Good" threshold: depends on domain; industry says <10 acceptable; authors consider that high and prefer <5. Crap4J (Java) combines CC and coverage: CC over 50 is hopeless regardless of coverage. Anecdote: a C function with CC over 800, 4,000+ lines, GOTOs. Questions to ask: is it complex because of the domain or because of poor coding / poor partitioning? TDD tends to yield small low-CC methods as a side effect.

**Process measures.** Agility is composite: testability (code coverage tools; but 100% coverage with weak assertions gives no confidence; metrics don't replace thinking) and deployability (ratio of successful/failed deployments, deployment duration, issues raised by deployments). Each team chooses its own measurements. If deployability and testability matter, the architect emphasises modularity and isolation: a characteristic driving a structural decision. Anything in a project can become an architecture characteristic if it meets the three criteria (from Ch. 4).

**Governance and fitness functions.** Governance (Greek *kubernan*, to steer) = any part of the development process the architect wants to influence. Automation lineage: XP -> continuous integration -> DevOps -> automated architectural governance. *Fitness function* term comes from genetic algorithms (an objective function scoring how close output is to the aim, e.g. route length/cost/time in traveling-salesperson). Architecture fitness function = any mechanism giving an objective integrity assessment of one or a combination of characteristics. Implementations vary: metrics, monitors, unit-test libraries, chaos engineering (Figure 6-2 shows the mechanisms; figure not in text).
- *Cyclic dependencies:* IDE auto-import habits create cycles between components (Fig 6-3); cycles block reuse of one component without the others and lead to Big Ball of Mud. Code review is too late (a week of damage). Fitness function: JDepend test that fails if any cycles exist, wired into the continuous build. Guards the important-not-urgent.
- *Distance from the main sequence:* JDepend test asserting each package's distance is within a project-specific tolerance (example 0.5 around ideal 0.0). Lesson: architects and developers must collaborate; developers must understand the purpose of a fitness function before it is imposed; no ivory-tower esoterica.
- *Layer governance:* ArchUnit (Java) expresses layer rules as tests (Controller may not be accessed by any layer; Service only by Controller; Persistence only by Service). NetArchTest is the .NET analogue (presentation namespace must not depend on data namespace). Purpose: stop "better to ask forgiveness than permission" erosion (e.g. for local performance reasons).
- *Netflix Simian Army:* Chaos Monkey (random production failure), Latency Monkey, Chaos Kong (whole data-centre failure), Conformity Monkey (checks services follow architect rules, e.g. respond to all REST verbs), Security Monkey (open ports, misconfig), Janitor Monkey (finds orphan instances nothing routes to and removes them to save cloud cost). Origin: moving to AWS removed operational control, giving birth to chaos engineering. Mindset: not if something breaks but when.
- *Checklist Manifesto framing (Gawande):* pilots and surgeons use checklists not from ignorance but because details slip in repeated work. Fitness functions are the same: lightweight, codified reminders embedded in the architecture, not heavyweight governance.

## 3. Pitfalls / anti-patterns
- Averages hiding outliers; arbitrary thresholds instead of statistical models.
- Treating coverage % as quality (100% with bad assertions).
- Cyclic dependencies via auto-import; Big Ball of Mud.
- Governance by late code review.
- Fitness functions the developers do not understand (ivory tower).
- Vague composite "-ilities" with no objective definition.

## 4. Key terms
- Cyclomatic complexity: count of independent decision paths in code.
- Fitness function: automated objective check of an architecture characteristic.
- Governance: steering the development process toward architectural intent.
- Performance budget / K-weight budget: hard limits for a specific speed or payload size.
- ArchUnit / NetArchTest / JDepend: test libraries that codify architecture rules.
- Chaos engineering: deliberately breaking production to test resilience.
- Important-not-urgent: concerns (modularity) that need automation to survive deadlines.

## 5. Quotes
- "Architects must ensure that developers understand the purpose of the fitness function before imposing it on them."
- "Fitness functions are not some new framework for architects to download, but rather a new perspective on many existing tools."
- (paraphrase-level) fitness functions work like checklists: a succinct reminder that busy people do not forget under pressure.

## 6. Relevance to PACE [mine]
PACE already behaves like a fitness-function shop: `test/route-shadowing-smoke.mjs`, `recruiting-routes-mounted.mjs`, `admin-numbers-smoke.mjs`, `utility-classes-smoke.mjs`, `page-renders-smoke`, `mobile-layout-smoke`, `test/run-all.mjs` as the CI gate. That matches the book's idea exactly: rules paid for by incidents encoded as automated checks. Candidate additions (my suggestions, framed as product-owner choices):
- **Layer/ownership rule in plain Node:** a test that scans `require`/`import` graphs and fails if `routes/*` import `supabase` directly for tenant tables (CLAUDE.md says use `models/`, not hand-written `supabase.from()`); if `services/*` import from `routes/*`; if any file other than `services/ai-provider.js` calls an AI vendor, `people-apollo.js` calls Apollo, `http-client.js` wraps outbound HTTP. This is an ArchUnit-style fitness function; tools: `madge` or a 40-line script [mine].
- **Cycle test:** `madge --circular` over `services/` and `routes/` [mine].
- **Size/complexity budget for `index.js`** (4,500 lines): a test that fails if the file grows past the current line count or if any function CC exceeds a threshold (ESLint `complexity` rule); a ratchet that only ever allows shrinkage [mine, shortcut: line counts are crude; upgrade to ESLint complexity].
- **Tenant-scope fitness function:** every table with `org_id` appears in `models/tables.js`; every migration with `org_id` has RLS (a check against SQL files).
- **Performance budget:** p95 response-time probes for key routes and a payload/page-weight budget for the plain-JS frontend (K-weight idea) given a free-tier host [mine].
- **Operational monitors:** Sentry alerts as the "statistical model" analogue; the Janitor idea maps to detecting stale/orphan routes or unused services.
- Process measure: test-count (385 files) is coverage-by-count; the book warns coverage alone is not confidence, matching CLAUDE.md's "a guard must fail when the thing is ABSENT."

---
# CHAPTER 7 — Scope of Architecture Characteristics

## 1. Core argument
Traditionally architecture characteristics (scalability, availability...) were scoped to the whole system, which was fine when everything was one monolith. With microservices and similar styles, different parts of a system need different characteristics, so the system-level scope is outdated. The authors introduce the *architecture quantum* — an independently deployable artifact with high functional cohesion and synchronous connascence — as the correct scope, and illustrate with the Going, Going, Gone auction kata, where bidder feedback, the auctioneer and online bidders need different characteristics, leading to a hybrid/distributed design early.

## 2. Concepts
- **Why a new measure:** code metrics (coupling etc., Ch. 6) cannot see outside the code base (databases etc.), but operational characteristics depend on those external dependencies: a performant app on a mismatched database still fails.
- **Connascence (Page-Jones, 1996):** two components are connascent if a change in one requires change in the other to keep the system correct. *Static* (found by static analysis; e.g. two services sharing an Address class) and *dynamic* (runtime): *synchronous* (caller waits for callee) and *asynchronous* (fire-and-forget, as in event-driven). Figure 7-1 adds quantum connascence to the unified coupling diagram (figure not in text).
- **Architecture quantum, parts:** *Independently deployable* (includes everything needed to function, incl. its database; so legacy single-database systems are a quantum of one; microservices each own a database -> many quanta). *High functional cohesion* (does something purposeful; Customer component is cohesive, a Utility grab-bag is not; microservices map to a bounded-context workflow). *Synchronous connascence* (synchronous calls tie caller and callee to similar operational characteristics for the call's duration; a far more scalable caller overwhelms the callee -> timeouts).
- **Payment/Auction example:** Payment handles one payment per 500 ms; many auctions end at once -> synchronous design times out; an asynchronous queue buffers the mismatch, so asynchronous connascence gives flexibility.
- **DDD bounded context:** everything in the domain visible inside, opaque outside; rejects org-wide shared entities (one Customer class) because shared artifacts cause coupling and coordination cost; each domain has its own model and reconciles at integration points.
- **Scope of characteristics = quantum**, letting architects spot hybrids early.
- **Going, Going, Gone kata analysis** (online nationwide auction; hundreds to thousands of bidders per auction; real-time; card charged on win; reputation index; live video and bid stream; ordering of online and live bids; merging with competitors; unconstrained budget; recent fraud lawsuit):
  - Scale/real-time -> scalability, elasticity (implicit: bursts near auction end), performance.
  - Credit card + fraud history -> security (usually hygiene: no plaintext cards, encrypt in transit); but the past fraud suit warrants asking further.
  - Reputation index -> maybe auditability/loggability, but litmus test: does it need domain knowledge to implement (-> domain, ask a business analyst) or is it abstract like elasticity (-> architecture characteristic)?
  - Merging with competitors -> interoperability may tip trade-offs (e.g. protocol choice).
  - No budget constraint -> allows elaborate special-purpose architecture.
  - Live stream + ordering -> availability and reliability are not uniform: the auctioneer's availability matters far more than any one bidder's; reliability includes message ordering/race conditions and data integrity.
  - Quanta found: **Bidder feedback** (bid + video stream): availability, scalability, performance. **Auctioneer**: availability, reliability, scalability, elasticity, performance, security. **Bidder** (online bidding): reliability, availability, scalability, elasticity.

## 3. Pitfalls
- Scoping characteristics system-wide; ignoring external dependencies (database) of operational characteristics; synchronous calls between mismatched services; shared org-wide entities; mistaking domain requirements for architecture characteristics.

## 4. Key terms
- Architecture quantum: independently deployable, functionally cohesive artifact with synchronous coupling.
- Connascence: change in one thing forces change in another (static/dynamic).
- Bounded context: DDD boundary where a model is internally consistent, opaque outside.
- Functional cohesion: unified purpose.
- Implicit characteristic: not stated but implied by the domain (e.g. elasticity for auctions).

## 5. Quotes
- "Architecture quantum: An independently deployable artifact with high functional cohesion and synchronous connascence."
- Synchronous calls create dynamic connascence for the length of the call.

## 6. Relevance to PACE [mine]
PACE is a **quantum of one**: one deployable (Render), one database (Supabase), so every characteristic (availability, scalability, elasticity) has the same scope. That is fine today. Internally, though, there are workloads with visibly different characteristics, the exact signal the chapter says suggests a split later: the **send loop / mailbox sweeps / conversation-intel** (background, throughput and retries matter) vs the **interactive recruiter UI** (latency matters) vs **public pages** `/i/:token`, `/apply/:token` (availability, must never hang on DB). On the free tier a background sweep and an interactive request compete for one instance; the notes in CLAUDE.md (4s bounds on public pages, free-tier instance-hours) are early evidence. Proposed fitness-function-style guards [mine]: keep the three email pipelines separate (already a rule); keep AI calls going through one adapter; consider a future "worker" quantum for the send loop if scale demands. Bounded-context thinking matches the three-pipeline email decision and `candidate_outreach` vs `emails` separation (no shared Customer class). Multi-tenancy by `org_id`/RLS is data-level isolation inside one quantum, not separate quanta.

---
# CHAPTER 8 — Component-Based Thinking

## 1. Core argument
Architects think in components: the physical packaging of modules (jar, dll, gem, npm package, service). Their first big decision is top-level partitioning: by technical capability (layers) or by domain/workflow (modular monolith, microservices). Neither is right, but the industry is trending to domain partitioning because change usually follows workflows. The chapter gives an iterative component-identification cycle, warns against the "entity trap", presents discovery techniques (actor/actions, event storming, workflow) and shows how architecture characteristics can split a component, which determines monolith vs distributed via the number of quanta.

## 2. Concepts
- **Component scope (Fig 8-1/8-2, figures not in text):** library (same address space, function calls, compile-time dependency), subsystem/layer, event-processor deployable unit, service (own address space, TCP/REST/queues). Components are optional: a tiny microservice may not need any.
- **Architect role:** defines, refines, manages, governs components, with BAs, SMEs, developers, QA, ops. Architecture is independent of development process (agile exceptions: deployment and automated governance). Component is the lowest level architects directly touch (apart from code metrics); classes/functions belong to tech leads and developers; don't micromanage or the next generation of architects is never empowered.
- **Top-level partitioning (Fig 8-3/8-4):** *technical* (layered monolith: presentation, business rules, services, persistence; fits MVC; easy to find code by capability; mirrors teams seated by skill per Conway's law) vs *domain* (modular monolith, Simon Brown; DDD-inspired; microservices are based on it). Sub-components may still contain layers.
- **Conway's law:** organisations produce designs that copy their communication structures. **Inverse Conway Maneuver** (Jonny LeRoy): shape teams/org to promote the desired architecture.
- **Technical partitioning pros/cons:** useful decoupling (persistence changes affect only adjacent layers); but workflows like CatalogCheckout smear across all layers (Fig 8-5).
- **Silicon Sandwiches example:** domain version (Purchase, Promotion, MakeOrder, ManageInventory, Recipes, Delivery, Location with customization subcomponents) vs technical version (Common and Local as top-level components). *Domain partitioning* advantages: models how the business works; Inverse Conway cross-functional teams; aligns with modular monolith/microservices; message flow matches domain; easy to migrate data and components to distributed. Disadvantage: customization code in multiple places. *Technical partitioning* advantages: customization separated cleanly; aligns with layered style. Disadvantages: more global coupling (change to Common/Local affects everything); duplicated domain concepts; higher data-level coupling (single DB) making later distribution hard.
- **Developer role:** subdivide components into classes/functions; treat architect's design as a first draft, iterate.
- **Component identification flow (Fig 8-8):** (1) identify initial components (invent them, map functionality; first guess is poor); (2) assign requirements/user stories to components (create, merge, split); (3) analyse roles and responsibilities for granularity; (4) analyse architecture characteristics (e.g. a hundreds-of-users part vs a few-users part should be split even if functionally the same); (5) restructure through feedback with developers. Domains may add steps (security, audit).
- **Granularity:** too fine -> heavy inter-component chatter; too coarse -> high internal coupling, hurting deployability, testability, modularity.
- **Discovery techniques (none superior):** *Entity trap* (anti-pattern): a Manager component per entity = ORM in disguise, workflows ignored, too coarse, gives no guidance; if only CRUD, use Naked Objects / Rails scaffolding instead. *Actor/Actions* (from Rational Unified Process): list actors and actions; good general default, works monolithic or distributed, suits distinct roles. *Event storming* (DDD): determine events and messages, build around handlers; suits messaging/microservices. *Workflow approach*: roles -> workflows -> components, without a messaging assumption.
- **GGG components:** roles = bidder, auctioneer, system. Components: VideoStreamer, BidStreamer (read-only views), BidCapture, BidTracker (system of record), AuctionSession (start/stop, payment, notify), Payment (third party). Characteristics analysis splits BidCapture into BidCapture + AuctioneerCapture (auctioneer needs higher reliability/availability, bidders need scale/elasticity); BidTracker unifies the single auctioneer stream with many bidder streams. Not the one true design; choose the "least worst" trade-offs; don't over-engineer.
- **Quantum redux:** monolith = single deployable, single DB (layered or modular); distributed = multiple services over network, with separate release cadences. If one quantum suffices, monolith has many advantages; if components need differing characteristics (read-only streaming vs high-scale updates; auctioneer vs bidder) -> distributed.

## 3. Pitfalls
- Entity trap; ORM-as-architecture; wrong granularity; technical partitioning that smears workflows; architect micromanaging; treating the first component design as final; over-engineering by hunting the one true design.

## 4. Key terms
- Component: physical packaging of a module.
- Technical vs domain top-level partitioning.
- Modular monolith: one deployable partitioned by domain.
- Conway's law / Inverse Conway Maneuver.
- Entity trap: components = database entities.
- Actor/Actions, event storming, workflow approach: discovery techniques.
- Stamp-free: n/a here.

## 5. Quotes
- "Few software systems have only one way that developers can implement them; every design has different sets of trade-offs."
- Choose "the least worst set of trade-offs" rather than the one true design (paraphrase of the book's wording).

## 6. Relevance to PACE [mine]
PACE is partitioned **by technical capability at the top** (`routes/`, `services/`, `models/`, `public/js/NN-*.js`) with domain sub-folders only in `routes/recruiting/`; this is the "technical partitioning" in Figure 8-4, and the smearing problem is visible (a submission/stage rule touches `33-stage-modal.js`, `services/recruiting-core.js`, routes, models). CLAUDE.md already compensates by naming "one home" per rule (`services/submission-stages.js`, `services/ownership.js`, `ARCHITECTURE.md`), and the nine "territories" are an Inverse Conway Maneuver in spirit. A modular-monolith move (domain folders: sales-leads, recruiting, email, billing, tenancy) is the book's cheapest route to future distribution, and the 4,500-line `index.js` (leads, send loop, follow-ups, sweeps) is an un-partitioned lump suggesting the "send engine" component split. The book's warning on the entity trap applies to `models/` if it only mirrors tables. Fitness-function ideas [mine]: forbid cross-domain imports except through a named public module per domain; fail when `index.js` grows.

---
# PART II intro — Architecture Styles
Style = overarching structure of how UI and backend code are organised (layers in one deployment vs separately deployed services) and how it talks to a datastore. Pattern = lower-level design structure within a style (e.g. how to get scalability/performance). Each style carries a well-known set of trade-offs; architects must know them.

---
# CHAPTER 9 — Foundations

## 1. Core argument
An architecture style name is shorthand for topology plus default architecture characteristics (good and bad), deployment model and data strategy. Before the named styles, the chapter covers fundamental patterns (Big Ball of Mud, unitary, client/server, three-tier) and then splits all styles into monolithic (single deployment unit) and distributed (multiple units over remote protocols). Distributed styles buy performance, scalability and availability but inherit the eight fallacies of distributed computing and extra problems (logging, transactions, contracts) that monoliths avoid. Message: do not go distributed without paying attention to those costs.

## 2. Concepts
- **Big Ball of Mud** (Foote & Yoder, 1997): haphazard, spaghetti, duct-tape structure, information shared promiscuously, repeated expedient repair. Modern form: scripting app with event handlers wired straight to DB calls. Harms change, deployment, testability, scalability, performance. Arises from lack of governance over code quality/structure, rarely intentional. Fig 9-1: coupling visualisation of a real Java code base (circle with every class on the perimeter and heavy connecting lines; figure not in text).
- **Unitary architecture:** software and computer as one entity; today only in embedded/constrained systems; systems grow and need separation of concerns.
- **Client/server (two-tier):** desktop + database server (rich UI, heavy computation on DB server); browser + web server (thin client; still two-tier since web and DB servers are one class of machine); **three-tier** (late 1990s: DB tier, application-server tier, HTML/JS frontend; tied to CORBA/DCOM). Sidebar: Java serialization baked into every Object because three-tier was expected to be eternal; leftover constraint on language evolution. Lesson: long-term consequences of design decisions are hard to foresee; favour simple designs.
- **Monolithic vs distributed:** monolithic = layered (Ch10), pipeline (Ch11), microkernel (Ch12). Distributed = service-based (13), event-driven (14), space-based (15), service-oriented (16), microservices (17).
- **Fallacies of distributed computing** (Deutsch et al., Sun, 1994):
  1. *Network is reliable* - services can be healthy yet unreachable, or the response can be lost; hence timeouts, circuit breakers. More reliance on network (microservices) means less reliability.
  2. *Latency is zero* - local call = nanoseconds/microseconds, remote = milliseconds. Know your average round-trip latency and, more importantly, the 95th-99th percentile ("long tail"). Example: 100 ms per call x 10 chained calls = 1,000 ms; average 60 ms but p95 400 ms.
  3. *Bandwidth is infinite* - splitting a monolith consumes bandwidth. Stamp coupling example: wish-list service needs a customer's name (200 bytes) but the profile service returns 45 attributes, 500 KB; at 2,000 requests/s that's ~1 Gb/s for one call path (book's figures; the text states the fix cuts it to 400 KB). Remedies: private REST endpoints, field selectors, GraphQL, consumer-driven contracts (value-driven), internal messaging endpoints; pass the minimum data.
  4. *Network is secure* - VPNs/firewalls breed complacency; every endpoint of every deployment unit needs securing; attack surface grows by orders of magnitude; per-service security slows synchronous, highly distributed systems.
  5. *Topology never changes* - e.g. a 2 a.m. "minor" network upgrade invalidates latency assumptions, causing timeouts and tripped circuit breakers on Monday; architects must talk constantly to operations/network admins.
  6. *There is only one administrator* - dozens of admins; coordination cost; monoliths avoid it.
  7. *Transport cost is zero* - money, not latency: distributed architectures need more hardware, servers, gateways, firewalls, subnets, proxies. Analyse current capacity, bandwidth, latency and security zones before starting.
  8. *Network is homogeneous* - mixed vendors (Juniper/Cisco) not fully tested together; packets get lost; loops back into fallacies 1-3.
- **Other distributed considerations (out of scope, only listed):** *Distributed logging* (dozens to hundreds of logs, different formats; tools like Splunk consolidate but only scratch the surface). *Distributed transactions* (monoliths enjoy ACID commit/rollback; distributed rely on eventual consistency, trading consistency/integrity for scalability, performance, availability; transactional sagas via event sourcing for compensation or finite state machines; BASE = basic availability, soft state, eventual consistency, a technique not software). *Contract maintenance and versioning* (contract = agreed behaviour and data; hard across teams; version deprecation communication is harder still).

## 3. Pitfalls / anti-patterns
Big Ball of Mud; assuming each of the eight fallacies; stamp coupling; fine-grained services with chatty calls; averages without percentiles; assuming ACID across services; ignoring operational cost of distribution.

## 4. Key terms
- Architecture style vs pattern; topology; monolithic (one deployment unit) vs distributed (many).
- Fallacies of distributed computing; stamp coupling; circuit breaker; long-tail latency.
- Eventual consistency; saga; BASE; ACID.
- Consumer-driven contract: consumers define what they need from a service contract.

## 5. Quotes
- "A Big Ball of Mud is a haphazardly structured, sprawling, sloppy, duct-tape-and-baling-wire, spaghetti-code jungle." (Foote and Yoder, quoted)
- "Latency in any distributed architecture is not zero, yet most architects ignore this fallacy."
- Distributed styles are more powerful in "performance, scalability, and availability" but "have significant trade-offs for this power."

## 6. Relevance to PACE [mine]
PACE is a **monolith talking to one managed Postgres**, so most fallacies bite only at its edges: Supabase (network reliability, latency to DB, per-request p95), Microsoft Graph / Gmail / Apollo / JSearch / OpenRouter (all outbound HTTP). CLAUDE.md already encodes the lessons: all outbound HTTP via `http-client.js` with timeouts, no retry of `POST /me/sendMail`, 4-second DB bounds on public pages (fallacies 1-2), per-org keys and cost counted before call (fallacy 7), "Public pages never hang." Keeping a monolith avoids distributed transactions (ACID in Postgres), distributed logging (one log, Sentry) and contract versioning. Warning for the future: if the send loop is ever split out, eventual consistency and idempotency (double-send guard) become the hard problem, so keep `services/outreach-dedup.js` as the single rule. Fitness-function ideas [mine]: a test that every outbound `fetch`/`axios` call lives in `http-client.js`; a latency budget (p95 per route) logged in Sentry; a stamp-coupling check (API responses do not return whole rows when UI needs a few fields; PACE rule "narrow in SQL" aligns). Big Ball of Mud risk is real for the 4,500-line `index.js`: guard with a line-count ratchet and the `ARCHITECTURE.md` "one home" rule.

---
# CHAPTER 10 — Layered Architecture Style

## 1. Core argument
Layered (n-tier) is the de facto default: simple, familiar, cheap, and it mirrors typical org charts (UI, backend, rules, DBAs) per Conway's law. It is also where teams land by accident ("architecture by implication", "accidental architecture") when nobody picks a style. It separates technical concerns into horizontal layers, which gives isolation of change but smears each business domain across all layers, hurting agility, deployability, testability, scalability and fault tolerance as the application grows. Good starting point and for small/cheap apps; poor for large systems.

## 2. Concepts
- **Topology:** logical horizontal layers; usual four: presentation, business, persistence, database (business and persistence sometimes merged -> three; large apps five or more). Physical variants (Fig 10-2): (1) presentation+business+persistence in one deployment with external database; (2) presentation separate from business+persistence, DB external; (3) all four layers in one deployment, incl. embedded/in-memory DB (many on-prem products).
- **Separation of concerns:** each layer abstracts its work (presentation does not know where data comes from; business does not format for display). Enables role-based expertise but costs overall agility.
- **Technically partitioned:** a domain (e.g. customer) is spread across presentation, business, rules, services and DB layers -> hard to change; DDD fits poorly.
- **Layers of isolation:** changes in one layer should not affect others provided contracts hold. *Closed layer*: request must pass through the layer directly below. *Open layer*: may be bypassed. The "fast-lane reader" (presentation reading DB directly for simple reads) needs open layers but couples layers and makes the system brittle. Isolation lets you replace a layer (e.g. JSF presentation layer -> React.js) with no impact on others, given contracts and the business delegate pattern.
- **Adding layers:** to forbid presentation from using shared business objects (date/string utils, auditing, logging) inside the business layer, add a *services layer* below business, marked **open** so business can use it or skip it. Open/closed rules must be documented and communicated, or the result is tightly coupled brittle architecture hard to test, maintain and deploy.
- **Other considerations:** good starting point when the final style is unknown (common before microservices); keep reuse minimal and inheritance trees shallow so migrating later is easy.
- **Architecture sinkhole anti-pattern:** requests pass through layers as pure pass-through with no logic (simple SELECT travelling presentation -> business -> rules -> persistence -> DB and back), wasting object instantiation, memory, performance. Every layered system has some; measure the percentage. **80-20 rule:** fine if ~20% are sinkholes; if ~80%, the style is wrong (or open the layers, accepting harder change management).
- **Why use:** small/simple apps or websites; very tight budget/time; still analysing requirements; among the lowest-cost styles. As it grows, maintainability, agility, testability, deployability suffer, so large systems may need more modular styles.
- **Characteristic ratings (Fig 10-6 is a star table whose figure is NOT in the text; reconstructed from the prose):** Partitioning: technical. Quanta: 1. Overall cost: 5 stars. Simplicity: 5. Reliability: 3 (no network/latency issues but weak testability/deployment risk). Testability: 2 (mocking/stubbing layers helps; otherwise full-regression reluctance). Performance: 2 (no parallelism, closed layers, sinkholes; fixable with caching/multithreading but not natural). Deployability: low (1; ceremony, risk, a three-line change redeploys everything with bundled changes). Elasticity: 1. Scalability: 1 (single quantum; per-function scaling needs complex threading/internal messaging). Fault tolerance: 1 (one out-of-memory crashes everything; high MTTR, startup 2 to 15+ minutes). Modularity/evolutionary: low (my recollection of the original table is 1; not stated in prose). Availability suffers from MTTR.

## 3. Pitfalls / anti-patterns
Architecture by implication; accidental architecture; architecture sinkhole; undocumented open/closed layers; fast-lane reader coupling; domain smeared across layers; growth without re-evaluation.

## 4. Key terms
- Closed layer / open layer; layers of isolation; fast-lane reader; business delegate; sinkhole; MTTR (mean time to recovery); n-tier.

## 5. Quotes
- Layered is "the de facto standard for most applications, primarily because of its simplicity, familiarity, and low cost."
- "A closed layer means that as a request moves top-down from layer to layer, the request cannot skip any layers."
- The 80-20 rule: acceptable if ~20% of requests are sinkholes, a bad sign if ~80% are.

## 6. Relevance to PACE [mine]
PACE is, in the book's terms, a **layered monolith drifting toward a modular monolith**, a single quantum: browser UI (`public/js/NN-*.js`) -> `routes/*` -> `services/` -> `models/` -> Supabase Postgres. It matches the "physical variant 1" (UI+business+persistence deployed together, external DB). The `models/` rule ("not hand-written `supabase.from()` on tenant tables") is exactly a closed-layer rule; a leak of routes straight to the DB is the "fast-lane reader" the book warns about, and an ArchUnit-style test can enforce it [mine]. `index.js` as a 4,500-line lump holding the sales/lead engine violates the sinkhole/BoM spirit. Ratings fit lived experience: cost and simplicity high (right for a solo owner on free tier), deployability low (any merge to `main` = full release on Render), scalability low (single free-tier instance), fault tolerance low and MTTR relevant (free tier sleeps/cold-starts; CLAUDE.md "row left at 'sending' by a dead process moves at boot" is MTTR mitigation). Sinkhole check [mine]: many CRUD routes may be pass-through; measure the percentage before adding layers. The book's advice to favour layered when "unsure which style" and "tight budget" supports today's choice; its warning that deployability/testability decay with size supports the ~385-test discipline and `--bail` ordering.

---
# CHAPTER 11 — Pipeline Architecture Style

## 1. Core argument
Pipeline (pipes and filters) splits processing into small single-purpose filters connected by one-way pipes. It is the principle behind Unix shells, MapReduce and ETL/EDI tools, and can serve higher-level business apps. It is a simple, cheap, modular monolith (technically partitioned, quantum = 1) with good composability but the usual monolith weaknesses in scalability, elasticity and fault tolerance.

## 2. Concepts
- **Topology:** pipes (unidirectional, usually point-to-point not broadcast, small payloads for speed) and filters (self-contained, independent, generally stateless, one task each; composite tasks = sequence of filters).
- **Four filter types:** *Producer* (source, outbound only), *Transformer* (input -> optionally transform -> output; "map"), *Tester* (tests criteria, optionally emits; like "reduce" per the book), *Consumer* (end; persists to DB or displays).
- **Compositional reuse:** Knuth vs McIlroy anecdote: Knuth's 10+ page Pascal word-frequency program vs McIlroy's six-command shell pipeline (tr, tr, sort, uniq -c, sort -rn, sed).
- **Use cases:** EDI tools, ETL tools, orchestrators/mediators such as Apache Camel.
- **Example (Fig 11-2):** service telemetry streamed to Kafka: Service Info Capture (producer) -> Duration Filter (tester) -> Duration Calculator (transformer) or -> Uptime Filter (tester) -> Uptime Calculator (transformer) -> Database Output (consumer) into MongoDB; data of no interest ends the pipeline. Extensibility: add another tester (e.g. DB connection wait time) after Uptime Filter.
- **Ratings (Fig 11-3 not in text; from prose):** Partitioning technical; Quanta 1. Overall cost 5, simplicity 5, modularity high (about 4; filters replaceable without affecting others). Deployability and testability "around average", slightly above layered (about 2-3 / 3-4; monolith ceremony remains). Reliability 3. Elasticity 1, scalability 1, fault tolerance 1 (one OOM crashes all; MTTR 2 to 15+ min). Performance and evolutionary: not discussed in prose.
- **When to use / not use (derived, the chapter has no explicit section):** use for simple one-way, stepwise data processing (ETL, transformation, telemetry, document conversion), when cost/simplicity matter. Avoid when you need high scalability, elasticity, independent deployment or fault isolation, or processing that is not a linear flow [mine inference].

## 3. Pitfalls
Filters doing more than one task; stateful filters; broadcast/bidirectional pipes (breaks the model); large payloads on pipes; treating a monolithic pipeline as scalable.

## 4. Key terms
- Pipe, filter, producer, transformer, tester, consumer; ETL; EDI; MapReduce; compositional reuse.

## 5. Quotes
- "Filters should perform one task only. Composite tasks should be handled by a sequence of filters rather than a single one."
- Pipes are "typically unidirectional and point-to-point (rather than broadcast) for performance reasons."

## 6. Relevance to PACE [mine]
Several PACE flows are naturally pipelines and are worth keeping that shape: **resume parse -> score/match -> stage into `sourcing_candidates` -> import**; **candidate outreach batch** (select candidates -> render merge fields -> `checkDraft` -> send window gate -> send -> record); **reply sweep -> conversation-intel -> "needs you today" queue**; **send loop** (pending fetch ordered by `send-queue-order.js` -> dedup guard -> render -> send -> `recordSendFailure`). Each stage as one stateless filter with a testable contract matches CLAUDE.md's "rules-first, AI optional" (an AI filter that returns null passes the rules output on). Fitness functions [mine]: each stage module exports one pure function; test that a filter has no DB access except producers/consumers (the "pure, injectable clock" pattern already used by `conversation-intel.js`); an end-to-end characterisation test of each pipeline with fake db. The pipeline style does not change PACE's single-quantum limits.

---
# CHAPTER 12 — Microkernel Architecture Style

## 1. Core argument
Microkernel (plug-in) architecture splits a system into a minimal core (the happy-path process) and independent plug-ins that hold variable, volatile or customer-specific behaviour. It gives extensibility, isolation and a lower cyclomatic complexity in the core, is natural for products (IDEs, browsers, Jira, Jenkins) but also for big business apps (insurance claims by jurisdiction, tax forms). It is usually monolithic (quantum = 1), so cheap and simple but limited in scalability and fault tolerance; remote plug-ins gain decoupling at the cost of becoming distributed.

## 2. Concepts
- **Topology:** core system + plug-in components. Core = minimal functionality to run (Eclipse = basic text editor) or the happy path with custom processing stripped out. Example: device-recycling assessment; a long `if/else` over device IDs (high CC) is replaced by registry lookup + reflective invocation of a per-device plug-in; adding a device = add plug-in + registry entry.
- **Core system shapes (Fig 12-2/12-3):** layered or modular monolith; or split into separately deployed domain services each with its own plug-ins (e.g. Payment Processing core with credit card, PayPal, store credit, gift card, purchase order plug-ins). Typically one shared database. UI can be embedded or separate (and itself a microkernel).
- **Plug-ins:** standalone, independent, ideally no inter-plug-in dependencies; isolate highly volatile code. Communication usually point-to-point (function/method call to entry class). *Compile-based* (simple; redeploy whole app on change) vs *runtime-based* (add/remove without redeploy; OSGi, Penrose, Jigsaw, Prism). Implementation: shared libraries (JAR/DLL/Gem) or packages/namespaces; recommended naming `app.plug-in.<domain>.<context>` e.g. `app.plugin.assessment.iphone6s`.
- **Remote plug-ins:** via REST or messaging, each plug-in a service; gains decoupling, scalability/throughput, runtime change without special frameworks, async user-responsiveness; costs: becomes distributed, harder for third-party on-prem products, more complexity/cost, plug-in down = request fails. Still one quantum because every request goes through the core. Decide by trade-off analysis.
- **Data:** plug-ins normally do not touch the shared DB; the core passes data in (so DB change only impacts the core). Plug-ins may own separate stores (external or embedded).
- **Registry:** core's list of available plug-ins (name, data contract, access protocol); can be a simple in-core map (key -> plug-in ref, queue name or URL) or a discovery tool (ZooKeeper, Consul).
- **Contracts:** usually standard across a plug-in domain (behaviour, input, output); for third-party plug-ins write an adapter so the core has no per-plug-in code. Formats XML/JSON/objects. Example interface: `assess()`, `register()`, `deregister()` returning an output object (report string, resell flag, value, resell price). Responsibility split: the core does not understand the report, only displays it.
- **Examples:** Eclipse, PMD, Jira, Jenkins, Chrome/Firefox; insurance claims (jurisdiction rules as plug-ins instead of a giant rules engine that becomes a ball of mud; core = standard claim filing and processing); tax software (form 1040 as the core, other forms/worksheets as plug-ins so tax law changes stay isolated).
- **Ratings (Fig 12-8 not in text; from prose):** Partitioning: technical (unique in that it can be domain- AND technically partitioned, by strong domain-to-architecture isomorphism, e.g. per-location/per-client configuration or user-customisation products). Quanta: 1. Simplicity and overall cost: strengths. Scalability, fault tolerance, elasticity: weaknesses (1 star; monolith). Testability, deployability, reliability: 3 stars. Modularity and extensibility: 3 stars. Performance: 3 stars (small, little sinkhole; can unplug unneeded features, e.g. Wildfly/JBoss dropping clustering, caching, messaging). Simplicity roughly 4 (my recollection). Evolutionary: 3 (my recollection).
- **When to use (inferred from the text):** products with extensibility/customisation, per-client or per-jurisdiction variation, stable core + volatile edges, complex rule sets that need isolation. **Avoid** when you need independent scale/fault tolerance of features or highly interdependent features that cannot be isolated [mine inference].

## 3. Pitfalls
Plug-ins depending on each other; plug-ins reaching the shared DB; per-plug-in special code in the core (no adapter); switching to remote plug-ins and expecting it to be a microservices-grade scalable system (still one quantum); a giant rules engine that becomes a big ball of mud.

## 4. Key terms
- Core system; plug-in; registry; contract; adapter; runtime vs compile-based plug-in; OSGi; isomorphism (domain shape matches architecture shape).

## 5. Quotes
- The core system is "the minimal functionality required to run the system."
- Removing the cyclomatic complexity of the core and placing it in separate plug-ins allows "better extensibility and maintainability, as well as increased testability."
- Microkernel "is the only architecture style that can be both domain partitioned and technically partitioned."

## 6. Relevance to PACE [mine]
This is the style PACE should grow *toward* for its biggest long-term needs, because the product is sold to many customers who each need variation: **per-organisation configuration** (customer name in cold-email templates and resume letterhead, per-org keys, plans, `SETTINGS_SCHEMA`), **provider-neutral contact-data layer** (D-0175/R-321: Apollo, ZoomInfo, Lusha as plug-ins behind one contract with an adapter, a registry and no vendor hard-wired), **job sources** (JSearch, other boards), **AI providers** (`ai-provider.js` already a single adapter), **mailbox providers** (Outlook, Gmail behind one sweep/send contract), **sourcing channels** (`config/sourcing.js` built vs available) and **stage/workflow variants per org**. The pattern: small stable core (send loop, ownership, scoping, billing) + plug-ins registered in a map (`config/sourcing.js` already resembles a registry). Rules from the chapter that match PACE rules: plug-ins do not touch the DB (the core passes data in, equal to "use `models/`"), contract + adapter (provider-neutral layer), `register/deregister`. Fitness functions [mine]: a contract test that every registered provider implements the interface and returns the standard output shape; a test that no vendor name appears in UI strings (already a rule: "names no vendor on screen"); a test that plug-in modules import nothing from sibling plug-ins and nothing from `models/`. Quanta stay at 1 unless plug-ins go remote.

---
# STYLE COMPARISON QUICK TABLE (from slice; star values partly reconstructed [mine from prose/recall], figures absent)
| Style | Partitioning | Quanta | Strengths | Weaknesses |
|---|---|---|---|---|
| Layered | technical | 1 | cost 5, simplicity 5 | deploy 1, test 2, perf 2, scale 1, elastic 1, fault 1 |
| Pipeline | technical | 1 | cost 5, simplicity 5, modularity ~4 | scale 1, elastic 1, fault 1 |
| Microkernel | technical and/or domain | 1 | cost, simplicity, extensibility ~3, perf 3 | scale 1, fault 1, elastic 1 |

# PACE TODAY, IN ONE LINE [mine]
A single-quantum layered monolith (Node/Express + Supabase), partitioned technically, with microkernel-like seams (AI provider, mailbox, sourcing) and pipeline-like flows (send loop, parse->stage->import, reply sweep). Candidate fitness functions: (1) import-graph layer rules, (2) madge circular check, (3) `index.js` size/complexity ratchet, (4) all outbound HTTP via `http-client.js`, (5) all tenant tables in `models/tables.js` + RLS, (6) plug-in contract conformance for providers, (7) p95 latency budget on key routes, (8) no vendor names in UI strings. Most of this already exists informally as smoke tests; the book's contribution is the framing: run them in CI as the guard for important-not-urgent structure.

# Coverage
Read lines 1-2391 of fosa-2-ch06-12.txt (entire file) in 5 chunks. Chapters: 6, 7, 8, Part II intro, 9, 10, 11, 12. Missing/garbled: all figures (6-1 to 6-4, 7-1, 8-1 to 8-11, 9-1 to 9-9, 10-1 to 10-6, 11-1 to 11-3, 12-1 to 12-8) are absent, including the three star-rating tables (Figs 10-6, 11-3, 12-8), so ratings are reconstructed from the prose and flagged. Chapters 10-12 in this text have no explicit "when to use / not to use" subsection beyond ch.10's "Why Use This Architecture Style"; the ch.11/12 items are my inferences and marked. Code samples (JDepend, ArchUnit, NetArchTest, Java) appear mildly garbled by extraction (e.g. a missing opening brace in the assessDevice else-if, "DevicePlugin.assess()") but are legible. The slice ends cleanly at the end of Ch. 12 (page 161).
