# Fundamentals of Software Architecture (Richards & Ford, 2020) — Notes, slice 1: front matter, Ch 1-5

(Praise pages, copyright, TOC, acknowledgments, O'Reilly boilerplate skimmed only. TOC is useful as a map of the whole book: Part I Foundations ch2-8, Part II Styles ch9-18, Part III Techniques/soft skills ch19-24.)

## Preface: Invalidating Axioms
- Core: Architecture rests on "axioms" that keep changing because the software ecosystem is in "dynamic equilibrium" (small change -> small change -> new ecosystem; example: containers/Kubernetes). Architects must regularly question inherited assumptions. Old tongue-in-cheek definition: "the stuff that's hard to change later"; microservices made change a first-class design concern.
- Subtitle "An Engineering Approach": move from craft toward repeatability, rigor, analysis; Agile engineering practices (XP -> Continuous Delivery -> DevOps -> containers -> cloud) are what made the progress.
- Stance: eliminate value judgments about technologies; analyse trade-offs. "Everything is a trade-off", no binary choices.
- Book does not make you an architect overnight; covers structure to soft skills.

## Chapter 1: Introduction
**Core argument.** There is no agreed definition of software architecture or of the architect role, because the field keeps moving, the role keeps expanding (now touches ops, process, data, engineering practice), much old material is historical, and every architecture is a product of its context (e.g. microservices were unaffordable in 2002 when each service needed paid OS/app-server/DB licences; open source + DevOps made them feasible). Instead of defining the role they define architecture as four things (structure, characteristics, decisions, principles) and list eight expectations of an architect. Two laws are introduced: everything is a trade-off, and why matters more than how.

### Defining Software Architecture
- Architecture = **structure** (the style(s): layered, microservices, microkernel) + **architecture characteristics** ("-ilities", the success criteria, orthogonal to functionality) + **architecture decisions** (hard rules, constraints; e.g. only business/services layers may touch the DB) + **design principles** (guidelines, not rules; e.g. prefer async messaging between services, but a dev may pick REST/gRPC when justified).
- Saying "it's microservices" describes only structure, not the architecture.
- **Variance**: a formal exception to a decision, analysed by an architecture review board (ARB) or chief architect, approved/denied on justification and trade-offs.
- Decision vs principle: a decision cannot cover every case, so principle gives preferred direction while leaving room.

### Expectations of an Architect (eight, regardless of title)
1. **Make architecture decisions** — guide, don't specify technology. Say "use a reactive frontend framework" (guides the choice among React/Vue/Angular), not "use React" (that's a technical decision). Test: does the decision guide the team's choice or make it for them? Exception: sometimes a specific technology must be named to preserve a characteristic (scalability etc.); still architectural. (Ch 19.)
2. **Continually analyze the architecture** — "architecture vitality": is the architecture defined 3+ years ago still viable given business and tech change? Most architectures suffer **structural decay** when developer changes degrade performance/availability/scalability. Also forgotten: test and release environments (code agility is moot if tests take weeks and releases months).
3. **Keep current with trends** — architect decisions are long-lasting and hard to change (Ch 24).
4. **Ensure compliance** — continually verify teams follow decisions/principles. Example: closed layers exist to control change (DB changes won't hit presentation layer); a UI dev bypassing them "for performance" breaks that. Automate via fitness functions (Ch 6).
5. **Diverse exposure and experience** — breadth over depth; know ~10 caching products' pros/cons rather than expert in one; stretch the comfort zone; heterogeneous environments.
6. **Business domain knowledge** — without the domain's vocabulary an architect loses credibility; best architects pair broad technical knowledge with deep domain knowledge to talk to C-level.
7. **Interpersonal skills** — teamwork, facilitation, leadership; Weinberg: "it's always a people problem"; leadership is at least half the job.
8. **Understand and navigate politics** — nearly every architect decision is challenged (by product owners, PMs, business over cost/time, developers who prefer their way), unlike a developer choosing the strategy pattern. Example: CRM architect creating "application silos" (each DB only reachable via its owning app, others use REST/SOAP) is challenged by everyone. Negotiation is a core skill (Ch 23).

### Intersection of Architecture and…
- **History aside — Pets.com and elastic scale:** the sock-puppet-mascot company spent on marketing, not infrastructure; Christmas rush -> slow site, lost transactions, late deliveries; business closed; "too much success can kill the business". Lesson: elastic scale (spin up more instances on demand) was born of such failures; clouds now sell it as a commodity.
- **Engineering practices vs process:** process = how teams are formed/managed, meetings, workflow (Waterfall, Scrum, XP, Lean...); engineering practices = process-agnostic repeatable practices (continuous integration). XP (Kent Beck, 1996) took practices that correlated with success "to the extreme" (test-first); led to Continuous Delivery and DevOps (ops adopting automation, testing, declarative single source of truth).
- Software lags civil engineering in predicting structural change; **estimation** is its Achilles heel, partly because of **unknown unknowns** (Rumsfeld quote). Hence Big Design Up Front fails; Mark: "All architectures become iterative because of unknown unknowns, Agile just recognizes this and does it sooner."
- Architecture style and engineering practice must form a "symbiotic mesh": microservices assumes automated provisioning, testing and deployment; building it with manual ops and little testing creates friction.
- **Evolutionary architecture & fitness functions** (from Ford's Building Evolutionary Architectures): a fitness function is an objective integrity assessment of an architectural characteristic (metrics, unit tests, monitors, chaos engineering). Origin: genetic algorithms (e.g. path length for travelling salesperson). Example: a test measuring page load time per page run in CI so the system can change without degrading performance. Frequency of execution correlates with feedback quality.
- **Operations/DevOps:** 1990s-2000s architectures assumed ops was outsourced and uncontrollable, so they defensively built scale/elasticity/performance into the architecture (e.g. ESB-driven SOA, space-based architecture) = vastly more complex ("accidental complexity"). Microservices builders created a liaison with ops and let ops handle what it handles best.
- **Process:** architecture historically treated as orthogonal to process; in fact Agile gives faster feedback, so architects can experiment more aggressively. Authors assume Agile baseline. Agile is especially good for **restructuring** (e.g. monolith -> modern architecture) via tight feedback, **Strangler Pattern** and **feature toggles**.
- **Data:** serious apps have external storage; code and data are symbiotic; DBAs work with architects on data architecture; the book includes databases within the operational "architectural quantum" (Ch 7).

### Laws of Software Architecture
- **First Law:** Everything in software architecture is a trade-off. Corollary 1: if you think you found something that isn't a trade-off, you just haven't identified the trade-off yet.
- **Second Law:** Why is more important than how. (Anecdote: workshop exercises kept only topology diagrams, losing the "why".) Capture why via Architecture Decision Records (Ch 19).

**Pitfalls named:** defining architecture only by structure; static view of architecture ("solve once"); relying on outdated material; defensive design around ops constraints (accidental complexity); Big Design Up Front; architect specifying technologies instead of guiding; ignoring test/release agility; not enforcing compliance.
**Key terms:** architecture characteristics ("-ilities"); architecture decision; design principle; variance; ARB; architecture vitality; structural decay; process vs engineering practice; unknown unknowns; fitness function; elastic scale; Strangler Pattern; feature toggle.
**Quotes:** "Everything in software architecture is a trade-off." / "Why is more important than how." / "All architectures become iterative because of unknown unknowns, Agile just recognizes this and does it sooner."
**Relevance to PACE:**
- Now: PACE's CLAUDE.md already encodes architecture decisions (rules) vs principles; the book's definition (structure + characteristics + decisions + principles) maps neatly: structure = Node monolith + routes/services/models; characteristics = multi-tenancy isolation, deliverability, cost; decisions = "Rules that must never be softened"; principles = "Build philosophy: spend nothing now". (My mapping.)
- Second Law is exactly the DECISIONS.md habit ("written the moment it is decided"); keep it.
- Fitness functions = PACE's guard tests (`route-shadowing-smoke`, `admin-numbers-smoke`, `page-renders-smoke`). Book supports continuing to automate each rule as a test run in CI.
- "Guide, don't specify" is relevant to how the owner instructs the AI builder: state the characteristic needed, let builder pick tech. Also an AI builder must not decay structure (index.js at 4,500 lines is structural decay candidate; ARCHITECTURE.md's "one home" is the antidote).
- Strangler pattern + feature toggles fit PACE's staged moves (e.g. SELF_SERVE_SIGNUP OFF, payments OFF; Apollo -> provider-neutral layer R-321). Later.
- Pets.com: "too much success can kill the business" ties to free-tier Render limits and per-org caps; elastic scale is not needed now. Never: building a distributed/elastic design speculatively.
- Politics/negotiation: only the owner's stakeholders (customers) matter; low relevance now.

## Chapter 2: Architectural Thinking
**Core argument.** Thinking like an architect has four aspects: seeing architecture and design as one continuous, bidirectional collaboration with developers; favouring technical breadth over depth; analysing trade-offs rather than looking for right answers ("it depends"); and translating business drivers into architecture characteristics. It also advises architects to stay hands-on without becoming a bottleneck.

### Architecture versus Design
- Traditional model: architect picks characteristics, styles, components and hands off one-way to developers (class diagrams, UI, code). The one-way arrow through physical/virtual barriers is "why architecture rarely works": decisions never reach developers and developers' changes never return.
- Fix: break barriers, make a strong bidirectional relationship, architect and developers on the same virtual team (also enables mentoring). Today's architecture changes every iteration. "Where does architecture end and design begin? It doesn't."

### Technical Breadth
- Knowledge pyramid: **stuff you know** (top), **stuff you know you don't know** (middle), **stuff you don't know you don't know** (bottom, largest). Developers early on grow the top (depth), and top needs maintenance (Rails expertise fades in 1-2 years). Architects should instead widen the top+middle and push the middle into the bottom: **technical breadth** = how much you know exist; **technical depth** = what you know deeply. Better to know five solutions for a problem than be expert in one. Sacrifice some hard-won expertise to broaden.
- Dysfunctions: trying to keep expertise in everything (ragged, success in none); **stale expertise** (outdated knowledge felt as cutting edge — founders turned leaders using ancient criteria).
- **Frozen Caveman Anti-Pattern:** architect reverts to a pet irrational concern in every design (anecdote: "But what if we lose Italy?" after one freak outage). Cause: being burned before. Remedy: distinguish genuine from perceived risk.

### Analyzing Trade-Offs
- "Architecture is the stuff you can't Google" (Mark). "There are no right or wrong answers in architecture—only trade-offs" (Neal). "It depends" = deployment environment, business drivers, culture, budget, time, skills...
- **Worked example — auction system:** Bid Producer sends bids to Bid Capture, Bid Tracking, Bid Analytics. Option A, **topic (pub/sub)**; Option B, **queues (point-to-point)**.
  - Topic advantages: extensibility (add a Bid History service by just subscribing, no change to producer), producer more decoupled (doesn't know consumers).
  - Topic disadvantages: data access/security (anyone can subscribe; easy to wiretap, whereas a queue wiretap would starve the legit consumer and trigger an alert); only homogeneous contracts (a consumer needing extra data like asking price forces a contract change for all); can't monitor/auto-scale per consumer (queues can; AMQP separates exchange from queue — technology-specific).
  - Queue: opposite profile. Answer: "It depends" on whether extensibility or security matters more.
- Rich Hickey quote: programmers know benefits of everything and trade-offs of nothing; architects need both.

### Understanding Business Drivers
- Translate success needs of business into characteristics (scalability, performance, availability); requires domain knowledge and good stakeholder relationships. Ch 4 defines, Ch 5 identifies, Ch 6 measures them.

### Balancing Architecture and Hands-On Coding
- Every architect should code and keep some technical depth.
- **Bottleneck trap:** architect owns critical-path/framework code but is part-time on code (meetings, diagrams) and blocks the team. Avoid: delegate the critical path/framework code and code a business feature 1-3 iterations ahead — hands-on, no bottleneck, team owns hard parts, architect shares team's pain.
- If can't code with team: (1) frequent **proofs of concept**, written as production quality (throwaway POC code becomes the reference example); e.g. build same thing in two caching products and compare; (2) take **technical-debt / architecture stories** (low priority, safe to slip); (3) fix bugs (reveals weak spots); (4) automate: command-line tools, analyzers, source validators, checklists, fitness functions (e.g. ArchUnit in Java); (5) frequent **code reviews** (compliance, mentoring).

**Pitfalls:** one-way hand-off; stale expertise; spreading depth everywhere; Frozen Caveman; bottleneck trap; throwaway POC code reused as reference.
**Key terms:** technical breadth/depth; knowledge pyramid; topic vs queue; bottleneck trap; POC; ArchUnit.
**Quotes:** "Architecture is the stuff you can't Google." / "There are no right or wrong answers in architecture—only trade-offs." / "Programmers know the benefits of everything and the trade-offs of nothing. Architects need to understand both."
**Relevance to PACE:**
- Now: the owner (non-engineer) + AI builder is the extreme case of the bidirectional-collaboration point: the CLAUDE.md/DECISIONS.md/CONTEXT_WINDOW.md memory is the "no one-way hand-off" mechanism. Keep decisions flowing back into docs.
- Trade-off thinking (topic vs queue) mirrors PACE's three email pipelines kept separate (extensibility vs coupling) and rules-first AI vs funded AI. Always record the opposite-side cost, as the book does. Hickey's quote is a good checklist item for every AI-suggested "obvious best" choice (mine).
- Frozen Caveman: PACE's rules each "paid for with an incident"; watch that incident-driven rules don't harden into obsession over unlikely cases (my caution).
- Bottleneck trap: the AI builder is the sole coder; risk is a single 4,500-line index.js owned in one place; keep delegating logic to services/ (my suggestion).
- POC production-quality: relevant when AI builder prototypes (e.g. contact-data provider spike R-321) — POC code that lands in main becomes the pattern.
- Later: team/political aspects not relevant until staff are hired. Never: the architect-vs-developer organisational split.

## Chapter 3: Modularity
**Core argument.** Modularity (logical grouping of related code) is an organising principle that doesn't happen by accident — software tends toward entropy, so architects must expend energy to preserve order. It is an implicit characteristic (nobody asks for it, but sustainable code needs it). Three measurement concepts: cohesion (do parts belong together), coupling (how connected modules are, incoming/outgoing), and connascence (a finer-grained taxonomy of coupling with strength, locality and degree). Metrics are blunt and need interpretation.

### Definition
- Module = standardised, independent unit for building complex structures; here a *logical* grouping (classes or functions), not necessarily physical. Packaging mechanisms vary (Java package, .NET namespace); architects must know them because tight coupling between packages blocks reuse and later splitting of a monolith ("lumping" classes together is convenient but loose partitioning hurts when restructuring).
- Sidebar history: Dijkstra's 1968 "Go To Statement Considered Harmful" -> structured programming (Pascal, C) -> brief modular languages (Modula, Ada) -> OO languages retained modules as packages/namespaces.
- Sidebar Java 1.0: package = directory structure to avoid name clashes (classpath of directories only); Java 1.2 added JARs, which broke the guarantee and caused years of classpath/class-loader pain.
- Myers (1978): 95% of words about modularity extol it, little says how to achieve it.

### Measuring modularity
**Cohesion** (how related the parts of a module are). Constantine: dividing a truly cohesive module only increases coupling and lowers readability. Seven kinds, best to worst:
 functional (everything related and essential), sequential (one's output feeds the next), communicational (chain operating on same info, e.g. add record then email about it), procedural (must execute in an order), temporal (timing, e.g. startup initialisation list), logical (related by category, different functions, e.g. StringUtils), coincidental (only same file; worst).
- Cohesion is subjective/imprecise: Customer Maintenance vs splitting out Order Maintenance (get/cancel customer orders). Decide by: are those the only two operations (then merge back)? Will Customer Maintenance grow (extract)? Would separation force heavy coupling because Order needs lots of Customer knowledge (don't split)? = trade-off analysis.
- **LCOM (Lack of Cohesion in Methods)**, from Chidamber & Kemerer OO metrics suite: sum of sets of methods not sharing fields. Class with fields a and b where methods use only a or only b scores high LCOM (poor cohesion; could be split). Fig 3-1: Class X low, Class Y high (each field/method pair could be its own class), Class Z mixed. Useful when migrating styles: finds shared utility classes that are incidentally coupled. Limit: purely structural; can't tell if pieces logically fit (Second Law: why over how). (Equations garbled in extraction; prose used.)

**Coupling.** Method calls form a call graph so graph-theory analysis is possible. Yourdon & Constantine (1979, Structured Design): **afferent coupling (Ca) = incoming connections** to a code artifact; **efferent coupling (Ce) = outgoing**. Mnemonics: a before e = incoming before outgoing; e in efferent = exit. Tools exist for most platforms.

**Abstractness, instability, distance from the main sequence** (Robert Martin, C++ book):
- **Abstractness A** = sum abstract artifacts (interfaces/abstract classes) / sum concrete. Example: 5,000-line single main() -> ~0. Too many abstractions (AbstractSingletonProxyFactoryBean) is the opposite problem.
- **Instability I = Ce / (Ce + Ca)**: volatility; high I means breaks easily on change (a class that delegates to many others).
- **Distance from the main sequence D = |A + I − 1|**: both in 0..1; the ideal line balances A and I. Near the line = balanced. Upper-right corner = **zone of uselessness** (too abstract, hard to use); lower-left = **zone of pain** (too concrete, brittle, hard to maintain). Used for analysing unfamiliar code, migration, technical-debt assessment.
- **Limitations of metrics:** blunt compared with other engineering; require interpretation (e.g. cyclomatic complexity can't tell essential from accidental complexity). Establish baselines and test via fitness functions (Ch 6). Yourdon/Constantine's other coupling types are omitted because connascence supplanted them.

**Connascence** (Meilir Page-Jones, 1996): "Two components are connascent if a change in one would require the other to be modified in order to maintain the overall correctness of the system."
- *Static* (source level): **Name** (agree on a name — most desirable, refactoring tools handle it), **Type** (agree on type), **Meaning/Convention** (agree on meaning of values; magic numbers, TRUE=1), **Position** (order of values, e.g. updateSeat("14D","Ford, N") swapped args), **Algorithm** (e.g. client and server hashing algorithms must match).
- *Dynamic* (runtime): **Execution** (order of calls, e.g. email.send() before setSubject), **Timing** (race conditions), **Values** (several values change together; rectangle corners; multi-database transactions must all change or none), **Identity** (components share/update the same entity, e.g. a distributed queue).
- Dynamic is harder to analyse (no call-graph tool equivalent).
- **Properties:** *Strength* = ease of refactoring; refactor toward weaker forms (e.g. magic value (Meaning) -> named constant (Name)); prefer static to dynamic. *Locality* = proximity; stronger connascence is tolerable within a module, worse across modules. *Degree* = how many things affected (small now, grows as code grows).
- Page-Jones guidelines: minimise overall connascence by breaking system into encapsulated elements; minimise what crosses encapsulation boundaries; maximise connascence inside boundaries. Jim Weirich: **Rule of Degree** (convert strong forms to weaker) and **Rule of Locality** (as distance grows, use weaker forms).
- **Unifying:** static connascence = refined afferent/efferent coupling (structured programming only cared in/out; connascence cares how). Dynamic connascence was not addressed by structured programming; book returns to it via architectural quanta (Ch 7).
- **Problems with 1990s connascence:** works at low code level (hygiene), whereas architects care about how modules couple (sync vs async) and the sync/async decision in distributed architectures isn't addressed; fixed in Ch 7.

### From Modules to Components
- "Module" is generic; component is the key building block. Deriving components from the problem domain is Ch 8, but first need characteristics and their scope.

**Pitfalls:** shared utility classes with incidental coupling; logical/coincidental cohesion (StringUtils); magic values; positional args; order-dependent calls; over-abstraction and zero abstraction; metric worship without interpretation; assuming modularity arrives by itself.
**Key terms:** module; cohesion types; LCOM; afferent/efferent coupling; abstractness; instability; main sequence; zone of pain/uselessness; connascence (name/type/meaning/position/algorithm/execution/timing/values/identity); strength/locality/degree.
**Quotes:** "95% of the words [about software architecture] are spent extolling the benefits of 'modularity' and that little, if anything, is said about how to achieve it." (Myers) / "Attempting to divide a cohesive module would only result in increased coupling and decreased readability." (Constantine) / Page-Jones' connascence definition above.
**Relevance to PACE:**
- Now, high value: the 4,500-line `index.js` is a candidate "zone of pain" (very concrete, no abstraction) and likely coincidental/temporal cohesion (lead engine + send loop + sweeps + boot tasks together). CLAUDE.md already moves toward functional cohesion ("one home" per rule: services/ownership.js, services/plans.js, submission-stages.js). The book supports continuing to extract by cohesion, not by file size. LCOM-style/afferent-efferent measures can be run cheaply (e.g. a script counting require() in/out per service) — my suggestion.
- Connascence examples map to real PACE rules: Meaning/Convention = stage names across `33-stage-modal.js` and `recruiting-core.js` (the "one home" for the 11 stages; `normalizeStage()`); Name = `window.atsReloadCandidates` named globals; Position = merge-field order; Algorithm = renderStoredEmail/VAR_SYNONYMS must agree between save and send; Execution/Timing = send loop vs reply sweep, 'sending' rows left by dead processes; Identity/Values = Gmail thread id belongs to one mailbox; org_id across tables; Rule of Locality supports keeping strong coupling inside a service and only named, weak (Name) coupling across folders.
- Frontend: plain scripts loaded in order with global `window.*` is connascence of Execution (load order) and Name; acceptable at this size, worth noting as the reason registration-order bugs occurred (route shadowing).
- Later: automated coupling reports as a guard. Never: chasing numeric main-sequence targets; PACE isn't OO-heavy (JS modules), so use idea not formulas.

## Chapter 4: Architecture Characteristics Defined
**Core argument.** A solution = domain requirements + architecture characteristics. Characteristics are the "-ilities" that are not domain functionality but decide success. The authors reject "nonfunctional requirements" (self-denigrating, hard to get attention) and "quality attributes" (implies after-the-fact assessment). A characteristic must meet three criteria. Supporting each one adds complexity and they pull against each other, so architects pick the fewest, aiming for the "least worst" architecture, not the best.

### Definition (three criteria)
1. **Specifies a nondomain design consideration** (how/why, not what; e.g. performance level, "prevent technical debt" never appears in requirements).
2. **Influences some structural aspect of the design** — security is baseline everywhere, but becomes an architecture characteristic only when special structure is needed. Example: third-party payment processor = standard hygiene (encryption, hashing), no special structure; in-application payment processing = may need a dedicated module/component/service to isolate security structurally. Past incidents and integration nature also matter.
3. **Critical or important to application success** — choose the fewest, not the most.
- **Explicit** (in requirements) vs **implicit** (rarely written yet necessary: availability, reliability, security; e.g. a high-frequency trading architect knows low latency matters). Architects uncover implicit ones using domain knowledge during analysis.
- Triangle figure: the three elements support each other; the fulcrum shows characteristics interact -> trade-offs.

### Characteristics (partially) listed — no universal standard; each organisation interprets terms
- **Operational** (overlap with ops/DevOps): availability (how long must it be up; 24/7 needs fast-recovery steps), continuity (disaster recovery), performance (stress testing, peak analysis, frequency of function use, capacity, response times; acceptance may take months), recoverability (business continuity, drives backup strategy and duplicated hardware), reliability/safety (fail-safe? life-critical? costly if fails), robustness (error and boundary conditions: network down, power outage, hardware failure), scalability (performance as users/requests rise).
- **Structural** (code quality concerns): configurability (end users change config via usable interfaces), extensibility (plug in new functionality), installability, leverageability/reuse (common components across products), localization (languages, multibyte, units, currencies), maintainability (ease of change/enhancement), portability (more than one platform), supportability (support level, logging, debug facilities), upgradeability (version upgrade ease on servers and clients).
- **Cross-cutting:** accessibility (e.g. colour blindness, hearing loss), archivability (archive/delete after a period, e.g. accounts deleted after three months), authentication, authorization (by use case, subsystem, page, rule, field), legal (data protection, Sarbanes-Oxley, GDPR, regulations on how it is built/deployed), privacy (hide transactions even from internal staff/DBAs via encryption), security (encryption at rest and in transit, remote-access authentication), supportability, usability/achievability (training needed; treat as seriously as other architecture issues).
- **"Italy-ility" sidebar:** client demanding a centralised architecture kept asking "what if we lose Italy?" (past outage); team coined Italy-ility = availability + recoverability + resilience — shows any system can invent its own characteristic.
- **Ambiguity:** interoperability (ease of integration; implies published documented APIs) vs compatibility (industry/domain standards); learnability (users learn it vs system learns its environment); availability vs reliability overlap yet differ (UDP is available but not reliable).
- **ISO list** (incomplete, overlapping): performance efficiency (time behaviour, resource utilisation, capacity); compatibility (coexistence, interoperability); usability (appropriateness recognizability, learnability, user error protection, accessibility); reliability (maturity, availability, fault tolerance, recoverability); security (confidentiality, integrity, nonrepudiation, accountability, authenticity); maintainability (modularity, reusability, analyzability, modifiability, testability); portability (adaptability, installability, replaceability). The authors exclude ISO's **functional suitability** (completeness, correctness, appropriateness): those are the motivation to build the software, not architecture characteristics.
- **Ambiguities sidebar:** the industry has no clear definitions; advice from domain-driven design — establish a **ubiquitous language** inside the organisation to avoid term misunderstandings.

### Trade-Offs and Least Worst Architecture
- Only a few characteristics can be supported: each costs design effort and each affects others (security vs performance: more encryption, indirection). Metaphor: helicopter flying — a control for each hand and foot, changing one affects the rest.
- "Never shoot for the best architecture, but rather the least worst architecture." Too many characteristics -> generic, unwieldy solutions. Therefore make architecture as **iterative** as possible so you needn't get it right the first time.

**Pitfalls:** "nonfunctional" naming; supporting every characteristic; treating ISO list as authoritative; vague terms used inconsistently.
**Key terms:** architecture characteristic; explicit/implicit; operational/structural/cross-cutting; Italy-ility; ubiquitous language; least worst architecture.
**Quotes:** "Never shoot for the best architecture, but rather the least worst architecture." / (criteria) specifies a nondomain design consideration; influences some structural aspect of the design; is critical or important to application success.
**Relevance to PACE:**
- Now: PACE already has de facto characteristics, many unnamed. My candidate short list for a multi-tenant recruiting SaaS: (1) tenant isolation / privacy-security (RLS, org_id, who-sees-what), (2) deliverability and send correctness (email pipelines, retries, dedup), (3) cost-efficiency on free tier ("spend nothing now"), (4) maintainability for a solo owner + AI builder (explicit "one home" rule). Others (elasticity, scalability) are deliberately not top. Naming 3 and writing them in ARCHITECTURE.md would make trade-offs explicit (my suggestion).
- In-application vs third-party payment example maps to billing: PACE uses signed webhook, payments OFF; keep card handling with the processor (no special structure) — matches the book.
- Security vs performance and Italy-ility: PACE's own "customer brings own keys" (D-0055) and admin-chosen limits (D-0123) are configurability + multi-tenancy characteristics; "a limit not enforced is a claim" is a fitness-function mindset.
- Archivability/privacy/legal (GDPR, India DPDP) are relevant for candidate PII (resumes, opt-out suppression). Now for opt-out; later for retention/erasure policies. Accessibility is a gap to consider (CLAUDE.md covers phone/themes but not a11y) — my observation.
- Ubiquitous language = PACE's "business terms defined once and made callable" (submission, Sourced, etc.) — validates it.
- Never: chasing every ISO sub-characteristic.

## Chapter 5: Identifying Architectural Characteristics
**Core argument.** Characteristics are found three ways: from domain concerns (translate the stakeholders' business language), from requirements (explicit statements and numbers), and from implicit domain knowledge. Keep the final list short (the Vasa warship died of over-specification), ask stakeholders for their top three rather than a full ranking, and learn the skill through timeboxed architecture katas. The Silicon Sandwiches case walks through deriving explicit and implicit characteristics and ends with trade-off and "which would you drop" analysis.

### Extracting from domain concerns
- Translate "is scalability, fault tolerance, security or performance most important?" into justifiable decisions. Resist the anti-pattern of a **generic architecture supporting all characteristics**; each adds complexity before domain problem even starts. Don't obsess over the count; aim at simplicity.
- **Vasa case study (1626-28):** Swedish king wanted the most magnificent ship — both troop transport and gunship, two gun decks, double-size cannons; expert builders could not refuse the king; it fired a salute, was top-heavy, capsized and sank in the harbour (raised in the 20th century, now in a Stockholm museum). Lesson: over-specified characteristics kill projects.
- **Prioritising:** a full ranking is a fool's errand causing disagreement; instead have domain stakeholders **pick the top three** (any order) — easier consensus, prompts discussion, aids trade-off analysis.
- **Lost in translation:** architects say scalability/interoperability/fault tolerance; stakeholders say mergers and acquisitions, user satisfaction, time to market, competitive advantage. Table 5-1 translation:
  - Mergers and acquisitions -> interoperability, scalability, adaptability, extensibility
  - Time to market -> agility, testability, deployability
  - User satisfaction -> performance, availability, fault tolerance, testability, deployability, agility, security
  - Competitive advantage -> agility, testability, deployability, scalability, availability, fault tolerance
  - Time and budget -> simplicity, feasibility
- **Trap:** agility != time to market; it is agility + testability + deployability (forgetting flour in the cake). **Fund-pricing example:** "end-of-day fund pricing must finish on time (regulatory)" — an ineffective architect optimises performance only; real need also includes availability, scalability (more funds), reliability (no crash), recoverability (restart at 85% done), and auditability (correct prices).

### Extracting from requirements
- Some are explicit (expected user numbers); others from domain knowledge. **University registration example:** 1,000 students, 10 hours — do not assume even spread; students procrastinate, design for all 1,000 in the last 10 minutes. Such details rarely appear in requirements.
- **Architecture katas** (Ted Neward; adapted by Ford and Richards): from martial arts, an individual training exercise emphasising form. Fred Brooks: great designers design; architects architect only a few times in a career, so katas supply practice. Format: small teams, 45 minutes, present, vote. Sections: **Description, Users, Requirements, Additional context** (context added by Neal; implicit info). Can be run as a brown-bag lunch with an experienced architect giving trade-off feedback.

### Case Study: Silicon Sandwiches (kata)
- Description: national sandwich shop adds online ordering; users thousands, maybe millions; requirements: order with pickup time and directions (external mapping services with traffic), delivery dispatch, mobile access, national and local daily promotions, payment online/in person/on delivery; context: franchised (different owners), overseas expansion planned, goal to hire inexpensive labour.
- **Explicit:** user numbers -> **scalability** (many concurrent users without serious degradation) — decoded from "thousands, maybe millions". Also **elasticity** (bursts), not stated but a sandwich shop has meal-time peaks. Scalability graph = concurrent users; elasticity graph = bursts. Hotel reservation = scalable not elastic; concert tickets = elastic (and usually scalable).
- Requirement-by-requirement: (1) external mapping = integration points -> reliability impact, but don't over-specify: if traffic service is down, degrade gracefully rather than fail ("guard against building unnecessary brittleness"); (2) delivery -> nothing special; (3) mobile -> design choice: mobile-optimised web app vs several native apps; budget says web app; define page-load performance; collaborate with UX and stakeholders; (4-5) national/local promotions (+ location-based traffic) -> **customizability**; microkernel/plug-in style supports it, but Template Method pattern can too — trade-off; (6) payments -> security but not above implicit baseline (third-party processing); (7) franchised -> cost constraints; check feasibility (cost, time, skills) — maybe a simple or **sacrificial architecture**; (8) overseas -> internationalisation (i18n), design not structure; (9) cheap labour -> usability, more design than architecture.
- **Performance** is the third: define it together with scalability (baseline without scale, then acceptable level at given users). Characteristics interact and must be defined relative to each other.
- **Implicit:** availability, reliability (no dropped connections mid-purchase), security (always implicit; becomes a characteristic only if it shapes structure and is critical; with third-party payments general hygiene: no plain-text card numbers, don't store too much). Over-specifying is as damaging as under-specifying.
- **Customizability:** custom behaviour (recipes, local sales, local directions) — when structure supports it, it becomes a characteristic, though here not critical. Mark Richards quote: "There are no wrong answers in architecture, only expensive ones."
- **Design versus architecture trade-offs:** microkernel structural support vs Template Method pattern; decide by: reasons (performance, coupling) not to use microkernel? other characteristics harder in one design? cost of supporting all? **Never decide in isolation from the implementation team — "Ivory Tower Architect" anti-pattern**; involve tech lead, developers, domain analysts, ops, PM.
- No need to find the exactly right set — developers can implement many ways — but the right structure may allow a simpler design. "No best design, only a least worst collection of trade-offs."
- **Exercise:** after the first pass, ask "if you must eliminate one, which?" Usually cull explicit ones, since implicit ones support general success. For Silicon Sandwiches, drop customizability (do it in design) or performance (least critical operational one — not terrible, just not prioritised over scalability/availability).

**Pitfalls:** generic everything-architecture; Vasa-style over-specification; full priority ranking; mistaking one ingredient (agility, performance) for the business concern; assuming even load; over-specifying (brittleness) and under-specifying; Ivory Tower Architect; deciding without implementation team.
**Key terms:** explicit/implicit characteristic; scalability vs elasticity; architecture kata; customizability; sacrificial architecture; Template Method; i18n; Ivory Tower Architect.
**Quotes:** "There are no wrong answers in architecture, only expensive ones." / "Architects must also prioritize... toward trying to find the simplest required sets." (paraphrase of the "least important one" exercise) / Fred Brooks: "How do we get great designers? Great designers design, of course."
**Relevance to PACE:**
- Now, very actionable: use the translation table for the owner's goals — "competitive with Ceipal/Bullhorn" (competitive advantage -> agility, testability, deployability, availability); "sold to other companies" (user satisfaction -> security, availability); "spend nothing now" (time and budget -> simplicity, feasibility). Ask the owner for their **top three** characteristics and record them (my suggestion).
- Scalability vs elasticity: PACE has bursts (batch candidate outreach, send windows, mailbox sweeps) rather than user-count scale; the free-tier host sleeps; so the first real characteristic risk is elasticity of background jobs/free-tier instance hours, not concurrent users. Defer elastic infrastructure until a paying customer needs it (Never now: speculative scaling).
- University-registration lesson: design for the bursty reality (Monday-morning logins, send-window starts when many orgs' windows open simultaneously) not the average — PACE's per-candidate-timezone windows concentrate sends. Worth a test (my observation).
- Integration-point lesson (map service down -> degrade) matches PACE's AI/Apollo/JSearch rule: calls return null, "rules-first", fallback visible to operator. Strong match.
- Customizability: PACE's per-org configuration (customer's letterhead/cold-email identity, admin-set limits, roles/permissions open) is the same trade-off as microkernel plug-in vs Template Method; today a config-table approach (the "design" end) is right; a plug-in/microkernel structure is only for later if customers need custom behaviour (e.g. provider-neutral contact data layer R-321 is the first place a plug-in style pays off).
- i18n: US + India already; locale/timezone handling is a design concern, no special structure yet.
- Sacrificial architecture: fits the early free-tier monolith — acceptable as long as exits (the "one home" rule, models/ layer) are kept clean.
- Ivory tower: not a risk with a solo owner; the analogue is the AI builder deciding structure without owner-level "why" — keep DECISIONS.md.
- Katas: could be used by owner/AI to rehearse a design decision before building (e.g. kata for "second customer onboarding") — my idea, optional.

## Coverage
- Whole file read: lines 1-3060 (all). Front matter (praise, copyright, TOC lines ~1-583, acknowledgments, O'Reilly boilerplate) skimmed only; Preface (584-657), Ch 1 (746-1362), Part I intro (1364-1368), Ch 2 (1371-1739), Ch 3 (1741-2297), Ch 4 (2299-2667), Ch 5 (2668-3058) read fully. The slice ends at p.75 inside Ch 5 (end of "Case Study: Silicon Sandwiches"); Ch 5 is complete there; Ch 6 begins on the next page and is not in the slice.
- Missing/garbled: all figures (mindmap 1-1, 1-2..1-7, 2-1..2-9, 3-1..3-6, 4-1/4-2, 5-1/5-2) absent; worked from captions/prose. Equations 3-1 (LCOM v1), 3-2 (LCOM96b), 3-3 to 3-5 partly garbled by extraction; formulas stated in notes come from prose (A = abstract/concrete, I = Ce/(Ce+Ca), D = |A+I-1|). Table layouts in Ch 4 (term/definition) interleaved but readable; Table 5-1 readable. No other problems.
