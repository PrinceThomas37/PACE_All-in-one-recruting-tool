# A Philosophy of Software Design (2nd ed., Ousterhout) - Ch 14-22 + closing summaries

Note on Clean Code: across this whole slice the author never names Robert C. Martin or "Clean Code". Where a disagreement is implied by the position taken, it is flagged as "implied (my inference)".

---
## Chapter 14 - Choosing Names

1. **Core argument.** Names are documentation and abstraction. Complexity is incremental, so mediocre names multiplied across thousands of identifiers add up. A name should paint an accurate image of what the thing is and is not, for a reader who sees it in isolation. Two properties matter: precision and consistency. Good naming also acts as a design probe: if you cannot name something, the design is probably unclear.

2. **Rules / red flags**
   1. Do not settle for names that are "reasonably close"; spend the extra time. Example: the Sprite file system used `block` for both a physical disk block and a logical file block. A logical number was used where a physical one was needed, so an unrelated disk block was zeroed. It took six months to find because the name made readers assume the wrong thing. Better: `fileBlock` / `diskBlock`, or distinct types.
   2. Create an image: ask what a reader would guess from the name alone, with no declaration or docs. Keep names to two or three words.
   3. **RED FLAG: Vague Name.** A name broad enough to refer to many things conveys little and invites misuse. Examples: `getCount()` (count of what? use `numActiveIndexlets`); `x`/`y` for character position (use `charIndex`/`lineIndex`); `blinkStatus` (use the predicate `cursorVisible`); `VOTED_FOR_SENTINEL_VALUE` (use `NOT_YET_VOTED`); `result` in a method that returns nothing; Linux `struct sock` vs `struct socket` (too similar to tell apart).
   4. Boolean names should be predicates.
   5. Names can also be too specific: a `delete(Range selection)` parameter suggests UI selection when any range works, so call it `range`.
   6. **RED FLAG: Hard to Pick Name.** If a simple, clear name is hard to find, the entity may lack a clean definition. Try other factorings, for example split one variable that represents several things.
   7. Consistency: use one common name for each recurring purpose, use it only for that purpose, and keep the purpose narrow enough that every variable with that name behaves the same. For two of the same kind, add a prefix (`srcFileBlock`, `dstFileBlock`). Loops: `i` outer, `j` nested.
   8. Avoid extra words: generic nouns (`fileObject`), type-encoding such as Hungarian notation (IDEs make it unnecessary), and repeating the class name in a member (`File.fileBlock` becomes `block`).
   9. Go-style short names: the author is unconvinced. He cites Gerrand's `RuneCount` with one-letter names, and the Go habit of reusing `ch`/`d` for several meanings. His rule: readability is judged by readers, not writers. He agrees with "the greater the distance between declaration and use, the longer the name should be".

3. **Caveats.** `i`/`j` are fine in short loops where the whole range of use is visible. Short names are fine if used consistently for one meaning. Names cannot carry everything, so pick the most important aspects.

4. **Key terms.** Precision = a name rules in the right meaning and rules out others. Consistency = same name, same single purpose, everywhere. Hungarian notation = type-encoding prefixes.

5. **Quotes.**
   - "Take a bit of extra time to choose great names, which are precise, unambiguous, and intuitive."
   - "Readability must be determined by readers, not writers."
   - "The greater the distance between a name's declaration and its uses, the longer the name should be." (Gerrand, endorsed)

6. **vs Clean Code.** Not named. Implied agreement on meaningful names. No explicit conflict; he is more tolerant of short names in tiny scopes and warns against type prefixes (Clean Code also discourages these).

7. **Applies to a Node/Express + Postgres SaaS?** Yes, directly. Domain terms (candidate vs applicant, lead vs submission, org_id vs user_id) are exactly the "block" trap, and one fixed name per concept across SQL columns, JS and API payloads prevents confusion. Distinct types are hard in plain JS; use naming conventions or branded IDs.

---
## Chapter 15 - Write The Comments First

1. **Core argument.** Writing documentation at the end gives poor comments: they get skipped, repeat the code, and miss design rationale already forgotten. Writing comments at the start makes them a design tool. A class or method whose abstraction cannot be described simply is a bad abstraction, and you find that before writing code. It is also cheaper and more fun than assumed.

