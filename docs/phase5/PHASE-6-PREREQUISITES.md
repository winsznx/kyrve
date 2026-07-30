# Phase 6 prerequisites

Phase 6 is Cross, Roll, Capsule and the Cloudflare application. None of it starts before this file is
read.

Phase 5 made a curve reservation into a real capital lock, turned a settled Midnight position into
confidential ERC-7984 claims, proved the ownership journey in a real browser, and finished on a public
network: eighteen contracts deployed and verified on Ethereum Sepolia, and one real confidential allocation
against credit a real Midnight `take` created. P6-0 records what that left on chain for Phase 6 to build
on, and the two operational properties a public-network sequence turned out to need.

Five entries below are constraints Phase 5 established by measurement or by failure. Each recurs at a point
where the consequence is lost capital or a mispriced claim rather than a failed test.

---

## P6-0 · Phase 5 IS finished, and here is what it left on chain

Discharged. `pnpm verify:phase5` reports **32 passed, 0 failed, 0 skipped**. Every condition executed;
nothing is assumed and no local result stands in for a public one. `docs/phase5/GATE.md` records it.

**What Phase 6 builds on, on Ethereum Sepolia.** Eighteen contracts, twelve one-shot bindings, 19/19
Etherscan-verified across both compiler pins, and 56 read-back checks against chain state:

```
KyrveCustodyVault          0x69b8b911ec83673e35d369c100a5812734f997e3
KyrveSeriesToken           0xe2aea76cf8a2bf4877943792eb3ea877e8dec073
SeriesOwnershipRegistry    0xd0a3e53c7c089b1b47207237f2a923ced601bfff
SeriesAllocator            0x4a5092e1ca49044e4be2755873c116fa199b7428
AggregateSolvencyVerifier  0xf5da1616407ad9e9e4bb593b9e6049589d912f33
SeriesResidueAccount       0x372bd4fed1c8d08a97f24359befb9399431f68ec

series 0xadcfb277…   vault 0xA910E1E263338bE447ab24922693bc5c63BEC539
epoch  0x760d3261…   quote 0xf05e7d39…   deployment 0xb2f6707578…
```

One real confidential allocation, funded from two real confidential locks rather than a mint:

| | |
|---|---|
| published aggregate | **299,999,999** |
| unwrap plaintext | **299,999,999** — invariant 1, proven by a public ERC-20 transfer |
| Midnight units settled | **300,000,599** — the credit the vault holds |
| buyer assets paid | **299,999,998** |
| total confidential supply | **299,999,999** — the aggregate, never the units |
| funding residue | **1**, recorded against an immutable declared beneficiary |
| per-provider | both decrypted their own; both refused the other's |
| solvency | published as one bit: solvent, coverage 300,000,594 |

**Two things Phase 6 inherits from how that ran, not from the design.**

The Sepolia funding forecast under-predicted by **18%**, against Phase 3's 27%. The 35% floor held both
times — the first evidence that multiplier has ever had beyond a single sample. Keep it at 35%: two
samples are not a distribution, and an under-funded sequence strands halfway with provider capital held
until someone cancels it.

And a public-network run gets interrupted. `--continue` finished an epoch that stopped three stages from
the end for **3,765,826 gas** instead of the ~27,000,000 a fresh one costs, and the deployment resumed
28,318,988 gas of already-landed contracts for nothing. Deltas T-13 and T-14. Anything Phase 6 broadcasts
in sequence needs the same two properties: record each step the moment it lands, and skip what has already
happened rather than retrying it.

**The one thing that is still not done, and is not Phase 5's.** Keeper, operator, curator and the residue
beneficiary are four immutable roles that are one Sepolia address. Separating them is a deployment, not a
code change, and it should happen before anything holds value that matters.

## P6-1 · A funded round whose quote never settles needs public tokens back, and Kyrve cannot compel it

`SeriesAllocator.unwindChunk` is permissionless and bounded by exactly what was consumed. What it cannot do
is return the loan tokens: they are in a Phase 4 `KyrveSeriesVault` whose `recoverFunding` is operator-only,
and Phase 5 reuses those vault instances deliberately so the Sepolia position stays owned.

If coverage has not returned, the wrapper's own `transfer` primitive moves **encrypted zero** rather than
reverting, so the restoration credits a balance that later pays nothing. `102-series-attacks.ts` A7 proves
the whole path with the operator's return transaction included, and ends with a withdrawal that really
moves — because only a real withdrawal distinguishes restored capital from a restored number.

**Required:** Cross and Roll each create *new* offers from existing claims, so each opens the same window
and each needs its own unwind. A residual-settlement adapter that funded from custody and then failed would
strand capital exactly here. Delta [T-4](PRD-DELTA.md). Closing it properly needs a series vault whose
retirement path returns funding without an operator — a settlement-layer revision, not a Phase 5 one.

## P6-2 · Q-6 is maintained and tested, never proven on chain

`sum(available) + sum(locked) <= asset.confidentialBalanceOf(vault)` is **not** provable on chain, and the
reason is structural rather than an omission: it needs an encrypted `sum(available)`, and an aggregate
accumulated beside a provider's balance is precisely how the Phase 2 vault draft handed its first depositor
a permanent admin grant on the protocol total (delta Q-5, caught by a test rather than a review).

