# Phase 7 gate

`pnpm verify:phase7`. Closing run: **25 passed, 0 failed, 0 skipped.**

> **VERDICT: PASS** — every gate executed and passed.

The earlier run recorded here was 21 passed, 0 failed, 1 skipped — a CONDITIONAL PASS. Two things
changed to reach an unconditional one, and neither weakened a check: the local stack and the connected
Capsule flow became executable gates rather than open conditions, and the Slither entry stopped
pretending to be a check it could never be (delta W-2).

The three lines the gate prints on every successful run, because each is a claim that would
otherwise widen by nobody noticing:

- **THE ROLL IS MINIMAL, AND THAT IS THE CLAIM.** One intent against one supply between two series
  that share no contract. The interface over it shows no maturity ladder, no roll-to-any-series
  control and no queue, because none of those exists.
- **NO CLOUDFLARE RESOURCE WAS CREATED.** The Workers compile under `wrangler deploy --dry-run`,
  which publishes nothing and needs no authentication. Every binding still carries the placeholder
  id.
- **UNVERIFIED BY SLITHER.** The confidential layer has no static-analysis coverage. Phase 7 added a
  browser and a set of Workers, which get none of Slither's detectors either.

---

## What ran

| Section | Gate | Result |
|---|---|---|
| The product | every required route is declared, with a title and a description | 19 routes, all 19 required |
| The product | the lifecycle vocabulary is closed, and every required state is reachable | 13 required states, declared and reachable |
| The product | the web product typechecks and builds | clean |
| The product | the approved brand assets are unmodified and reach the bundle | 18 exports, 8 favicon sizes, OG exact |
| Journeys | provider and borrower, in a real Chromium against real Nox and real Midnight | 9 passing |
| Journeys | activation, refused partial fill and exact settlement | 9 passing |
| Journeys | confidential ownership, and another wallet refused, in two browser contexts | 4 passing |
| Journeys | the proof page disagrees with a record that lies | 10 passing |
| Journeys | the Capsule and auditor flow, three browser contexts, live stack | 9 claims |
| Journeys | the local stack, clean start, stop, and start again | two instances |
| Journeys | every role reaches its first task by clicking, and only by clicking | 3 roles walked |
| Hardening | a gate cannot report PASS over a failure, a skip or an empty run | 8 regression tests |
| Hardening | every route in a real browser: refresh, metadata, keyboard, design rules, links | 22 routes, no finding |
| Hardening | no secret reaches the client bundle | 0 inlined |
| Hardening | no decrypted value reaches a record, a log or a metric | pass |
| Hardening | no secret, key or RPC credential in the tree | pass |
| Hardening | every dependency advisory is closed or overridden | 1 low, overridden |
| Hardening | the scripts typecheck and the generated files are current | 6 paths byte-identical |
| Hardening | the import boundary holds | pass |
| Hardening | formatting and lint | biome and forge fmt clean |
| Quality | git identity and a clean working tree | winsznx, no co-author trailers |
| Quality | Slither over the settlement layer | 0 High/Medium in 7 deployed paths |
| Quality | every published fact recomputed from chain state, per layer | layer a 12/0/0, layer b 10/0/2 |
| Not deployed | every Worker compiles, and nothing is published | dry-run only |
| Not deployed | no Cloudflare resource was created | placeholder ids intact |

---

## Standing declaration

**UNVERIFIED — Slither over the confidential layer.** Printed before the verdict on every run, outside
the pass/fail/skip tally. crytic-compile will not drive solc 0.8.36 (delta U-5, exact reproduction).
Not a pass and not a fail: a permanent absence of static-analysis coverage, not a check that might one
day run. Compensating evidence is direct 0.8.36 compilation, the full suite against real Nox, the
attack suite, and the contract-size and gas-cap checks — real, and not the same thing.

---

## Findings, and what they cost

### F7-1 · The gate reported PASS beside a failing test run

`testTally` extracted the node:test tally and returned it as the gate's **detail string**. A run
printing `8 passing, 1 failing` was therefore recorded as a passing gate with the failure visible in
its own output.

