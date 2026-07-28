# kyrve

## Production Product Requirements Document

Version: 1.0  
Status: Build specification  
Launch network: Ethereum Sepolia  
Primary integration: Morpho Midnight, pinned release `2026-07-23`  
Confidential compute: iExec Nox  
Confidential token standard: ERC-7984  
Product category: Confidential fixed-income liquidity network  
Brand pronunciation: “curve”  
Tagline: One quote. The curve stays private.  
Design tokens: intentionally excluded, they belong in `design.md`

---

## 1. Product decision

### 1.1 Name

The product is `kyrve`.

Use the name in lowercase across product surfaces, prose, URLs, package names, and social accounts. Use `KYRVE` only for compact marks, repository headings, terminal output, and contract prefixes where uppercase improves scanning.

The name compresses “curve” into five letters. It refers to the yield curve that Kyrve keeps confidential while revealing only the one executable quote required by a public credit protocol.

### 1.2 One-line definition

Kyrve is a confidential fixed-income liquidity network that converts encrypted lender mandates and borrower requirements into one executable Morpho Midnight offer while keeping the complete yield curve, provider allocations, exposure limits, and rejected alternatives private.

### 1.3 Thirty-second pitch

Fixed-rate market makers currently publish where they will lend, how much capital they have, which maturities they prefer, and the minimum yield they will accept. Kyrve lets capital providers submit encrypted rate ladders and shared exposure budgets. Borrowers submit encrypted term requirements. Nox privately evaluates the full market, maturity, rate, collateral, and capacity surface, then publicly reveals only one executable quote. A custom ratifier and exact-fill callback enforce that quote through an unchanged Morpho Midnight deployment. The resulting public credit position belongs to a pooled series vault while each provider’s economic ownership remains confidential.

### 1.4 Product category

Kyrve is a confidential term-structure exchange for fixed-rate onchain credit.

Do not position it as:

- a private lending vault
- an encrypted Aave frontend
- a sealed-bid auction
- a Morpho fork
- an institutional dashboard with encryption added
- a generic private DeFi router
- a privacy wrapper around one public offer
- an anonymous loan product

Kyrve’s product category is built around private price discovery, private syndication, exact public settlement, and confidential ownership of public fixed-income positions.

### 1.5 Primary statement

> One public fixed-rate quote. An entire private capital curve behind it.

### 1.6 Product family

The launch product contains:

- Kyrve Book, encrypted lender mandates and borrower requests
- Kyrve Curve, the Nox term-structure computation engine
- Kyrve Leaf, the one activated public quote selected from the private curve
- Kyrve Series, confidential beneficial ownership of pooled Midnight credit
- Kyrve Cross, private secondary matching between existing and incoming holders
- Kyrve Roll, confidential maturity migration and residual public settlement
- Kyrve Capsule, frozen selective-disclosure reports
- Kyrve Verify, web and command-line proof of every critical claim

---

## 2. Strategic thesis

### 2.1 The market failure

Fixed-rate markets require liquidity providers to express a curve.

A provider deciding whether to lend USDC may have different requirements for:

- December, March, June, and September maturities
- wETH, wstETH, cbBTC, and other collateral sets
- different fixed-rate ticks
- different position sizes
- different maximum duration
- different portfolio concentration
- different shared exposure caps
- different counterparties
- different settlement windows

A public offer exposes part of that policy. A basket of public offers exposes far more.

The public can infer:

- how much deployable capital the provider controls
- where its rate floor begins
- which maturities it needs
- which collateral it accepts
- how quickly its appetite changes
- whether it is near an exposure limit
- where it expects rates to move
- which markets it is trying to bootstrap
- when it needs to roll or exit
- how much urgency it has

This information is useful to competitors, borrowers, market makers, liquidators, governance participants, and anyone negotiating with the provider elsewhere.

### 2.2 Why the obvious private vault is weak

A confidential vault that aggregates deposits and opens one public position hides individual balances, but it does not solve private price discovery.

It usually reveals:

- one strategy chosen by the operator
- one public rate
- one public position
- one aggregate amount

The product remains a pooled asset manager. Nox can become an encrypted ledger rather than the mechanism that determines the trade.

Kyrve makes Nox responsible for:

- accepting private mandate vectors
- enforcing private portfolio constraints
- testing lender and borrower compatibility
- privately excluding invalid capital
- calculating aggregate capacity at each quote point
- selecting one market and one rate leaf
- checking a confidential provider-count floor
- reserving confidential balances without leaking failure
- calculating each provider’s series allocation
- netting private secondary entry and exit orders
- calculating residual public settlement
- maintaining confidential beneficial ownership
- producing limited public decryptions that public contracts verify

Removing Nox removes Kyrve’s market, not only its privacy.

### 2.3 Why Morpho Midnight is the right integration

Morpho Midnight separates:

- offer creation
- offer distribution
- routing
- ratification
- callbacks
- group budgets
- final settlement

Offers can be distributed through any external channel. A ratifier decides whether an offer is valid when it is taken. A callback can source capital at settlement. Shared groups can cap exposure across many offers.

Kyrve occupies those extension surfaces:

```text
Encrypted capital mandates
          |
          v
     Kyrve Curve
          |
          v
   One activated offer
          |
          +----> Kyrve Ratifier
          |
          +----> Kyrve Maker Callback
          |
          v
 Unmodified Morpho Midnight
```

The Midnight core receives a normal `Offer` and a normal `take` call. It does not receive Nox handles and does not need confidential arithmetic.

### 2.4 Why the ratifier alone is insufficient

Midnight’s ratifier receives:

```solidity
isRatified(Offer offer, bytes ratifierData, address taker)
```

It is a `view` call and does not receive the `units` a taker is trying to fill.

Midnight offers normally support partial fills. A ratifier can confirm that an activated offer is authentic, but it cannot by itself enforce that the borrower takes the exact quote size Kyrve privately computed.

Kyrve combines two protocol-native controls:

1. `KyrveQuoteRatifier` checks the exact offer hash, approved taker, quote state, request binding, expiry, chain, and deployment.
2. `KyrveSeriesVault.onBuy` receives the actual `units`, `buyerAssets`, buyer address, and callback data during Midnight settlement. It rejects partial or oversized fills, marks the quote consumed, and supplies the exact assets.

A failed callback reverts the entire Midnight take. The group consumption and position updates revert with it.

This exact-fill composition is one of Kyrve’s central technical contributions.

### 2.5 Competitive posture

Kyrve should feel like a new fixed-income market structure built with Nox, not a privacy page inside an existing lending interface.

Its defensible position is:

> Public protocols can settle a quote without seeing the strategy that created it.

Do not claim that Nox is cryptographically superior to every FHE, MPC, or ZK system. Kyrve’s advantage comes from combining Nox’s programmable encrypted arithmetic, asynchronous computation, public decryption proofs, ACL model, and ERC-7984 accounting with Midnight’s ratifier, callback, group, and settlement architecture.

---

## 3. Network and source decision

### 3.1 Ethereum Sepolia deployment

The hackathon requires Ethereum Sepolia.

The official Morpho Midnight address documentation currently lists a Base deployment. Kyrve therefore deploys the pinned, unmodified `2026-07-23` Midnight release to Ethereum Sepolia.

The deployment must:

- preserve the source exactly
- pin the release commit and submodules
- publish the bytecode comparison
- verify every contract on Etherscan
- publish constructor arguments and deployment scripts
- label the deployment as a Sepolia testnet replica
- never imply that it is an official Morpho deployment
- expose a `verify:midnight-bytecode` command

Kyrve contracts remain separate extension contracts.

### 3.2 Licence disclosure

The Midnight repository’s primary licence must be reproduced and respected. The repository and submission must state:

- which files are imported
- which files are deployed unchanged
- which interfaces and libraries carry secondary GPL licensing
- that Kyrve is a non-production Sepolia build
- that production deployment would require a fresh legal and licence review

This is a disclosure requirement, not a reason to weaken the implementation.

### 3.3 Version pinning

The repository must pin:

- Midnight release `2026-07-23`
- exact Nox Solidity packages
- exact Nox JS SDK package
- exact Nox Hardhat plugin
- exact ERC-7984 package
- exact Viem and Wagmi versions
- exact Node and pnpm versions
- exact compiler and EVM target
- exact deployment configuration hashes

No dependency uses an open-ended range.

---

## 4. Product goals and non-goals

### 4.1 Goals

1. Keep full lender mandate curves confidential.
2. Keep borrower rejected alternatives confidential.
3. Select one executable fixed-rate quote through Nox.
4. Settle that quote through unmodified Midnight contracts.
5. Enforce exact one-shot fills despite Midnight’s native partial-fill support.
6. Syndicate one public credit position across several confidential providers.
7. Maintain encrypted provider allocations through ERC-7984 series balances.
8. Support private entry, exit, transfer, and maturity roll flows.
9. Reveal only the minimum aggregate values required by public settlement.
10. Resist cheap quote probing and curve extraction.
11. Fail privately for confidential balance and policy conditions.
12. Provide public proof that private claims remain covered by real public positions.
13. Make every critical product claim independently verifiable.
14. Ship a complete user, operator, auditor, and developer experience.
15. Keep decrypted values out of servers, analytics, logs, and support tooling.
16. Provide a clear recovery path when Nox services or the application are unavailable.
17. Preserve accurate authorship, contributor, and existing-work disclosure in the hackathon submission.

### 4.2 Non-goals

1. Hiding that a borrower took an activated offer.
2. Hiding the final selected market, rate, size, expiry, or maker vault.
3. Hiding initial ERC-20 wrapping amounts.
4. Hiding final public unwrapping amounts.
5. Hiding the public Midnight series position.
6. Making arbitrary Midnight offers confidential.
7. Supporting arbitrary unreviewed markets or callbacks.
8. Claiming that repeated public quotes reveal no economic information.
9. Granting revocable access to a live Nox handle after a viewer has already received permanent permission.
10. Replacing Midnight liquidation, health, maturity, fee, or settlement logic.
11. Treating a TEE output as trustless in the same sense as a validity proof.
12. Using fake book depth, fake fills, simulated Nox handles, or frontend-only balances.
13. Presenting the Sepolia replica as an official Morpho deployment.
14. Letting a generic relayer submit another user’s `fromExternal` proof.
15. Allowing an activated quote to be partially taken.

---

## 5. Users and jobs

### 5.1 Capital provider

A DAO treasury, credit fund, market maker, protocol foundation, family office, or sophisticated onchain lender.

Jobs:

- shield loan assets
- define private rate floors across markets
- define private maturity and collateral preferences
- set portfolio exposure limits
- reuse one private capital budget across several candidate markets
- enter a syndicated position without exposing contribution size
- transfer or sell a private series claim
- roll capital into a later maturity
- prove exposure to an auditor without publishing it
- recover funds through a documented public path

### 5.2 Borrower or credit originator

A borrower, treasury, structured-credit desk, or protocol seeking fixed-term liquidity.

Jobs:

- submit a private maximum rate
- submit a private desired amount
- submit a private maturity range
- submit collateral preferences
- receive one executable quote
- understand what becomes public on activation
- bind the quote to its own address
- take the offer through Midnight
- recover a request bond when it settles
- avoid publishing every rejected term

