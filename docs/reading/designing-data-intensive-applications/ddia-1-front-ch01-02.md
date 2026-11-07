# DDIA (Kleppmann 2017) - Front matter, Part I intro, Ch 1, Ch 2 - notes

## FRONT MATTER (title, copyright, dedication, TOC, Preface) and PART I INTRO

Title/copyright/dedication/Alan Kay epigraph: nothing substantive (dedication: tech can entrench power or serve good; book dedicated to those working toward the good).
Table of contents (lines 66-469) lists all 12 chapters in 3 parts: Part I Foundations (1 Reliable/Scalable/Maintainable, 2 Data Models & Query Languages, 3 Storage & Retrieval, 4 Encoding & Evolution); Part II Distributed Data (5 Replication, 6 Partitioning, 7 Transactions, 8 Trouble with Distributed Systems, 9 Consistency & Consensus); Part III Derived Data (10 Batch, 11 Stream, 12 Future of Data Systems). Not analysed (belongs to other slices).

### Preface - core argument
Backend engineers face a flood of buzzwords (NoSQL, Big Data, web-scale, sharding, eventual consistency, ACID, CAP, MapReduce). Tools change fast but underlying principles are enduring; understanding principles and trade-offs lets you place each tool, use it well, avoid its pitfalls. The book is neither tutorial for one tool nor dry theory: it studies internals, algorithms and trade-offs of successful data systems.

### Concepts / claims
- Drivers of recent change: internet-scale companies built new tools; businesses want agility (cheap hypothesis testing, short dev cycles, flexible data models); FOSS preferred over commercial/bespoke; CPU clocks flat but multi-core and faster networks, so parallelism grows; IaaS lets small teams build multi-machine/multi-region systems; high availability now expected, downtime unacceptable.
- **Data-intensive vs compute-intensive**: data-intensive = the main challenge is quantity, complexity or rate of change of data; compute-intensive = CPU cycles are the bottleneck.
- Many applications combine several building blocks: databases, message queues, caches, search indexes, batch and stream processors.
- Outcome promised: ability to choose technology for a purpose and combine tools into an architecture; not to build your own storage engine (rarely necessary) but intuition about what systems do under the hood.
- Audience: engineers/architects/technical managers building server-side apps with internet use; need some web/network service experience and relational/SQL familiarity; language-agnostic.
- **"You're not Google or Amazon" caveat**: author concedes building for scale you do not need is wasted effort, may lock into inflexible design, i.e. premature optimisation. But choose the right tool; relational DBs are important but not the final word.
- Scope: principles and trade-offs, not installation/API instructions. Deliberately excludes deployment, operations, security, management. Avoids the term "Big Data" in favour of single-node vs distributed, online/interactive vs offline/batch. Biased toward FOSS (inspectable code, less lock-in) but discusses proprietary systems too.
- Outline: Part I fundamentals (ch1 goals, ch2 data models/query languages, ch3 storage engines, ch4 encoding/schema evolution); Part II distributed data (replication, partitioning, transactions, distributed-system problems, consistency/consensus); Part III derived data (batch, stream, integration/future).
- References: 800+ references, per-chapter; ebook links, repo github.com/ept/ddia-references. Acknowledgments/O'Reilly/contact boilerplate skimmed, nothing substantive.

### Part I intro (lines ~723-740)
First four chapters = fundamentals for all data systems, single machine or cluster. Ch1 terminology and goals (reliability, scalability, maintainability); Ch2 data models and query languages "the most visible distinguishing factor between databases from a developer's point of view"; Ch3 storage-engine internals, different engines optimised for different workloads; Ch4 encoding formats and how they cope with schemas changing over time. Part II covers distributed issues.

### Pitfalls named
Buzzword-driven tool choice; premature scaling; treating "Big Data" as a technical term.

### Key terms
data-intensive, compute-intensive, data system, FOSS, vendor lock-in, single-node vs distributed, online vs batch.

### Quotes
- "building for scale that you don't need is wasted effort and may lock you into an inflexible design." (Preface)

### Relevance to Node/Express + single Supabase Postgres SaaS
Directly: the "not Google" caveat justifies the single-Postgres, free-tier approach; the principle that enduring trade-offs beat buzzwords supports "cheap now, retrofit-able later" choices (multi-tenancy, RLS). The book itself skips ops/security, so those need other sources. Distributed/multi-region content matters only at much larger scale.

---

## CHAPTER 1 - Reliable, Scalable, and Maintainable Applications

### Core argument
Modern applications are data-intensive (data volume/complexity/change rate, not CPU, is the limit). They are assembled from standard blocks (databases, caches, search indexes, stream/queue processing, batch jobs). Because the lines between these tools blur and no single tool meets all needs, application code stitches several together, which makes the developer a data-system designer who must give guarantees (e.g. cache consistent with DB). Three concerns apply to nearly every system: reliability (keeps working correctly despite faults), scalability (reasonable ways to cope with growth, only meaningful when load and performance are described quantitatively), and maintainability (operability, simplicity, evolvability). There are no easy fixes; the chapter gives vocabulary and ways of thinking (fault vs failure, load parameters, percentiles, accidental complexity) used for the rest of the book.

### Thinking About Data Systems
- Building blocks: databases (store), caches (remember expensive results), search indexes (keyword/filter), stream processing / message sending (async handling), batch processing (periodically crunch accumulated data).
- Categories blur: Redis is a datastore also used as a queue; Kafka is a queue with database-like durability. Also a single tool rarely suffices, so work is split and combined in application code.
- Figure 1-1 (not available as image; caption only): one architecture combining components - app code keeps a cache (e.g. Memcached) and a full-text index (Elasticsearch/Solr) in sync with the primary database; API hides these details from clients.
- Composite service = new special-purpose data system; you now own its guarantees (cache invalidated/updated on write so clients see consistent results).
- Design questions: keep data correct/complete when internals fail; consistent performance when parts degraded; scaling with load; good API shape. Influences: team skills, legacy dependencies, delivery timescale, risk tolerance, regulation.