This is the exact defect every gate in this repository exists to prevent, sitting inside the gate. It
was found by reading the first real run rather than by a test, which is worth saying plainly: nothing
would have caught it.

`testTally` now parses the failing count and throws. Phase 6's gate has the same shape and the same
latent hole; it is recorded here rather than silently changed, because altering a closed phase's gate
is a decision and not a tidy-up.

### F7-2 · The privacy lock stopped saying what locking does not do

Locking clears decrypted values from memory. It **does not revoke anything** — the wallet keeps every
ACL grant it held, because Nox has no `removeAdmin` and no `removeViewer`.

That sentence lived in the single-page terminal's privacy-lock panel. When the control moved into the
masthead the count came with it and the sentence did not. A reader who took "lock" to mean "withdraw
access" would have had exactly the wrong model of a permanent grant, and the browser suite caught it
because it asserts the product says so.

### F7-3 · Two verification claims looked like a mnemonic to the secret scanner

`"the vault that issued this capsule serves the series this record names"` is twelve consecutive
lowercase words in a quoted string, which is what `verify:secrets` looks for. The prose was reworded.
The detector was not touched: a scanner relaxed for writing convenience stops being a scanner, and
this one already carries a comment explaining that an earlier, looser version cried wolf.

### F7-4 · `/app/series` scrolled the page sideways at 360px

A `minmax(280px, 1fr)` grid track cannot shrink below its floor, so on a 360px viewport the fact list
plus its card padding pushed the whole document wider than the viewport. `min(280px, 100%)` lets the
track collapse instead. Measured, not eyeballed — `verify:web` failed on exactly 16px.

### F7-5 · A whole route sat outside the navigation

`/app/cross/:seriesId` had nothing carrying `aria-current`, because a Cross order is always against
one series and has no top-level section of its own. Series now owns it. A route no navigation item
claims is a route a screen-reader user cannot locate themselves in.

### F7-7 · Three teardown defects, each invisible until the run after the one that caused it

Found by `pnpm verify:stack`, which starts the stack twice. Delta W-4 has the detail. In order: `npx`
is an intermediate process so SIGTERM left `vite preview` orphaned; group-killing the chain host then
skipped the plugin's `finally` and left six containers up; and `wrangler dev` is a supervisor that
respawns a killed `workerd`, so four ports stayed bound after four "killed leftover" lines.

The second start is the assertion. A single-start proof would have passed on all three.

### F7-8 · The check on the tally suite got its own evidence wrong, twice

The gate row that runs the tally regression tests matched `(\d+) passed` — which caught vitest's FILE
count, reporting "1 regression tests" for a suite of eight. Anchoring on `Tests` then failed to match
at all, because vitest colourises its summary and the escape codes sit between the label and the
number.

A gate that miscounts its own evidence is a smaller version of the defect the suite underneath it
exists to prevent, and it is the argument for parsing counts rather than reading output formatted for
a human.

### F7-6 · Two hardening checks were measuring the wrong thing

Both were found by running them, and both would have produced confident nonsense forever:

- the forbidden-copy list contained the bare word **placeholder**, which this product uses precisely
  to say it does not ship placeholder proofs or placeholder terms. A check that pushes the discussion
  out of the interface is worse than no check. The list now names unfinished-work markers.
- Chromium's own `Failed to load resource` was being counted as an uncaught browser error. With no
  local node running, every page correctly reports the chain as unavailable — so the check failed
  precisely when the interface behaved as designed. Network-layer failures are now separated from
  anything the application threw or logged, and counted as a note.

---

## What this gate does not prove

- **It is not an accessibility audit**, and `verify:web` says so on every run. It checks a fixed list
  of structural properties that can be checked mechanically. A real audit involves a person and
  assistive technology.
- **It does not prove the deployed bytecode is the audited bytecode.** `getCode` proves the record
  does not name an empty account. Bytecode comparison is `pnpm verify:deployed-bytecode`, against a
  compiled tree a browser does not have.
- **It does not analyse the confidential layer**, and never will until crytic-compile can drive solc
  0.8.36.
- **It does not prove the Capsule and auditor flow on a public network.** It is local, against a real
  Nox stack and real unmodified Midnight, on chain 31337.
