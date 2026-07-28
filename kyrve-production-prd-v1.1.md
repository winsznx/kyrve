# Kyrve — production PRD v1.1

**Status:** normative. **Supersedes** the listed sections of `kyrve-production-prd.md` (v1.0).
**Date:** 2026-07-28. **Basis:** Day 0 executable evidence — see [`docs/day0/GATE.md`](docs/day0/GATE.md).

> One quote. The curve stays private.

## How to read this document

`kyrve-production-prd.md` (v1.0) remains **unedited and authoritative for every section not listed
here**. This document is a normative amendment: each entry below supersedes a specific v1.0 section.
Where they conflict, **v1.1 wins**.

This structure is deliberate. v1.0 is 4,272 lines across 282 sections; regenerating it in full would
hide 20 substantive corrections inside an unreviewable diff. Every change below carries its
evidence.

Traceability: each amendment cites its finding ID from [`docs/day0/PRD-DELTA.md`](docs/day0/PRD-DELTA.md).

---

## A-1 · §3.1 Deployment requirements — Osaka and solc pin · *(D-6)*

**Supersedes §3.1.** Add to the deployment requirements:

- The pinned Midnight release compiles with `evm_version = "osaka"`. A target chain **must** execute
  the Osaka EVM or the release cannot be deployed unmodified.
- Ethereum Sepolia executes Osaka. Proven executably: the CLZ opcode (EIP-7939) returns correct
  results for three distinct inputs, with a control confirming undefined opcodes still revert —
  [`docs/day0/evidence/sepolia-osaka.md`](docs/day0/evidence/sepolia-osaka.md).
- Kyrve contracts compile with **solc 0.8.34**, `via_ir`, optimizer on, `optimizer_runs = 466`,
  `bytecode_hash = "none"`, matching the pinned release so bytecode comparison stays meaningful.
- `verify:deployment` **must** include a CLZ probe so a chain silently lacking Osaka fails loudly.

## A-2 · §12.4, §13.10, §13.12 Ratifier authorisation · *(D-7)*

**Supersedes the ratifier and series-vault setup specifications.**

Midnight requires `isAuthorized[offer.maker][offer.ratifier]` before it will call the ratifier at
all; otherwise `take` reverts `RatifierUnauthorized`.

- `KyrveSeriesVault` **must** call `midnight.setIsAuthorized(ratifier, true, address(this))` as part
  of series setup.
- `verify:ratifier` **must** assert the authorisation is present.

Proven by `test_ratifierMustBeAuthorisedByMaker` in `contracts/integration/test/ExactFill.t.sol`.

## A-3 · §9.3 Rate grid must exclude ticks below the settlement fee · *(D-8)*

**Supersedes §9.3 universe construction.**

For a buy offer Midnight computes `sellerPrice = offerPrice − settlementFee`, which reverts on
underflow. Universe construction **must** compute the market's settlement fee across the maturity
band and exclude every tick whose price falls below it. `verify:universe` **must** enforce this.

Measured: at 60-day maturity the fee was `7e14` while `tickToPrice(0) = 0` — every low tick unusable.

## A-4 · §12.5 `onBuy` carries `pendingFeeIncrease` · *(D-9, D-19)*

**Supersedes the eleven-step `onBuy` specification.** Add a twelfth check.

`onBuy` receives `pendingFeeIncrease` — the continuous fee accruing on new credit. The activated
quote **must** bind a `maxPendingFee` and reject above it, alongside `offer.continuousFeeCap`.

This fee **must** appear in the §19.1 solvency accounting. It is the maker's real fee exposure — see
A-6.

## A-5 · §12.6 Use Midnight's cancellation primitive · *(D-10)*

**Supersedes §12.6 expiry handling.**

`setConsumed(bytes32 group, uint128 amount, address onBehalf)` lets a maker pre-consume its own
group. Because `group == quoteId`, the series vault **should** use it in `expireActivatedQuote` and
in `EmergencyController` to release capital immediately rather than waiting out the expiry window.

## A-6 · §12.3, §20.2 Settlement-fee drift is a borrower-proceeds risk · *(D-13)*

**Supersedes §20.2's "settlement-fee drift" threat and §12.3's fee-bound outputs.**

