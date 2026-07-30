# Phase 5 — confidential series ownership

A settled public Midnight credit position becomes **privately owned, fully collateralised ERC-7984
series claims**, funded by capital a curve reservation really locked.

> One quote. The curve stays private. And now the ownership does too.

Run `pnpm verify:phase5`. Current verdict: **NOT FUNDED** — every executable gate passes and the Sepolia
sequence is priced at 58,546,501 gas against a deployer short by roughly 0.0285 ETH. See
[`GATE.md`](GATE.md); nothing was broadcast and the shortfall is not rounded up to a pass.

---

## What changed, in one paragraph

Phases 2 to 4 computed, published and settled. **This is the first phase that takes custody.** A curve
reservation used to be an encrypted accounting result against a snapshot nothing spends — delta S-6 said
so in those words, and prerequisite P5-1 called it the gap that made the phase necessary. It is now a
real lock: one `safeSub`, against the provider's live balance, in the same contract that holds the
ERC-7984 coverage backing it. The locks are consumed, summed, unwrapped into the market's loan token, and
that is what pays Midnight. Only after the fill lands is each provider's confidential claim minted — from
the exact handle their lock became.

---

## Read in this order

| Question | Where |
|---|---|
| Why is the lock built this way, and what was rejected? | [`P5-1-DECISION.md`](P5-1-DECISION.md) |
| Where is the PRD or a prior phase wrong? | [`PRD-DELTA.md`](PRD-DELTA.md) — T-1 to T-11 |
| What can still be taken, stranded or double-counted? | [`SECURITY.md`](SECURITY.md) |
| What did the gate actually measure? | [`GATE.md`](GATE.md) |
| What must be true before Cross, Roll, Capsule or Cloudflare? | [`PHASE-6-PREREQUISITES.md`](PHASE-6-PREREQUISITES.md) |

---

## The seven contracts

Five are new. Two were revised, and the revision made one of them **shorter**.

| contract | pin | role |
|---|---|---|
| `KyrveCustodyVault` | 0.8.36 | **new.** The P5-1 discharge. Handle-native lock, consume, unwrap, release, restore. The one subtraction lives here |
| `KyrveSeriesToken` | 0.8.36 | **new.** ERC-7984 claims over the official pinned implementation. Mints only from a handle; no overload takes a number |
| `SeriesOwnershipRegistry` | 0.8.36 | **new.** The provenance balances cannot hold: which epoch, which graph root, which lock, and whether that authority is already spent |
| `SeriesAllocator` | 0.8.36 | **new.** Orders the six steps and refuses every substitution. Lends handles to exactly one address |
| `AggregateSolvencyVerifier` | 0.8.36 | **new.** PRD §19.1 as one encrypted comparison against a fully public right-hand side, publishing only the verdict bit |
| `SeriesResidueAccount` | 0.8.36 | **new.** The declared public dust destination, immutable, with no function that takes an address |
| `ReservationLedger` | 0.8.36 | revised. Keeps epoch state, delegates the arithmetic. **Zero subtractions** — the parallel remainder was the defect |
| `NoxCurveEngine` | 0.8.36 | revised in three lines. Reads the eligibility balance from custody, and needs one fewer permanent provider grant |

`KyrveConfidentialAssetVault` stays in the tree untouched. It is still deployed on Sepolia, and the
repository must not stop describing what is on chain.

---

## The order, and why it is this order

```
1  consumeChunk    keyed on the EPOCH — each lock leaves `locked`, joins the round's total
2  unwrapFunding   keyed on the EPOCH — the total becomes public loan tokens. IRREVERSIBLE
3  activation      prepareQuote refuses a vault that cannot already pay, so 1 and 2 come first
4  settlement      the borrower takes; onBuy enforces exact fill; credit is created
5  allocateChunk   keyed on the QUOTE — claims minted from the handles the locks became
6  closeQuote      allocation sealed, funding residue accounted
```

