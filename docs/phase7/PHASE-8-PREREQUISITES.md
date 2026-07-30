# Phase 8 prerequisites

Phase 8 is the Cloudflare deployment. Phase 7 built the product and deliberately created no
Cloudflare resource; `pnpm verify:phase7` proves that on every run by checking that every binding
still carries the placeholder id.

Everything in `docs/phase6/PHASE-7-PREREQUISITES.md` remains in force. P7-1, P7-2, P7-4 and P7-6 are
about the Worker and have not been discharged — they were carried, not closed.

---

## P8-0 · Phase 7 IS finished, and here is what it left behind

Discharged. `pnpm verify:phase7` reports **24 passed, 0 failed, 0 skipped**. Both conditions this
document originally opened with are closed:

**`pnpm stack:local` starts the whole local product from one command** and does not report READY until
every health check answers. It owns the gateway port — Docker assigns it, the Hardhat plugin discovers
it, and the chain host publishes it on one sentinel-prefixed JSON line into `.runtime/local-stack.json`
so nothing else rediscovers it. `stack:local:status` and `stack:local:stop` are its other two halves,
and `pnpm verify:stack` proves the whole thing from a clean machine state twice, because teardown
defects are invisible on a first run.

**The connected Capsule and auditor flow runs in three browser contexts against the live stack.** The
provider reads their own claim, seals a capsule for the auditor through the interface, and then burns
part of their own balance — a real holder action, by the holder's own key. The auditor decrypts the
frozen snapshot and gets the value from before the burn; is refused the provider's current balance on
chain; and a third wallet is refused the capsule entirely. Refresh restores the public metadata and
not the plaintext, and ending the session removes it from the DOM.

**What Phase 8 inherits that it cannot undo.** The four browser suites each start their own chain on
port 8545, so they cannot run while a stack is up — `pnpm demo:phase7` refuses to try and says why.
That is a real constraint rather than an oversight: the suites are reproducible precisely because each
one owns its stack for the length of its run. The full demonstration is two invocations,
`--capsule` against a live stack and `--suites` without one, and `verify:phase7` runs both halves and
reads the evidence each leaves.

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
