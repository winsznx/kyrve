# PRD delta

Corrections to `kyrve-production-prd.md` found during Day 0. **The PRD is never edited**; this file
is the correction record.

Each entry is graded:

- **CONFIRMED** — the PRD was right, and it is now proven rather than assumed.
- **GAP** — the PRD is silent on something load-bearing. Additive.
- **CORRECTION** — the PRD states something that verification contradicts. Must change.
- **RISK** — unresolved, with a required action.

Evidence levels are distinguished throughout: *local proof* (Foundry against real unmodified
Midnight), *Sepolia-read proof* (live chain state, no writes), *source proof* (pinned package or
repository source), and *assumption* (unproven).

---

## Confirmed — the central thesis holds

### D-1 · §2.4, §6.5, §12.4, §12.5 — the two-layer exact-fill composition · CONFIRMED
*Local proof + source proof.* `contracts/integration/test/ExactFill.t.sol`, 14/14 passing.

The PRD's core technical claim is exactly right, and it is right for exactly the reason stated:

- `IRatifier.isRatified(Offer, bytes, address taker) external view returns (bytes32)` — `view`, and
  it receives **no `units`** (`vendor/midnight/src/interfaces/IRatifier.sol:8`).
- Midnight permits partial fills: `newConsumed <= offer.maxUnits`
  (`vendor/midnight/src/Midnight.sol`, `take`).
- `IBuyCallback.onBuy(bytes32 id, Market, uint256 buyerAssets, uint256 units, uint256
  pendingFeeIncrease, address buyer, bytes data)` — the only point where actual fill size reaches
  maker-controlled code (`src/interfaces/ICallbacks.sol:9`).
- Reverting in `onBuy` reverts the entire take. Proven: after a rejected half-fill, group
  consumption, vault credit and borrower debt are all zero, and the exact fill still succeeds
  afterwards (`test_failedPartialFill_leavesNoState`).

Proven to revert: partial fill, half fill, oversized fill, wrong taker, altered tick, altered
expiry, altered callback, altered `maxUnits`, replay, spoofed callback caller, expired quote.

### D-2 · §11.1 — direct-caller binding on `fromExternal` · CONFIRMED
*Source proof.* `Nox.fromExternal` calls `validateInputProof(handle, msg.sender, proof, type)`, and
the proof binds owner, app contract, chain id (twice — in the handle bytes and the EIP-712 domain)
and a 3600 s expiry. The PRD's prohibition on relayers, paymasters, Safe modules, batch routers and
server signers is correct.

One nuance the PRD does not capture: `INoxCompute.validateInputProof` takes `owner` as a
caller-supplied parameter and checks equality, so an app contract *may* implement metatransactions
by calling it directly. The app binding remains unforgeable. Kyrve should keep the PRD's stricter
rule, but should not claim relaying is cryptographically impossible — it is prevented by Kyrve's
own design choice.

### D-3 · §11.2 — external encrypted types · CONFIRMED
`externalEuint16`, `externalEuint256`, `externalEint16`, `externalEint256`, `externalEbool` are
exactly the five types Nox supports. The PRD's list is precisely right, and its instruction to avoid
"undocumented encrypted bitwise operations" was well-judged — see D-8.

### D-4 · §11.13, §18.3 — ACL permanence · CONFIRMED
There is no `removeViewer`, no `removeAdmin`, and no way to un-set `allowPublicDecryption`; only
`disallowTransient` exists. The PRD's "viewer permission is treated as permanent" and its ban on
saying "access revoked" are correct.

**Additive:** transient access carries *full persistent-grant power* — any contract handed a
transient handle can permanently mark it publicly decryptable or mint persistent admins. Only pass
transient handles to reviewed Kyrve contracts.

### D-5 · §11.14 — ERC-7984 boundaries and operator risk · CONFIRMED
The public deposit amount, private balances, public unwrap amount, and unbounded operator blast
radius are all as the PRD describes. Confirmed: operators have **no per-amount allowance**, and an
operator on a wrapper can unwrap a holder's entire balance to any address. The PRD's requirement for
time-limited, narrowly-scoped operators is the right mitigation.

---

## Gaps — additive, nothing in the PRD is wrong

### D-6 · §3.1 — the pinned release requires the Osaka EVM · GAP → resolved PASS
*Sepolia-read proof.* `vendor/midnight/foundry.toml` pins `evm_version = "osaka"`. The PRD never
identifies this, and it was the single hardest blocker in the whole plan: had Sepolia not been on
Osaka, the release could not have been deployed **unmodified** and §3.1 would have been
unachievable.