### 5.3 Portfolio manager

A person or policy engine governing several provider wallets.

Jobs:

- manage several encrypted mandates
- view total confidential exposure
- inspect maturity ladders
- inspect private collateral concentration
- rotate a mandate without exposing the old one
- pause new commitments
- create frozen board and risk reports

### 5.4 Secondary liquidity provider

A party entering or exiting existing fixed-term credit.

Jobs:

- submit encrypted buy or sell interest
- cross privately against another user
- reveal only residual public execution
- receive confidential series units or confidential loan assets
- migrate between maturities without exposing the full roll

### 5.5 Auditor or board viewer

A party requiring scoped evidence.

Jobs:

- receive one frozen disclosure capsule
- decrypt only included fields
- verify the capsule’s onchain origin
- reconcile private aggregate claims with public positions
- avoid receiving access to future balances

### 5.6 Public verifier

A judge, researcher, investor, or integrator.

Jobs:

- confirm real Nox handles
- confirm the operation graph
- confirm the public decryption proof
- confirm the exact Morpho offer
- confirm ratifier and callback enforcement
- confirm private series claims reconcile to public credit
- inspect honest privacy limits

### 5.7 Keeper

A permissionless or replicated service.

Jobs:

- detect completed Nox operations
- activate proven quotes
- finalize expired requests
- settle unlocked redemptions
- publish status without accessing plaintext
- receive bounded fees for public work

---

## 6. Product principles

### 6.1 One leaf, not one public book

Kyrve reveals one executable leaf selected from a confidential curve. It does not publish all acceptable points.

### 6.2 Nox decides economic state

Nox calculations determine eligibility, quote selection, reservation, allocation, secondary crossing, and roll results.

### 6.3 Public contracts receive ordinary values

Midnight receives a standard offer, plaintext tick, plaintext units, public addresses, and normal ERC-20 transfers.

### 6.4 Confidential failure must not become a public oracle

A private balance failure, provider exclusion, rate mismatch, or exposure breach contributes encrypted zero or leaves private state unchanged.

Public reverts are reserved for public failures:

- invalid proof
- expired public request
- wrong chain
- malformed universe
- unregistered market
- replayed quote
- unauthorised taker
- altered offer
- partial fill
- stale settlement boundary
- unauthorised callback caller

### 6.5 Exact fill is enforced twice

The ratifier authenticates the offer. The callback authenticates the attempted settlement amount.

### 6.6 Private claims remain fully reserved

The sum of active confidential series claims cannot exceed the real public credit units and reserves controlled by the associated series vault.

### 6.7 Disclosure is a copy, not live access

Auditors receive frozen handles created for a particular capsule. They do not receive viewer access to live balances.

### 6.8 Every reveal is named before signing

The user interface distinguishes:

- private now and private after settlement
- private now but public on activation
- public from submission
- public only on unwrap or redemption

### 6.9 No decrypted value enters backend infrastructure

Decryption occurs in the authorised client. Server-side components index handles, proofs, statuses, public amounts, and receipts only.

---

## 7. Product pillars

### 7.1 Kyrve Book

Stores encrypted provider mandates and borrower requests.

Provider mandates contain a private vector across a bounded public universe. They can express:

- maximum contribution per market
- minimum acceptable rate index
- allowed maturity set
- allowed collateral set
- maximum duration
- total portfolio exposure cap
- maximum exposure per collateral family
- maximum exposure per maturity bucket
- allocation weight
- quote participation expiry
- optional borrower allow or deny policy

Borrower requests contain:

- desired asset amount
- maximum acceptable rate index
- allowed markets
- preferred maturity band
- minimum fill
- exact-fill or bounded-fill preference
- request expiry
- approved borrower address
- optional collateral policy

### 7.2 Kyrve Curve

Evaluates all candidate quote points using Nox.

It produces encrypted handles for:

- effective provider capacity per leaf
- provider eligibility per leaf
- effective provider count per leaf
- aggregate capacity per leaf
- borrower compatibility per leaf
- portfolio compatibility per leaf
- selected leaf
- selected aggregate amount
- privacy-floor result
- provider reservation amounts

### 7.3 Kyrve Leaf

The single public result.

An activated leaf contains:

- universe ID
- market ID
- exact Midnight market struct hash
- exact tick
- exact units
- aggregate public loan assets
- approved taker
- start
- expiry
- settlement fee cap
- quote ID
- request ID
- maker series vault
- ratifier
- callback
- group
- one-shot status

### 7.4 Kyrve Series

A public Midnight credit position with confidential beneficial owners.

Each distinct market and maturity position has:

- one `KyrveSeriesVault`
- one confidential ERC-7984 series token
- one public Midnight position
- one confidential ownership ledger
- one redemption queue
- one solvency snapshot stream

The public sees the series vault’s aggregate position. Providers see their own encrypted series balances.

### 7.5 Kyrve Cross

A confidential secondary market for series claims.

Existing holders submit encrypted exit orders. Incoming providers submit encrypted entry orders. Nox matches compatible orders privately and transfers confidential series balances and confidential loan-token balances.

Only unmatched residual demand reaches public Midnight settlement.

### 7.6 Kyrve Roll

A private maturity migration engine.

A holder can express:

- amount to roll
- earliest and latest target maturity
- minimum acceptable new yield
- maximum cash top-up
- maximum realized discount
- collateral preferences
- fallback to remain in current series

Nox privately matches rolls against:

- entrants into the old series
- exits from a target series
- new primary-market demand
- other holders rolling in the opposite direction

Only residual public actions are exposed.

### 7.7 Kyrve Capsule

Frozen selective disclosure.

Capsules can cover:

- position ownership
- maturity ladder
- collateral concentration
- realized yield
- unrealized yield
- solvency
- one quote participation
- one secondary transfer
- one policy-compliance period
- one board-period report

### 7.8 Kyrve Verify

The evidence layer.

It exposes:

- deployment verification
- Midnight bytecode comparison
- Nox operation graph
- quote activation proof
- ratifier result
- callback exact-fill evidence
- Midnight take receipt
- provider allocation reconciliation
- series solvency
- secondary crossing reconciliation
- maturity redemption reconciliation
- privacy-boundary report

---

## 8. Privacy model

### 8.1 Private fields

- provider rate floors
- provider capacity per market
- provider total capital budget after shielding
- provider inclusion in a quote
- provider exclusion reason
- provider portfolio limits
- provider resulting allocation
- provider secondary order
- provider roll policy
- borrower desired amount before activation
- borrower maximum acceptable rate before activation
- borrower acceptable maturities before activation
- rejected quote leaves
- second-best quote
- effective provider count, except pass or fail against a public threshold
- internal crosses
- individual yield ownership
- individual redemption requests before batch settlement
- capsule contents

### 8.2 Public fields

- wallet addresses that submit encrypted handles
- transaction timing and gas
- handle identifiers
- request existence
- public universe
- request bond
- initial wrapping amount
- activated market
- activated tick and implied rate
- activated aggregate amount
- activated exact units
- approved taker
- quote expiry
- maker series vault
- ratifier and callback
- Midnight take
- public series position
- aggregate secondary residual
- aggregate redemption
- final public unwrap
- capsule existence and recipient address

### 8.3 Inference risks

Kyrve reduces disclosure. It cannot erase all economic inference.

Observers may learn information from:

- repeated requests
- repeated activated quotes
- quote timing
- public aggregate sizes
- changes in public series positions
- provider deposit and withdrawal timing
- small anonymity sets
- unique market preferences
- abandoned requests
- correlation across addresses

The application must describe these risks without claiming perfect anonymity.

### 8.4 Privacy floor

Every syndicated quote has a public minimum provider count, normally three.

The effective count is computed privately. Only an encrypted Boolean result becomes publicly decryptable:

```text
privacy floor passed: true
```

The application must never display an exact provider count when that count is meant to remain private.

A quote with fewer effective providers can:

- remain pending for the next epoch
- fall back to an explicitly labelled single-provider RFQ
- expire and unlock capital

It cannot be presented as a multi-provider private quote.

---

## 9. Public quote universe

### 9.1 Why the universe is bounded

Nox supports encrypted arithmetic over handles, but Kyrve should not pretend that an unbounded dynamic order book is practical inside one computation graph.

Each quote universe contains a bounded set of public leaves.

Launch configuration:

- up to 8 Midnight markets
- up to 16 rate ticks per market
- up to 16 providers per epoch
- up to 128 market-rate leaves
- one loan token per universe
- one quote direction per universe

These are deployment parameters, not permanent protocol limits.

### 9.2 Universe structure

```solidity
struct CurveUniverse {
    bytes32 id;
    address loanToken;
    bytes32 midnightReleaseHash;
    uint16 maxProviders;
    uint16 minEffectiveProviders;
    uint40 opensAt;
    uint40 closesAt;
    MarketLeaf[] markets;
}

struct MarketLeaf {
    bytes32 marketId;
    bytes32 marketStructHash;
    uint16 marketIndex;
    uint40 maturity;
    uint16 collateralFamily;
    int256[] ticks;
}
```

### 9.3 Rate-index discipline

Do not compare human APR values inside the confidential engine.

For every market:

1. Use the pinned Midnight SDK and tick math to produce a public ordered rate grid.
2. Map `rateIndex` to one exact valid Midnight tick.
3. Sort indexes by increasing borrowing cost for that market.
4. Hash the full grid into the universe.
5. Verify the grid during deployment and in `verify:universe`.
6. Store provider and borrower limits as encrypted indexes into this grid.

This avoids hidden assumptions about tick direction, settlement fees, maturity, or annualization.

### 9.4 Universe governance

A universe can be proposed by anyone but activated only after:

- bytecode and market-struct validation
- maturity validation
- oracle liveness checks
- collateral-parameter checks
- tick-spacing validation
- quote-grid hash publication
- risk-limit publication
- a delay
- security review status

No active universe can be mutated. A new configuration creates a new universe ID.

---

## 10. Full system architecture

