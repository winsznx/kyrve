# Phase 7 prerequisites

Phase 7 is the Cloudflare application and the final web work — the two things Phase 6 was explicitly told
not to start. None of it begins before this file is read.

Phase 6 separated seven operational roles and proved the separation on chain, shipped Capsule, Cross and
Roll, stood up a **second complete confidential issuance stack** so a roll had two real series to move
between, and finished on a public network: 43 contracts verified across two compiler pins, one real
Capsule, one real Cross match, and one minimal coherent Roll.

Seven entries below. Each is a constraint Phase 6 established by measurement or by failure, and each recurs
at a point where the consequence is a leaked credential, a permanent disclosure, or a page that reports a
verdict it did not compute.

---

## P7-0 · Phase 6 IS finished, and here is what it left on chain

Discharged. `pnpm verify:phase6` reports **21 passed, 0 failed, 1 skipped** — the skip being Slither over
the confidential layer, which by construction can never pass (P7-1). `docs/phase6/GATE.md` records the run.

**What Phase 7 builds on, on Ethereum Sepolia.** Two independent stacks of 19 contracts each sharing zero
addresses, plus a market layer of three:

```
layer A series  0x07af68de01aa80ca39…   token 0x61fcb2a7623bb15622b1303d0bf819247078f178
layer B series  0x4066880587d1792630…   token 0xd085176a07a3764fad5b872f2b05cb34f931d314
KyrveCapsuleVault  0x488d9d4348e6de9aad8750eda035968f09bfd896
KyrveCrossBook     0xbfae69cee2c1a26e213041475bdfcdcb9ca827ad
KyrveRollBook      0x3c1e083c538ecaba5cd449e4393755dcc8bdfc8e
```

Seven role holders, all distinct, all declared in two `KyrveRoleRegistry` deployments whose constructors
reject collapsed pairs on chain. `pnpm roles:reconcile` is the receipt-level proof of what each one
actually signed.

**One capsule, one Cross match and one Roll exist on chain and are permanent.** The capsule's grant cannot
be withdrawn, both published residuals cannot be un-published, and any Phase 7 interface that describes
them must use the vocabulary in P7-3.

---

## P7-1 · The confidential layer has no static analysis, and Phase 7 adds a Worker to the same repository

`crytic-compile` cannot be made to drive solc 0.8.36 (delta U-5, exact reproduction included). This is
**open**, reported as UNVERIFIED on every gate run, and it will not fix itself when a Worker arrives.

Two consequences for Phase 7:

- **Do not let a green `verify:phase7` imply the confidential layer is analysed.** Whatever gate Phase 7
  adds must carry the same `UNVERIFIED BY SLITHER` line forward, or the phase will have quietly widened the
  claim.
- **The Worker is a new analysis surface with different tooling.** TypeScript in `workerd` gets none of
  Slither's detectors either, and the compensating evidence for a Worker is not the same list as for
  Solidity. Name it explicitly rather than inheriting §4 of `docs/phase6/SECURITY.md` by proximity.

---

## P7-2 · An Ethereum key in a Worker secret is a hot wallet, and Phase 6 already leaked an RPC credential twice

U-F1: an Alchemy API key reached stdout **twice**, from two different scripts, because viem's error
formatting includes the full request URL and 36 scripts had a top-level `console.error(error)`. It was
fixed with `redactUrls` / `safeErrorMessage` across 32 scripts.

A Worker makes this strictly worse in three ways, and each needs a decision **before** the first
`wrangler secret put`:

- **Anyone with deploy rights can exfiltrate a Worker secret.** `.claude/rules/security.md` already
  requires that value ceilings and target allowlists be enforced **on chain**, not in the Worker. Phase 6
  gives you the place to put them: the keeper is an `immutable` on every book, and `KyrveRoleRegistry`
  makes the intended holder publicly declared.
- **Worker logs are a disclosure surface.** `redactUrls` covers thrown errors in scripts; a Worker's
  `console.log`, its tail consumer, its metric labels and its `observability` traces are four more places a
  URL or a handle-plus-plaintext pair can land. `verify:privacy-scan` does not currently read Worker code.
- **Only the keeper's work is delegable.** The keeper advances computation and cannot choose inputs or
  change outcomes — that is exactly the role a Worker should hold, and the reason the campaign put
  `matchOrders` and `netRoll` behind `onlyKeeper`. **Do not give a Worker the curator or the deployer.**

---

## P7-3 · Three permanent disclosures now exist on chain, and the interface vocabulary is fixed

Nox has no `removeViewer`, no `removeAdmin`, and no way to un-set `allowPublicDecryption`. Phase 6 created
one permanent grant and two permanent publications on a public network.