`AggregateSolvencyVerifier` proves the statement invariant 13 actually asks for —
`supply + pendingEntitlements <= credit + reserves - fees` — with a fully public right-hand side and a single
published `ebool` as the output, so a solvency check is not itself a permanent disclosure.

**Required:** Capsule snapshots and any Cross or Roll accounting must not add a second encrypted aggregate
to "make solvency checkable". The one Phase 5 keeps — `_consumedTotal`, needed because the funding unwrap
requires exactly one handle — is isolated on **every** fold under a quote-scoped domain before anything is
granted, transferred or published. Copy that discipline or do not add the aggregate. Delta
[T-7](PRD-DELTA.md).

## P6-3 · Series supply is principal, and the conversion is a public factor

Three numbers are distinct and must never be conflated. On the Phase 4 Sepolia fixture: capacity
300,000,000, published aggregate 299,999,999, units 300,000,599, buyer assets 299,999,998.

`KyrveSeriesToken`'s supply is the **published aggregate**. PRD §19.3's literal reading — supply equals the
Midnight units — over-issues by 600 on that fixture and makes invariant 5 false, because a unit already
carries the discount. The unit-to-asset conversion is `redemptionFactorWad`, computed on chain from two
public numbers so anyone can reproduce it. Delta [T-1](PRD-DELTA.md).

**Required:** Cross prices claims against each other and Roll moves them across maturities. Both need the
factor of the series they are leaving and the series they are entering, and neither may denominate a claim
in units. `MaturityRedemptionQueue` inherits the same rule: `redeem` already burns principal and accrues
the factor-adjusted entitlement, and the payout must not re-apply it.

## P6-4 · A real lock rewrites the balance handle, so a grant is per-epoch

A Nox ACL entry is per handle, not per storage slot. Locking rewrites `_available` to a new handle, so the
engine needs a fresh permanent grant each epoch. It surfaced as three Phase 4 test failures on the second
and third epochs of a suite whose first epoch passed — the signature of exactly this class of defect.

It cannot be designed away: a grant cannot be pre-made for a handle that does not exist, and `allow` is
gated on the caller already holding access. Letting the custody vault grant the engine itself was
considered and rejected — it would widen a third party's access to a provider's balance without the
provider's per-epoch consent.

**Required:** every new consumer of a live balance handle pays the same cost, and a Cloudflare keeper that
assumed one grant lasts forever would fail on the second epoch of every provider. Budget one permanent
grant per provider per epoch after the first, and re-grant only when the handle has actually moved. Delta
[T-8](PRD-DELTA.md).

## P6-5 · Two irreversible crossings, and both are in this phase's hot path

Nox has no `removeViewer`, no `removeAdmin` and no un-publish.

- `KyrveWrappedAsset.unwrap`, inside `KyrveCustodyVault.unwrapQuoteFunding`. The published plaintext is the
  epoch's aggregate, which was already public — but it *also* discloses whether the vault could cover it
  in total, because a short vault burns encrypted zero. That is a protocol solvency fault rather than a
  private fact, and no provider is identified. Finding F-9.
- `allowPublicDecryption`, inside `publishAggregateSupply` (once per token, then it reverts) and
  `proveSolvency` (once per snapshot, on the verdict bit only).

**Required:** Capsule is where this bites hardest — capsules use **fresh snapshot handles** and auditors
never receive access to a live portfolio handle, and the UI must never say "revoked" for a handle a viewer
could already decrypt. Use "live access ended", "future snapshots disabled", "this historical snapshot
remains available". Carry-over 10 from Phase 4, unchanged.

---

## Carried forward, still binding

Everything in `docs/phase4/PHASE-5-PREREQUISITES.md` remains in force. Three are discharged by this phase:

- **P5-1** — decided in its own commit before any code, implemented, and the decision is itself a gate.
  `docs/phase5/P5-1-DECISION.md`.
- **P5-2** — series ownership is minted against the published aggregate, and both residues are named,
  separated and tested from different sources. Deltas T-1 and T-2.
- **P5-4** — the published handle set is still read only after `publishAggregate`; the Phase 5 suite reads
  it through `collectPublicResult`, which is the same path the Phase 4 regression covers.

**P5-3 is not discharged and does not need to be.** `cacheProviderChunk` is still the tightest stage at
14,984,397 gas and 10.7% margin, and Phase 5 added no work to it. `verify:gas-cap` names it on every run.

And the three items Phase 4 listed as outside the dependency chain are all still outside it:

- **Key separation.** Keeper, operator and curator are three immutable constructor arguments that are one
  Sepolia address. Phase 5 adds a fourth role — the residue account's declared beneficiary — and it is
  also immutable. Separating them is a deployment, not a code change, and should happen before anything
  holds value.
- **The bond a borrower can still cancel after their request was sealed.** Unchanged from Phase 3.
- **A 16 × 128 epoch on a public network.** Still UNVERIFIED. Sepolia has only ever run a four-cell epoch.