Sepolia is on Osaka. Proven executably rather than inferred — see
[`evidence/sepolia-osaka.md`](evidence/sepolia-osaka.md): the CLZ opcode (EIP-7939) returns
correct results for three inputs, while a control confirms undefined opcodes are still rejected.

**Action:** record `evm_version = "osaka"` and solc `0.8.34` in the deployment manifest, and add the
CLZ probe to `verify:deployment` so a chain that silently lacks Osaka fails loudly.

### D-7 · §12.4, §13.10, §13.12 — the maker must authorise the ratifier · GAP
*Local proof.* Midnight requires `isAuthorized[offer.maker][offer.ratifier]` before it will call the
ratifier at all; otherwise `take` reverts `RatifierUnauthorized`. The PRD's ratifier and series-vault
specifications never mention this.

**Action:** `KyrveSeriesVault` must call `midnight.setIsAuthorized(ratifier, true, address(this))` as
part of series setup, and `verify:ratifier` must assert it. Proven by
`test_ratifierMustBeAuthorisedByMaker`.

### D-8 · §9.3 — the rate grid must exclude ticks priced below the settlement fee · GAP
*Local proof.* For a buy offer Midnight computes `sellerPrice = offerPrice - settlementFee`, which
reverts on underflow. At a 60-day maturity with the fee used in testing, `settlementFee = 7e14` while
`tickToPrice(0) = 0` — every low tick is unusable.

**Action:** universe construction must compute the market's settlement fee across the maturity band
and exclude ticks whose price falls below it. `verify:universe` must enforce this. Proven by
`test_rateGrid_lowTicksUnderflowAgainstSettlementFee`.

### D-9 · §12.5 — `onBuy` also receives `pendingFeeIncrease` · GAP
The PRD's eleven-step `onBuy` list omits it. This is the continuous fee the vault accrues on new
credit, and it is a real cost that belongs in the §19.1 solvency invariant.

**Action:** bind a `maxPendingFee` into the activated quote and reject above it, alongside
`continuousFeeCap` on the offer. Already implemented in the spike.

### D-10 · §12.6 — Midnight offers a cancellation primitive the PRD does not use · GAP
`setConsumed(bytes32 group, uint128 amount, address onBehalf)` lets a maker pre-consume its own
group. Because `group == quoteId`, the series vault can retire an activated quote immediately rather
than waiting for expiry.

**Action:** use it in `expireActivatedQuote` and in `EmergencyController`, so capital is released
without waiting out the window.

---

## Corrections — the PRD must change

### D-11 · §11.5 — Nox has no boolean operations · CORRECTION
*Source proof.* §11.5 specifies eligibility as a six-term conjunction:

```
eligible[p,l] = enabled AND rateAllowed AND borrowerAllowed
                AND marketCapAvailable AND portfolioCapAvailable AND balanceAvailable
```

The complete callable surface of `sdk/Nox.sol@0.2.4` is `add sub mul div safeAdd safeSub safeMul
safeDiv eq ne lt le gt ge select transfer mint burn toEbool toEuint16 toEuint256 toEint16 toEint256
fromExternal publicDecrypt` plus ACL functions. **There is no `and`, `or`, `not` or `xor`** — and
`select` is overloaded for `euint16`/`euint256`/`eint16`/`eint256` but **not for `ebool`**, so the
obvious `and(a,b) = select(a, b, false)` workaround is also unavailable.

**Required change:** arithmetise the conjunction. Map each predicate to `euint16` 0/1 with `select`,
multiply the indicators, then compare against 1 to recover an `ebool`:

```
ind[k]   = select(pred[k], toEuint16(1), toEuint16(0))     // 1 op per predicate
product  = mul(ind[0], ind[1]) … mul(product, ind[n-1])    // n-1 ops
eligible = eq(product, toEuint16(1))                       // 1 op
```

For six predicates that is 6 selects + 5 muls + 1 eq = **12 operations per (provider, leaf)** where
the PRD implicitly assumed roughly 6. The thesis is unaffected; the cost model is not. This feeds
directly into D-12.

### D-12 · §9.1, §13.7 — Nox has no batch API, and the launch universe is unbudgeted · CORRECTION + RISK
*Source proof for the constraint; the cost itself is **UNMEASURED**.*

§13.7 says "Implementation must batch operations to stay within practical Nox and gas limits."
**No batch entry point exists.** `INoxCompute` exposes no array-of-operations function; every
primitive is a separate external call to the NoxCompute proxy that performs handle-definition
checks, an ACL loop over operands, a keccak, a transient-storage write per output, and an event.