2. **Rules / red flags**
   1. Write comments first. Order: class interface comment, then interface comments and signatures of key public methods with empty bodies, iterate, then instance variable declarations and comments, then bodies. Write each new method's interface comment before its body. When the code is done, the comments are done.
   2. Delayed comments are bad: they never get written, the task grows, you have mentally checked out, memory of the design is fuzzy, and you describe what the code shows.
   3. Comments are the only way to fully capture an abstraction, and a canary for complexity. A long comment on a method or variable means shallow or poorly decomposed. Compare interface comment length to implementation: if the comment must describe the implementation, the method is shallow.
   4. **RED FLAG: Hard to Describe.** If a simple yet complete comment is hard to write, the design has a problem. (Only a reliable indicator if the comment is complete and clear.)
   5. Early comments are fun: finding the design expressible in the fewest words is a source of pride.
   6. Cost: typing code and comments is perhaps 10% of development time, comments maybe 5%, so deferring them saves little. Stable abstractions up front may even speed total development.

3. **Caveats.** The cost argument is a back-of-envelope estimate. The author invites readers to try it and report back.

4. **Key terms.** Interface comment = comment describing the abstraction callers see. Canary in the coal mine = early warning of complexity.

5. **Quotes.**
   - "Comments provide the only way to fully capture abstractions, and good abstractions are fundamental to good system design."
   - "The best time to write comments is at the beginning of the process, as you write the code."

6. **vs Clean Code.** Not named. Implied conflict (my inference): Clean Code prefers self-documenting code and treats most comments as a failure to express in code. Ousterhout treats comments as a first-class, design-time artifact for abstractions that code cannot express.

7. **Applies to a Node/Express + Postgres SaaS?** Yes. Write route/service contract comments (what, who may call, errors, tenant scoping) before bodies. Works well with JSDoc in plain JS, and the same discipline applies to migration notes.

---
## Chapter 16 - Modifying Existing Code

1. **Core argument.** Design is determined more by evolution than by initial conception, so every change must be made strategically, not as "the smallest change that works". After each change the system should look as if designed from the start with that change in mind. Comments must also be maintained with specific techniques: place them near the code, avoid duplication, check the diff, and keep them abstract.

2. **Rules**
   1. Stay strategic. Minimal-change thinking adds special cases and dependencies. Think about whether the current design is still best given the change, and refactor if not. "If you're not making the design better, you are probably making it worse." Improve at least slightly whenever you are in the code.
   2. Keep comments near the code they describe (interface comment next to the body, not a header file; implementation comments pushed down to the narrowest scope, though a top-of-method strategy outline of phases is fine). The farther a comment is from the code, the more abstract it should be.
   3. Comments belong in the code, not the commit log. If a future developer needs the information (for example, why a subtle fix exists, so no one undoes it), put it in the code; duplicating it in the commit message is fine.
   4. Avoid duplication. Document each decision once, in the most obvious place (for example, at a variable declaration affecting several uses). If no obvious place, use a designNotes file plus short pointers. A dangling pointer is self-evident, while stale duplicates are silent. Do not redocument one module's behavior in another, and reference external docs (HTTP spec, user manual) instead of copying.
   5. Check the diffs before committing: confirm docs match changes; this also catches leftover debug code and TODOs.
   6. Higher-level, more abstract comments are easier to maintain.

3. **Caveats.** Commercial reality: a 3-month refactor vs a 2-hour hack, or refactors that break other teams. Still ask whether this is the best possible given constraints, look for a near-as-clean option that takes days, and get time allocated after the deadline. Every organization should spend a small fraction of effort on cleanup.

4. **Key terms.** Tactical vs strategic programming; investment mindset; designNotes file (central cross-module documentation, from Ch 13).

5. **Quotes.**
   - "If you're not making the design better, you are probably making it worse."
   - "Comments belong in the code, not the commit log."

6. **vs Clean Code.** Not named. Broadly compatible with the Boy Scout rule (leave it cleaner). Implied tension: he insists decisions are documented in code comments, not only commits.