Steps 1 and 2 must precede activation because `KyrveSeriesVault.prepareQuote` reverts
`FundingShortfall` on a vault that cannot pay. Step 5 must follow settlement because a claim minted
against a quote that then fails to settle is a claim on nothing. That is why funding is keyed on the
epoch and allocation on the quote — delta T-9, and it was a deadlock before it was a design.

The window between 2 and 5 is bounded on both sides by `unwindChunk`, which burns the claims and
restores the capital. Its honest limit is delta T-4.

---

## Five things that are easy to get wrong, and were

- **Series supply is the published aggregate — not the units, not the capacity, not the borrower's
  assets.** PRD §19.3 says *"sum encrypted series allocations = exact Midnight units received"* and it
  cannot be read literally: a Midnight unit already carries the discount, so minting against units
  denominates a claim in redemption face value while the contribution was principal. On the measured
  fixture that is 600 units of over-issuance and invariant 5 becomes false. The conversion is a
  **public redemption factor** instead, derived on chain from two public numbers. Delta T-1.

- **There are TWO residues and both are 1.** `capacity − aggregate = 1` is private forever — publishing
  it discloses the winning leaf's capacity by subtraction. `aggregate − buyerAssets = 1` is public and
  is real loan tokens. A test asserting "the residue is 1" passes against either and proves nothing
  about the other, so the suite derives them from different sources. Delta T-2.

- **A real lock rewrites the balance handle.** A Nox ACL entry is per handle, not per storage slot, so
  the engine needs a fresh permanent grant each epoch. It cost three Phase 4 test failures on the
  second and third epochs of a suite whose first epoch passed. It cannot be designed away: a grant
  cannot be pre-made for a handle that does not exist. Delta T-8.

- **The wrapper must wrap the market's own loan token.** Three phases tolerated two separate test
  tokens because nothing ever crossed back. The moment one did, `finalizeUnwrap` moved the wrong asset
  and activation reverted `FundingShortfall(600000509, 0)` on a run where every encrypted step had
  succeeded. Delta T-10.

- **Transient access is a full grant.** `lendSupply` originally took its recipient as a parameter and
  checked it against `msg.sender` — which let any caller borrow the aggregate supply handle and publish
  it irreversibly. Finding F-1. It is one bind-once address now.

---

## What is measured rather than reasoned

From the local run against the real Nox stack and real unmodified Midnight
(`evidence/phase5/series-gas.json`):

| step | gas |
|---|---|
| `consumeChunk` (3 providers) | 1,006,658 |
| `unwrapFunding` | 320,097 |
| `finalizeUnwrap` | 76,910 |
| `Midnight.take` | 332,394 |
| `allocateChunk` (3 providers) | 1,412,091 |
| `closeQuote` | 137,612 |
| `proveSolvency` | 294,636 |

Every one is far inside the Osaka 2^24 single-transaction cap, and the per-provider steps are chunked so
the caller chooses the width. Stage B (`cacheProviderChunk`, 14,984,397 — 10.7% margin) is untouched:
prerequisite P5-3 forbids adding work there and nothing here does. Testnet gas is UNVERIFIED (AS-1).

---

## What Phase 5 deliberately does not contain

- No Cross, no Roll, no Capsule. No secondary order book, no residual settlement adapter.
- No Cloudflare resource of any kind. Nothing was created.
- No Sepolia deployment. The sequence is measured against the live network on every gate run and the
  deployer cannot cover it; no deploy script exists either, because a command that has never run is worse
  than a missing one (carry-over 8, deltas R-11 and R-13).
- No maturity redemption *payout*. `redeem` burns the claim and accrues a confidential entitlement;
  batching, the Midnight `withdraw` and the confidential distribution are `MaturityRedemptionQueue`
  (PRD §13.19) and are out of scope by owner decision. The entitlement is carried on the claim side of
  the solvency inequality precisely so the boundary stays honest.
- No claim that gas is indistinguishable, and no claim that the gateway never sees plaintext.