```text
┌─────────────────────────────────────────────────────────────────────────┐
│                              Client layer                               │
│                                                                         │
│  Provider console   Borrower RFQ   Secondary desk   Auditor verifier    │
│         │                │                 │                 │            │
│         └──────────── Nox encryption and local decryption ──────────────┘
└───────────────────────────────┬─────────────────────────────────────────┘
                                │ direct calls with bound proofs
                                v
┌─────────────────────────────────────────────────────────────────────────┐
│                          Confidential input layer                        │
│                                                                         │
│  ConfidentialAssetVault   MandateBook   RequestBook   SecondaryBook     │
│          │                    │              │              │             │
│          └──────── validated Nox handles and ACL grants ────────────────┘
└───────────────────────────────┬─────────────────────────────────────────┘
                                v
┌─────────────────────────────────────────────────────────────────────────┐
│                              Kyrve Curve                                 │
│                                                                         │
│  eligibility  safe reservation  capacity  privacy floor  leaf select    │
│  exposure limits  provider allocation  secondary netting  roll netting  │
└───────────────────────────────┬─────────────────────────────────────────┘
                                │ deterministic result handles
                                v
┌─────────────────────────────────────────────────────────────────────────┐
│                             Nox pipeline                                 │
│                                                                         │
│  onchain events -> Ingestor -> NATS -> TDX Runner -> Handle Gateway     │
│                                   │                                     │
│                                   └──────── encrypted outputs ──────────┘
└───────────────────────────────┬─────────────────────────────────────────┘
                                │ signed public decryption proofs
                                v
┌─────────────────────────────────────────────────────────────────────────┐
│                         Quote activation layer                           │
│                                                                         │
│  QuoteActivator -> QuoteMath -> KyrveQuoteRatifier -> SeriesVault       │
│                                             │             │              │
│                                             │             └ onBuy       │
└─────────────────────────────────────────────┼────────────────────────────┘
                                              v
┌─────────────────────────────────────────────────────────────────────────┐
│                    Pinned Morpho Midnight on Sepolia                     │
│                                                                         │
│  touchMarket  take  group consumption  credit  debt  fees  maturity     │
└─────────────────────────────────────────────┬────────────────────────────┘
                                              │ public credit position
                                              v
┌─────────────────────────────────────────────────────────────────────────┐
│                       Confidential ownership layer                       │
│                                                                         │
│  ERC-7984 SeriesToken   PrivateCreditLedger   CrossEngine   RollEngine  │
│          │                       │                  │            │         │
│          └──────────── confidential claims and allocations ─────────────┘
└───────────────────────────────┬─────────────────────────────────────────┘
                                v
┌─────────────────────────────────────────────────────────────────────────┐
│                         Proof and operations layer                       │
│                                                                         │
│ Indexer  Keeper  SolvencyVerifier  CapsuleFactory  Web proof explorer   │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## 11. Nox integration

### 11.1 Direct-input rule

A wallet that encrypts an input must directly call the contract that invokes `Nox.fromExternal`.

Kyrve must not route another user’s external proof through:

- a generic relayer
- an account abstraction paymaster contract
- a Safe module
- a batch router
- a server signer

Correct pattern:

```text
provider wallet
    -> MandateBook.submitMandate(...)
        -> Nox.fromExternal(...)
        -> Nox.allowThis(...)
        -> persistent or transient ACL grants
```

Gas sponsorship may reimburse the user after submission, but it cannot change the direct caller.

### 11.2 External encrypted types

Use only supported input types:

- `externalEuint16`
- `externalEuint256`
- `externalEint16`
- `externalEint256`
- `externalEbool` where supported by the pinned package

Do not encode a large private object into one opaque unverified byte string.

### 11.3 Mandate representation

Each provider submits fixed-length arrays of handles.

```solidity
struct EncryptedMandateInput {
    externalEuint256 totalBudget;
    externalEuint256[8] marketCaps;
    externalEuint16[8] minRateIndexes;
    externalEuint16[8] enabledFlags;
    externalEuint256[4] collateralFamilyCaps;
    externalEuint256[4] maturityBucketCaps;
    externalEuint16 maxDurationIndex;
    externalEuint16 allocationWeight;
}
```

The exact lengths derive from the universe. Unused slots are encrypted zero.

Avoid relying on undocumented encrypted bitwise operations.

### 11.4 Request representation

```solidity
struct EncryptedRequestInput {
    externalEuint256 desiredAssets;
    externalEuint256 minimumAssets;
    externalEuint16[8] maxRateIndexes;
    externalEuint16[8] enabledFlags;
    externalEuint16 preferredMaturityIndex;
}
```

Public request fields include:

- universe ID
- borrower address
- request bond
- submission time
- expiry
- exact-fill requirement
- public collateral transaction reference
- nonce

### 11.5 Eligibility

For provider `p` and leaf `l`:

```text
enabled[p,l]
rateAllowed[p,l]
borrowerAllowed[p]
marketCapAvailable[p,l]
portfolioCapAvailable[p,l]
balanceAvailable[p]

eligible[p,l] =
    enabled
    AND rateAllowed
    AND borrowerAllowed
    AND marketCapAvailable
    AND portfolioCapAvailable
    AND balanceAvailable
```

Every term remains encrypted where it depends on private state.

### 11.6 Safe reservation

A provider must not become a public oracle through an underflow revert.

For each candidate reservation:

```text
(ok, remainingBalance) = safeSub(balance, requestedContribution)
effectiveContribution = select(ok AND eligible, requestedContribution, 0)
finalBalance = select(ok AND eligible, remainingBalance, balance)
```

Private invalidity produces a zero contribution and unchanged balance.

### 11.7 Leaf capacity

```text
capacity[l] = sum(effectiveContribution[p,l])
count[l] = sum(select(eligible[p,l], 1, 0))
canFill[l] =
    capacity[l] >= desiredAssets
    AND count[l] >= privacyFloor
    AND borrowerAllows[l]
```

Only the final selected leaf and privacy-floor Boolean may become publicly decryptable.

### 11.8 Leaf selection

The selection policy is public and deterministic.

Default:

1. lowest borrowing cost allowed by the borrower
2. sufficient aggregate capacity
3. privacy floor passed
4. maturity preference distance
5. public market-priority tie-break
6. lowest market index
7. lowest rate index

The policy must never depend on a trusted offchain operator.

Nox applies encrypted comparisons and `select` operations over every candidate.

### 11.9 Aggregate amount

The selected amount is:

```text
fillAssets = min(desiredAssets, selectedCapacity)
```

The launch product supports exact-fill borrower requests. A bounded partial-fill mode can exist only when its minimum is encrypted and the final amount remains above that minimum.

### 11.10 Provider reservation allocation

If selected capacity exceeds the fill:

```text
rawAllocation[p] =
    fillAssets
    * effectiveContribution[p,selectedLeaf]
    / selectedCapacity