7. **Applies to a Node/Express + Postgres SaaS?** Strongly. Applies to every feature-by-feature change to routes and migrations. "Document once, near the code" helps with rule duplication across routes/services/SQL, and the pre-commit diff review fits a PR workflow.

---
## Chapter 17 - Consistency

1. **Core argument.** Consistency means similar things are done in similar ways and dissimilar things differently. It gives cognitive leverage (learn once, apply elsewhere) and safe assumptions, and so fewer mistakes. It needs deliberate maintenance as people join and conventions drift. Over-applied, it creates confusion.

2. **Rules**
   1. Apply consistency to names, coding style, interfaces with multiple implementations, design patterns, and invariants (always-true properties that remove special cases).
   2. Document conventions in a visible place, and invariants next to the code.
   3. Enforce with tools. Example: a pre-commit script rejected files with carriage returns after Windows/Unix line-ending churn made diffs unreadable; it also trained newcomers. Code reviews (nit-picky ones) teach conventions.
   4. "When in Rome": mimic the surrounding code (public before private, ordering, camelCase vs snake_case); look for an existing example of a similar decision.
   5. Do not change existing conventions just because you have a "better idea". Allow it only if there is significant new information AND the improvement justifies converting every old use, leaving no trace of the old convention.
   6. Do not take it too far: do not force dissimilar things into one name or pattern. Consistency helps only if "if it looks like an x, it really is an x".

3. **Caveats.** The upgrade of a convention is allowed under the two-question test, but even then others may reintroduce the old way.

4. **Key terms.** Cognitive leverage; invariant; convention; "When in Rome".

5. **Quotes.**
   - "The value of consistency over inconsistency is almost always greater than the value of one approach over another."
   - "Consistency only provides benefits when developers have confidence that 'if it looks like an x, it really is an x.'"

6. **vs Clean Code.** Not named; no conflict implied.

7. **Applies to a Node/Express + Postgres SaaS?** Yes: route registration, error shape, tenant scoping, naming across SQL/JS, and linters or CI checks that enforce conventions all fit. The warning against forced uniformity matters where different data sources or email pipelines genuinely differ.

---
## Chapter 18 - Code Should be Obvious

1. **Core argument.** Obscurity is one of the two causes of complexity. Obvious code can be read quickly and the reader's first guess is right. Obviousness is judged by the reader, so code review is the test: if a reviewer says it is not obvious, it is not. Non-obviousness means the reader lacks information.

2. **Rules / red flags**
   1. Make code obvious with good names (Ch 14) and consistency (Ch 17).
   2. Use whitespace: separate parameter docs, blank lines between blocks (best when each block starts with a comment), spaces inside statements.
   3. Use comments to compensate for unavoidable non-obviousness.
   4. **RED FLAG: Nonobvious Code.** Behavior or meaning cannot be understood with a quick reading.
   5. Things that reduce obviousness:
      - Event-driven programming: handlers are invoked indirectly and which handler runs depends on runtime registration. Compensate by documenting in each handler's comment when it is invoked.
      - Generic containers (`Pair<>`): elements get meaningless names (`getKey`). Define a purpose-specific class or struct instead. "Software should be designed for ease of reading, not ease of writing."
      - Declaration type differing from allocation type (`List` declared, `ArrayList` allocated): match them.
      - Code that violates reader expectations: for example a `main` that returns while threads keep the app running; document it.
   6. Three ways to give readers the information they need, in order of preference: reduce the information needed (abstraction, eliminate special cases), reuse information readers already have (conventions), and present it in the code (names, comments).

3. **Caveats.** Event-driven programming and similar techniques are useful, so you may use them; add documentation to minimize confusion.

4. **Key terms.** Obscurity; obvious code; unknown unknowns (the missing-information framing); generic container.

5. **Quotes.**
   - "If someone reading your code says it's not obvious, then it's not obvious, no matter how clear it may seem to you."
   - "Software should be designed for ease of reading, not ease of writing."

6. **vs Clean Code.** Not named. Shared goal of readability; difference is that he accepts comments as the remedy, where Clean Code prefers restructuring code.

