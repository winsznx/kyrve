# Kyrve — agent orientation

Kyrve converts encrypted lender mandates and borrower requirements into **one** executable Morpho
Midnight offer while the full yield curve, provider allocations, exposure limits, rejected
alternatives and beneficial ownership stay private.

> One quote. The curve stays private.

Do not guess contract addresses, package versions, or protocol signatures. Everything verified is
locked in [`source-lock.json`](source-lock.json) with reproduction commands in
[`docs/day0/SOURCE-LOCK.md`](docs/day0/SOURCE-LOCK.md).

## Read before acting

| Question | Where |
|---|---|
| What is the product? | `kyrve-production-prd.md` (immutable) |
| What does it look like? | `design.md` (immutable) |
| What must the submission contain? | `hack.md` (immutable) |
| Where is the PRD wrong? | `docs/day0/PRD-DELTA.md` |
| Is this assumption proven? | `docs/day0/VERDICT.md` |
| What are the exact versions? | `source-lock.json` |
| Can we ship this licence? | `docs/day0/LICENSE-MATRIX.md` |

The three immutable documents are never edited. Corrections go to `docs/day0/PRD-DELTA.md`.

## Skills

- `/morpho-docs` — before touching anything on the Midnight settlement path.
- `/nox-docs` — before writing confidential contract or client code.
- `/kyrve-validation` — before accepting any load-bearing architectural assumption.

## Subagents

`protocol-source-auditor` · `nox-primitive-auditor` · `midnight-integration-auditor` ·
`cloudflare-runtime-auditor` · `security-adversary` · `test-evidence-reviewer`

All are read-only. Their reports are **input, not conclusions** — reconcile findings against the
primary source before acting on anything that changes a decision.

## Architecture in one pass

```
encrypted mandates + encrypted request
        -> Nox curve engine (eligibility, capacity, privacy floor, leaf selection)
        -> one publicly decrypted leaf: market, rate, aggregate amount
        -> KyrveQuoteRatifier  (authenticates the exact offer + approved taker)
        -> KyrveSeriesVault.onBuy (enforces exact units and exact assets)
        -> unmodified Morpho Midnight take()
        -> public credit position, confidential ERC-7984 beneficial ownership
```

The two enforcement points are not redundant. `isRatified` is `view` and never receives `units`, so
it **cannot** enforce fill size; `onBuy` is the only place actual fill size reaches maker code.

## Invariants that must never break

1. A confidential failure never produces a public reason.
2. One quote settles at most once, only for the approved taker, only at the exact units.
3. The sum of encrypted allocations equals the Midnight credit received.
4. Aggregate confidential claims never exceed series-vault coverage.
5. No decrypted value ever reaches a server, log, metric or database.

Detailed rules live in `.claude/rules/`, path-scoped. Read `CLAUDE.md` first.

## Phase 3 — the confidential curve engine

`confidential/` is a separate Hardhat project at solc **0.8.36**, because
`nox-protocol-contracts@0.2.4` requires `^0.8.35` while the Midnight substrate is pinned at 0.8.34
for bytecode comparability. Anything importing `sdk/Nox.sol` belongs there, not in `contracts/`.

Its tests run against the **real** iExec Nox stack in Docker — real handles, real gateway proofs.
A mocked NoxCompute would be a mocked confidentiality path and is forbidden.

Six constraints that are easy to violate and hard to notice:

- **Nox handles are deterministic in their operands.** Two logically distinct encrypted quantities
  computed identically from identical inputs are ONE handle with ONE permanent ACL entry. Everything
  granted to a user or the public goes through `KyrveCurveBase._isolate` first; intermediates collide
  freely and harmlessly. `docs/phase3/HANDLE-LINEAGE.md` is the proof, and delta R-6 explains why the
  obvious test for this passes with the defence removed.
- **The local node is more permissive than any real chain, in two ways.** It allows unlimited
  contract size — and cannot be made not to, because NoxCompute itself is over EIP-170 — so
  `verify:contract-size` carries that check. Its clock outruns wall clock until every gateway proof
  looks expired, which `allowBlocksWithSameTimestamp` prevents. Deltas R-10 and R-12.
