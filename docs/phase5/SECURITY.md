# Phase 5 security

Confidential series ownership is the first Kyrve phase where **provider capital actually moves**. Every
prior phase computed, published or settled; this one takes custody. So the security question changes
shape: it is no longer "can a private value leak" alone, it is "can capital be taken, stranded, or
double-counted".

Read `docs/phase5/P5-1-DECISION.md` §5 first. That is the threat model the *architecture* had to answer,
decided before implementation. This file is the register of what the implementation actually did, what
was found while building it, and what is knowingly carried.

---

## 1. Findings register

Severity is the impact if the defence were absent, not the difficulty of reaching it. `FIXED` means the
defence is in the tree with a paired test that fails without it. `ACCEPTED` means the risk is real,
bounded, and recorded rather than mitigated — each one names why closing it is out of this phase's scope.

| id | severity | status | finding | disposition |
|---|---|---|---|---|
| F-1 | High | FIXED | `KyrveSeriesToken.lendSupply` took the recipient as a parameter and checked it against `msg.sender`. Transient access carries full persistent-grant power, so **any** caller could have borrowed the aggregate supply handle and called `allowPublicDecryption` on it — irreversibly, since Nox has no un-publish. | Restricted to one bind-once `solvencyVerifier`, and the recipient is no longer a parameter. `102-series-attacks.ts` A2 asserts `NotVerifier` for an outsider. |
| F-2 | High | FIXED | `SeriesAllocator.unwindChunk` read the quote id from the round's own record, which is only written at the first allocation. A round funded and activated but not yet allocated therefore skipped the retirement check entirely, and a keeper could reclaim provider capital from under a quote a borrower could still settle. | The quote is discovered from `KyrveQuoteRegistry.quoteOfEpoch`, the registry's own total index. Delta T-11. A7 caught it and now asserts `QuoteNotRetired` against a live quote. |
| F-3 | Medium | FIXED | Quote-keyed confidential funding deadlocks: `QuoteActivator.activate` calls `prepareQuote`, which refuses a vault that cannot already pay, so the money must be in place before a quote id exists. | Funding is keyed on the epoch and allocation on the quote. Delta T-9. Strictly stronger: the unwrap recipient is now an `immutable` checked against the series at construction rather than derived from a quote. |
| F-4 | Medium | FIXED | The ERC-7984 wrapper wrapped a different ERC-20 than the Midnight market's `loanToken`, so `finalizeUnwrap` moved an asset the series vault does not pay in. Three phases tolerated it because nothing ever crossed back. | The Midnight substrate is deployed before the wrapper and its USDC is what gets wrapped. Delta T-10. |
| F-5 | Low | ACCEPTED | A real lock rewrites the provider's balance handle, and a Nox ACL entry is per handle — so the engine needs a fresh permanent grant each epoch. | Inherent: a grant cannot be pre-made for a handle that does not exist, and `allow` is gated on already holding access. Delta T-8. Letting the custody vault grant the engine itself was rejected: it would widen a third party's access to a provider's balance without the provider's per-epoch consent. |
| F-6 | Low | ACCEPTED | After funding, restoring a provider's capital needs the public tokens back in custody, and `KyrveSeriesVault.recoverFunding` is Phase 4 code and operator-only. `KyrveCustodyVault` cannot compel it. | Delta T-4. Bounded: the unwind itself is permissionless, the restoration is bounded by exactly what was consumed, and `AggregateSolvencyVerifier` makes a coverage gap observable. A7 proves the whole path with the operator's return transaction included, and ends with a withdrawal that really pays — because the wrapper moves encrypted zero rather than reverting when coverage is short, so only a real withdrawal distinguishes restored capital from a restored number. |
| F-7 | Low | ACCEPTED | An unwind after `UNWIND_GRACE` on a round with no activated quote, followed by an activation and a settlement, would create credit no claim owns. | Delta T-11. Needs the keeper to act adversarially after seven days of silence against a one-day maximum quote lifetime, and the keeper is an immutable, non-open role in this release. Closing it fully would make activation depend on the confidential layer. |
| F-8 | Low | ACCEPTED | Q-6 — `sum(available) + sum(locked) <= coverage` — is not proven on chain. | Delta T-7. Proving it needs an encrypted `sum(available)`, and an aggregate accumulated beside a provider's balance is exactly the Q-5 mechanism that handed the Phase 2 vault's first depositor a permanent admin grant on the protocol total. Maintained by construction, checked by decryption in a bounded fixture. |
| F-9 | Informational | ACCEPTED | The funding unwrap publishes whether the vault's coverage was sufficient **in aggregate**: a short vault burns encrypted zero and the published plaintext is 0. | The amount itself is the epoch's published aggregate, already public (PRD §19.2). No provider is identified. An aggregate coverage failure is a protocol solvency fault rather than a private fact, which is why the verifier exists to surface it before the unwrap does. |
| F-10 | Low | ACCEPTED | Migrating to the new engine costs each provider 36 **permanent** grants on their mandate handles, and the old engine keeps its own forever — Nox has no `removeAdmin`. | P5-1 §6. The old engine can compute on those handles and cannot publish them, which is a property of reviewed code and not of the ACL, and the interface must say exactly that. A provider unwilling to grant a second engine keeps their capital and stops participating; nothing is seized. |
| F-11 | Informational | CARRIED | No gas indistinguishability is claimed for the ownership path. | Phase 4 carry-over 6. Phase 4 measured that the *settlement* path has no confidential branch; confidential minting does touch encrypted state, so any statement about it is a new experiment and none is made here. |
| F-12 | Informational | CARRIED | The handle gateway sees plaintext on the way in. | Delta Q-10. Kyrve claims only that no *Kyrve* component receives a decrypted value, and nothing in this phase changes that. |