For a buy offer, `buyerPrice == offerPrice`, so:

```
buyerAssets = floor(units × tickToPrice(tick) / WAD)
```

is **exactly independent of the settlement fee**. Proven: with the fee raised to its maximum, the
maker paid `499999000000` in both cases while borrower proceeds fell from `499649000000` to
`499582250000`.

Settlement-fee drift therefore threatens **borrower proceeds**, not maker funding. The real
maker-side fee exposure is the *continuous* fee via `pendingFeeIncrease` (A-4), bounded by
`continuousFeeCap`. Rewrite the threat accordingly rather than defending the wrong one.

## A-7 · §9.3 Rate-index ordering · *(D-14)*

**Supersedes §9.3 step 3.**

`tickToPrice` is **monotonically non-decreasing** and capped at WAD. Higher tick → higher price →
more assets per unit of face value → **cheaper borrowing**.

"Sort indexes by increasing borrowing cost" therefore means **sort by decreasing tick**. Proven
across the full grid at `DEFAULT_TICK_SPACING`.

## A-8 · §11.9, §12.3 Units round down; residue is dust · *(D-15)*

**Supersedes §12.3's "maximum rounding tolerance".**

Given an aggregate `fillAssets` from Nox:

```
units = floor(fillAssets × WAD / price)
```

This guarantees `buyerAssets ≤ fillAssets` — the maker never owes more than providers reserved —
with the shortfall bounded at **2 wei** of the loan token (fuzzed, 256 runs). Rounding up can
overdraw and would break §19.2.

The ≤2 wei residue routes to the §19.8 dust account.

## A-9 · §11.5 Eligibility is arithmetised, not boolean · *(D-11)*

**Supersedes §11.5's six-term conjunction.**

Nox has **no `and` / `or` / `not` / `xor`**, and `select` has **no `ebool` overload**, so booleans
cannot be combined directly. Eligibility **must** be arithmetised.

The naive form — convert each predicate to a 0/1 `euint16` indicator and multiply — costs
**146,865 gas per cell**. Kyrve **must** instead use the cached form specified in A-10, which costs
**76,402 gas per cell**:

```
providerOk[p]        computed ONCE per provider   (Stage B)
rateOk[p,l]  = ge(publicTick_l, minTick_p)        (1 op)
contribution = select(rateOk, capacityIfEligible[p], 0)   (tests AND applies in one op)
```

`select(cond, cachedValue, 0)` replaces the indicator conversion *and* the multiply.

## A-10 · §9.1, §13.7 Hierarchical epoch replaces monolithic computation · *(D-12)*

**Supersedes §9.1's asserted limits and §13.7's "batch operations" language.**

**There is no Nox batch API.** Every primitive is a separate external call. §13.7's
`computeLeaf(requestId, leafIndex)` decomposition is now **normative, not optional**, and is
extended to a full hierarchical epoch:

```
sealed request
  -> Stage A  seedProvider          once per provider
  -> Stage B  cacheProvider         once per provider  (NOT per leaf)
  -> Stage C  accumulateLeafChunk   per (leaf, provider-chunk), idempotent
  -> Stage D  finalizeLeaf          per leaf, applies the privacy floor
  -> Stage E  reduceWinnerChunk     balanced reduction over leaves
  -> Stage E2 publishWinner         the ONE public/private boundary crossing
  -> Stage F  allocate              per provider, pro-rata
```

**The epoch — not the transaction — is the atomic unit.** Stages are idempotent and checkpointed so
a keeper can resume.

Normative budgets, all measured, are binding and live in
[`docs/day0/OPERATION-BUDGET.md`](docs/day0/OPERATION-BUDGET.md):

| Parameter | Value |
|---|---:|
| Transaction gas ceiling | 24,000,000 |
| **Max cells per transaction** | **311** |
| Recommended chunk | 256 cells |
| Handles per cell | 3 |
| Runner timeout per stage | 5 s |
| Epoch timeout | 15 min |

**§9.1's 16 × 128 universe is retained in full.** It costs ~195.7M gas across ~11 transactions.
No parameter reduction, no deferred pillar.