```

Rounding dust is allocated by a public deterministic rule, such as lowest provider commitment hash among eligible providers, without revealing the provider’s raw capacity.

The sum of reservations must equal the public fill amount.

### 11.11 Public decryption

The engine grants public decryption only to these handles:

- selected market index
- selected rate index
- aggregate fill assets
- privacy-floor passed
- quote-ready Boolean

It does not grant public access to:

- all candidate capacities
- provider count
- second-best leaf
- provider allocation
- borrower maximum rate
- provider minimum rate
- excluded providers

### 11.12 Operation-graph proof

`Kyrve Verify` reconstructs the handle dependency graph from Nox events.

It proves that the public result handle derives from:

- the registered universe
- the submitted request handles
- active mandate handles
- encrypted balance handles
- the declared selection policy
- the declared arithmetic sequence

This does not remove Nox’s TEE trust assumption. It proves that the output used by Kyrve is the output of the declared Nox computation graph.

### 11.13 ACL policy

Rules:

- new computation handles receive transient access first
- any handle needed in a later transaction receives explicit persistent admin access
- users receive viewer access only to their own values
- quote aggregate handles receive public decryption permission only after sealing
- live portfolio handles never grant auditor viewer access
- capsules use new-handle isolation
- viewer permission is treated as permanent for that handle
- key rotation creates new view handles

### 11.14 Confidential tokens

Underlying assets are wrapped into ERC-7984 tokens.

Honest boundaries:

- the initial ERC-20 deposit amount is public
- confidential balances and transfers are private after wrapping
- aggregate quote funding becomes public when unwrapped for Midnight
- final public withdrawal amount is public
- confidential series transfers remain encrypted

Operator permissions must be time-limited and narrowly scoped. A broad operator can move an unlimited amount until expiry under the standard’s operator model.

---

## 12. Morpho Midnight integration

### 12.1 Offer direction

The primary quote uses a lender-side maker offer:

```text
offer.buy = true
maker = KyrveSeriesVault
taker = approved borrower
```

The series vault buys Midnight credit units. The borrower sells units and increases or transfers debt according to Midnight’s normal settlement path.

### 12.2 Activated offer

```solidity
Offer({
    market: selectedMarket,
    buy: true,
    maker: seriesVault,
    start: activationTime,
    expiry: shortExpiry,
    tick: selectedTick,
    group: quoteId,
    callback: seriesVault,
    callbackData: abi.encode(quoteId),
    receiverIfMakerIsSeller: address(0),
    ratifier: quoteRatifier,
    reduceOnly: false,
    maxUnits: exactUnits,
    maxAssets: 0,
    continuousFeeCap: configuredFeeCap
});
```

Exactly one of `maxUnits` or `maxAssets` is non-zero, matching Midnight’s validation.

### 12.3 Quote math

`KyrveQuoteMath` imports or reproduces the pinned release’s exact tick and rounding rules.

It derives:

- selected tick
- exact units
- expected buyer assets
- expected seller assets
- settlement-fee bounds
- maximum rounding tolerance

The activator rejects any mismatch between:

- Nox-decrypted aggregate amount
- universe rate index
- exact tick
- derived units
- expected assets
- market maturity
- current fee configuration

### 12.4 Quote ratifier

`KyrveQuoteRatifier` implements `IRatifier`.

It checks:

- caller is the pinned Midnight deployment
- offer hash equals the activated offer hash
- quote status is executable
- request ID matches
- universe matches
- chain ID matches
- taker equals the approved borrower
- quote has not expired
- quote has not been consumed
- series vault is the maker
- callback equals the series vault
- ratifier equals this contract
- group equals quote ID
- rate and market match the activated leaf

It returns Midnight’s required callback success value only when all checks pass.

It does not attempt to enforce exact units because `isRatified` does not receive units.

### 12.5 Series-vault callback

`KyrveSeriesVault` implements `IBuyCallback`.

On `onBuy`:

1. Require `msg.sender` is the pinned Midnight contract.
2. Decode quote ID.
3. Require quote status is executable.
4. Require buyer is this series vault.
5. Require market ID matches.
6. Require actual units equal activated exact units.
7. Require buyer assets equal the approved asset amount within the exact documented rounding rule.
8. Require the callback has not been called.
9. Mark quote consumed before external token interactions.
10. Approve or expose the exact loan-token amount for Midnight.
11. Emit an exact-fill receipt.
12. Return Midnight’s callback success value.

Because Midnight transfers assets after the callback, the vault must already hold the public loan tokens and approve Midnight.

### 12.6 Funding before activation

Funding sequence:

1. Nox locks provider cToken balances privately.
2. Public decryption reveals the aggregate selected amount.
3. `QuoteActivator` verifies the decryption proof.
4. `ConfidentialAssetVault` burns the aggregate confidential tokens from the locked settlement account.
5. The ERC-7984 wrapper’s public finalization releases the exact ERC-20 amount.
6. ERC-20 assets move to the series vault.
7. Quote math derives exact units.
8. Ratifier and callback state are activated.
9. Borrower takes the offer.

If the quote expires untaken:

1. Series vault returns public ERC-20 assets to the confidential wrapper.
2. Wrapper mints aggregate cTokens to the settlement account.
3. Nox releases each provider’s encrypted reservation.
4. Request bond is processed under the anti-probing policy.

### 12.7 One-shot settlement

The quote cannot be:

- partially filled
- filled by another borrower
- replayed on another chain
- replayed against another Midnight deployment
- replayed after expiry
- filled twice
- altered while retaining ratification

### 12.8 Post-settlement allocation

After the real `Take` event:

1. `SeriesAllocator` reads exact public units and public position state.
2. It invokes Nox allocation over encrypted provider reservations.
3. Nox calculates encrypted series-unit allocations.
4. Dust follows the public deterministic rule.
5. ERC-7984 series balances are minted.
6. Aggregate private supply is publicly reconciled to the series vault’s Midnight credit.

Until allocation completes, the UI shows a real pending state, not a fake balance.

---

## 13. Contract system

### 13.1 `KyrveProtocolRegistry.sol`

Stores:

- pinned Midnight address
- pinned Nox addresses
- wrapper addresses
- approved universe factories
- approved callback bytecode hashes
- approved ratifier bytecode hashes
- protocol version
- emergency state

### 13.2 `CurveUniverseRegistry.sol`

Creates immutable public universes.

Functions:

```solidity
proposeUniverse(...)
activateUniverse(bytes32 universeId)
deprecateUniverse(bytes32 universeId)
getUniverse(bytes32 universeId)
getMarketLeaf(bytes32 universeId, uint16 marketIndex)
getTick(bytes32 universeId, uint16 marketIndex, uint16 rateIndex)
```

### 13.3 `ConfidentialAssetVault.sol`

Maintains confidential provider balances and settlement reservations.

Responsibilities:

- ERC-7984 deposits
- encrypted balance handles
- encrypted locked handles
- safe reservations
- aggregate settlement account
- release on expiry
- redemption distribution
- solvency handles

### 13.4 `EncryptedMandateBook.sol`

Direct user entry point for provider encrypted inputs.

Functions:

```solidity
submitMandate(...)
replaceMandate(...)
pauseMandate(bytes32 mandateId)
retireMandate(bytes32 mandateId)
rotateViewHandle(bytes32 mandateId)
```

A replacement creates a new epoch and new handles. Old handles cannot authorize future quotes.

### 13.5 `ConfidentialRequestBook.sol`

Direct borrower entry point.

Functions:

```solidity
submitRequest(...)
cancelUnsealedRequest(bytes32 requestId)
topUpBond(bytes32 requestId)
expireRequest(bytes32 requestId)
```

### 13.6 `QuoteEpochController.sol`

Controls:

- epoch opening and closing
- request admission
- one active request per borrower and universe
- provider-set snapshot
- privacy floor
- cooldown
- bond settlement
- quote expiry
- deterministic keeper fee

### 13.7 `NoxCurveEngine.sol`

Builds the encrypted operation graph.

Functions:

```solidity
sealRequest(bytes32 requestId)
computeLeaf(bytes32 requestId, uint16 leafIndex)
finalizeSelection(bytes32 requestId)
preparePublicDecryption(bytes32 requestId)
```

Implementation must batch operations to stay within practical Nox and gas limits.

### 13.8 `QuoteActivator.sol`

Verifies Nox public-decryption proofs and creates one exact offer.

Functions:

```solidity
activateQuote(
    bytes32 requestId,
    PublicQuoteResult calldata result,
    DecryptionProof[] calldata proofs
)
expireActivatedQuote(bytes32 quoteId)
```

### 13.9 `KyrveQuoteMath.sol`

Pinned math for:

- rate-index to tick
- tick to price
- exact units
- settlement fee
- buyer and seller asset rounding
- maturity calculations

Every output is differential-tested against the pinned Midnight SDK and core libraries.

### 13.10 `KyrveQuoteRatifier.sol`

Read-only exact-offer authorization.

Storage:

```solidity
struct ActivatedQuote {
    bytes32 offerHash;
    bytes32 requestId;
    bytes32 universeId;
    bytes32 marketId;
    address taker;
    address seriesVault;
    uint128 exactUnits;
    uint128 expectedBuyerAssets;
    uint40 expiry;
    QuoteStatus status;
}
```

The ratifier has no upgrade or arbitrary-call surface.

### 13.11 `KyrveSeriesFactory.sol`

Deploys deterministic series components for a market:

- series vault
- ERC-7984 series token
- allocator
- redemption queue
- solvency account

### 13.12 `KyrveSeriesVault.sol`

Roles:

- Midnight maker
- `IBuyCallback`
- public ERC-20 settlement reserve
- public Midnight credit owner
- maturity withdrawal account
- residual secondary maker
- quote-consumption authority

It must not accept arbitrary external calls or arbitrary callbacks.

### 13.13 `KyrveSeriesToken.sol`

Full ERC-7984 implementation representing confidential beneficial claims.

Rules:

- mint only from proven allocation
- burn only through redemption or approved crossing
- use time-bound operators
- validate callback receivers
- expose no plaintext balance path
- maintain a public aggregate-supply handle for solvency only

### 13.14 `SeriesAllocator.sol`

Converts encrypted reservations into encrypted series allocations.

It verifies:

- quote was consumed
- exact public Midnight credit increase
- reservation set hash
- allocation graph
- dust rule
- one-time mint status

### 13.15 `SecondaryOrderBook.sol`

Direct encrypted order input.

Order fields:

- series ID
- side
- amount
- limit price index
- expiry
- minimum fill
- roll intent
- private counterparty policy

### 13.16 `NoxCrossEngine.sol`

Computes:

- compatible private buy and sell orders
- internal transfer amount
- clearing price
- individual confidential fills
- public residual
- privacy floor

### 13.17 `ResidualSettlementAdapter.sol`

Creates exact residual Midnight offers using the same ratifier and callback discipline.

The adapter cannot submit arbitrary market structs, ticks, or token destinations.

### 13.18 `NoxRollEngine.sol`

Matches confidential exits and entries across maturities.

### 13.19 `MaturityRedemptionQueue.sol`

Batches encrypted redemption requests.

At maturity:

1. Nox aggregates requests.
2. Series vault withdraws aggregate units from Midnight.
3. Received loan assets are wrapped to cTokens.
4. Nox distributes encrypted cToken amounts.
5. Series tokens burn privately.

### 13.20 `DisclosureCapsuleFactory.sol`

Creates immutable snapshot handles and viewer scopes.

### 13.21 `AggregateSolvencyVerifier.sol`

Publicly reconciles:

- series-vault credit
- withdrawable assets
- pending fee
- aggregate confidential series supply
- pending redemptions
- public reserves
- settlement accounts

### 13.22 `EmergencyController.sol`

Can:

- pause new mandates
- pause new requests
- pause quote activation
- pause secondary crossing
- pause new roll epochs

It cannot seize user claims or falsify allocations.

Settled Midnight positions and maturity redemption remain recoverable.

### 13.23 `KyrveRecoveryRouter.sol`

Provides a delayed public recovery path when confidential services remain unavailable.

Requirements:

- explicit public-boundary warning
- time delay
- claim proof
- aggregate rate limit
- no operator discretion over claim size
- public amount and recipient
- one-time claim consumption
- complete receipt

---

## 14. State machines

### 14.1 Request

```text
Draft
  -> Submitted
  -> Admitted
  -> Sealed
  -> Computing
  -> QuoteReady
  -> Funding
  -> Activated
  -> Taken
  -> Allocating
  -> Settled

Alternative:
Submitted -> Cancelled
Admitted -> Expired
Computing -> FailedPublicInvariant
Activated -> ExpiredUntaken -> Refunding
```

Confidential rejection does not create a public “provider failed” state.

### 14.2 Quote

```text
None
  -> Proven
  -> Funded
  -> Executable
  -> Consumed

Alternative:
Executable -> Expired
Executable -> EmergencyCancelled
```

### 14.3 Mandate

```text
Active
  -> Snapshot
  -> PartiallyReserved
  -> Filled
  -> Active

Alternative:
Active -> Paused
Active -> Replaced
Active -> Retired
```

### 14.4 Series

```text
Created
  -> Funding
  -> Live
  -> Matured
  -> Redeeming
  -> Closed
```

### 14.5 Secondary epoch

```text
Open
  -> Sealed
  -> Computing
  -> CrossReady
  -> InternalSettlement
  -> ResidualReady
  -> ResidualSettled
  -> Allocated
```

### 14.6 Roll

```text
Open
  -> Sealed
  -> Computing
  -> Paired
  -> ResidualFunding
  -> PublicSettlement
  -> Allocating
  -> Completed

Alternative:
Open -> Cancelled
Computing -> NoMatch
Paired -> Expired -> Released
```

### 14.7 Capsule

```text
Draft
  -> SnapshotCreated
  -> ViewerGranted
  -> Available
  -> Archived