| what exists | what a Phase 7 page may say | what it may never say |
|---|---|---|
| the auditor's capsule grant | "live access ended", "future snapshots disabled", "this historical snapshot remains available" | "access revoked", "the auditor can no longer read this" |
| the published Cross residual | "public since block N, permanently" | "hidden", "expired", "no longer visible" |
| the published Roll residual | as above | as above |

**A capsule's expiry stops it asserting, not its recipient decrypting** (delta U-3, U-F10). `assertsValidAt`
is the only thing expiry governs. A Phase 7 interface that renders an expired capsule as "no longer
readable" would be stating the opposite of the truth about a permanent grant.

---

## P7-4 · A verification page must recompute, and Phase 6 has the executable proof of what that means

`apps/web/src/components/VerifyBand.tsx` states a fact, reads the chain for it, and compares — the
deployment record supplies addresses and is never the source of a verdict. Demonstration 24 proves this the
only way it can be proven: the served record is rewritten with a **false series id** and the page must turn
that row red on its own, showing both values.

Three properties to preserve when Phase 7 puts this behind a Worker:

- **A cached or indexed value is a manifest.** The moment a proof page reads a fact from D1, R2 or a
  Worker's KV rather than from chain, it is displaying a record again. Either read the chain in the page,
  or label the cached value as a cached value and give the reader the recomputation.
- **`UNAVAILABLE` is a third verdict and it is load-bearing.** Layer B has no Capsule vault of its own.
  Reporting that as pass or fail is a lie in one direction or the other, and U-F6 is what happens when the
  wrong contract gets attached instead.
- **The downloadable artefact carries public values only** and states what it is not: a recomputation at
  one block by one browser over the listed checks, not an audit. It also says gateway proofs are signatures
  over a released plaintext rather than zero-knowledge proofs. Neither sentence is decoration.

---

## P7-5 · The Roll is minimal, and Phase 7 must not let a UI imply otherwise

One intent against one supply between two series. The expensive part of a larger roll is repeating the
whole confidential issuance stack per maturity (delta U-1) — `bindSettler` is one-shot and the settler holds
its series, token, ownership registry, vault and market as immutables, so **one custody vault serves exactly
one series** and there is no configuration that makes a third maturity cheap.

A Phase 7 interface showing a maturity ladder, a "roll to any series" control, or a queue of pending rolls
would be describing a system that does not exist. `pnpm verify:phase6` prints
`THE ROLL IS MINIMAL, AND THAT IS THE CLAIM` on every run for this reason.

Two related traps, both already paid for:

- **`SupplyState.Open` is public and says nothing about remaining inventory** (delta U-9, U-F8). A keeper
  dashboard listing "open supplies" would be listing supplies that may be drained to dust. Only the
  supplier can read their own escrow.
- **A Roll is not atomic and nothing claims it is** (U-F11). `statusOf` returns the next action so an
  interrupted roll resumes; a progress bar that implies a single transaction would be the claim the
  contracts deliberately do not make.

---

## P7-6 · The Cloudflare limits that decide the architecture, before any code

Unchanged from `.claude/rules/cloudflare.md` and restated because Phase 7 is the phase that hits them:

- **The Free plan is not viable for an indexer.** 50 subrequests. D1 and R2 calls count against the same
  budget as RPC calls.
- **6 simultaneous connections** awaiting response headers. Cap RPC fan-out at 6.
- **D1 is not the primary store for a blockchain event index** — 10 GB hard cap, single-threaded per
  database. Bulk data in R2 partitioned by block range; a bounded queryable projection in D1.
- **Workflow step return is 1 MiB, hard.** Return R2 keys, never payloads.
- **Nonce allocation needs a Durable Object.** Transaction submission is non-idempotent and Workflows retry
  by default. Pre-sign with an explicit nonce and check whether it is already pending.
- **`wrangler.jsonc` is the source of truth**, and the authoritative reference for key names is
  `node_modules/wrangler/config-schema.json`, not the docs prose.
- **`viem` in `workerd` is not officially attested.** Prove it with `wrangler deploy --dry-run --outdir
  dist` and grep for `[unenv] … is not implemented yet!` before relying on it. Kyrve's whole client path is
  viem.

---

## Carried forward, still binding

Every constraint from `docs/phase3/PHASE-4-PREREQUISITES.md` and `docs/phase5/PHASE-6-PREREQUISITES.md`
remains in force. The five that Phase 6 touched and did not relax:

1. **`cellsPerChunk` ≤ 192.** EIP-7825's 16,777,216 gas cap. `verify:gas-cap` is the regression gate.
2. **One-shot bindings are one-shot.** `SettlerAlreadyBound` is the correct refusal and it names nothing
   about the cause; delta U-1 is what it cost to learn that the second time.
3. **The wrapper must wrap the market's own loan token.** Delta T-10.
4. **No gas indistinguishability is claimed**, for any path in any phase.
5. **No decrypted value reaches a server, log, metric or database.** Phase 7 is the phase that introduces
   the server. This is where that invariant gets its first real test.