**No High or Medium finding is open.** F-1 through F-4 are fixed with paired tests; every remaining entry
is Low or Informational and states why it is carried.

---

## 2. What is enforced structurally rather than by review

Each of these is a property the code cannot express a violation of, which is stronger than a check.

**Nothing can mint against the wrong quantity.** `KyrveSeriesToken.mintClaim` has no overload that takes
a number. The only `euint256` `SeriesAllocator` can hand it is the handle
`KyrveCustodyVault.consumeLock` returned for that exact provider. Leaf capacity is private and has no
accessor the allocator calls; `exactUnits` is read once, only to check the vault's credit grew, and never
reaches a mint. Invariants 2 and 3, deltas T-1 and S-4.

**The residue account has no redirectable path.** No function on `SeriesResidueAccount` takes an address,
`distribute()` takes no parameters and no privileges, and the destination is `immutable` and visible in
the verified constructor arguments. PRD §19.8's *"dust cannot be swept to a developer wallet"* is
therefore a shape of the contract rather than a promise about a key. A8 asserts it against the ABI.

**The unreserved residue is not representable anywhere it could leak.** It is a Nox handle;
`SeriesResidueAccount` and the whole residue path are `uint256`. Publishing it would disclose the winning
leaf's capacity by subtraction, and there is no function that could accept it. Delta T-2.

**No provider gains authority over an aggregate.** `SeriesOwnershipRegistry.isReviewedTransientRecipient`
returns `false` unconditionally, and so does `AggregateSolvencyVerifier`'s — the strongest available form
of "this contract lends nothing". A3 and A4 read the on-chain ACL directly rather than inferring it from a
refused decryption.

**Every privileged reference is bound once.** Custody's reserver and settler, the token's allocator and
solvency verifier, the ownership registry's allocator, the allocator's residue account. A1 asserts every
rebinding reverts by name.

**Recovery has no pause flag and cannot acquire one.** `KyrveEmergencyController`'s enum has no member for
withdrawal, release, restoration, transfer or redemption, and must never gain one (Q-6, PRD invariant 20).
The gate reads `releaseLock` and `restoreLock` and fails if either consults the controller.

---

## 3. What the solvency verifier proves, and what it does not

**Proves, on chain, per snapshot:**

```text
confidentialTotalSupply + confidentialTotalEntitlement
  <=  credit + vaultReserves + residueReserves - pendingFee
```

The left side is two encrypted aggregates borrowed transiently and never granted onward. The right side is
entirely public. The output is one published `ebool` — so a solvency check is not itself a permanent
disclosure of the claim total, which it would be if the verifier had to publish the left side to state the
verdict.

Pending redemption claims are counted on the claim side deliberately. A burn removes supply, so if the
liability it became were not carried anywhere, redeeming would make a series look *more* solvent the more
it owed.

**Does not prove:** the custody vault's internal accounting (F-8), that the residue tokens have physically
arrived (`unsettledResidue()` reports the gap), or anything about future loss. `proveSolvency` is
permissionless because a solvency proof only a privileged key could produce is one that can be withheld
exactly when it matters.

---

## 4. The boundary, restated for this phase

| value | before activation | after activation | after allocation |
|---|---|---|---|
| provider's custody balance | private | private | private |
| provider's locked amount | private | private | private, and now also a series balance |
| the sum of the locks | private | **public** — it is the published aggregate, and the funding unwrap makes it public as a plaintext | public |
| provider's series balance | — | — | private, holder-only, permanently |
| redemption entitlement | — | — | private, holder-only |
| total series supply | — | — | private until `publishAggregateSupply`, then public **forever** |
| solvency verdict | — | — | public, one bit per snapshot |
| redemption factor | — | — | public from the moment it is set, necessarily — invariant 14 needs it shown to have been applied identically |
| funding residue | — | public | public |
| unreserved residue | private | private | **private, forever** |

Two crossings are irreversible and both are named at the point of action in code:
`KyrveWrappedAsset.unwrap` inside `unwrapQuoteFunding`, and `allowPublicDecryption` inside
`publishAggregateSupply` and `proveSolvency`. Nox has no `removeViewer`, no `removeAdmin` and no
un-publish. No interface may describe either as revocable.