| Providers × leaves | Cells | Total gas | Transactions |
|---|---:|---:|---:|
| 4 × 16 | 64 | 10.6M | 4 |
| 8 × 32 | 256 | 31.1M | 4 |
| 8 × 64 | 512 | 58.7M | 5 |
| 16 × 64 | 1,024 | 101.2M | 7 |
| **16 × 128** | **2,048** | **195.7M** | **11** |

Implementation rules: prefer `euint16` for indicators and indexes; stage and chunk identifiers must
be deterministic; a chunk already applied to a finalized leaf must be rejected.

## A-11 · §13.8 Handle-to-graph binding is consensus-critical · *(D-16)*

**Supersedes §13.8 `QuoteActivator`.**

`validateDecryptionProof` is a pure signature check — **no ACL, no nonce, no expiry, no caller
binding**. A valid proof establishes only *"the gateway attests handle H decrypts to V"*, never
*"V is this quote's aggregate"*. Once issued, a proof is replayable by anyone forever.

`QuoteActivator` **must** verify that H is the handle derived from **this request's** sealed
operation graph. §11.12 operation-graph reconstruction is therefore a **consensus-critical
activation check**, not an evidence feature for the proof explorer.

## A-12 · §11.1 Direct-caller rule is policy, not impossibility · *(D-2)*

**Supersedes §11.1's framing.**

The binding is real and was proven at runtime: wrong owner, wrong application contract, malformed
and truncated proofs all revert.

However, `INoxCompute.validateInputProof` takes `owner` as a **caller-supplied parameter** and checks
equality. A contract *could* implement metatransactions by calling it directly. The `app` binding
remains unforgeable.

Kyrve keeps the stricter direct-caller rule — no relayer, paymaster, Safe module, batch router or
server signer — but **must describe it as a design policy**, not as cryptographically impossible.

## A-13 · §21.3 Storage — R2 for history, D1 for projection · *(D-17)*

**Supersedes §21.3's PostgreSQL-only specification.**

D1 cannot substitute: **10 GB hard cap, single-threaded per database**, 100 bound parameters per
query, 1,000 queries per invocation.

Adopted: **R2** holds full event history partitioned by block range plus content-addressed proof
bundles; **D1** holds cursors, a block-partition index and quote status only; a **Durable Object**
serialises keeper nonce allocation.

**The Cloudflare Free plan is not viable** — 50 subrequests per invocation, counting D1 and R2 calls,
cannot cover one block of indexing. Budget Workers Paid from day one.

Rationale and proof: [`docs/day0/STORAGE-DECISION.md`](docs/day0/STORAGE-DECISION.md),
[`docs/day0/CLOUDFLARE-RUNTIME-GATE.md`](docs/day0/CLOUDFLARE-RUNTIME-GATE.md).

## A-14 · §3.2 Licence disclosure — name BUSL accurately · *(D-18)*

**Supersedes §3.2.**

Both protocol cores are **BUSL-1.1, not open source**:

- `src/Midnight.sol` — BUSL-1.1. Change Date the earlier of 2030-05-01 or an ENS-specified date.
  Change Licence GPL-2.0-or-later.
- `@iexec-nox/nox-protocol-contracts` — declares `MIT` in `package.json` while its core modules are
  BUSL-1.1 with **"Additional Use Grant: None"**.

**Resolved 2026-07-28:** `morpho-midnight-license-grants.morpho.eth` and
`morpho-midnight-license-date.morpho.eth` both resolve to the ENS public resolver
`0x4976fb03C32e5B8cfe2b6cCB31c09Ba78EBaBa41` but carry **no contenthash and no text records across
17 candidate keys**. The Additional Use Grant is **empty** — no additional grant currently exists.

Consequences, binding:

- Only BUSL's default terms apply: copy, modify, and **non-production use**.
- The Sepolia deployment **must** be labelled a non-production testnet replica, never an official
  Morpho deployment, and Morpho branding must not be used.
- Kyrve **must not** publish an unqualified "open source" claim over a BUSL core.
- Kyrve's own contracts carry **GPL-2.0-or-later** (they import GPL Midnight interfaces and link
  `ConstantsLib`). Non-contract code may be permissive; keep the boundary explicit in `LICENSE`.