7. **Applies to a Node/Express + Postgres SaaS?** Yes. Obvious analogues: Express middleware chains and event emitters (hidden control flow), returning anonymous arrays/tuples or loose objects instead of named fields, and async side effects that outlive a request. Prefer named result objects and document middleware order and background work.

---
## Chapter 19 - Software Trends

1. **Core argument.** Evaluate each popular paradigm by one test: does it reduce complexity? OO helps when it enables information hiding and interface inheritance, but implementation inheritance and overuse of patterns and getters/setters can add complexity. Agile's iteration is good, but increments should be abstractions, not features. Unit tests enable refactoring. TDD is rejected as too tactical.

2. **Rules / positions**
   1. OO and inheritance: private members enable information hiding. Interface inheritance is good (one interface, many implementations, so deeper). Implementation inheritance reduces duplication but couples parent and subclasses (information leakage, may need to know the whole hierarchy). Prefer composition and helper classes; if you must inherit, keep state managed by the parent separate (parent-owned, subclasses read-only). OO does not guarantee good design.
   2. Agile: iterative, incremental development is right. The risk is feature focus and deferred design, which becomes tactical. "Implement a minimal special-purpose mechanism, generalize later" fights the investment approach. Increments should be abstractions; delay thought about an abstraction until a feature needs it, then design it cleanly and somewhat general-purpose.
   3. Unit tests (vs system tests): valuable mainly because they make refactoring safe and give higher coverage. Example: Tcl's byte-code compiler rewrite surfaced only one bug after alpha because of the existing suite.
   4. Test-driven development: not recommended. It is "tactical programming pure and simple", with no natural time for design and a temptation to hack the next test green. Design abstractions whole. Exception worth keeping: write the failing test first when fixing a bug, to prove the fix.
   5. Design patterns: good when they fit and reduce invention; the risk is over-application and forcing a problem into a pattern. More patterns is not better.
   6. Getters and setters: shallow, one-line methods that expose implementation data. Better not to expose instance variables at all; they are only justifiable if you must expose.
   7. Challenge any new paradigm on whether it truly minimizes complexity in large systems.

3. **Caveats.** Author is a strong advocate of unit testing, just not TDD. Test-first is endorsed for bug fixes. Patterns are fine when they fit.

4. **Key terms.** Interface inheritance; implementation inheritance; composition; unit test vs system (integration) test; TDD; design pattern; getter/setter.

5. **Quotes.**
   - "The increments of development should be abstractions, not features."
   - "Although I am a strong advocate of unit testing, I am not a fan of test-driven development."
   - "Test-driven development is too incremental."

6. **vs Clean Code.** Martin is not named, but TDD is the clearest implied disagreement: Clean Code's three laws of TDD vs Ousterhout's explicit rejection (keep the test-first rule for bugs). Also implied: his tolerance for deep classes vs very small classes, and his opposition to shallow getters/setters. Agile's "build the simplest thing, refactor later" is also criticized, which cuts against the YAGNI-style reading. (All inference; no names given.)

7. **Applies to a Node/Express + Postgres SaaS?** Largely yes. Prefer composition and plain modules over inheritance. Keep tests that enable refactoring, with a regression test written first for every bug fix. Be wary of small thin wrappers and per-feature special-casing in multi-tenant code; the "design the abstraction when needed, but design it whole" guidance fits a growing product.

---
## Chapter 20 - Designing for Performance

1. **Core argument.** Simplicity is also the best route to speed. Do not optimize everything (complexity, wasted effort) and do not ignore performance (death by a thousand cuts, 5-10x slow). Use awareness of what is fundamentally expensive to choose naturally efficient, still-simple designs. If still too slow, measure first, then make a fundamental fix, and as a last resort redesign around the critical path.