The §9.1 launch universe is 16 providers × 128 leaves. With D-11's corrected 12 ops per
(provider, leaf) for eligibility alone — before capacity summation, reservation, `safeSub`,
selection and allocation — that is **≥ 24,576 cross-contract calls** for one quote. No per-operation
gas figure is published by iExec, and none was measured here, but no plausible per-op cost fits that
in a 30M-gas block, or in any small number of blocks.

**Required change:** the PRD must state an explicit per-transaction operation budget and a
decomposition. §13.7's `computeLeaf(requestId, leafIndex)` already anticipates per-leaf batching —
that decomposition must become normative rather than optional, and §9.1's limits must be derived
from a *measured* op budget instead of asserted.

**This does not require weakening the product.** The full private curve is preserved; only the
transaction decomposition changes. The strongest available architecture is:
1. Measure real per-op gas on the local Nox stack (**SPIKE D — not run, see Residual**).
2. Derive `maxProviders × ticksPerMarket` per transaction from that measurement.
3. Keep `computeLeaf` per-leaf and idempotent so a keeper can drive 128 leaves across many
   transactions within one sealed epoch, with the epoch — not the transaction — as the atomic unit.
4. Prefer `euint16` over `euint256` for indicator and index arithmetic where the range allows.

Until measured, §9.1's "up to 128 market-rate leaves" is an **aspiration, not a validated
parameter**.

### D-13 · §12.3, §20.2 — settlement-fee drift does not affect the maker's payment · CORRECTION
*Local proof.* §12.3 lists "settlement-fee bounds" among quote-math outputs and §20.2 treats
"settlement-fee drift" as a threat mitigated by short quote life. For a **buy** offer:

```
sellerPrice = offerPrice - settlementFee
buyerPrice  = sellerPrice + settlementFee = offerPrice
buyerAssets = floor(units × tickToPrice(tick) / WAD)
```

The maker's payment is **exactly independent of the settlement fee**. Proven directly: with the fee
raised from 0.0004/0.001 to the maximum 0.000417/0.00125, the maker paid `499999000000` in both
cases while the borrower's proceeds fell from `499649000000` to `499582250000`
(`test_differential_buyerAssetsIndependentOfSettlementFee`).

**Required change:** settlement-fee drift is a **borrower-proceeds** risk, not a funding risk. The
real maker-side fee exposure is the *continuous* fee via `pendingFeeIncrease`, controlled by
`offer.continuousFeeCap` and the D-9 cap. Rewrite §20.2 accordingly rather than defending against
the wrong threat.

### D-14 · §9.3 — tick direction resolved · CORRECTION
§9.3 correctly refuses to assume tick direction. The answer, proven across the full grid at
`DEFAULT_TICK_SPACING`: `tickToPrice` is **monotonically non-decreasing** and capped at WAD. Higher
tick → higher price → more assets per unit of face value → **cheaper borrowing**.

So "sort indexes by increasing borrowing cost" means sorting by **decreasing tick**. Proven by
`test_rateGrid_priceIsMonotonicInTick` and the 10-point differential grid.

### D-15 · §11.9, §12.3 — units must be derived by rounding down · CORRECTION
§12.3 mentions a "maximum rounding tolerance" without fixing the direction. The direction is
load-bearing for §19.2 (`sum of reservations = publicly unwrapped funding`).

Given an aggregate `fillAssets` from Nox, `units = floor(fillAssets × WAD / price)` guarantees
`buyerAssets ≤ fillAssets` — the maker never owes more than providers reserved — with the shortfall
bounded at **2 wei** of the loan token (fuzzed, 256 runs). Rounding up can overdraw and would break
§19.2.

**Required change:** state the rounding direction normatively, and route the ≤2 wei residue to the
§19.8 dust account.

### D-16 · §13.8 — decryption proofs are replayable and prove less than assumed · CORRECTION
*Source proof.* `validateDecryptionProof` is a pure EIP-712 signature check with **no ACL check, no
nonce, no expiry, and no caller binding**. Once issued, a proof is replayable by anyone, in any
contract, forever.

A valid proof therefore establishes only *"the gateway attests handle H decrypts to V"* — never
*"V is this quote's aggregate"*. Since handles are derived deterministically from the operation
graph, the binding must come from Kyrve.

