# Phase 7 delta

Corrections and decisions from the web-product phase. The three immutable documents are never edited;
everything that contradicts them, or that they do not cover, is recorded here.

---

## V-1 · The router is hand-written, and that is a decision rather than an omission

**PRD says** nothing about routing. **Reality:** nineteen routes with five parameterised segments.

React Router would have been the default choice. It was not taken, for reasons that are specific
rather than ideological:

- the route table is fixed and known at build time, so the matcher is a segment comparison and fits
  on one screen — it can be read and checked rather than trusted;
- an exact pin is a maintenance obligation under `.claude/rules/contracts.md`'s no-ranges rule, and
  `source-lock.json` would gain an entry for behaviour twenty lines make explicit;
- nothing in the product needs nested layouts, loaders, data routers or transitions.

What the hand-written router must therefore get right, and does: real `<a href>` on every link so
modifier-clicks and middle-clicks behave, `popstate` handling, and no client-only route state. The
last one is what makes every route survive a refresh.

**Cost if this is wrong:** a future need for nested layouts or route-level data loading would mean
adopting a router and rewriting `router.tsx`. That is a contained change — one file and the route
table — which is the reason it is an acceptable bet now.

---

## V-2 · Cobalt appears in one place `design.md` does not list: the focus ring

**`design.md` says** Cobalt is the single primary action per page and never decoration.
**Reality:** `:focus-visible` renders a 2px Cobalt outline on every focusable element.

A focus ring is not a control — it is the keyboard's cursor. On a deliberately monochrome interface a
monochrome ring is a ring a keyboard user cannot find, and WCAG 2.4.7 is not optional. The two rules
conflict and one has to win.

**Decision:** the focus ring is Cobalt. It is not a "primary action" in any sense a reader would
misinterpret, it appears one element at a time, and it never appears without a keyboard. Recorded
here rather than left as an inconsistency for the next reader to find and "fix".

---

## V-3 · The shell holds no Cobalt at all, which `design.md` does not require

**`design.md` says** the top navigation bar carries "the single Cobalt action on the right".
**Reality:** the masthead is entirely monochrome.

That description is of the marketing surface. Inside the application it would put a second Cobalt
element on every page that has its own primary action, and one on pages that have no action at all —
a "Connect wallet" button competing with "Activate quote".

**Decision:** the landing page carries its own header with the single Cobalt action ("Open the
terminal"), exactly as `design.md` describes. The application shell carries none, and each route
declares its own. This makes the one-per-page rule mechanically checkable: `verify:web` counts the
rendered Cobalt elements per route and fails on more than one.

---

## V-4 · A verification verdict has four values, not three

**Phase 6 shipped** `pass` / `fail` / `unavailable`. **Phase 7 needs a fourth.**

P7-4 establishes `unavailable` as load-bearing. Phase 7 found a second gap: a proof page has facts it
can state and has not checked. The deployment record reports 43 contracts verified on Etherscan; this
browser did not call Etherscan. The confidential layer's compiler pin is real; this browser compiled
nothing. The Slither gap is real and open.

Three options existed. Drop them — which hides a claim. List them as `verified` — which misstates who
checked. Or name them.

**`reported-not-verified`** is the fourth verdict. It appears in the downloadable artefact with its
own definition shipped alongside, so a reader who has never seen Kyrve cannot mistake it for a pass.
The two decided verdicts were renamed `verified` and `failed` at the same time, and demonstration 24's
expected values moved with them.

---

## V-5 · `data-testid="connected-account"` and `disconnect` existed twice

**Phase 5 rendered** both in the ownership band and — from Phase 7 — in the masthead.

Harmless on a single page and a real defect across nineteen: two elements carrying one identifier make
every assertion about them ambiguous under Playwright's strict mode, and two "disconnect" buttons make
a reader guess whether they do the same thing.

**Decision:** the masthead owns both, once. The ownership band's header now carries a comment saying
so rather than an empty div, because "why is this missing" is the question the next reader will have.

---

## V-6 · The environment line moved out of the wallet badge

`Environment local · chain 31337` used to render beside the connected account, which meant it
disappeared for anyone who had not connected a wallet — including every reader of a proof page, who is
exactly the person who needs to know which deployment they are looking at.

**Decision:** it lives in the footer, on every route, with or without a wallet. The Phase 2 browser
suite's assertion is unchanged and now reads `data-testid="environment"`.

---

## V-7 · `verify:web` replaces five scripts that were named before they existed

Early comments in `router.tsx`, `Shell.tsx`, `styles.css` and `App.tsx` referred to
`scripts/verify/routes.ts`, `metadata.ts`, `design-rules.ts`, `accessibility.ts` and `lifecycle.ts`.

They were consolidated into one script, because they all need the same expensive thing — a built
bundle, a preview server and a browser — and running that five times to answer five questions is
five times the wall clock for no additional evidence.

Every reference was corrected to `pnpm verify:web`. A comment naming a file that does not exist is
the same class of defect as a manifest naming a contract that was never deployed.

---

## V-8 · A `page.evaluate` closure carries the transpiler's helpers into the browser

Playwright serialises a closure by its source. `tsx` transpiles with esbuild, which injects a `__name`
helper into named function expressions — so the helper travels into the page and Chromium throws
`__name is not defined`.

It looks exactly like a product defect and is a build-tool artefact. Every `evaluate` in
`scripts/verify/web.ts` passes a **string** instead, which nothing transpiles. Recorded because the
next person to add a check will reach for a closure first.

---

## V-9 · A grid track with a fixed minimum can scroll the whole page sideways

`repeat(auto-fit, minmax(280px, 1fr))` cannot shrink below 280px. At a 360px viewport, that plus the
card's 32px padding exceeds the viewport and the **document** scrolls horizontally — not the grid.

`minmax(min(280px, 100%), 1fr)` lets the track collapse to its container. Applied to every
`auto-fit` grid in the stylesheet, not only the one that was measured failing, because the others
differ from it by an arbitrary constant.