```

Archiving removes the application listing. It does not revoke access to an already granted handle.

---

## 15. Quote-probing resistance

### 15.1 Threat

A requester can repeatedly ask:

- “Can I borrow 100,000?”
- “Can I borrow 120,000?”
- “Can I borrow at this rate?”
- “What about this maturity?”

Activated quote outcomes can gradually reconstruct the hidden curve.

### 15.2 Controls

Kyrve uses:

- refundable request bonds
- one active request per borrower per universe
- exact public lot buckets
- discrete public rate grids
- short activation windows
- one-shot quotes
- borrower-bound ratification
- minimum provider privacy floor
- epoch batching
- request cooldowns
- abandoned-quote penalties
- escalating bond for repeated untaken quotes
- public request-rate limits enforced onchain
- quote coarsening
- universe-level daily activation budget
- optional private counterparty allow policies

### 15.3 Bond outcomes

- quote taken: full bond returned
- no compatible quote: full bond returned
- requester cancels before sealing: full bond returned
- quote activated and requester lets it expire: partial bond slash
- repeated expiries: higher next bond
- protocol or Nox failure: full bond returned

### 15.4 Quote coarsening

Borrowers choose from public lot bands rather than arbitrary public sizes.

Private desired amounts can remain within a band, but the activated quote is rounded according to a declared policy.

Rate selection uses a fixed public grid. No arbitrary custom rate is publicly activated.

### 15.5 Honest limitation

These measures raise the cost of curve extraction. They do not make inference impossible.

---

## 16. Confidential secondary market

### 16.1 Internal crossing

For one series and price bucket:

```text
totalPrivateBuys
totalPrivateSells
crossed = min(totalPrivateBuys, totalPrivateSells)
residualBuy = totalPrivateBuys - crossed
residualSell = totalPrivateSells - crossed
```

Nox privately allocates fills among orders.

### 16.2 Confidential settlement

Internal cross:

- buyer cToken balance decreases
- seller cToken balance increases
- seller series balance decreases
- buyer series balance increases
- individual fills remain encrypted

### 16.3 Residual public settlement

Only the unmatched aggregate becomes a public Midnight offer or take.

The UI distinguishes:

- privately crossed amount
- public residual amount
- public price and series
- private individual fill

### 16.4 Private failure

An underfunded buyer or overselling holder contributes zero without publishing which order failed.

### 16.5 Price policy

The clearing price is selected from a public bounded grid.

A private order cannot force arbitrary calldata or an unreviewed tick.

### 16.6 Fairness policy

Within one price bucket, allocation follows one public rule:

- pro-rata by valid encrypted size, or
- encrypted time priority based on committed submission slots

The rule is immutable per secondary epoch.

### 16.7 Residual seller path

When the series vault must sell public credit units:

- `offer.buy = false`
- the series vault is the maker and seller
- `receiverIfMakerIsSeller` is the series vault
- exact units and price are bound
- the residual ratifier prevents replay
- received ERC-20 assets are wrapped and privately distributed

---

## 17. Maturity rolls

### 17.1 Roll request

A holder submits encrypted:

- source series amount
- target maturity range
- target collateral families
- minimum target yield
- maximum discount on source exit
- maximum cToken top-up
- expiry
- fallback policy

### 17.2 Roll graph

Nox searches:

1. private buyers for the source series
2. private sellers or primary capacity for the target series
3. opposing roll requests
4. internal cToken balances
5. residual public settlement

### 17.3 Atomicity model

A complete cross-series public roll may require more than one transaction because Nox computation is asynchronous.

Kyrve does not claim same-transaction confidentiality across the Nox phase.

It provides economic atomicity through:

- locked confidential inputs
- bounded public quote windows
- minimum outcome handles
- paired activation state
- all-or-release settlement rules
- residual adapters that revert when bounds fail

### 17.4 Roll outcome

Private:

- user source amount
- user target amount
- user top-up
- internal counterparties

Public:

- aggregate source residual
- aggregate target residual
- selected public series
- public Midnight settlements

### 17.5 Failure handling

If only one public leg settles, the system must not fabricate the other leg.

Use:

- pre-funded residual accounts
- paired expiry
- minimum-out enforcement
- deterministic unwind
- explicit public recovery when necessary

---

## 18. Selective disclosure

### 18.1 Capsule schema

```solidity
struct Capsule {
    bytes32 id;
    address subject;
    address viewer;
    uint40 snapshotAt;
    bytes32 scopeHash;
    bytes32[] handles;
    bytes32[] receiptHashes;
}
```

### 18.2 Capsule scopes

- quote participation
- series ownership
- total fixed-income exposure
- maturity distribution
- collateral concentration
- realized return
- policy compliance
- proof of reserve
- period statement

### 18.3 No false revocation

The UI must never say “access revoked” for a handle the viewer could already decrypt.

Use:

- “live access ended”
- “future snapshots disabled”
- “this historical snapshot remains available”

### 18.4 Capsule verification

A capsule verifier checks:

- factory address
- snapshot block
- subject
- viewer
- scope hash
- handle ACL
- source receipt hashes
- deployment version

---

## 19. Solvency and accounting

### 19.1 Core invariant

For each series:

```text
aggregate confidential active claims
+ pending confidential redemption claims
<= public Midnight credit
+ public withdrawable loan assets
+ public settlement reserves
- protocol fees already accrued
```

### 19.2 Quote funding invariant

```text
sum encrypted provider reservations
= publicly unwrapped quote funding
```

### 19.3 Allocation invariant

```text
sum encrypted series allocations
= exact Midnight units received
```

### 19.4 Secondary invariant

```text
series debited from sellers
= series credited to buyers
+ public residual series sold
```

### 19.5 Maturity invariant

```text
series tokens burned
<= units withdrawn from Midnight
```

### 19.6 Public solvency snapshot

A snapshot publicly decrypts only aggregate claim handles. Individual balances remain private.

The proof page shows:

- public series credit
- aggregate private claims
- coverage ratio
- pending redemption
- reserve assets
- block number
- Nox proof
- Midnight state reference

### 19.7 Loss accounting

Midnight positions can experience loss.

The confidential ledger must apply the public series loss factor consistently to every private claim.

Rules:

- no provider receives preferential loss treatment
- pending fee and loss factor are included in share-value math
- solvency proofs use current public position state
- the UI separates principal units from current redeemable value
- capsules disclose the snapshot loss factor

### 19.8 Dust accounting

All rounding dust belongs to a public dust account.

Dust cannot be swept to a developer wallet.

At series close, residual dust is distributed under a declared policy or donated to a declared public address.

---

## 20. Security model

### 20.1 Trust assumptions

Kyrve depends on:

- Ethereum Sepolia consensus
- pinned Midnight contract correctness
- Nox Gateway signing authority
- Nox KMS and TEE confidentiality assumptions
- correct ACL enforcement
- correct wrapper implementation
- correct quote-grid construction
- correct callback and ratifier code
- correct public-decryption proof verification

### 20.2 Threats and mitigations

#### Forged encrypted input

- `Nox.fromExternal`
- caller and contract binding
- proof expiry
- input type checking
- one-time request nonce

#### Handle replay

- consumed handle registry
- request and mandate epoch binding
- universe binding
- chain and contract domain separation

#### Partial quote fill

- exact units stored on activation
- exact assets bound
- series-vault callback checks actual fill
- callback marks consumed
- full transaction reverts on mismatch

#### Quote theft

- approved taker stored
- ratifier checks taker
- request address bound
- short expiry

#### Altered offer

- full `keccak256(abi.encode(offer))`
- exact callback, ratifier, group, tick, market, maker, fee cap, and expiry binding

#### Settlement-fee drift

- short quote life
- public fee cap
- exact callback asset checks
- activation math based on current pinned state

#### Callback spoofing

- only Midnight caller
- exact market ID
- exact buyer
- exact quote state
- reentrancy guard

#### Provider balance probing

- safe arithmetic
- encrypted success
- `select` to zero invalid contribution
- no public rejection reason

#### Malicious universe

- immutable activation
- delay
- oracle and market validation
- tick-grid verification
- bytecode allowlist
- public risk metadata

#### Insolvent private ledger

- mint only from proven allocation
- aggregate supply reconciliation
- solvency invariant tests
- public aggregate proof
- paused new issuance on discrepancy

#### ACL leakage

- viewer minimization
- new-handle isolation
- no auditor on live handles
- permission inspection page

#### Operator abuse

- time-bound ERC-7984 operators
- function-specific operator contracts
- maximum expiry
- emergency disable
- operator permission page

#### Quote probing

- bonds
- cooldown
- lot and tick buckets
- one active request
- activation budget
- one-shot quote

#### Indexer compromise

- no private plaintext
- onchain source of truth
- deterministic rebuild
- signed release manifests
- public status only

#### Frontend compromise

- commitment preview
- domain display
- contract-address pinning
- transaction simulation
- content security policy
- reproducible build hash
- local decrypted-value isolation

#### TEE or gateway compromise

Impact:

- confidentiality can fail
- invalid encrypted values or decryption authority may be accepted depending on the compromised component

Mitigation and disclosure:

- pin official contracts and endpoints
- verify gateway signatures
- display Nox trust assumptions
- support emergency pause
- provide aggregate public recovery
- never market TEE outputs as zero-knowledge proofs

### 20.3 Emergency recovery

If Nox is unavailable:

- no new confidential calculations
- no new quote activation
- existing public Midnight positions remain valid
- public maturity withdrawal remains possible
- users can enter a delayed aggregate recovery process
- recovery publishes the amount being withdrawn
- recovery never fabricates confidential allocations
- all boundary changes require explicit user acknowledgement

---

## 21. Backend and operations

### 21.1 Backend role

The backend provides:

- public event indexing
- request and epoch status
- Nox operation-readiness polling
- public quote activation jobs
- public settlement receipt indexing
- public Midnight state indexing
- proof-bundle generation
- notifications
- health and status monitoring

It does not:

- decrypt handles
- store private mandate values
- store private borrower limits
- make quote decisions
- alter Nox results
- custody keys
- sign on behalf of providers

### 21.2 Services

```text
apps/indexer
apps/keeper
apps/proof-api
apps/status
workers/nox-readiness
workers/midnight-events
workers/solvency-snapshots
workers/notifications
```

### 21.3 Database

PostgreSQL stores public and derived metadata:

- blocks
- transactions
- handles
- operation edges
- request IDs
- epoch IDs
- quote IDs
- offer hashes
- series IDs
- public positions
- proof-bundle locations
- status history

No decrypted values are valid database fields.

### 21.4 Keeper neutrality

Any user can perform keeper actions onchain.

The official keeper is an availability service, not a trusted correctness authority.

### 21.5 Observability

Metrics:

- Nox input-proof latency
- Nox operation-completion latency
- handle-readiness failures
- quote activation latency
- activated-to-taken conversion
- exact-fill callback failures
- expired quote rate
- series allocation latency
- solvency coverage
- indexer lag
- keeper competition
- RPC health
- Midnight event reconciliation

Private values never appear in metrics labels.

### 21.6 Reorg handling

The indexer:

- waits a configured confirmation depth
- stores block hash and parent hash
- rolls back derived records on reorg
- replays Nox and Midnight events
- marks proof bundles stale until rebuilt
- never changes onchain state from an unconfirmed event

### 21.7 Notifications

Supported events:

- mandate admitted
- request sealed
- quote ready
- quote activated
- quote near expiry
- take confirmed
- allocation ready
- cross settled
- roll ready
- maturity approaching
- redemption ready
- solvency warning

Notifications contain no private values.

---

## 22. Application information architecture

### 22.1 Public routes

```text
/
 /proof
 /proof/quote/[quoteId]
 /proof/series/[seriesId]
 /proof/capsule/[capsuleId]
 /docs
 /docs/protocol
 /docs/privacy
 /docs/contracts
 /docs/integration
 /docs/security
 /status
 /feedback
