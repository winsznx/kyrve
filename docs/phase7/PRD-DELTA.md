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

---

## W-1 · Two gates shared one broken helper, and neither imported it

**Phase 6 and Phase 7 each carried a private copy** of a function that extracted a node:test tally and
returned it as a **display string**. The gate then reported PASS with that string beside it, so a run
printing `8 passing, 1 failing` was recorded as a passing gate with its own failure visible in its own
output.

Eleven lines, duplicated, imported by nothing and checked by nothing. It was found by reading the
first real Phase 7 run — there was no test that could have caught it, because there was nothing to
test.

**Fixed in `scripts/lib/tally.ts`**, which returns COUNTS. The summary is rendered from those counts
rather than being the thing parsed, so no gate can decide an outcome by looking at prose.
`scripts/lib/tally.test.ts` proves the five rules, including the historical string verbatim.

**Phase 6's recorded evidence is untouched.** Its gate imports the shared helper now, but
`docs/phase6/GATE.md` stands as written: repairing an instrument is not the same as re-interpreting
what it measured, and re-running a closed phase is that phase's decision rather than this one's side
effect. The historical exposure is: any Phase 6 gate row backed by a Hardhat suite could have shown
PASS beside a failing test. The Capsule, Cross, Roll and attack rows are the ones affected.

---

## W-2 · A permanent absence of coverage is not a skipped check

**Phase 7 shipped** Slither-over-the-confidential-layer as a gate whose `skipIf` always returned a
reason, so it always reported SKIP.

That reads as "this check is pending". It is not: crytic-compile cannot drive solc 0.8.36 and will not
start being able to. A skip means *could have run, did not*; this is a permanent, reproduced absence.
Dressing it as a pending check also made zero skips unreachable, so the run could never report the
verdict it was supposed to be able to reach.

**Decision:** it is a **standing declaration**, printed before the verdict on every run, outside the
pass/fail/skip tally. Nothing about it is softer — P7-1 asks that a green gate must not imply the
layer is analysed, and a line that prints unconditionally does that better than a row in a skip count
nobody reads twice.

---

## W-3 · IPC does not survive `npx`, and the gateway port had to leave the process somehow

`NOX_HANDLE_GATEWAY_HOST_PORT` is set by the Nox plugin inside the Hardhat process and is invisible
outside it. The orchestrator has to learn it.

IPC was the first choice and was **measured not to work**: `spawn(..., stdio: [..., "ipc"])` through
`npx` and the `hardhat` shell wrapper leaves `process.send` undefined in the process that actually
runs. Two intermediate processes, and the channel does not cross them.

**Decision:** one sentinel-prefixed JSON line on stdout — `@@KYRVE-STACK-READY@@ {…}`. The orchestrator
matches the prefix and parses the payload; it never reads prose. This is the "JSON line" option rather
than a fallback to log scraping, and the distinction is that the line exists solely to be parsed.

---

## W-4 · Three teardown defects, each invisible until the run after the one that caused it

All three were found by `pnpm verify:stack`, which starts the stack **twice**. None would have shown
on a single run.

- **`npx` is an intermediate process.** SIGTERM to the child reaped `npx` and left `vite preview`
  holding port 4173 with its parent gone. Children now run in their own process groups.
- **Then group-killing the chain host skipped the plugin's `finally`**, which is what runs
  `docker compose down`, leaving six containers up. The host is signalled by pid so its own handler
  runs; the group kill is the escalation after a timeout.
- **`wrangler dev` is a supervisor.** Killing the `workerd` child it spawned made it start another, so
  four ports stayed bound after four "killed leftover" lines. The whole group goes, and the sweep
  recognises `workerd` — a Worker's command line does not mention wrangler at all.

---

## W-5 · Sequential Worker startup, because a race made one service look broken