**Required change:** `QuoteActivator` must verify that handle H is the handle derived from **this
request's** sealed operation graph, not merely that a valid proof exists. This makes §11.12's
operation-graph reconstruction a **consensus-critical activation check**, not just an evidence
feature for the proof explorer.

### D-17 · §21.3 — PostgreSQL versus the Cloudflare direction · CORRECTION
§21.3 specifies PostgreSQL for public and derived metadata. The Day 0 architecture direction places
the indexer, keeper and API on Cloudflare Workers. D1 cannot substitute for PostgreSQL here: **10 GB
hard cap, single-threaded per database**, 100 bound parameters per query, and 1,000 queries per
invocation — which caps bulk ingestion at roughly 10,000 rows per invocation and makes indexer writes
contend with API reads on the same thread.

**Required change:** choose explicitly and record it. Either keep an external PostgreSQL for the
event index and use Workers purely as the edge and orchestration layer, or split storage — bulk
event data in R2 partitioned by block range, with a bounded queryable projection plus cursors in D1.
Do not architect as though D1 will hold full history.

Related, and non-negotiable: **the Cloudflare Free plan is not viable.** 50 subrequests per
invocation — counting D1 and R2 calls, not just RPC — cannot cover one block of indexing.

---

## Risks requiring action

### D-18 · §3.2 — both protocol cores are BUSL-1.1, not open source · RISK
§3.2 requires licence disclosure but never names BUSL or its production-use constraint.
`src/Midnight.sol` is BUSL-1.1 (Additional Use Grant at an unresolved ENS name; Change Date the
earlier of 2030-05-01 or an ENS-specified date). `@iexec-nox/nox-protocol-contracts` declares MIT in
`package.json` while its core modules are BUSL-1.1 with **"Additional Use Grant: None"**.

`hack.md` requires open-source code and states the prize covers **a year of hosting** — which sits
awkwardly against BUSL's non-production-use grant, and Kyrve *deploys the Midnight core itself*.

**Action:** resolve `morpho-midnight-license-grants.morpho.eth` and
`morpho-midnight-license-date.morpho.eth`, record them verbatim, and state which grant Kyrve relies
on. If none covers it, contact Morpho Association. Do not publish an unqualified "open source"
claim. Full analysis in [`LICENSE-MATRIX.md`](LICENSE-MATRIX.md).

### D-19 · Nox maturity is thinner than the PRD's production framing · RISK
No mainnet exists. The handle SDK is `0.1.0-beta.13` with no stable release. The Hardhat plugin's
`main` already contains an unpublished breaking redesign. Published `nox-protocol-contracts@0.2.4`
lags repository HEAD on security fixes, and the deployed testnet implementations lag both. The two
supported testnets run different contract versions and different KMS keys. Handle readiness depends
on `POST /v0/public/handles/status`, which is absent from both the SDK and the documentation.

**Action:** wrap every Nox touchpoint behind `packages/nox` so a breaking upstream change is a
one-package fix; implement Kyrve's own polling with backoff rather than relying on the SDK's ~7 s
give-up; pin exactly and re-verify on every bump. Keep §20.1's trust-assumption disclosure explicit
about TEE and gateway compromise — a gateway key compromise is total confidentiality compromise.

### D-20 · §31 — `verify:live` must gain checks for the new findings · RISK
Add: Osaka availability (D-6), ratifier authorisation (D-7), rate-grid fee floor (D-8), the
handle-to-operation-graph binding (D-16), and the measured op budget (D-12).

---

## Residual — what Day 0 did not prove

Three planned spikes did not run. **The host machine's disk was exhausted** (460 GB volume at 99%,
peaking at ~124 MiB free), which blocked Docker images, `pnpm install`, and package extraction.

| Spike | Status | Consequence |
|---|---|---|
| **C — Nox primitives on the local stack** | NOT RUN | `fromExternal` binding, safe arithmetic, `select`, encrypted division, ACL and public decryption are proven from **source**, not by execution. Source proof is strong for *existence* and *signature*; it is not proof of *runtime behaviour*. |
| **D — curve-engine op/gas budget** | NOT RUN | D-12 is unquantified. This is the largest open risk in the architecture. |
| **E — Cloudflare + viem** | NOT RUN | `viem` inside `workerd` is supported only by structural evidence (`isows` ships a `workerd` export condition; node-only surface is quarantined in `viem/node`). Discharged by `wrangler deploy --dry-run --outdir dist`, grepping for `[unenv] … is not implemented yet!`. |

None of these is known to fail. All three are cheap once disk is available, and each has a defined
discharge procedure above.