```

### 22.2 Application routes

```text
/app
/app/onboarding
/app/universes
/app/universes/[universeId]
/app/mandates
/app/mandates/new
/app/mandates/[mandateId]
/app/requests
/app/requests/new
/app/requests/[requestId]
/app/epochs
/app/epochs/[epochId]
/app/quotes/[quoteId]
/app/series
/app/series/[seriesId]
/app/cross
/app/cross/[seriesId]
/app/roll
/app/roll/new
/app/roll/[rollId]
/app/portfolio
/app/capsules
/app/capsules/new
/app/capsules/[capsuleId]
/app/verify
/app/security
/app/settings
```

---

## 23. Public website

The landing page has a persistent header, exactly six content sections, and a footer.

Do not add generic testimonial, logo-cloud, pricing, FAQ, or bento sections before launch.

### 23.1 Landing header

Left:

- Kyrve wordmark
- compact product descriptor: Confidential fixed income

Centre navigation:

- Protocol
- Series
- Proof
- Developers

Right:

- Ethereum Sepolia status
- View live proof
- Launch app

Behaviour:

- transparent over the hero at the top
- becomes a solid restrained bar after scroll
- active section indicated by one thin marker
- no oversized pill navigation
- no chain-logo clutter
- mobile menu opens as a full-height ledger index, not a generic floating sheet

### 23.2 Section 1: Hero

Eyebrow:

`Confidential term structure for Morpho Midnight`

Headline:

`One quote. The curve stays private.`

Supporting copy:

`Capital providers submit encrypted rates, capacities, maturities, and exposure limits. Nox selects one executable leaf. Morpho Midnight settles it unchanged.`

Primary action:

`Open the live market`

Secondary action:

`Verify a quote`

Hero visual:

A wide fixed-income curve surface rather than a product screenshot in a laptop frame.

The visual shows:

- several maturity columns
- rate ticks running vertically
- encrypted provider depth represented as obscured fields
- one selected market-rate leaf becoming readable
- a clear line leading from that leaf into a real Midnight settlement receipt
- no decorative code snippets
- no fake glowing network globe
- no generic node graph

The selected leaf must be the visual focus. The rest of the curve should feel present but unreadable.

### 23.3 Section 2: The leak

Headline:

`A public offer is a fragment of your strategy.`

Composition:

A two-column editorial section.

Left:

- a normal public offer book
- visible rate, size, maturity, maker, and remaining budget
- annotations showing what each field reveals

Right:

- a reconstructed provider profile
- capital availability
- rate floor
- maturity preference
- collateral preference
- urgency
- exposure change

Close:

`Kyrve reveals the trade without publishing the policy behind it.`

Avoid generic problem cards.

### 23.4 Section 3: The one-leaf mechanism

Headline:

`A private curve becomes one public offer.`

Use one continuous horizontal flow:

1. Encrypted mandates
2. Encrypted borrower request
3. Nox curve computation
4. Public decryption of one leaf
5. Kyrve ratifier and exact-fill callback
6. Midnight settlement
7. Confidential series allocation

Each stage expands on hover or focus with:

- what is private
- what is public
- what contract acts
- what proof exists

The public-decryption stage must state that the selected market, rate, and aggregate amount become public.

### 23.5 Section 4: The market after origination

Headline:

`Private ownership does not end when the loan begins.`

Use a full-width series timeline:

```text
Primary syndication -> Confidential series -> Private cross -> Private roll -> Batched redemption
```

Each stage has a real product-surface preview:

- syndication allocation
- encrypted series balance
- matched secondary order
- maturity roll
- aggregate redemption

Do not use six identical feature cards.

### 23.6 Section 5: Proof stack

Headline:

`Nox is inside the price, custody, and allocation path.`

This section must show real evidence:

- handle dependency graph
- public-decryption proof
- activated offer hash
- ratifier result
- exact callback values
- Midnight take transaction
- public series credit
- encrypted aggregate claims
- solvency equality

Primary action:

`Run pnpm verify:live`

Secondary action:

`Inspect contracts`

The terminal view should contain real output from the deployed system.

### 23.7 Section 6: Live close

Headline:

`Fixed-rate liquidity without a public yield curve.`

Content:

- live Sepolia deployment status
- active universes
- settled quote count
- latest solvency block
- Nox service status
- latest verified release hash

Actions:

- Launch Kyrve
- Read the architecture
- View source

The section ends in the footer without a separate generic CTA card.

### 23.8 Landing footer

Columns:

Product:

- App
- Series
- Proof
- Status

Developers:

- Documentation
- Contracts
- SDK
- GitHub
- feedback.md

Protocol:

- Privacy model
- Security
- Deployment manifest
- Licence disclosures

Footer base row:

- Kyrve mark
- Ethereum Sepolia
- pinned Midnight release
- Nox version
- commit hash
- open-source licence for Kyrve code

Avoid social-icon clutter. Use text links for X and GitHub.

---

## 24. Application shell

### 24.1 Global header

Left:

- Kyrve mark
- selected workspace
- selected role, Provider or Borrower

Centre:

- command search
- current universe
- current epoch state

Right:

- Nox health
- Sepolia block freshness
- privacy-key status
- wallet
- account menu

The header never displays a decrypted balance when privacy mode is locked.

### 24.2 Left navigation

Primary:

- Overview
- Universes
- Mandates
- Requests
- Epochs
- Series
- Cross
- Roll
- Portfolio

Secondary:

- Capsules
- Verify
- Security
- Settings

Navigation uses text and restrained symbols. Avoid a stack of rounded app icons.

### 24.3 Context rail

The right rail changes by route.

It shows:

- privacy boundary
- current contract addresses
- current state
- next valid action
- proof readiness
- public fields
- private fields
- warnings

Users can collapse it, but critical reveal warnings cannot be hidden during signing.

### 24.4 App footer

A narrow operational footer:

- network
- block
- indexer lag
- Nox runner status
- release hash
- documentation
- report issue

No marketing content inside the app footer.

### 24.5 Command palette

Commands:

- create mandate
- create request
- open series
- submit cross order
- create roll
- create capsule
- verify quote
- lock private view
- copy contract address
- open transaction
- switch universe

### 24.6 Privacy lock

The application has two display states:

- locked, only public metadata
- unlocked, authorised local decryption

Locking clears decrypted values from in-memory state and hides them immediately.

### 24.7 Mobile shell

Mobile prioritizes review and verification, not full matrix editing.

Mobile supports:

- request review
- mandate review
- signature confirmation
- quote take
- series balance
- notifications
- proof inspection
- emergency recovery

Complex curve and portfolio editors open in a dedicated full-screen workspace with horizontal pan and zoom.

---

## 25. Route specifications

### 25.1 `/app`

Purpose:

Operational overview.

Layout:

- page title and role switch
- confidential capital summary
- public settlement summary
- active epoch strip
- maturity ladder
- latest private actions
- latest public receipts
- system health

The private summary remains concealed until local unlock.

### 25.2 `/app/onboarding`

Steps:

1. Connect wallet.
2. Confirm Ethereum Sepolia.
3. Register privacy key.
4. Inspect Nox permissions.
5. Select provider, borrower, or both.
6. Wrap first asset.
7. Choose an active universe.
8. Create first mandate or request.
9. Run environment verification.

Every step shows public and private consequences.

### 25.3 `/app/universes`

A market matrix, not a card grid.

Columns:

- loan token
- market count
- maturity range
- collateral families
- rate-grid density
- privacy floor
- current epoch
- risk status
- bytecode release

### 25.4 `/app/universes/[universeId]`

Tabs:

- Curve map
- Markets
- Rate grid
- Risk
- Contracts
- Proof

Curve map:

- maturity columns
- public rate indexes
- no private depth
- activated historical leaves
- public series positions

### 25.5 `/app/mandates`

Provider mandate ledger.

Rows:

- mandate ID
- universe
- status
- private budget, locked
- private rate range, locked
- public expiry
- current epoch
- viewer permissions
- action menu

### 25.6 `/app/mandates/new`

A progressive institutional order ticket.

Stages:

1. Select universe.
2. Set total confidential budget.
3. Configure market matrix.
4. Set private rate floors.
5. Set collateral caps.
6. Set maturity caps.
7. Set duration.
8. Set borrower policy.
9. Review privacy boundary.
10. Encrypt and submit directly.

The review shows a canonical commitment and contract binding.

### 25.7 `/app/mandates/[mandateId]`

Views:

- private mandate matrix
- public lifecycle
- reservations
- series allocations
- exposure impact
- ACL
- replacement history
- proof references

### 25.8 `/app/requests`

Borrower request tape.

Public list shows:

- request ID
- universe
- borrower
- public state
- submitted time
- expiry
- bond
- activated quote, when available

It does not show hidden amount or rate before activation.

### 25.9 `/app/requests/new`

Stages:

1. Select universe.
2. Select allowed public markets.
3. Enter private desired amount.
4. Enter private maximum rate.
5. Enter maturity preferences.
6. Enter minimum fill.
7. Set expiry.
8. Deposit request bond.
9. Review reveal schedule.
10. Encrypt and submit directly.

### 25.10 `/app/requests/[requestId]`

Public view:

- lifecycle
- handle IDs
- epoch
- bond
- proof readiness
- activated quote if any

Authorised borrower view:

- decrypted request
- commitment match
- quote comparison against private maximum
- take action
- expiry timer

### 25.11 `/app/epochs`

A chronological clearing ledger.

Fields:

- epoch
- universe
- state
- request count
- public privacy-floor policy
- Nox operations
- completed quotes
- expired quotes
- settlement receipts

### 25.12 `/app/epochs/[epochId]`

Sections:

- operation graph
- handle readiness
- candidate leaf count
- public policy
- selected quote results
- keeper actions
- errors
- receipts

Never display private candidate capacities.

### 25.13 `/app/quotes/[quoteId]`

The definitive quote room.

Top strip:

- executable state
- expiry
- borrower
- market
- maturity
- fixed rate
- exact units
- aggregate assets

Main body:

- offer struct
- public-decryption proof
- ratifier checks
- callback exact-fill checks
- Midnight take
- series allocation status

Attack-proof panel:

- altered-offer check
- wrong-taker check
- partial-fill check
- replay check
- callback caller check

### 25.14 `/app/series`

Fixed-income series table.

Columns:

- series
- maturity
- collateral
- public tick
- public vault credit
- confidential user balance
- coverage
- secondary state
- roll availability

### 25.15 `/app/series/[seriesId]`

Tabs:

- Position
- Ownership
- Cross
- Roll
- Redemption
- Solvency
- Contracts

Position view combines:

- public Midnight state
- private user claim
- maturity timeline
- fee accrual
- loss factor
- withdrawable amount
- coverage

### 25.16 `/app/cross`

Secondary market overview.

Shows:

- active series
- public price grids
- sealed epoch status
- aggregate residual history
- private order access

No public individual order book.

### 25.17 `/app/cross/[seriesId]`

Order ticket:

- encrypted side
- encrypted amount
- encrypted limit
- encrypted minimum fill
- expiry
- roll linkage

Settlement view:

- private fill
- public residual
- series movement
- cToken movement
- proof

### 25.18 `/app/roll`

Maturity-ladder workspace.

Visual:

- source series on left
- target maturities on right
- private policy band
- public residual indicators
- active roll epochs

### 25.19 `/app/roll/new`

Stages:

1. Source series.
2. Private amount.
3. Target maturity band.
4. Target collateral policy.
5. Minimum new yield.
6. Maximum source discount.
7. Maximum top-up.
8. Fallback.
9. Review.
10. Encrypt and submit.

### 25.20 `/app/roll/[rollId]`

Shows:

- private requested policy
- public state
- internal matches
- residual public legs
- final confidential target allocation
- reconciliation proof

### 25.21 `/app/portfolio`

Confidential portfolio terminal.

Views:

- maturity ladder
- collateral concentration
- rate distribution
- series ownership
- pending commitments
- realized return
- redemption schedule
- policy utilization

All private charts decrypt locally.

### 25.22 `/app/capsules`

Capsule ledger.

Columns:

- capsule ID
- subject
- viewer
- snapshot date
- scope
- historical-access warning
- verification

### 25.23 `/app/capsules/new`

Select:

- scope
- period
- series
- quote receipts
- viewer
- expiry label
- disclosure statement

Before creation:

`The viewer will retain access to this snapshot handle. Future portfolio values are not included.`

### 25.24 `/app/capsules/[capsuleId]`

Auditor view:

- decrypted fields
- snapshot block
- source handles
- receipts
- proof
- scope hash
- historical-access status

### 25.25 `/app/verify`

Verification hub.

Inputs:

- quote ID
- series ID
- request ID
- capsule ID
- transaction hash
- contract address

Outputs:

- pass
- fail
- incomplete
- pending Nox output
- unsupported version

### 25.26 `/app/security`

Panels:

- contract versions
- Nox ACL permissions
- viewer list
- operator grants
- active universes
- paused functions
- recovery path
- signed frontend release
- dependency manifest
- audit status
- known limitations

### 25.27 `/app/settings`

Settings:

- default role
- default universe
- privacy-lock timeout
- local notification preferences
- RPC
- preferred verifier
- transaction simulation
- explorer
- language
- export public receipts

No private values are synced to a cloud profile.

---

## 26. Interaction and visual direction

### 26.1 Overall character

Kyrve should resemble an institutional fixed-income terminal translated into a modern web product.

It should feel:

- exact
- restrained
- high-trust
- data-rich
- quiet
- deliberately engineered
- unlike a generic crypto dashboard
- unlike an AI-generated SaaS template

### 26.2 Core visual metaphor

The visual system is based on:

- curves
- maturities
- ticks
- ledgers
- sealed fields
- one selected leaf
- settlement receipts
- confidential ownership layers

### 26.3 Layout

Use:

- long horizontal tables
- maturity matrices
- rate ladders
- transaction tapes
- full-width proof views
- side inspectors
- clear vertical rhythm
- real operational density

Avoid:

- repetitive bento grids
- oversized floating cards
- glassmorphism
- neon network art
- generic purple gradients
- token bubbles
- robot illustrations
- fake AI chat panels
- huge empty dashboard areas
- decorative charts with no data

### 26.4 Charts

Every chart must have a real product purpose.

Charts:

- maturity ladder
- activated-leaf history
- public series credit
- private portfolio exposure
- solvency coverage
- aggregate residual settlement
- quote lifecycle latency

A locked private chart shows a deliberate redacted structure, not zero values or fake sample data.

### 26.5 Tables

Tables are first-class.

Requirements:

- sticky headers
- clear numeric alignment
- human-readable and raw-value toggle
- row expansion
- keyboard navigation
- copy actions
- onchain link actions
- public/private field markers
- no horizontal-scroll traps on desktop

### 26.6 Confidential state

Confidential values have four states:

- encrypted and unavailable
- available to decrypt
- decrypted locally
- intentionally public

Each state has a consistent icon, label, and explanation defined later in `design.md`.

### 26.7 Motion

Motion communicates state:

- handle submitted
- computation pending
- output ready
- quote activated
- settlement confirmed
- private allocation ready

Avoid ambient motion that makes the interface feel speculative.

### 26.8 Empty states

Empty states explain the next economic action.

Example:

`No active mandate. Submit a private rate curve to participate in the next clearing epoch.`

Do not use generic illustrations.

### 26.9 Loading states

Nox is asynchronous. Loading states must identify the actual phase:

- input proof submitted
- event confirmed
- ingestor observed
- runner queued
- encrypted output stored
- public decryption ready
- quote activation pending
- allocation computing

Do not use one indefinite spinner.

### 26.10 Error states

Errors separate:

- public transaction failure
- invalid external proof
- Nox output pending
- public invariant failure
- private no-fill outcome
- service availability issue
- stale deployment version

A private no-fill result must not reveal which provider or rule caused it.

---

## 27. Component inventory

### 27.1 Navigation

- landing header
- app header
- left navigation
- context rail
- command palette
- mobile ledger menu
- operational footer

### 27.2 Data

- maturity matrix
- rate ladder
- curve surface
- quote tape
- series table
- solvency table
- operation graph
- receipt viewer
- handle inspector
- ACL inspector

### 27.3 Forms

- universe selector
- encrypted amount input
- encrypted rate-index input
- market matrix editor
- maturity-band editor
- portfolio-cap editor
- request bond form
- secondary order ticket
- roll ticket
- capsule builder

### 27.4 Security

- commitment verifier
- direct-caller warning
- public-boundary confirmation
- contract-address check
- proof-expiry timer
- operator-grant review
- viewer-permission review
- exact-fill receipt
- signed-release badge

### 27.5 Status

- Nox operation status
- handle readiness
- quote state
- epoch state
- allocation state
- settlement state
- indexer lag
- solvency state
- service health

### 27.6 Feedback

- transaction toast
- proof-validation result
- public-reveal warning
- confidential no-fill result
- quote-expiry warning
- recovery warning
- network mismatch
- stale-release warning

---

## 28. API and SDK

### 28.1 Public SDK

Packages:

```text
@kyrve/core
@kyrve/nox
@kyrve/midnight
@kyrve/quote-math
@kyrve/verify
@kyrve/react
```

### 28.2 SDK capabilities

- universe discovery
- rate-grid rendering
- mandate encryption
- request encryption
- commitment construction
- handle readiness
- quote reconstruction
- offer encoding
- take transaction construction
- local decryption
- series inspection
- proof verification
- solvency verification

### 28.3 Public API

Endpoints:

```text
GET /v1/status
GET /v1/universes
GET /v1/universes/:id
GET /v1/requests/:id
GET /v1/epochs/:id
GET /v1/quotes/:id
GET /v1/series
GET /v1/series/:id
GET /v1/proofs/:type/:id
GET /v1/deployments/:chainId
```

No endpoint accepts or returns decrypted private data.

### 28.4 Agent documentation

Provide:

- `AGENTS.md`
- architecture map
- contract map
- generated ABIs
- invariant map
- deployment manifest
- proof workflow
- common failure catalogue
- Nox async lifecycle notes
- Midnight callback notes

Agents must not guess contract addresses or package versions.

---

## 29. Repository structure

```text
kyrve/
  apps/
    web/
    docs/
    indexer/
    keeper/
    proof-api/
    status/
    cli/
  contracts/
    registry/
      KyrveProtocolRegistry.sol
      CurveUniverseRegistry.sol
    confidential/
      ConfidentialAssetVault.sol
      EncryptedMandateBook.sol
      ConfidentialRequestBook.sol
      NoxCurveEngine.sol
    quotes/
      QuoteEpochController.sol
      QuoteActivator.sol
      KyrveQuoteMath.sol
      KyrveQuoteRatifier.sol
    series/
      KyrveSeriesFactory.sol
      KyrveSeriesVault.sol
      KyrveSeriesToken.sol
      SeriesAllocator.sol
      MaturityRedemptionQueue.sol
    secondary/
      SecondaryOrderBook.sol
      NoxCrossEngine.sol
      ResidualSettlementAdapter.sol
      NoxRollEngine.sol
    disclosure/
      DisclosureCapsuleFactory.sol
      AggregateSolvencyVerifier.sol
    security/
      EmergencyController.sol
      KyrveRecoveryRouter.sol
  packages/
    core/
    nox/
    midnight/
    quote-math/
    verify/
    react/
    config/
    generated/
  deployments/
    sepolia/
      manifest.json
      addresses.json
      bytecode-lock.json
      universes.json
  scripts/
    deploy/
    seed-live/
    verify/
    demo/
  test/
    unit/
    integration/
    fork/
    invariant/
    fuzz/
    attacks/
    differential/
    e2e/
  docs/
    ARCHITECTURE.md
    PRIVACY.md
    THREAT-MODEL.md
    ACCOUNTING.md
    MIDNIGHT-INTEGRATION.md
    NOX-INTEGRATION.md
    DEPLOYMENT.md
    RECOVERY.md
    DEMO.md
    feedback.md
    design.md
  AGENTS.md
  CONTRIBUTING.md
  LICENSE
  README.md