Four `wrangler dev` processes racing through their first compile contend for CPU, and the keeper —
heaviest, because it carries a Durable Object and a Workflow — lost and exited 1. The orchestrator
discarded child output, so the failure was `keeper exited (code 1)` and nothing else.

**Two fixes, and the second matters more.** Workers start one at a time, gated on health. And every
child's last forty lines are kept, because a child whose failure is unattributable is worse than one
that fails loudly: the operator's only move is to run it by hand and hope it fails again.

---

## X-1 · Navigation exposed nine contract surfaces as if they were tasks

**Phase 7 shipped** Fund, Mandates, Request, Curve, Quotes, Series, Capsules, Roll and Proof across
the top of the application. Every one is a real surface. Not one of them is a task, so a first-time
reader had to model Kyrve's architecture before they could do anything at all.

**Corrected to four destinations** — Home, Activity, Positions, Verify — with the actions under them
chosen by role. **No route was removed**: every old path still resolves, still has a title, and is
still addressable by a technical reader. `pnpm verify:journeys` walks each of the three roles from a
browser that has never seen Kyrve, clicking only visible controls, and fails if any step can be
reached solely by typing a route.

---

## X-2 · The stage a reader is at is derived, never stored

A wizard that remembers "you are on step 3" is wrong the moment a keeper transaction lands, or
another device acts, or a tab has been open since yesterday.

Every step in Kyrve corresponds to a fact on chain, so `lib/journey.ts` READS the position instead:
a provider with a confidential balance and no lending terms is at "set your terms" whether or not
they have ever opened this screen.

That also makes the required "refreshing restores public workflow state" property true by
construction rather than by a restore path — reloading runs exactly the same reads as arriving for
the first time, so there is nothing to restore and nothing to get wrong.

---

## X-3 · Two storage keys, and a Phase 2 assertion that got stronger

A role has to survive a reload or every visit begins by asking who you are. `kyrve.role` and
`kyrve.onboarded` are now persisted, which contradicts the Phase 2 browser assertion that **zero**
keys are ever written.

That assertion was easy to make and weaker than it looks: it would have passed on a build that stored
a decrypted balance under a key it cleared on unload. What matters is not how many keys exist but
whether any holds a value that was decrypted.

**The assertion now names the permitted set and checks every stored VALUE** against the plaintext the
flow revealed, and refuses anything that looks like an amount. The decryption path is untouched —
`scripts/verify/privacy-scan.ts` still forbids every storage sink in `packages/nox/src/client.ts`,
which is the only module in the workspace that ever holds a plaintext.

---

## X-4 · The landing page disclaimed itself before it explained itself

A "What this is not" card sat in the narrative, between the mechanism and the call to action. Every
sentence in it was true and every one is still on the page — in the footer, where legal and technical
qualification belongs.

A reader who has not yet been told what the thing does cannot evaluate a caveat about it, and a
product that qualifies itself that early reads as unfinished. Nothing was softened or dropped.

---

## X-5 · One cobalt element per page survived contact with a strong closing CTA

Section F of the landing brief asks for a strong final action. The hero already holds this page's one
cobalt element, and `design.md` rations it to a single primary action per page — a rule `verify:web`
counts and enforces.

**Decision:** the closing call is a large ghost outline rather than a second cobalt fill. The rule
wins, and it is the right outcome: the eye should land on the hero's resolved point, which is the
whole visual argument the mark makes.

---

## X-6 · Three hardening checks were wrong about what counts as decided

Added in this pass and immediately wrong, all three found by running them:

- a page offering a **role choice** is not a dead end, but had no primary action;
- `/app/start` is chromeless by design, so requiring `aria-current` on it failed a page that
  deliberately has no navigation;
- a page still **reading the chain** is pending, not undecided. The check failed on a capsule detail
  caught mid-read, and "wait longer" would have made it slower without making it truer.

The ratio is now familiar: a check written from a requirements list rather than from a run measures
something adjacent to what was asked for. Run it, read every finding, and fix the check before the
product.