2. **Rules**
   1. Know what is expensive: network round trips (datacenter 10-50 us, wide area 10-100 ms), disk I/O (5-10 ms; flash 10-100 us), dynamic allocation, and cache misses. Learn costs through micro-benchmarks (RAMCloud built a reusable micro-benchmark framework).
   2. Choose the cheap option when it is equally simple (hash table vs ordered map, up to 5-10x faster, unless ordering is needed; store structs in an array, not an array of pointers).
   3. If efficiency needs complexity: acceptable if small and hidden from interfaces; otherwise start simple and optimize later, unless there is clear evidence performance will matter (RAMCloud kernel-bypass networking, decided from earlier measurements, and it made other things easier).
   4. Simpler code is usually faster: no special-case checks, deep classes mean fewer layer crossings.
   5. Measure before and after. Intuition is unreliable, so find the specific hot spots and take a baseline; back out changes that did not help measurably (unless they simplified).
   6. Prefer fundamental fixes (cache, better algorithm). Otherwise design around the critical path: imagine the minimal code for the common case ("the ideal"), then find a clean design close to it. Remove special cases from the critical path ideally with a single up-front test that diverts rare cases off-path.
   7. Example: RAMCloud `Buffer` allocation originally checked 6 conditions across three shallow identical-signature layers (a red flag). Redesigned around a single `availableAppendBytes` check that rules out three special cases at once, roughly 2x faster (8.8 ns to 4.75 ns), class 20% smaller (1476 vs 1886 lines), and clearer.

3. **Caveats.** Redesign around the critical path should be a last resort and rare. Some extra bookkeeping on a path is accepted if it keeps another common operation cheap (the totalLength update).

4. **Key terms.** Critical path; micro-benchmark; fundamental fix; "the ideal" code; death by a thousand cuts.

5. **Quotes.**
   - "Programmers' intuitions about performance are unreliable."
   - "Clean design and high performance are compatible."

6. **vs Clean Code.** Not named. Implied tension with very small decomposed methods: he says shallow layers cost both clarity and speed.

7. **Applies to a Node/Express + Postgres SaaS?** Yes, with different numbers: the expensive things are DB round trips, N+1 queries, external API calls and unindexed scans. Pick naturally efficient designs (batching, indexes, narrowing in SQL before limit), measure with query plans and profiles before tuning, and keep any caching or critical-path tuning out of public interfaces.

---
## Chapter 21 - Decide What Matters

1. **Core argument.** A central design skill is separating what matters from what does not, structuring the system around the former and hiding the latter. Many earlier principles (abstraction, naming, performance paths) are instances. Identify what matters by finding leverage, minimize what matters, then emphasize what remains.

2. **Rules**
   1. Look for leverage: a solution that solves many problems, or one fact that explains many things (the general-purpose text insert/delete interface vs a special-purpose backspace; invariants).
   2. Consider several options ("design it twice"), for example choose the few most informative words for a name.
   3. When unsure what matters, form an explicit hypothesis, commit, and review afterwards why it was right or wrong.
   4. Minimize what matters: fewer constructor parameters, sensible defaults, errors handled low, hidden information, configuration computed automatically rather than exposed to admins.
   5. Emphasize what matters by prominence (docs, names, parameters), repetition, and centrality (like a device-driver interface). Hide and de-emphasize what does not matter.
   6. Two mistakes: treating too many things as important (clutter, shallow classes, Java buffered vs unbuffered I/O) and missing something important (hidden information, missing functionality, unknown unknowns).
   7. The same idea applies to technical writing and to life priorities; "good taste" is telling the two apart.

3. **Caveats.** Hard for inexperienced developers; the answer is hypothesis and learning, not certainty. External constraints still need the designer to find what matters most within them.

4. **Key terms.** Leverage; centrality; prominence; good taste.

5. **Quotes.**
   - "Things that matter should be emphasized and made more obvious; things that don't matter should be hidden as much as possible."
   - "Try to make as little matter as possible."

6. **vs Clean Code.** Not named; no disagreement implied.

7. **Applies to a Node/Express + Postgres SaaS?** Yes. Decide which business rules and tenant boundaries matter, make those central and visible, and keep per-customer settings few, with sane defaults and automatic values rather than a screen of admin knobs.

---
## Chapter 22 - Conclusion