- **A valid decryption proof says nothing about which quote a value belongs to.** Bind through
  `CurveGraphRegistry`, and predict handles with `@kyrve/nox`'s `deriveHandle` — which is verified
  against handles a live NoxCompute returned, unlike the Phase 1 formula it replaced. Delta R-4.
- **The gateway returns a plaintext at its NATURAL width.** A published `euint16` is two bytes and
  `abi.decode` reverts with no reason. Use `DecryptedValue.toUint`. Delta R-5.
- **Input proofs carry no nonce and no consumption marker.** Use `KyrveConfidentialBase`'s one-shot
  handle consumption and per-owner nonce on every entry point. Q-2.
- **The pause enum has no recovery member, and must never gain one.** Q-6 and PRD invariant 20.

The measured operation budget replaces the Day 0 one: every stage costs more, stage B's unit is
(provider, market) rather than provider, and the launch epoch is **25 transactions** and ~301M gas —
22 until Phase 4 lowered the chunk width. Size anything against `@kyrve/curve`'s `CURVE_STAGE_GAS`.
Deltas R-3 and S-2.

Run `pnpm verify:phase3`. Read `docs/phase3/PHASE-4-PREREQUISITES.md` before starting quote
activation.

## Phase 4 — quote activation and Midnight settlement

`contracts/kyrve/` is the settlement layer, at solc **0.8.34** with the substrate's settings, because
it imports Midnight interfaces and libraries directly and must stay byte-comparable with the pinned
release. It reaches the confidential layer through `contracts/kyrve/interfaces/ICurveLayer.sol` —
declared, never imported, because the two compiler pins are mutually exclusive. `verify:curve-abi`
compares those declarations against the compiled 0.8.36 artifacts, selectors and return shapes both.

Five things that are easy to get wrong and were:

- **A single transaction may not exceed 2^24 = 16,777,216 gas.** EIP-7825, Osaka. Phase 3 sized its
  widths against 24,000,000, measured on a node with no such cap, and `accumulateLeafChunk` at 256
  cells was 18,193,386 — the one width over the limit, and the reason the launch universe was not
  executable. The bound is now 192 cells. `verify:gas-cap` is the regression gate and
  `confidential/test/08-chunk-width.ts` keeps 256 as a negative fixture. Delta S-2.
- **The local Nox node must be an L1 at `osaka`.** The plugin's default is an OP chain at Isthmus,
  where CLZ is an INVALID opcode — everything deploys, a whole epoch completes, and then
  `Midnight.take` dies with a bare `invalid opcode`. `confidential/test/09-osaka.ts` runs first and
  catches it in 250 ms. Delta S-1.
- **`aggregateFill` is the sum of RESERVED allocations, never the winning leaf's capacity.** They
  differ by floor-division dust. Units round down from the aggregate and buyer assets round down from
  the units, so the maker never owes more than providers committed. Nothing reconstructs a fill from
  capacity, and `contracts/kyrve/test/SettlementHarness.sol` pins the 300,000,000 / 299,999,999 case.
- **Two Solidity files may not share a basename.** Foundry keys artifacts on it and silently drops
  one on a successful build — proven, not assumed. `verify:basenames` refuses it. This is why the
  production ratifier is `KyrveSettlementRatifier`: Phase 1's `KyrveQuoteRatifier.sol` is deployed on
  Sepolia with its runtime hash locked. Delta S-3.
- **The activated offer is recovered from `OfferPublished`, never from a simulation.** `offer.start`
  is `block.timestamp`, so a simulated offer differs from the mined one in exactly the field
  `offerHash` covers. Delta S-5.

Exact fill is composed across two contracts and cannot be collapsed: `isRatified` is `view` and never
receives `units`, and Midnight permits `newConsumed <= offer.maxUnits`, so
`KyrveSeriesVault.onBuy` is the only place fill size reaches maker code.

Phase 4 settles from **public** funding. A curve reservation is still not a capital lock — P4-2 is
open on purpose, and delta S-6 says so. Run `pnpm verify:phase4`.