```

---

## 30. Testing strategy

### 30.1 Unit tests

Cover every contract branch and state transition.

### 30.2 Nox integration tests

Use genuine Nox contract bytecode and the official local service stack.

Test:

- direct-caller proof binding
- contract binding
- proof expiry
- type mismatch
- transient ACL
- persistent ACL
- viewer access
- public decryption
- safe arithmetic
- select
- encrypted division
- operation readiness
- handle replay

### 30.3 Midnight differential tests

Compare `KyrveQuoteMath` against:

- pinned Midnight libraries
- pinned Midnight SDK
- real `take` results

Across:

- every tick in the active grid
- every maturity bucket
- settlement-fee boundaries
- rounding edges
- minimum and maximum units
- fee changes
- pre and post maturity states

### 30.4 Fork tests

Fork the deployed Sepolia environment.

Test:

- real Nox addresses
- real wrappers
- real Midnight replica
- real markets
- real oracles
- real ERC-20 transfers
- real take
- real credit
- real maturity withdrawal

### 30.5 Attack tests

Required cases:

- forged gateway proof
- proof for another owner
- proof for another contract
- proof for another chain
- replayed mandate handle
- replayed request handle
- stale mandate epoch
- altered universe
- altered tick
- altered market
- altered expiry
- altered callback
- altered ratifier
- altered maker
- wrong taker
- partial fill
- oversized fill
- repeated fill
- callback spoof
- stale fee
- underfunded provider
- provider over-allocation
- malicious operator
- viewer leakage
- quote probing
- abandoned quote
- indexer reorg
- emergency pause
- Nox unavailable
- series insolvency attempt
- rounding-dust theft

### 30.6 Invariants

1. Aggregate confidential asset liabilities never exceed wrapper reserves.
2. Sum of quote reservations equals public quote funding.
3. A confidential failure never creates a public reason event.
4. One quote can settle at most once.
5. An activated quote can settle only for the approved taker.
6. Actual units equal activated units.
7. Actual assets match quote math.
8. Sum of series allocations equals Midnight credit received.
9. Series-token aggregate claims never exceed series-vault coverage.
10. Secondary transfers conserve series and loan-token claims.
11. Roll settlement conserves value within declared rounding.
12. Expired quotes release all reservations.
13. Old mandate epochs cannot authorize new reservations.
14. Capsule viewers never gain access to live handles.
15. No server component receives decrypted private values.
16. Only approved Midnight can call the series callback.
17. Only proven aggregate handles can be publicly decrypted by the quote path.
18. Public recovery cannot exceed the user’s private claim.
19. One request bond is processed once.
20. Pausing new activity cannot block matured-asset recovery.

### 30.7 Stateful fuzzing

Fuzz sequences of:

- deposits
- mandates
- replacements
- requests
- epochs
- activations
- expiries
- takes
- series transfers
- secondary crosses
- rolls
- redemptions
- capsules
- pauses
- recovery

### 30.8 End-to-end browser tests

No mocked contract responses.

Test:

- provider onboarding
- encrypted mandate
- borrower request
- quote computation
- activation
- exact take
- allocation
- series display
- secondary cross
- roll
- capsule
- verifier

### 30.9 Static and dependency analysis

Release checks:

- Slither
- compiler warnings
- storage-layout diff
- bytecode-size report
- dependency audit
- licence audit
- frontend bundle integrity
- CSP validation
- secret scan
- generated-ABI drift

---

## 31. Verification commands

```bash
pnpm verify:live
pnpm verify:deployment
pnpm verify:midnight-bytecode
pnpm verify:nox-addresses
pnpm verify:universe
pnpm verify:nox-graph
pnpm verify:quote
pnpm verify:public-decryption
pnpm verify:ratifier
pnpm verify:callback
pnpm verify:take
pnpm verify:allocation
pnpm verify:series
pnpm verify:solvency
pnpm verify:cross
pnpm verify:roll
pnpm verify:capsule
pnpm verify:privacy
pnpm test:invariants
pnpm test:attacks
```

`pnpm verify:live` must:

1. Read the deployment manifest.
2. Verify chain ID.
3. Verify bytecode.
4. Verify the pinned Midnight release hash.
5. Verify Nox contracts and package versions.
6. Verify the universe.
7. Read one completed request.
8. Trace encrypted input handles.
9. Reconstruct the Nox operation graph.
10. Verify public-decryption proofs.
11. Reconstruct the exact offer.
12. Verify the ratifier state.
13. Verify callback exact-fill values.
14. Trace the real Midnight take.
15. Read the series-vault credit.
16. Decrypt authorised demo allocations.
17. Prove allocation sum equals public credit.
18. Verify aggregate solvency.
19. Exit non-zero on any mismatch.

### 31.1 Proof bundle

Every completed quote exports one machine-readable bundle:

```json
{
  "version": "1",
  "chainId": 11155111,
  "deploymentManifestHash": "0x...",
  "requestId": "0x...",
  "quoteId": "0x...",
  "noxInputHandles": [],
  "noxOperationGraphRoot": "0x...",
  "publicDecryptionProofs": [],
  "offer": {},
  "offerHash": "0x...",
  "ratifier": "0x...",
  "callback": "0x...",
  "takeTransaction": "0x...",
  "seriesId": "0x...",
  "allocationAggregateHandle": "0x...",
  "solvencySnapshot": {}
}
```

---

## 32. Ethereum Sepolia deployment graph

```text
Nox protocol contracts
  |
  +-- ERC-7984 cUSDC wrapper
  +-- ERC-7984 cSeries implementations
  |
