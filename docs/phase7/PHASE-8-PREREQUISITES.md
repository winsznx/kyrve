# Phase 8 prerequisites

Phase 8 is the Cloudflare deployment. Phase 7 built the product and deliberately created no
Cloudflare resource; `pnpm verify:phase7` proves that on every run by checking that every binding
still carries the placeholder id.

Everything in `docs/phase6/PHASE-7-PREREQUISITES.md` remains in force. P7-1, P7-2, P7-4 and P7-6 are
about the Worker and have not been discharged — they were carried, not closed.

---

## P8-0 · Two things Phase 7 was asked for and did NOT deliver

Stated first, because a prerequisites document that opens with what went well is a document nobody
reads for what is missing.

### The local production stack does not start from one command

There is no `pnpm stack:local`. The pieces exist and each runs — `npx hardhat test` in `confidential/`
boots the real Nox stack through the plugin, `pnpm deploy:confidential local` writes a record,
`pnpm web:dev` serves the terminal, and `pnpm wrangler:dry-run` compiles the Workers — but nothing
composes them.

A `stack:local` entry was added to `package.json` and then **removed**, because the script behind it
was not written and a package script that fails is worse than an absent one.

What it needs, and why it is not trivial: the Nox stack's host port is assigned at startup and is
discovered through the Hardhat plugin's `handleGatewayUrl()`, which currently only exists inside a
Hardhat process. Composing the stack means either driving Hardhat as a long-running node and reading
that port out, or teaching the deploy script to publish it. Neither is hard; both are a decision about
where that port's source of truth lives.

### There is no single 15-step connected demonstration

The connected lifecycle **is** demonstrated end to end, in a real Chromium against real Nox and real
unmodified Midnight — but across four suites rather than one, and they cover thirteen of the fifteen
required steps:

| Step | Where | State |
|---|---|---|
| provider funds a confidential balance | `70-browser-flow.ts` | covered |
| provider submits a mandate | `70-browser-flow.ts` | covered |
| borrower submits a request | `70-browser-flow.ts` | covered |
| curve epoch completes | `80-curve-epoch.ts`, `91-settlement-browser.ts` | covered |
| one public quote appears | `91-settlement-browser.ts` | covered |
| partial fill is refused | `91-settlement-browser.ts` | covered |
| exact settlement succeeds | `91-settlement-browser.ts` | covered |
| provider receives confidential ownership | `101-series-browser.ts` | covered |
| another wallet cannot decrypt | `101-series-browser.ts` | covered |
| Cross match completes | `120-cross.ts` | covered, **not in a browser** |
| Roll completes between two series | `130-roll.ts` | covered, **not in a browser** |
| proof pages verify the lifecycle | `130-roll.ts` demonstration 24 | covered |
| provider creates a Capsule | — | **not demonstrated in a browser** |
| auditor decrypts the frozen snapshot only | — | **not demonstrated in a browser** |
| refresh restores public state without leaking private state | `verify:web` refreshes every route | partially — refresh is checked, the private-state half is not |

The Capsule and auditor routes are built and typecheck; nothing drives them in Chromium. Do not
describe the browser demonstration as complete until they do — and note that the auditor step is the
one that would catch a real defect, because it is the only place a grant to a *different* wallet is
exercised through the interface.

---

## P8-1 · The four hardening checks that were measuring the wrong thing

`verify:web` found eight things on its first run and **four of them were the check's fault**. That
ratio is the point: a hardening check written from a requirements list rather than from a run will
confidently measure something adjacent to what was asked for.

Before adding a check to `verify:web`, run it against the current product and read every finding. Two
of the four would have failed forever (the word "placeholder" in prose that exists to say the product
has none; Chromium's own network-failure message counted as an application error), and both would
eventually have been "fixed" by weakening the product rather than the check.

---

## P8-2 · A Worker is a new disclosure surface and `verify:privacy-scan` does not read it

Unchanged from P7-2 and still open. `redactUrls` covers thrown errors in scripts and now covers the
browser too — `apps/web/src/lib/redact.ts` is a deliberate second implementation, because
`scripts/lib/env.ts` reads `process.env` and cannot be imported into a bundle.

A Worker adds four more places a URL or a handle-plus-plaintext pair can land: `console.log`, the tail
consumer, metric labels, and `observability` traces. None of them is scanned today.

---

## P8-3 · Only the keeper's work is delegable, and the interface now shows what that means

`KyrveRollBook.netRoll` and `KyrveCrossBook.matchOrders` are `onlyKeeper`, and the Roll page renders
`statusOf`'s **next action** rather than a progress bar for exactly that reason: the thing a user is
waiting for is a keeper transaction they do not sign.

A Worker holding the keeper key is the intended shape. Do not give a Worker the curator or the
deployer — value ceilings and target allowlists belong on chain, where a Worker secret cannot reach
them, and `KyrveRoleRegistry` already declares the intended holder publicly.

---

## P8-4 · The proof pages read the chain in the browser, and that is load-bearing

P7-4 says a cached or indexed value is a manifest. The proof pages hold to it: every verdict comes
from a `publicClient` read in the page, at one block read once and named in the artefact header.

The moment a proof page reads a fact from D1, R2 or a Worker's KV, it is displaying a record again.
If Phase 8 puts an indexer in front of them, each cached value has to be **labelled as cached** and
the recomputation offered beside it — and the `reported-not-verified` verdict already exists for
precisely that shape.

---

## P8-5 · `viem` in `workerd` is still not attested

Kyrve's whole client path is viem, and the Workers compile under `wrangler deploy --dry-run` today.
That is a compile, not an attestation. Before relying on it, grep the dry-run output for
`[unenv] … is not implemented yet!` and never import `viem/node`, which is IPC and filesystem only.

---

## Carried forward, still binding

1. **`cellsPerChunk` ≤ 192.** EIP-7825's 16,777,216 gas cap.
2. **One-shot bindings are one-shot.** `SettlerAlreadyBound` names nothing about its cause.
3. **The wrapper must wrap the market's own loan token.**
4. **No gas indistinguishability is claimed**, for any path in any phase.
5. **No decrypted value reaches a server, log, metric or database.** Phase 7 put a browser in front of
   the protocol and kept that true — the page contacts three origins, measured rather than promised.
   Phase 8 introduces the server, and this is where the invariant gets its real test.