1. **Core argument.** The book is about one thing: complexity (its causes: dependencies and obscurity; its symptoms: red flags; its cures: deep and generic classes, defining errors away, separating interface from implementation docs, the investment mindset). Design costs extra effort early and is slow while skills are built, but pays back quickly, and good design is enjoyable.

2. **Points**
   1. Good design costs extra up front, more so if you are new to it.
   2. Investments (carefully defined modules, clear documentation, practiced skill) pay off quickly. Good design takes little longer than quick-and-dirty once you know how.
   3. Good designers spend more time in the fun design phase; poor designers spend theirs chasing bugs in brittle code.

3. **Caveats.** Honest about the early slowdown for anyone who only cares about working code now.

4. **Key terms.** Complexity; investment mindset.

5. **Quote.** "A clean, simple, and obvious design is a beautiful thing."

6. **vs Clean Code.** None named.

7. **Applies to a SaaS?** Yes: it is the argument for paying down design debt continuously in a long-lived product.

---
## Summary of Design Principles (all 16)

1. Complexity is incremental: sweat the small stuff (p.11). Many tiny shortcuts accumulate into an unmanageable system.
2. Working code isn't enough (p.14). A strategic design goal must beat merely functioning.
3. Make continual small investments to improve system design (p.15). Spend a little time on design each change.
4. Modules should be deep (p.23). Simple interface, powerful implementation.
5. Interfaces should make the most common usage as simple as possible (p.27). Defaults and no forced rare-case knowledge.
6. A simple interface matters more than a simple implementation (pp.61, 74). Absorb complexity inside the module.
7. General-purpose modules are deeper (p.39). Somewhat general interfaces cover more uses.
8. Separate general-purpose and special-purpose code (pp.45, 68). Keep special cases out of general mechanisms.
9. Different layers should have different abstractions (p.51). Avoid pass-through layers.
10. Pull complexity downward (p.61). Handle it in the module, not push it to callers.
11. Define errors out of existence (p.81). Design semantics so fewer error cases exist.
12. Design it twice (p.91). Compare at least two alternatives.
13. Comments should describe things that are not obvious from the code (p.101). Capture what and why, not restate.
14. Software should be designed for ease of reading, not ease of writing (p.151). Optimize for later readers.
15. The increments of software development should be abstractions, not features (p.156). Build clean abstractions as you go.
16. Separate what matters from what doesn't, and emphasize what matters (p.171). Structure around the important.

## Summary of Red Flags (all 14)

1. Shallow Module (pp.25, 110): interface is not much simpler than the implementation.
2. Information Leakage (p.31): one design decision is reflected in several modules.
3. Temporal Decomposition (p.32): structure follows execution order, not information hiding.
4. Overexposure (p.36): an API forces callers to know rare features to use common ones.
5. Pass-Through Method (p.52): a method just forwards arguments to a similar-signature method.
6. Repetition (p.68): a nontrivial piece of code repeated again and again.
7. Special-General Mixture (p.71): special-purpose code not cleanly separated from general-purpose code.
8. Conjoined Methods (p.75): two methods so dependent that you cannot understand one without the other's implementation.
9. Comment Repeats Code (p.104): the comment says nothing the adjacent code does not.
10. Implementation Documentation Contaminates Interface (p.114): interface comment describes details users do not need.
11. Vague Name (p.123): name too imprecise to convey useful information.
12. Hard to Pick Name (p.125): no precise, intuitive name comes easily.
13. Hard to Describe (p.133): complete documentation must be long.
14. Nonobvious Code (p.150): behavior or meaning cannot be understood quickly.

---
## Coverage
- Read the entire file, lines 1-1710, in three Read calls (1-600, 601-1200, 1201-1710). Content ends with "About the Author" (lines 1693-1707), which is outside the analysed slice.
- The slice begins at the start of Chapter 14 (no adjacent-section lead-in), and ends with the red-flag summary plus author bio.
- Garbled: Chapter 18's reformatted parameter-doc example (lines 807-834) and the `allocAux` code listing (838-864) came out line-broken from the PDF extraction but are understandable. Figures 20.1-20.3 are absent (only captions and text); their content is covered by the surrounding prose.
- Notes were written in a single write at the end rather than after each chapter.
