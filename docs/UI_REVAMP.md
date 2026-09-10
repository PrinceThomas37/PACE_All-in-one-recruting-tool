# The new look — how it works, and what is left

Owner's brief, Session 23: *"keep toggle to dark and light. I am tired of how it
looks right now."* Plus a Bolt export and two phone screenshots as the visual
reference. Decision: `DECISIONS.md` D-0015.

## The reference

8 files, ~600 lines, React + Vite + Tailwind, one screen, four hard-coded jobs,
no data layer. A **design**, not an app — and the right thing to have made.

## Why this is one stylesheet and not a rewrite

The design is a sidebar, a header, three metric cards, a stepper and a list.
None of that needs a component framework; the beauty is in the CSS. And every
page in PACE already draws from shared CSS variables and a small set of classes
(`.card`, `.btn`, `.inp`, `.bdg`).

So: **`public/theme.css`, loaded last, redefines the tokens.** ~19,600 lines of
frontend change appearance; none change behaviour. Removing the one `<link>`
restores the old look exactly.

A React port would have meant a build step, a bundler, and porting ~50 page
files — weeks, with everything that currently works at risk, for a result the
CSS already gives.

## The three theme states

| Root | Meaning |
|---|---|
| no `data-theme` | follow the operating system |
| `data-theme="light"` | light, chosen |
| `data-theme="dark"` | dark, chosen |

The complete light palette lives on bare `:root`; dark is defined **twice**,
once under `prefers-color-scheme: dark` (guarded `:not([data-theme="light"])`)
and once under `[data-theme="dark"]`, so an explicit choice always beats the OS.

## Rules that must not be softened

1. **Applied before first paint**, inline and synchronous in `<head>`. Defer it
   and the page paints light then snaps to dark.
2. **The toggle touches one attribute.** No `render()` — re-rendering to change
   a colour reloads every sandboxed iframe and loses the page's scroll.
3. **Never define a colour only inside a media query**, or the toggle cannot
   beat the OS.
4. **Reach every palette.** `ui.css` has its own (`--ink`, `--line`, `--hover`)
   separate from `styles.css` (`--text`, `--border`). Bridging only one left the
   Leads table drawing dark ink on dark glass.
5. **No inline colours.** An inline colour cannot be re-themed, exactly as an
   inline width cannot be re-laid-out.
6. **Blur is not free on a phone.** The rail is a moving surface; below 860px it
   drops to a solid ground and keeps its frame rate.

## What the tests hold

* **`theme-contrast-smoke.mjs`** — composites every translucent ancestor to find
  what is really behind each piece of text; 12 pages x 3 roles x 2 themes, fails
  under 2.2:1. Verified by reintroducing the `--ink` bug.
* **`mobile-layout-smoke.mjs`** caught a real regression here: a `z-index` rule
  that also restated `position` collapsed `#nav-scrim` and made the phone menu
  impossible to close. **Never restate `position` in a rule whose job is
  `z-index`.**
* `screen-stability`, `ageing-layout`, `nav-icons` all still pass — the theme
  changes no structure.

## Not done yet

This is a **re-skin**. It changes how every screen looks, not how any screen
works. The row-level interaction brief — a row that shows its state and offers
its actions in place, instead of hiding them two clicks deep in a drawer — is
**D-0014 and still open**. That is the next piece, and it is per-screen work.