- Production operation beyond the hackathon requires a grant from Morpho Association.

## A-15 · §20.1 Nox maturity and version isolation · *(D-19)*

**Supersedes §20.1's trust-assumption surface.** Add:

- No Nox mainnet exists. The handle SDK is `0.1.0-beta.13` with no stable release. The Hardhat
  plugin's `main` already contains an unpublished breaking redesign. Published
  `nox-protocol-contracts@0.2.4` lags repository HEAD on security fixes, and the deployed testnet
  implementations lag both. The two supported testnets run **different contract versions and
  different KMS keys** — portability must not be assumed.
- Handle readiness depends on `POST /v0/public/handles/status`, absent from both the SDK and the
  documentation. Treat it as unstable.
- **Mandatory:** wrap every Nox touchpoint behind `packages/nox` so a breaking upstream change is a
  one-package fix. Implement Kyrve's own polling with backoff — the SDK gives up after ~7 s.
- Disclose that a gateway key compromise is total confidentiality compromise.

## A-16 · §11.13, §18.3 Transient-handle escalation · *(D-4)*

**Supersedes §11.13.** Confirmed at runtime: `addViewer` and `allowPublicDecryption` both flip
false → true with **no inverse anywhere in the ABI**.

Add: **transient access carries full persistent-grant power.** Any contract handed a transient
handle can permanently mark it publicly decryptable or mint persistent admins for third parties.
Only pass transient handles to reviewed Kyrve contracts. Auditors receive fresh snapshot handles,
never live portfolio handles.

## A-17 · §11.14 ERC-7984 boundaries confirmed · *(D-5)*

**Confirms §11.14; no change required.** Recorded from runtime for completeness:

| Boundary | Verdict |
|---|---|
| `wrap` deposit amount | PUBLIC — plain `uint256` in calldata |
| `confidentialBalanceOf` | PRIVATE |
| Operator authority | **TOTAL** — no allowance function exists in the ABI |
| Operator expiry | ENFORCED |
| `unwrap` amount | **PUBLIC and IRREVERSIBLE** |

Always set a short explicit `until`. Never grant an unbounded-lifetime operator.

## A-18 · §31 `verify:live` additions · *(D-20)*

**Supersedes §31.** `verify:live` **must** additionally check:

1. Osaka availability on the target chain (CLZ probe).
2. `isAuthorized[vault][ratifier]` is set.
3. Every universe tick prices at or above the market settlement fee.
4. The activated handle matches this request's operation graph.
5. Measured per-transaction cell count stays within the 311-cell budget.

## A-19 · §30.6 Invariant 1 — gas is not yet indistinguishable · *(new)*

**Amends invariant 1.** Public status, log count and event topic were proven identical across
eligible, rate-ineligible, underfunded, cap-constrained and market-disabled contributions.

**Gas was not.** Four distinct values with a 2,974 gas (2.1%) spread were measured. Until a
constant-gas review is complete, Kyrve **must not** claim gas indistinguishability. Tracked as
THREAT-MODEL T-1.

## A-20 · §21 Keeper idempotency · *(new, from Spike E)*

**Amends §21 orchestration.**

Cloudflare Workflows retry steps by default (5 attempts, exponential backoff) and
`eth_sendRawTransaction` is not idempotent. Therefore:

- A **Durable Object must** serialise nonce allocation per signing key, allocated **before** the
  submitting step.
- Workflow step names **must** be deterministic — they are memoisation keys.
- Steps **must** return R2 keys, never payloads (1 MiB step-return cap).
- `scheduled` **must** reconcile forward from a stored cursor; Cloudflare publishes **no delivery
  guarantee** for cron.
- Use `NonRetryableError` for terminal reverts.

---

## Unchanged

Everything in v1.0 not listed above is unchanged and remains authoritative — the product thesis, the
privacy model, the settlement architecture, the design system, and every invariant other than those
amended in A-19.

The Day 0 gate confirmed the central mechanism intact: the ratifier authenticates but cannot see
attempted units; the callback sees actual units and enforces exact fill; callback failure rolls back
group consumption, credit and debt entirely; quote math matches real unmodified Midnight; Sepolia
runs Osaka; and encrypted-by-encrypted division exists.