### Reliability
- Working correctly = does what user expects; tolerates user mistakes/unexpected usage; performance good enough under expected load/volume; prevents unauthorized access and abuse. Reliability = continuing to work correctly even when things go wrong.
- **Fault** = one component deviating from spec; **failure** = whole system stops serving the user. Cannot make fault probability zero, so design fault-tolerance mechanisms that stop faults becoming failures. "Fault-tolerant" is slightly misleading (can only tolerate certain fault types; black-hole joke); "resilient" is the alternate term.
- Deliberately inducing faults (Netflix Chaos Monkey, randomly killing processes) exercises error-handling paths, since many critical bugs come from poor error handling (cites Yuan et al.).
- Prefer tolerating over preventing, except where no cure exists - security breaches (leaked data can't be undone) favour prevention.

**Hardware faults**
- Disks crash, RAM faults, blackouts, wrong cable pulled. Disk MTTF ~10-50 years, so a 10,000-disk cluster loses about one disk a day.
- Classic answer: hardware redundancy (RAID, dual power supplies, hot-swap CPUs, batteries/generators). Not perfect but well understood; machines run years. With a quick restore from backup, single-machine downtime was acceptable for most apps; multi-machine redundancy only for high-availability needs.
- Shift: more machines raise fault rate; clouds like AWS can make VM instances vanish without warning (favouring elasticity over single-machine reliability). So move toward software fault tolerance (surviving loss of whole machines) in addition to hardware redundancy. Operational bonus: rolling upgrades - patch one node at a time with no whole-system downtime, whereas a single server needs planned downtime for reboot/OS patch.

**Software errors**
- Systematic errors correlated across nodes, so cause more failures than independent random hardware faults. Examples: bug crashing every app-server instance on a particular bad input (leap second 30 Jun 2012 hung many apps via Linux kernel bug); runaway process exhausting CPU/memory/disk/bandwidth; a dependency that slows, hangs or returns corrupt responses; cascading failures.
- Bugs lie dormant until unusual circumstances break an assumption about the environment.
- No quick fix. Helpful: think hard about assumptions and interactions; thorough testing; process isolation; let processes crash and restart; measure, monitor and analyse production behaviour; self-checking invariants (e.g. a queue checks in-count equals out-count and alerts on discrepancy).

**Human errors**
- Study: operator configuration errors were the leading cause of outages in large internet services; hardware faults only 10-25%.
- Combine: (1) design to minimise error opportunities - good abstractions/APIs/admin UIs make the right thing easy; but too restrictive and people work around them; (2) decouple places people err from places that cause failures - full-featured non-production sandboxes with real data; (3) test at all levels (unit, integration, manual), automated tests especially for corner cases; (4) quick recovery - fast config rollback, gradual code rollout (bugs hit few users), tools to recompute data; (5) detailed monitoring/telemetry (performance metrics, error rates) for early warning and diagnosis; (6) good management practice and training (out of scope).

**How important is reliability?**
Mundane apps matter: business-app bugs cost productivity and legal risk; e-commerce outages cost revenue and reputation; "noncritical" apps (family photo storage) still owe users, e.g. corrupted DB with no restore path. It is acceptable to trade reliability for cost (prototype for unproven market, razor-thin-margin service) but only consciously.

### Scalability
- Scalability = ability to cope with increased load (e.g. 10k to 100k concurrent users, or more data). Not a one-dimensional label: "X is scalable" is meaningless; ask "if load grows in this way, what are our options, and how do we add resources?"

**Describing load**
- Load parameters: a few numbers, chosen per architecture - requests/sec, read/write ratio, simultaneously active users in a chat room, cache hit rate. Decide whether the average or the extreme cases dominate.
- Twitter example (Nov 2012): post tweet 4.6k req/s avg, >12k peak; home timeline reads 300k req/s. Write volume is easy; the challenge is **fan-out** (each user follows many and is followed by many). Footnote: fan-out borrowed from electronics (gate outputs driving inputs); here it means the number of requests to other services needed to serve one incoming request.
  - Approach 1: tweet insert into a global collection; at read time look up followees and merge by time (SQL join of tweets, users, follows - Figure 1-2 schema). Cheap writes, heavy reads.
  - Approach 2: maintain per-user home-timeline cache (mailbox); on post, insert tweet into each follower's cache. Reads cheap, writes heavy. Twitter's first version used approach 1, couldn't keep up with timeline reads, switched to 2 because reads are ~2 orders of magnitude more frequent than writes: do more work at write time.
  - Downside: avg ~75 followers so 4.6k tweets/s becomes ~345k cache writes/s; but followers per user varies wildly, some >30 million, so one tweet = 30M writes, target delivery within 5 seconds.
  - So the distribution of followers per user (perhaps weighted by tweet rate) is the key load parameter.
  - Final twist: hybrid - fan out for most users, but exclude celebrities; fetch their tweets at read time and merge (approach 1 for them). Consistent good performance. Revisited in Ch 12. Figure 1-3 = Twitter's pipeline with load parameters (caption only).

**Describing performance**
- Two framings: raise load with fixed resources - how does performance change? Or raise load - how much more resource keeps performance unchanged?
- Batch systems (Hadoop): throughput (records/sec or total job time for a dataset size). Online systems: response time. (Footnote: ideal batch time = dataset size / throughput; in practice longer due to skew and waiting for slowest task.)
- **Latency vs response time**: response time = what the client sees = service time + network delays + queueing delays; latency = time a request waits to be handled (is latent).
- Response time is a distribution, not a number, even for repeated identical requests. Random causes: context switch, packet loss and TCP retransmit, GC pause, page fault forcing disk read, rack vibration. Figure 1-4: 100 request response times with mean and percentiles marked (caption only).
- Mean is a poor "typical" measure (doesn't say how many users saw the delay). Use percentiles: median = p50 (half faster, half slower); a user making several requests has much more than 50% chance that at least one exceeds the median. Higher percentiles p95, p99, p999 show outliers = **tail latencies**. E.g. p95 = 1.5 s means 5 in 100 requests take >= 1.5 s.
- Amazon: specifies internal service targets at p99.9 because slowest requests often come from customers with most data/purchases (most valuable); also reports 100 ms added response time cuts sales 1%; others report 1 s slowdown cuts a satisfaction metric 16%. But p99.99 judged too costly for the benefit (random events beyond control, diminishing returns).
- **SLOs / SLAs**: contracts on expected performance and availability, often in percentiles - e.g. up if median < 200 ms and p99 < 1 s, and up >= 99.9% of the time; customers may claim refunds.
- **Queueing / head-of-line blocking**: a server handles few things in parallel (CPU cores), so a few slow requests delay following fast ones; hence measure response time on the client side.
- Load-testing pitfall: the load generator must send requests independently of response time; waiting for the previous reply keeps queues artificially short and skews results.
- **Tail latency amplification**: when one end-user request needs several backend calls (even parallel), it waits for the slowest; Figure 1-5 shows this. More calls per request = higher fraction of slow user requests.
- Computing percentiles for dashboards: rolling window (e.g. last 10 minutes), recompute each minute. Naive: keep all times and sort. Cheaper approximations: forward decay, t-digest, HdrHistogram. **Averaging percentiles is mathematically meaningless**; combine machines or time buckets by adding histograms.

**Approaches for coping with load**
- Architecture right for one load is unlikely to survive 10x; fast-growing services re-think at each order of magnitude.
- Scale up (vertical, bigger machine) vs scale out (horizontal, many smaller machines, "shared-nothing"). Single machine is simpler; high-end machines get very expensive; real designs mix, e.g. a few powerful machines can be simpler and cheaper than many small VMs.
- Elastic (auto-adds resources on load increase; useful for unpredictable load) vs manual (human analyses capacity; simpler, fewer operational surprises).
- Stateless services distribute easily; stateful data systems get much more complex distributed. Conventional wisdom: keep the database on one node (scale up) until cost or high-availability needs force distribution. Author speculates better tooling may make distributed the default even for small loads.
- No generic "magic scaling sauce": depends on read volume, write volume, data volume, data complexity, response-time needs, access patterns. Example: 100,000 req/s of 1 kB differs wholly from 3 req/min of 2 GB though same throughput.
- Architecture is built on assumptions about which operations are common/rare (load parameters). Wrong assumptions = wasted or counterproductive effort. In an early-stage startup or unproven product, iterating fast on features matters more than scaling to hypothetical load. Still, scalable architectures are made of general building blocks in familiar patterns.

### Maintainability
- Most software cost is ongoing maintenance (bugs, operations, failures, new platforms, new use cases, technical debt, features). People dislike legacy systems; design to avoid creating legacy. Three principles:
- **Operability**: "good operations can often work around the limitations of bad software, but good software cannot run reliably with bad operations." Ops duties: monitoring and restoring service; root-causing; patching/security updates; tracking how systems affect each other; capacity planning; deployment/config-management tooling; platform migrations; security under config changes; predictable processes; preserving organisational knowledge as people leave. Good operability = make routine tasks easy: visibility into runtime behaviour/internals via monitoring; automation/standard tool integration; no dependency on individual machines; good docs and a clear operational model ("if I do X, Y happens"); good defaults with override freedom; self-healing where appropriate but manual control available; predictable behaviour, few surprises.
- **Simplicity**: large projects become a "big ball of mud." Symptoms: state-space explosion, tight coupling, tangled dependencies, inconsistent naming/terminology, performance hacks, special-casing around problems elsewhere. Consequences: budget/schedule overruns, higher bug risk from hidden assumptions. Simplicity does not mean fewer features; it means removing **accidental complexity** (Moseley & Marks: not inherent in the problem as users see it, arises from implementation). Best tool: **abstraction** - hides detail behind clean facade, reusable, quality improvements benefit all users. Examples: high-level languages hide machine code; SQL hides on-disk/in-memory structures, concurrent clients, post-crash inconsistency. Finding good abstractions is hard, especially for distributed systems.
- **Evolvability** (extensibility/modifiability/plasticity): requirements change constantly (new facts, use cases, priorities, features, platforms, legal rules, growth). Agile, TDD and refactoring help at small scale; book seeks agility at whole data-system level; e.g. how would you "refactor" Twitter's timeline from approach 1 to 2? Ease of change is tied to simplicity and good abstractions.

### Summary (chapter)
Functional requirements (what it does) vs nonfunctional (security, reliability, compliance, scalability, compatibility, maintainability). Reliability: faults in hardware (random, uncorrelated), software (systematic, hard), humans (inevitable). Scalability: quantify load and performance (Twitter, percentiles); add capacity to stay reliable. Maintainability: better life for engineering and ops; abstractions reduce complexity; operability = visibility and effective control. No easy fix, but recurring patterns.

### Failure modes / pitfalls
- Treating faults as preventable; ignoring correlated software faults; operator config errors; over-restrictive tools that people bypass.
- Reporting mean instead of percentiles; averaging percentiles; measuring only server-side; load tests that wait for replies; chasing p99.99.
- Assuming one architecture scales across 10x; building for hypothetical load; wrong load-parameter assumptions.
- Fan-out hot spots (celebrity users); symptom of average hiding extremes.
- Accidental complexity, big ball of mud, tight coupling.
- Cutting reliability corners unconsciously; no restore path for user data.
- Cache/index out of sync with primary DB in composite systems.

### Key terms
data-intensive; compute-intensive; fault vs failure; fault-tolerant/resilient; MTTF; RAID; rolling upgrade; telemetry; load parameters; fan-out; throughput; response time; service time; latency; queueing delay; head-of-line blocking; percentile (p50/p95/p99/p999); tail latency; tail latency amplification; SLO/SLA; scale up/vertical; scale out/horizontal; shared-nothing; elastic; stateless vs stateful; operability; simplicity; accidental complexity; abstraction; evolvability; functional vs nonfunctional requirements; big ball of mud; chaos monkey.

### Quotes
- "Reliability means, roughly, 'continuing to work correctly, even when things go wrong.'" (para: "we can understand reliability as meaning, roughly, 'continuing to work correctly, even when things go wrong.'")
- "good operations can often work around the limitations of bad (or incomplete) software, but good software cannot run reliably with bad operations."
- "In an early-stage startup or an unproven product it's usually more important to be able to iterate quickly on product features than it is to scale to some hypothetical future load."

### Relevance to Node/Express + single Supabase Postgres SaaS on small host
Directly applicable: fault vs failure thinking; operator/config error is the top outage cause - sandbox/staging, fast rollback, gradual rollout, monitoring/error rates (Sentry-type telemetry); self-checking invariants; process crash-and-restart (Render restarts); measure p50/p95/p99 client-side and never average percentiles; define load parameters for your own workload (e.g. emails/day per tenant, candidates per org, read:write ratio) and note per-tenant skew (one big customer = celebrity fan-out analogue); the Twitter write-time vs read-time trade-off maps to precomputed/cached summaries (counts, queues) vs query at read; "scale up the single database node until forced" is exactly the recommended path; keep iteration speed over hypothetical scale; accidental complexity/abstractions/evolvability as guidance for model layers; maintain restore/backup path (reliability of user data); SLO thinking for tenants. Single-machine downtime for patching is real on one small host (rolling upgrades need >1 node). Only matters at much larger scale: tail latency amplification across many backend fan-out calls, t-digest/HdrHistogram, shared-nothing scale-out, elasticity, chaos engineering, MTTF arithmetic across thousands of disks, p99.99 tuning.

(Ch1 reference list [1]-[34], lines ~1476-1560, skimmed only.)

---

## CHAPTER 2 - Data Models and Query Languages  (notes part A: through "Schema flexibility", line ~2000; continues below)

### Core argument
Data models shape both how software is written and how we think about the problem. Software is layers of models (real world -> app objects -> general-purpose model like JSON/tables/graph -> bytes -> hardware); each layer hides the one below. Every model embeds assumptions: some usage easy, some fast, some awkward. The chapter compares relational, document and graph models and their query languages. Central thread: document model wins for self-contained tree-shaped data (locality, flexibility, closer to app objects); relational wins for many-to-one / many-to-many relationships and joins; graph models for highly interconnected data. The same debate happened in the 1970s (hierarchical vs network vs relational); relational prevailed because it moved access-path choice to an automatic query optimiser. Today the models are converging (relational DBs support JSON; document DBs add joins).

### Relational Model Versus Document Model
- Relational model (Codd, 1970): data in relations (tables) = unordered collections of tuples (rows). Doubted at first; by mid-1980s RDBMS/SQL were the default for regularly structured data; dominance ~25-30 years. Roots: business data processing on 1960s-70s mainframes - transaction processing (sales, banking, airline reservations, stock-keeping) and batch (invoicing, payroll, reporting). Goal: hide internal representation behind a cleaner interface.
- Competitors came and faded: network and hierarchical (1970s-80s), object databases (late 80s-early 90s), XML databases (2000s, niche). Each hyped, none lasted. Relational generalised far beyond origin (publishing, social networks, ecommerce, games, SaaS productivity).

**The Birth of NoSQL**
- "NoSQL" began as a 2009 Twitter hashtag for a meetup on open-source distributed nonrelational DBs; reinterpreted "Not Only SQL". Drivers: need for more scalability (huge datasets, very high write throughput); preference for FOSS; specialised query operations poorly served by relational; frustration with rigid schemas and desire for a more dynamic, expressive model.
- Conclusion: **polyglot persistence** - relational used alongside varied nonrelational stores, each for its fit.

**The Object-Relational Mismatch**
- OO app code vs tables/rows/columns needs a translation layer; the disconnect = **impedance mismatch** (term from electronics, footnote). ORMs (ActiveRecord, Hibernate) cut boilerplate but cannot hide the difference.
- Example: a LinkedIn profile (résumé). user_id; first_name/last_name once per user = columns on users; positions, education, contact info are one-to-many. Figure 2-1 (caption only): relational schema with separate tables keyed by user_id.
- Three ways to store one-to-many in SQL: (1) normalised separate tables with foreign keys (traditional); (2) structured/XML/JSON datatypes inside one row, queryable and indexable (Oracle, DB2, SQL Server, PostgreSQL; JSON in DB2, MySQL, PostgreSQL); (3) encode as JSON/XML in a text column, app interprets it - then the DB can't query inside it.
- For a mostly self-contained document like a résumé, JSON fits (Example 2-1 shows JSON with positions[], education[], contact_info{}, region_id, industry_id). Document DBs: MongoDB, RethinkDB, CouchDB, Espresso. JSON is much simpler than XML. JSON may reduce impedance mismatch; but JSON as encoding has its own problems (Ch 4); schema-less claim discussed below.
- **Locality**: JSON has better locality - one query fetches the whole profile; relational needs multiple queries or a messy multiway join. The one-to-many relationships form a tree structure (Figure 2-2, caption only), which JSON makes explicit.

**Many-to-One and Many-to-Many Relationships**
- Why region_id/industry_id instead of free text? Standardised lists give: consistent spelling/style, no ambiguity (same-name cities), ease of update (name stored once), localisation, better search (Seattle encoded as inside Washington).
- ID vs text = duplication question. An ID has no human meaning so never needs to change; human-meaningful text may change and, if duplicated, every copy must be updated (write overhead, risk of inconsistency). Removing such duplication = **normalisation** (footnote: normal forms of little practical interest; rule of thumb - if you duplicate values that could live in one place, it isn't normalised). Normalisation/denormalisation/caching/derived data deferred to Part III.
- Normalising needs many-to-one relationships, which fit documents poorly: document DBs have weak/no join support (footnote: at time of writing joins supported in RethinkDB, not in MongoDB, only predeclared views in CouchDB). Without joins you emulate them with multiple queries in app code (small slow-changing lists could be cached in memory, but work shifts from DB to app).
- Data becomes more interconnected as features grow: (a) organisations and schools as entities with own pages/logos (Figure 2-3: company name is a link to an entity); (b) recommendations - a user writes one for another and shows author's name and photo; if photo changes all recommendations must reflect it, so store a reference to the author's profile. Figure 2-4: these need many-to-many; data in each dotted rectangle can be one document but references need joins.

**Are Document Databases Repeating History?**
- Debate predates NoSQL. IBM IMS (Apollo programme stock-keeping, released 1968, still used on mainframes) used the **hierarchical model**: tree of nested records, much like JSON. Good at one-to-many, bad at many-to-many, no joins; developers chose between denormalising (duplicating) or manually resolving references - same problems document DBs have now.
- Solutions: the **relational** and the **network (CODASYL)** models; "great debate" through the 1970s.
- **Network model (CODASYL)**: generalises hierarchy by allowing a record multiple parents (e.g. one "Greater Seattle Area" record linked from many users) -> many-to-one and many-to-many. Links were pointer-like (not foreign keys), stored on disk. Only way to reach a record: follow an **access path** from a root along link chains; programmer must track multiple paths in their head; queries moved a cursor through lists. Even committee members likened it to navigating n-dimensional space. Efficient for 1970s hardware (tape seeks) but code was complicated/inflexible; lacking a path = trouble; changing access paths meant rewriting handwritten query code; hard to change the data model.
- **Relational model**: lays everything in the open - table of rows, read any rows by arbitrary condition, look up by key columns, insert rows without foreign-key worries (footnote: FK constraints optional; joins on foreign keys happen at query time, whereas CODASYL "joined" at insert time). The **query optimizer** picks execution order and indexes automatically (effectively the access path), so developers rarely think about it. New query patterns: just declare a new index; queries use it without being changed -> easier to add features. Optimisers are complex (years of R&D) but built once, benefit all applications; handcoding paths is easier initially but general solution wins long run.
- **Comparison to document DBs**: documents revert to hierarchical in storing nested one-to-many records inside the parent. For many-to-one/many-to-many, both models use a unique identifier (foreign key / document reference) resolved at read time via join or follow-up queries. Document DBs have not followed CODASYL.

### Relational Versus Document Databases Today
- Other differences (fault tolerance Ch 5, concurrency Ch 7) deferred; here only data model. Pro-document: schema flexibility, locality performance, closer to application data structures. Pro-relational: better joins and many-to-one / many-to-many.
- **Which gives simpler application code?** If data is document-like (a tree of one-to-many, usually loaded whole), use documents; relational **shredding** (splitting a document-like structure across tables) can mean cumbersome schemas and complex code. Document limitation: cannot reference a nested item directly ("second item in positions for user 251", like an access path); fine if not deeply nested. Weak joins may not matter (e.g. analytics event records seldom need many-to-many). If you need many-to-many, documents get unattractive: denormalise (then app keeps copies consistent) or emulate joins in app (more complex, usually slower than DB joins). Verdict: depends on relationship types; highly interconnected data -> document awkward, relational acceptable, graph most natural.
- **Schema flexibility**: most document DBs and JSON-in-relational enforce no schema (XML support often has optional validation); arbitrary keys can be added and readers have no guarantee which fields exist. "Schemaless" is misleading: code assumes some structure (continues in part B).

### Ch2 part B: schema flexibility (continued), locality, convergence
- **Schema-on-read** (structure implicit, interpreted when read; document DBs) vs **schema-on-write** (explicit, DB enforces conformity; relational). Analogy: dynamic (runtime) vs static (compile-time) type checking; no right answer, contentious.
- Difference shows when data format changes. Example: split full `name` into first/last. Document DB: just write new documents with new fields and handle old docs in application code on read (JS snippet derives first_name from name.split). Relational: migration `ALTER TABLE users ADD COLUMN first_name text; UPDATE users SET first_name = split_part(name,' ',1)` (PostgreSQL; substring_index in MySQL).
- Schema-change reputation (slow, downtime) is partly undeserved: most RDBMS run ALTER TABLE in milliseconds. MySQL is the exception - copies the whole table, minutes-hours downtime on large tables (workaround tools exist). The UPDATE rewrite of every row is slow on any DB; alternative: leave first_name NULL and fill at read time like a document DB.
- Schema-on-read helps when items are heterogeneous: many object types not practical as separate tables; structure dictated by external systems you do not control that may change. Then a schema hurts more than helps. When all records share structure, a schema documents and enforces it. (Ch 4 revisits.)
- **Data locality**: document stored as one continuous string (JSON/XML/BSON); big advantage if you usually need the whole document (e.g. render a page): one lookup vs multiple index lookups/disk seeks. Limits: DB loads the whole document even if you need a bit; updates usually rewrite the whole document (in-place only if encoded size unchanged). Advice: keep documents small, avoid writes that grow them. This limits where document DBs are useful.
- Locality is not unique to documents: Google Spanner lets a schema interleave child-table rows within parent; Oracle multi-table index cluster tables; Bigtable column families (Cassandra, HBase). More in Ch 3.
- **Convergence**: most RDBMS (except MySQL) support XML since mid-2000s (modify, index, query inside); PostgreSQL 9.3+, MySQL 5.7+, DB2 10.5+ support JSON; expected to spread because of JSON web APIs. Document side: RethinkDB has joins; some MongoDB drivers auto-resolve references (client-side join, slower: extra network round-trips). Hybrid is "a good route for the future"; models complement. Footnote: Codd's original paper allowed "nonsimple domains" (nested relations as values) - similar to JSON/XML columns, 30 years earlier.

### Query Languages for Data
- Relational model introduced a **declarative** query language (SQL; relational algebra sigma selection) vs **imperative** code in IMS/CODASYL (footnote: COBOL iterating records one at a time). Example: sharks in a list of animals - JS for loop vs `sharks = sigma family="Sharks" (animals)` vs `SELECT * FROM animals WHERE family = 'Sharks'`.
- Imperative = steps in a particular order. Declarative = specify the pattern/conditions/transformation (sort, group, aggregate), not how; the query optimizer picks indexes, join methods and order.
- Advantages of declarative: more concise, easier; hides engine implementation so DB can improve performance without query changes (e.g. DB can reorder/reclaim disk space only if queries don't depend on order - SQL guarantees no ordering; imperative code might rely on it); limited functionality gives optimizer room; lends itself to **parallel execution** across cores/machines because only the result pattern is specified, while imperative code with fixed instruction order is hard to parallelise (CPUs gain cores not clock speed).

**Declarative Queries on the Web** (analogy)
- Page with nav list; item `<li class="selected">`. CSS `li.selected > p { background-color: blue }` declares the pattern; XSL/XPath `li[@class='selected']/p` equivalent. Imperative DOM JS version is long, hard to read, and worse: if the "selected" class is removed the blue stays until page reload (CSS auto-unapplies), and adopting new APIs (getElementsByClassName, document.evaluate) requires rewriting code while browser vendors can optimise CSS/XPath without breaking compatibility. Lesson: declarative CSS beats imperative style manipulation; likewise SQL beat imperative query APIs.

**MapReduce Querying**
- MapReduce: Google-popularised model for bulk processing across many machines; limited form in MongoDB and CouchDB for read-only queries across many documents (full coverage Ch 10). Neither declarative nor fully imperative: query logic is code snippets (map/collect and reduce/fold/inject from functional programming) called repeatedly by the framework.
- Example: marine biologist counting shark sightings per month. PostgreSQL: `SELECT date_trunc('month', observation_timestamp) AS observation_month, sum(num_animals) AS total_animals FROM observations WHERE family='Sharks' GROUP BY observation_month;`. MongoDB mapReduce: map emits key "year-month" and numAnimals; reduce sums values per key; query filter {family:"Sharks"} declarative (Mongo extension); output to collection monthlySharkReport. Worked example: two Dec 1995 docs (3 and 4 animals) -> emit("1995-12",3), emit("1995-12",4) -> reduce("1995-12",[3,4]) = 7.
- map and reduce must be **pure functions**: only use passed input, no extra DB queries, no side effects - lets the DB run them anywhere, in any order, and rerun on failure. Still powerful (parse strings, call libraries, compute).
- MapReduce is low-level; SQL can be implemented as a pipeline of MapReduce ops (Ch 10) but many distributed SQL engines don't use it; nothing in SQL confines it to one machine. JavaScript inside queries isn't unique to MapReduce (some SQL DBs allow JS functions).
- Usability problem: two coordinated functions harder than one query; declarative gives optimizer more room. So MongoDB 2.2 added the declarative **aggregation pipeline** ($match, $group with $year/$month/$sum) - as expressive as a subset of SQL with JSON syntax. Moral: "a NoSQL system may find itself accidentally reinventing SQL, albeit in disguise."

### Graph-Like Data Models
- Use documents when relationships are mostly one-to-many (trees) or absent. Relational copes with simple many-to-many; as connections get complex, graph modelling becomes natural.
- Graph = **vertices** (nodes/entities) and **edges** (relationships/arcs). Examples: social graph (people, who knows whom), web graph (pages, links), road/rail networks (junctions, roads). Algorithms: shortest path (car navigation), PageRank (web ranking). Graphs also store heterogeneous things consistently: Facebook's single graph with people, locations, events, checkins, comments as vertices and friend/checkin-at/commented-on/attended edges.
- Running example Figure 2-5 (caption only): Lucy from Idaho and Alain from Beaune, France, married, living in London; boxes = vertices, arrows = edges.
- Models covered: property graph (Neo4j, Titan, InfiniteGraph) and triple-store (Datomic, AllegroGraph); declarative languages Cypher, SPARQL, Datalog; imperative Gremlin; processing frameworks like Pregel (Ch 10).

**Property Graphs**
- Vertex: unique id, set of outgoing edges, set of incoming edges, properties (key-value). Edge: unique id, tail vertex, head vertex, label (kind of relationship), properties.
- Can be stored in two relational tables (Example 2-2): `vertices(vertex_id PK, properties json)`; `edges(edge_id PK, tail_vertex FK, head_vertex FK, label text, properties json)` with indexes `edges_tails(tail_vertex)` and `edges_heads(head_vertex)` for forward/backward traversal.
- Key aspects: (1) any vertex can link to any other, no schema restricting associations; (2) given a vertex, efficiently find incoming and outgoing edges, so traverse forward and backward; (3) different labels store many relationship types in one clean model.
- Flexibility illustrated: different regional structures per country (France départements/régions vs US counties/states), a country within a country, varying granularity (residence = city, birthplace = state). Extension example: food allergies (allergen vertices, allergy edges, link allergens to foods) enabling "what is safe to eat" query. Graphs are good for **evolvability**.

**The Cypher Query Language** (begins at line 2497; continues in the next read chunk)
- Declarative language for property graphs created for Neo4j; named after a Matrix character, not cryptography.

### Ch2 part C: Cypher, graph queries in SQL, triple-stores, Datalog, summary
**Cypher**
- Example 2-3: CREATE vertices with symbolic names and labels/properties, e.g. (Idaho:Location {name:'Idaho', type:'state'}), (Lucy:Person {name:'Lucy'}); arrow notation creates edges: (Idaho)-[:WITHIN]->(USA)-[:WITHIN]->(NAmerica), (Lucy)-[:BORN_IN]->(Idaho).
- Example 2-4 query "people who emigrated from the US to Europe": `MATCH (person)-[:BORN_IN]->()-[:WITHIN*0..]->(us:Location {name:'United States'}), (person)-[:LIVES_IN]->()-[:WITHIN*0..]->(eu:Location {name:'Europe'}) RETURN person.name`. `:WITHIN*0..` = follow WITHIN edges zero or more times (like regex `*`).
- Execution is the optimizer's job: could scan all people and check birthplace/residence, or start from the two Location vertices (via an index on name), walk incoming WITHIN edges to all contained places, then find people via incoming BORN_IN/LIVES_IN. Declarative = you don't specify this.

**Graph queries in SQL**
- Graph data can sit in a relational DB but querying is hard because the number of joins is not known in advance (variable-length traversal). Since SQL:1999: recursive common table expressions (`WITH RECURSIVE`; PostgreSQL, DB2, Oracle, SQL Server). Example 2-5: build in_usa and in_europe sets recursively over 'within' edges, born_in_usa and lives_in_europe from edges, then join -> 29 lines vs 4 in Cypher. Moral: different data models suit different use cases; pick the suitable one.

**Triple-stores and SPARQL**
- Triple-store ~ property graph in other words. Everything is (subject, predicate, object), e.g. (Jim, likes, bananas). Subject = vertex. Object is either a primitive value (predicate/object = property key/value, e.g. (lucy, age, 33)) or another vertex (predicate = edge label, e.g. (lucy, marriedTo, alain)).
- Turtle (subset of Notation3) examples 2-6/2-7 (semicolons let you chain facts about one subject); `_:name` blank-node vertex names are only file-local. RDF/XML (Example 2-8) is more verbose; Apache Jena converts between RDF formats.
- **Semantic web**: idea that sites publish machine-readable data (RDF) as well as human text to build an internet-wide web of data. Overhyped in the 2000s, not realised, acronym-heavy, so people are cynical; but triples can still be a good internal data model. Datomic is a triple-store not tied to it (technically 5-tuples with versioning metadata).
- RDF quirk: subject/predicate/object are often URIs namespaced so data from different parties doesn't clash (examples use urn:example: prefixes; the namespace need not resolve).
- **SPARQL** (pronounced "sparkle"; SPARQL Protocol and RDF Query Language) predates Cypher, which borrowed its pattern matching. Example 2-9: `SELECT ?personName WHERE { ?person :name ?personName. ?person :bornIn / :within* / :name "United States". ?person :livesIn / :within* / :name "Europe". }`. Properties and edges use the same syntax. Useful internally even without the semantic web.

**Graph databases vs the network model (CODASYL)** - four differences: graph has no schema restricting which vertex links to which (CODASYL had record-type nesting); you can address any vertex by ID or by index, not only via access paths; vertices/edges are unordered (CODASYL children were ordered sets affecting storage and inserts), sort only at query time; queries can be imperative but usually use declarative Cypher/SPARQL (CODASYL was always imperative and brittle to schema change).

**Datalog**
- Much older (academic, 1980s); foundation that later languages build on; used in Datomic, Cascalog (Hadoop). Subset of Prolog. Data model like triples but written predicate(subject, object): `name(usa,'United States'). within(idaho, usa). born_in(lucy, idaho).`
- Queries are built from **rules** defining derived predicates (not stored): Example 2-11 `within_recursive(Location, Name) :- name(Location, Name).` (rule 1) and `... :- within(Location, Via), within_recursive(Via, Name).` (rule 2), then `migrated(Name, BornIn, LivingIn) :- ...` (rule 3) and query `?- migrated(Who, 'United States', 'Europe').` -> Lucy. Uppercase = variables. A rule applies if all right-hand-side predicates match; conclusions are added as if in the database; repeated application (Figure 2-6, caption: deriving that Idaho is in North America) yields transitive containment. Rules can call other rules or recurse, so complex queries are built piece by piece, reusable. Less convenient for one-off queries; better for complex data.

### Ch2 Summary
Historical arc: hierarchical (one big tree) -> relational (to fix many-to-many) -> NoSQL diverging two ways: document DBs for self-contained documents with rare cross-document relationships; graph DBs for "anything potentially related to everything." All three widely used, each good in its domain; one model can be emulated in another (graph in relational) but awkwardly - hence no one-size-fits-all. Document and graph DBs typically don't enforce schema, easing adaptation, but the application still assumes structure: explicit (schema-on-write) vs implicit (schema-on-read). Query languages surveyed: SQL, MapReduce, MongoDB aggregation pipeline, Cypher, SPARQL, Datalog; CSS and XSL/XPath as parallels. Unmentioned models: genome sequence-similarity search (GenBank, specialised software), particle physics/LHC (hundreds of PB, custom solutions), full-text search (frequently used alongside databases; Ch 3 and Part III).

### Ch2 Failure modes / pitfalls
- Picking a model that mismatches relationships (many-to-many in a document store -> emulated joins, denormalised copies drifting out of sync, slower, more complex code).
- Duplicating human-meaningful data instead of referencing by ID (update anomalies, inconsistency).
- Impedance mismatch / shredding documents across tables (cumbersome schemas); conversely, huge or fast-growing documents (whole-document load/rewrite).
- Data gets more interconnected as features are added; join-free design that fits v1 breaks later.
- Treating "schemaless" as no schema - implicit schema lives in code; old-format documents need read-time handling.
- MySQL ALTER TABLE copying whole table (long downtime); UPDATE of entire large table is slow anywhere.
- Imperative access paths (CODASYL) make code brittle; imperative DOM styling leaves stale state; imperative code can't be parallelised or optimised under the hood.
- MapReduce functions that have side effects or extra queries break re-execution; two coordinated functions error-prone.
- Variable-depth traversals in SQL are clumsy (recursive CTEs).
- Semantic web hype/complexity.

### Ch2 Key terms
data model; relational model/relation/tuple; RDBMS; NoSQL / Not Only SQL; polyglot persistence; impedance mismatch; ORM; shredding; document model; locality; normalisation/denormalisation; foreign key / document reference; join; hierarchical model; network (CODASYL) model; access path; query optimizer; schema-on-read vs schema-on-write; declarative vs imperative query language; MapReduce (map, reduce, pure function); aggregation pipeline; graph (vertex/node, edge/arc); property graph; Cypher; recursive CTE; triple-store; (subject,predicate,object); Turtle/N3; RDF; semantic web; SPARQL; Datalog (facts, rules, derived predicate); Gremlin; Pregel.

### Ch2 Quotes
- "Data models are perhaps the most important part of developing software, because they have such a profound effect: not only on how the software is written, but also on how we think about the problem that we are solving."
- "A hybrid of the relational and document models is a good route for databases to take in the future."
- "The moral of the story is that a NoSQL system may find itself accidentally reinventing SQL, albeit in disguise."

### Ch2 Relevance to Node/Express + single Supabase Postgres multi-tenant SaaS
Directly applicable:
- Postgres already is the "hybrid" the chapter recommends: relational tables with FKs for entities with many-to-one/many-to-many links (candidates-jobs-submissions-clients-users), plus `jsonb` columns for self-contained, variable-shape blobs (parsed resume `raw`, settings, AI briefs, third-party payloads). Use jsonb where the structure is externally determined or heterogeneous; keep relationships relational. Don't put queryable relationships inside JSON.
- Normalise human-meaningful values behind IDs (stage names, client names, locations, owners) so renames are one-row updates; denormalise deliberately (caches/derived counts) and own the consistency work.
- Interconnection grows with features (recommendations-style links): keep many-to-many as join tables from the start.
- Schema-on-write vs read: Postgres migrations are mostly millisecond ALTER TABLEs (adding nullable columns is cheap; Postgres, unlike old MySQL, doesn't copy the table for that), big backfill UPDATEs are the slow part - fill lazily at read time or batch them. Mixed approach for legacy values (cf. a `normalizeStage` mapper = schema-on-read compatibility).
- Declarative SQL lets the planner improve under you; add indexes without changing queries; Postgres `WITH RECURSIVE` handles hierarchies (reporting chains, org trees, location containment) - fine for modest depth; no graph DB needed. Edge/vertex tables with indexes on both ends (Example 2-2) is a viable pattern for e.g. org/relationship graphs in Postgres.
- Locality: keep jsonb documents small; rewriting whole row/value on update.
- Polyglot persistence warning: avoid adding stores until needed.
Only matters at larger scale / other contexts: MapReduce (largely obsolete vs SQL aggregates/window functions), dedicated graph DBs (Neo4j/Cypher/SPARQL/Datalog/RDF/semantic web), Spanner interleaving/Bigtable column families, Mongo-style client-side joins, genome/LHC examples.
Ch1 meets Ch2: Twitter fan-out is write-time precompute (denormalised cache) vs read-time join - same trade as normalise vs denormalise.

---

## Coverage
- Lines 1-3116 of /tmp/.../books/slices/ddia-1-front-ch01-02.txt read in full (7 Read calls of up to 500 lines; every line seen). Nothing garbled except normal PDF-extraction artefacts (hyphenation breaks "‐", split code lines, page numbers/headers interleaved, sidebars like "Latency and response time" inline).
- Skimmed only: table of contents (lines 66-469), copyright/acknowledgments/O'Reilly boilerplate, Ch1 reference list (~1476-1560) and Ch2 reference list (~2995-3114).
- Figures are not present as images: Figs 1-1 to 1-5, 2-1 to 2-6 worked from captions and surrounding prose. Code examples (2-1 to 2-11) are present as text.
- Slice start/end: begins at the book title page; ends at the end of Ch2 references (line 3114) with no adjacent-section spill.
