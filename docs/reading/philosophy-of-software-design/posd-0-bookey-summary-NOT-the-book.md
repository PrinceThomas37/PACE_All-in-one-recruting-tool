# A Philosophy of Software Design, John Ousterhout — notes from a SUMMARY, not the book

**Source received 7 Nov 2026:** "A Philosophy of Software Design PDF_copy.pdf" — a 30-page third-party summary by Bookey (about 3,600 words), NOT the book itself (the real 2nd edition is about 190 pages). Two of its seven chapters are cut off mid-sentence ("Install Bookey App to Unlock Full Text"). Read in full by the lead session; no helpers used.

## What the summary says (7 short chapters)
1. Complexity is anything that makes code harder to understand or change; reducing it is the engineer's primary job.
2. Accidental vs intrinsic complexity; symptoms: many branches, high coupling, low cohesion, globals, poor names, huge functions/classes, hard-to-test code.
3. Principles: modularity, abstraction, layering (presentation / business / data). (Truncated.)
4. Modules: information hiding, clean interfaces, high cohesion, loose coupling, stable interfaces, refine the module structure over time.
5. Abstractions: match the domain, keep the contract separate from the implementation, avoid leaky abstractions and over-abstraction built for imagined futures.
6. Refactoring: small incremental steps under automated tests, follow code smells, simplify. (Truncated.)
7. Craftsmanship: reviews, documentation as part of the work, long-term thinking.

## Warning: the summary is generic and partly misrepresents the book
From the lead session's own prior knowledge of the book ([Likely], NOT verified against the text here), the real book's signature ideas are missing or contradicted:
- **Deep modules:** a module should hide a lot of functionality behind a small, simple interface; many small "shallow" classes/methods ("classitis") ADD complexity. The summary instead pushes "small and focused" pieces.
- **Strategic vs tactical programming:** invest roughly 10-20% of effort in design continuously, instead of only making the next feature work.
- **Complexity = change amplification + cognitive load + unknown unknowns**, caused by dependencies and obscurity.
- **Define errors out of existence**, **pull complexity downwards** (the module author suffers so its users don't), **design it twice**, **different layer, different abstraction** (pass-through methods are a red flag), **information leakage** and **temporal decomposition** as red flags.
- **Comments:** describe what is not obvious from the code; interface comments written first. This openly disagrees with Clean Code's "a comment is a failure" and its very-short-functions rule.

Consequence for PACE: do not apply this summary as if it were the book. Ask the owner for the full book (send it under ~4.5 MB via Drive, as before) and read it the same way as the other two.
