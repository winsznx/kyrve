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

## Phase 5 — confidential series ownership

`KyrveCustodyVault` is the P5-1 discharge and the first Kyrve contract that takes custody. A curve
reservation now moves real capital: **one** `safeSub`, against the provider's live balance, in the same
contract that holds the ERC-7984 coverage backing it. `ReservationLedger` keeps epoch state and performs
zero subtractions — the parallel remainder it used to keep is exactly what made `sum(reserved)` and the
capital that can pay two independent quantities (delta S-6). Read `docs/phase5/P5-1-DECISION.md` before
changing anything on that path; the rejected option is recorded beside the chosen one.

Six things that are easy to violate and hard to notice:

- **Series supply is the published aggregate.** Not the leaf capacity, not the Midnight units, not the
  borrower's assets. On the measured fixture all four differ and minting against units over-issues by 600.
  `KyrveSeriesToken.mintClaim` has no overload that takes a number, so this is structural — and the
  unit-to-asset conversion is a PUBLIC redemption factor derived on chain from two public numbers. Delta
  T-1.
- **There are TWO residues and both are 1.** `capacity − aggregate` is private forever; publishing it
  discloses the winning leaf's capacity by subtraction. `aggregate − buyerAssets` is public and is real
  loan tokens with an immutable declared destination. Never assert "the residue is 1" without saying
  which. Delta T-2.
- **Funding is keyed on the EPOCH, allocation on the QUOTE.** `QuoteActivator.activate` calls
  `prepareQuote`, which refuses a vault that cannot already pay — so the money must land before a quote id
  exists. Quote-keyed funding deadlocks. Delta T-9.
- **A real lock rewrites the balance handle**, and a Nox ACL entry is per handle rather than per slot. The
  engine needs a fresh permanent grant each epoch; it cost three Phase 4 test failures on second and third
  epochs. Delta T-8.
- **The wrapper must wrap the market's own loan token.** Three phases tolerated two test tokens because
  nothing crossed back; the moment one did, activation reverted `FundingShortfall(600000509, 0)` on a run
  where every encrypted step succeeded. Delta T-10.
- **Transient access is a full grant.** `lendSupply` originally took its recipient as a parameter, which
  let any caller publish the aggregate supply irreversibly. Finding F-1. One bind-once address now.

`AggregateSolvencyVerifier` proves `supply + pendingEntitlements <= credit + reserves − fees` with a fully
public right-hand side and publishes only the verdict bit. It deliberately does **not** prove the custody
vault's own Q-6 accounting: that needs an encrypted `sum(available)`, and an aggregate beside a provider's
balance is the Q-5 mechanism. Delta T-7.

Run `pnpm verify:phase5`. Read `docs/phase5/PHASE-6-PREREQUISITES.md` before starting Cross, Roll, Capsule
or Cloudflare — P6-0 records the two PASS conditions this phase did not execute and what stands in their
place.

## Phase 6 — market operations

Seven operational roles, pulled apart into seven addresses before any value-bearing feature shipped.
`KyrveRoleRegistry`'s constructor rejects a zero holder and **every duplicate pair**, on chain — separation
is a deployment-time property, not a modifier someone can forget on one function. `docs/phase6/ROLES.md`
carries the authority, rotation, loss and compromise story per role; `pnpm roles:reconcile` proves what the
keys actually **did** by walking receipts, because that is a different claim from what a deploy script
intended.

Three features live in `confidential/contracts/` at solc 0.8.36: `KyrveCapsuleVault` (frozen selective
disclosure), `KyrveCrossBook` (confidential secondary transfer) and `KyrveRollBook` (confidential migration
between maturities). The market layer is its own deployment record because a Roll book cannot exist until a
**second complete series** does.

Six things that are easy to violate and hard to notice:

- **A roll needs two complete stacks, not two quotes.** `bindSettler` is one-shot and the settler holds its
  series, token, ownership registry, vault and market as immutables, so one custody vault serves exactly
  one series — which cascades into a second engine, epoch controller, graph registry, ledger and settlement
  layer. The first attempt failed with `SettlerAlreadyBound`, the correct refusal, naming nothing about the
  cause. Delta U-1.
- **A roll TRANSFERS; it does not burn and mint.** `Nox.mint` and `Nox.burn` are the only operations that
  touch `confidentialTotalSupply` and both produce a **new handle**, so an unchanged supply handle proves
  the operation never happened — stronger than an equal plaintext. Delta U-2.
- **`SupplyState.Open` is public and says nothing about remaining inventory.** A drained supply stays Open
  forever because the contract cannot say otherwise without leaking a balance, and netting leaves
  floor-division dust — so even a nonzero escrow may move nothing. Two Sepolia runs netted zero and passed
  every public check. Delta U-9.
- **A bare `try/catch` around a simulation proves nothing.** The first complete Sepolia roll reported that
  over-unwinding a residual was refused; it was refused with `IntentNotOpen` because the intent had already
  completed and the call never reached the ceiling. Assert every refusal **by decoded error name**, and run
  the attempt in the window where the defence can actually bind. Delta U-10.
- **A capsule's expiry stops it asserting, not its recipient decrypting.** Nox has no `removeViewer`. Use
  "live access ended" / "future snapshots disabled" / "this historical snapshot remains available", never
  "revoked". Delta U-3.
- **Two capsules over one balance are ONE handle unless the recipient is mixed into the isolation domain.**
  Proven by removing the defence: the handles come back byte-identical. Delta R-6 is why the negative was
  executed rather than assumed.

`KYRVE_EVIDENCE_TAG` threads the layer through every path in `scripts/lib/layer.ts`. A successful layer A
flow must never silently satisfy a layer B check, and `pnpm verify:phase6` runs `kyrve-verify` for both.

The Slither gate for the confidential layer can only ever SKIP — `crytic-compile` will not drive solc
0.8.36 (delta U-5). It is reported `UNVERIFIED BY SLITHER` on every run, never as a pass.

Run `pnpm verify:phase6`. Read `docs/phase6/PHASE-7-PREREQUISITES.md` before starting Cloudflare or final
web work — P7-2 and P7-3 are the two that bite.