Pinned Midnight 2026-07-23
  |
  +-- Market A, USDC / WETH / maturity 1
  +-- Market B, USDC / WETH / maturity 2
  +-- Market C, USDC / LINK / maturity 1
  +-- Market D, USDC / LINK / maturity 2
  |
KyrveProtocolRegistry
  |
  +-- CurveUniverseRegistry
  +-- ConfidentialAssetVault
  +-- EncryptedMandateBook
  +-- ConfidentialRequestBook
  +-- QuoteEpochController
  +-- NoxCurveEngine
  +-- QuoteActivator
  +-- KyrveQuoteRatifier
  +-- KyrveSeriesFactory
  +-- NoxCrossEngine
  +-- NoxRollEngine
  +-- DisclosureCapsuleFactory
  +-- AggregateSolvencyVerifier
```

Use real deployed testnet contracts and transactions.

Testnet tokens may be faucet assets, but frontend data, handles, positions, takes, balances, and proofs cannot be simulated.

### 32.1 Market deployment

Each market uses:

- a real deployed ERC-20 loan token
- a real deployed collateral token
- a live Sepolia oracle path
- a future maturity
- enabled LLTV
- enabled liquidation cursor
- verified market struct
- declared tick spacing
- declared settlement fee

### 32.2 Deployment manifest

The manifest records:

- Git commit
- Midnight release commit
- Nox package lock
- compiler
- optimiser
- EVM target
- deployer
- transaction hashes
- addresses
- constructor arguments
- bytecode hashes
- market struct hashes
- universe hashes
- frontend release hash

---

## 33. Demo environment

The live demo contains:

- four capital providers
- one borrower
- four public Midnight markets
- two maturities
- two collateral families
- sixteen public rate ticks per market
- different private mandates
- one provider excluded privately
- one successful syndicated quote
- one partial-fill attack that reverts
- one wrong-borrower attempt that reverts
- one real Midnight take
- four confidential provider allocations
- one private secondary cross
- one residual public settlement
- one maturity roll
- one frozen auditor capsule
- one public solvency proof

Every displayed receipt links to a real transaction.

---

## 34. Demo narrative

### 0:00 to 0:25

Show a public fixed-rate offer book.

Say:

`A lender quoting across maturities publishes its rate floor, available capital, collateral appetite, and timing. Kyrve reveals one executable quote and keeps the curve that created it private.`

### 0:25 to 0:55

Show four providers with different private mandates.

Public explorer:

- handles
- proofs
- commitments

Private provider view:

- different budgets
- different rate floors
- different maturity policies

### 0:55 to 1:20

Borrower submits an encrypted request.

Show:

- desired amount private
- maximum rate private
- maturity range private
- request bond public

### 1:20 to 1:50

Show Kyrve Curve processing the full matrix.

Public UI:

- 64 quote leaves evaluated
- privacy floor passed
- one result ready

Do not reveal the losing leaves.

### 1:50 to 2:15

Activate the quote.

Show:

- Nox public-decryption proof
- one selected market
- one public rate
- one aggregate amount
- exact offer hash
- approved borrower

### 2:15 to 2:40

First attempt a partial fill.

The ratifier accepts the authentic offer, but the maker callback rejects the wrong units and the entire take reverts.

Then execute the exact fill through the real Midnight contract.

### 2:40 to 3:05

Show one public series-vault position.

Open each provider account and reveal different confidential series allocations.

### 3:05 to 3:25

Show one holder exiting and one provider entering through Kyrve Cross.

Most ownership transfers privately. Only residual settlement is public.

### 3:25 to 3:45

Show the solvency verifier:

```text
public Midnight credit
=
aggregate encrypted series claims
```

Close:

`One public fixed-rate quote. An entire private capital curve behind it.`

---

## 35. Acceptance gates

### 35.1 Product

- complete landing page
- complete application routes
- no dead navigation
- no fake metrics
- no placeholder proof
- mobile review and verification
- clear privacy boundaries
- full recovery documentation

### 35.2 Nox

- genuine external proofs
- direct-caller flow
- genuine handles
- genuine asynchronous computation
- genuine safe arithmetic
- genuine encrypted comparisons
- genuine select
- genuine encrypted division
- genuine public-decryption proofs
- genuine ACL
- genuine ERC-7984 balances
- no mocked confidentiality path

### 35.3 Midnight

- pinned unmodified core deployment
- verified bytecode
- real market creation
- real offer
- real ratifier call
- real callback
- real take
- real credit position
- real maturity functions
- no simulated settlement

### 35.4 Security

- partial-fill defence
- taker binding
- replay defence
- stale-fee defence
- callback-caller defence
- solvency invariants
- operator expiry
- ACL review
- emergency controls
- attack test suite
- Slither baseline
- manual threat review

### 35.5 Evidence

- public contracts
- public source
- reproducible deployment
- one-command verification
- proof pages
- transaction links
- `feedback.md`
- complete contributor disclosure
- complete licence disclosure

---

## 36. `feedback.md` requirements

The document must include specific findings on:

- direct-caller binding in `fromExternal`
- handling multi-contract flows with transient ACL
- operation-completion latency
- handle-readiness ergonomics
- debugging asynchronous graphs
- public-decryption proof verification
- safe-arithmetic behaviour
- encrypted-division behaviour
- ACL permanence and snapshot isolation
- ERC-7984 operator risk
- local Hardhat service setup
- package and documentation gaps
- error messages
- suggested SDK abstractions
- proposed `awaitHandleReady` helper
- proposed operation-graph inspector
- proposed typed fixed-array encryption helper
- proposed quote-batch debugging tool

Avoid generic praise.

---

## 37. Build sequence

Every phase belongs to the final product.

### Phase 1: Reproducible foundations

- pin repositories
- deploy Midnight replica
- deploy Nox stack
- create markets
- verify bytecode
- build quote math
- differential tests

### Phase 2: Confidential assets and inputs

- ERC-7984 wrappers
- asset vault
- mandate book
- request book
- direct proof flow
- ACL tooling

### Phase 3: Curve engine

- universe
- fixed arrays
- eligibility
- private failure
- capacity
- privacy floor
- selection
- public result handles

### Phase 4: Exact public settlement

- public decryption
- quote activator
- ratifier
- series callback
- exact fill
- expiry and refund

### Phase 5: Private ownership

- series factory
- series token
- allocation
- portfolio
- solvency

### Phase 6: Secondary and roll

- encrypted secondary book
- crossing
- residual settlement
- maturity rolls
- redemption batching

### Phase 7: Disclosure and proof

- capsules
- web verifier
- CLI verifier
- operation graph
- proof pages

### Phase 8: Product surfaces

- landing
- app shell
- all routes
- documentation
- status
- mobile
- accessibility

### Phase 9: Adversarial hardening

- attack suite
- invariants
- fuzz
- fork tests
- static analysis
- dependency audit
- release gate

### Phase 10: Submission

- live seed data
- real receipts
- final demo
- X post
- public repository
- contributor list
- licence notes
- `feedback.md`
- release tag

---

## 38. Release gate

The release command fails unless:

- all contracts are verified
- deployment manifest is signed
- bytecode lock matches
- all unit tests pass
- all integration tests pass
- all invariants pass
- all attack tests pass
- all browser tests pass
- all verification commands pass
- no unresolved critical or high security finding exists
- every UI metric has a real source
- every route has loading, empty, success, and failure states
- privacy documentation matches implementation
- live proof pages resolve
- contributor and licence disclosure is complete
- `feedback.md` exists

---

## 39. Submission integrity

The public repository and hackathon submission must list the people who actually designed, wrote, reviewed, tested, and deployed the system.

If code is transferred to another participant:

- the original builders remain credited
- existing work is disclosed
- hackathon-period work is separated
- team-size rules are respected
- the submission does not falsely claim sole authorship

Product quality cannot compensate for inaccurate attribution.

---

## 40. Source map

Primary official sources used for this specification:

- Morpho Midnight offers  
  https://docs.morpho.org/learn/concepts/midnight/offers/

- Morpho Midnight multi-market offers  
  https://docs.morpho.org/developers/midnight/concepts/multi-market-offers/

- Morpho deployment addresses  
  https://docs.morpho.org/developers/contracts/addresses/

- Morpho Midnight repository and pinned releases  
  https://github.com/morpho-org/midnight  
  https://github.com/morpho-org/midnight/releases

- Nox global architecture  
  https://docs.noxprotocol.io/protocol/global-architecture-overview

- Nox external encrypted inputs  
  https://docs.noxprotocol.io/references/solidity-library/methods/core-primitives/fromExternal

- Nox safe arithmetic  
  https://docs.noxprotocol.io/references/solidity-library/methods/core-primitives/safe-arithmetic

- Nox encrypted selection  
  https://docs.noxprotocol.io/references/solidity-library/methods/core-primitives/select

- Nox public decryption  
  https://docs.noxprotocol.io/references/js-sdk/methods/publicDecrypt

- Nox ERC-20 to ERC-7984 wrapper  
  https://docs.noxprotocol.io/guides/build-confidential-tokens/erc20-to-erc7984-wrapper

- Nox Hardhat plugin  
  https://github.com/iExec-Nox/nox-hardhat-plugin

- Nox Hardhat starter  
  https://github.com/iExec-Nox/nox-hardhat-starter

---

## Final product statement

Kyrve turns private fixed-income policy into public protocol-native settlement.

Capital providers submit encrypted rate ladders, capacities, maturities, collateral preferences, and portfolio limits. Borrowers submit encrypted requirements. Nox privately evaluates the complete term structure, excludes invalid capital without public failure leakage, checks a confidential provider floor, reserves encrypted balances, and selects one executable leaf.

Kyrve publicly decrypts only the selected market, rate, and aggregate size. Its ratifier authenticates the exact offer. Its maker callback enforces the exact units and assets during settlement. Morpho Midnight creates the real public credit position unchanged.

The position then becomes a Kyrve Series with confidential beneficial ownership, private secondary crossing, confidential maturity rolls, batched redemption, frozen selective disclosure, and publicly verifiable aggregate solvency.

One quote becomes public. The curve, syndicate, and ownership behind it remain private.
