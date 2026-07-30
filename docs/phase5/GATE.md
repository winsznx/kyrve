# Phase 5 gate result

Command: `pnpm verify:phase5`. Full captured output: `evidence/phase5/gate-run.log`.

```
  VERDICT: NOT FUNDED — every other executable gate passed. The Sepolia sequence is priced
  against the live network and the deployer cannot cover it, so nothing was broadcast and
  nothing will be. This is not a PASS and must not be recorded as one.
```

Phase 5 has **not** reached full PASS, and this file does not round it up. **27 gates passed, 1 failed,
3 skipped.** The one failure is a balance, not a defect: the whole Sepolia sequence is priced from real
measurements and the deployer cannot cover it.

**The gas total is fixed at 58,546,501 and the ETH figures are not.** Gas used is reproducible; the base fee is
not, which is the entire reason the ledger appends rather than overwrites. Across the recorded samples the
shortfall has ranged from **0.028154403729974620** to **0.028494721425871398 ETH** on the same 58,546,501 gas. Quoting one sample's
ETH figure as though it were the number would be quoting a fee, so the authoritative record is
`evidence/phase5/funding-budget.json` and the figures below are its latest sample.

`NOT FUNDED` is a distinct verdict from `FAIL` on purpose. A funding shortfall is a fact about a wallet
rather than a broken build, and the summary must not be readable either way round — nothing is asserted
to work that does not, and nothing is reported as broken that is not.

---

## The funding preflight, measured against the live network

`pnpm test:sepolia-series-budget` runs on every gate invocation. It is **not** a SKIP: it calls
`eth_estimateGas` against Sepolia with the real creation bytecode and the real encoded constructor
arguments for every contract, adds the transaction sequences from real measured runs, prices the total at
the live base and priority fee, and appends the prediction to an append-only ledger
(`evidence/phase5/funding-budget.json`). Earlier samples are never edited.

| component | gas | source |
|---|---|---|
| `KyrveCustodyVault` (Phase 2 revision) | 2,026,766 | `eth_estimateGas`, Sepolia |
| `QuoteEpochController` | 1,763,153 | `eth_estimateGas`, Sepolia |
| `CurveGraphRegistry` | 749,178 | `eth_estimateGas`, Sepolia |
| `ReservationLedger` | 1,018,086 | `eth_estimateGas`, Sepolia |
| `NoxCurveEngine` | 5,181,946 | `eth_estimateGas`, Sepolia |
| `CurveResultVerifier` | 1,213,121 | `eth_estimateGas`, Sepolia |
| `KyrveQuoteRegistry` | 954,672 | `eth_estimateGas`, Sepolia |
| `KyrveSettlementRatifier` | 843,649 | `eth_estimateGas`, Sepolia |
| `KyrvePublicResultVerifier` | 1,011,152 | `eth_estimateGas`, Sepolia |
| `QuoteActivator` | 2,146,773 | `eth_estimateGas`, Sepolia |
| `KyrveQuoteExpiryController` | 379,595 | `eth_estimateGas`, Sepolia |
| `KyrveSeriesFactory` | 1,936,085 | `eth_estimateGas`, Sepolia |
| `KyrveSeriesToken` | 2,709,922 | `eth_estimateGas`, Sepolia |
| `SeriesOwnershipRegistry` | 797,094 | `eth_estimateGas`, Sepolia |
| `SeriesAllocator` | 2,436,857 | `eth_estimateGas`, Sepolia |
| `AggregateSolvencyVerifier` | 1,025,056 | `eth_estimateGas`, Sepolia |
| `SeriesResidueAccount` | 417,049 | `eth_estimateGas`, Sepolia |
| one-shot bindings and configuration (12 transactions) | 720,000 | 12 × 60,000, one storage write and one event each, sized against local receipts |
| provider funding, mandates, ACL grants and one full confidential epoch | 26,931,546 | a REAL Sepolia epoch — two providers, four cells, aggregate exactly 299,999,999 |
| quote activation (creates the series vault) and one exact Midnight take | 1,036,709 | real Sepolia settlement |
| confidential funding, allocation, close and the solvency proof | 3,248,092 | measured LOCALLY against the real Nox stack; no public sample exists yet |
| Etherscan V2 source verification | 0 | an HTTP submission, no gas |
| **TOTAL** | **58,546,501** | |
```
base fee            975,624,323 wei          <- moves every block
priority fee        1,500,000 wei
effective price     977,124,323 wei
predicted cost      0.057207210153643823 ETH
safety margin       35%
REQUIRED BALANCE    0.077229733707419161 ETH
deployer balance    0.048735012281547763 ETH
SHORTFALL           0.028494721425871398 ETH
```

The 35% floor is not padding. Phase 3's real Sepolia epoch cost 0.029918 ETH against a local prediction
of 0.023624 — a **27% under-prediction on a sequence whose gas was measured rather than guessed**. Gas
used is reproducible; the gas price across a hundred transactions minutes apart is not. An under-funded
sequence strands halfway, and a half-executed epoch holds provider capital until someone cancels it.

**Why the total is this large, and why it is not reducible.** 26.9M of the 58.5M — 46% — is one
confidential epoch, dominated by 36 **permanent** ACL grants per provider that a new engine cannot
inherit (deltas T-5 and T-8). The 26.6M of deployments is the whole curve and settlement stack, because
`bindEngine` is one-shot on `ReservationLedger`, `QuoteEpochController` and `CurveGraphRegistry`, and
`NoxCurveEngine` holds the vault as an `immutable`. P5-1 §3 shows the *rejected* option needed exactly the
same set, so this is not a cost the architecture choice introduced. `CurveUniverseRegistry`,
`KyrveWrappedAsset`, `EncryptedMandateBook`, `ConfidentialRequestBook` and `KyrveEmergencyController` are
all reused, which is what keeps registered universes and provider wrapper balances alive.

**Why the Phase 4 settled position cannot be reused.** It was created by a quote in the Phase 4
`KyrveQuoteRegistry`, which a redeployed stack replaces — and `SeriesAllocator.allocateChunk` reads the
quote from the registry it was constructed against, requires `provenance.epochId` to name the epoch whose
locks it consumed, and those locks live in the new custody vault created by the new ledger driven by the
new engine. There is no arrangement in which the old quote and the new locks are the same round. The brief
anticipated this: *"if the Phase 4 position cannot safely be reused after required redeployments, run a
new connected epoch and exact settlement instead"* — which is exactly what the 26.9M epoch component
prices.

---

## What passed

**The P5-1 decision (2).** The decision document is read and fails unless it records a decided status,
the chosen option, the rejected option by name, a threat model, a migration impact and all eleven criteria
the brief demanded. Then the *contracts* are read: a handle-native `lockAllocation` must exist, the ledger
must perform **zero** `safeSub` calls and custody at least one, and neither `releaseLock` nor `restoreLock`
may consult the emergency controller. Measured: 2 subtractions in custody, 0 in the ledger.

**Locks and boundaries (11).** Lockfile, source lock, toolchain lock, vendored Midnight unmodified, the
Nox import boundary, unique Solidity basenames, EIP-170 (33 deployable contracts, `NoxCurveEngine` still
the only tight one at 1,058 bytes spare), the Osaka 2^24 cap (`cacheProviderChunk` reported TIGHT at
1,792,819 to spare — named on every run, not waiting to become a failure), and **both** cross-compiler ABI
checks: `ICurveLayer` at 12 functions across 5 interfaces, `ISettlementLayer` at 9 across 2, selectors and
return shapes both.

**Series accounting (4).** Both compiler pins build clean. `forge test`: 122 passed, 0 failed. The measured
fixture pins 300,000,000 capacity / 299,999,999 supply / 300,000,599 units / 299,999,998 assets and asserts
all four are distinct — so an implementation that conflated any pair fails even if a lucky epoch would
have let it through. Unit suites: 366 passed.

**Confidential ownership (3 of 3).** **22 passing** against the real Nox stack and real unmodified
Midnight — the Osaka guard, 12 lifecycle demonstrations and 8 attacks. Then **4 passing in real
Chromium**: provider A decrypts a balance equal to the plaintext reference model and disconnecting removes
it from the DOM; provider B, in a separate browser context with a separate injected key, is refused A's
balance with `not-authorised` and a message carrying no magnitude, decrypts their own, and reads supply
equal to the published aggregate with a solvency verdict of true. A fourth test collects every origin the
page contacted and compares it against exactly three legitimate ones — the dev server, the JSON-RPC node,
and the Nox gateway. The privacy scan then searched the captured suite output and found no decrypted value
in any log, evidence file or manifest.

**Quality and security (7).** Clean tree, `winsznx` authorship, no `Co-Authored-By` trailer anywhere in
the branch. Biome and `forge fmt` clean. No secrets, no forbidden licence claim. Every Kyrve contract on
chain matches the current build — 8 contracts compared byte for byte. Every generated path is
byte-identical after regeneration, which is the check delta R-13's shape needs and which the ABI
generator has silently broken before. Slither: 0 High/Medium across the deployed contract paths. The
security register: 12 findings recorded, **none High or Medium and still open** — the gate parses the
table rather than trusting a summary line.

---

## What did not execute, and why

### The Chromium ownership view — now PASSES

It was a SKIP at the previous gate run and is not one any more. The gate **runs the demonstration** rather
than reading its evidence file, because a gate that only read the file would pass on a stale record from a
build that no longer exists. It additionally asserts the refusal kind is `not-authorised` — a refusal for
the wrong reason proves the wrong thing — and that the browser read solvency as verified.

### Sepolia deployment, Etherscan verification, one real allocation

```
FAIL  the whole sequence is priced against the live network, and the balance covers it
      NOT FUNDED — 58,546,501 gas needs 0.077229733707419161 ETH at a 35% margin;
      balance is 0.048735012281547763 ETH, short by 0.028494721425871398 ETH

SKIP  series layer deployed, bound and wired on Sepolia
SKIP  Etherscan source verification
SKIP  one real series allocation executed on Sepolia
```

The preflight **ran** and answered. The three gates below it are SKIPs because they genuinely did not
execute, and they will keep reporting SKIP until a deployment record exists. None of them may be
downgraded to PASS for a sequence nobody performed.

**Nothing was broadcast.** No deploy, verify-on-chain or allocation script was written either, and that is
deliberate rather than an omission: carry-over 8 from the Phase 5 prerequisites says *"a verification
command that has never run is worse than a missing one"* (deltas R-11 and R-13), and a deploy script wired
into a gate that cannot be executed against anything is exactly that. The path becomes writable — and
testable — the moment the deployer is funded.

**What stands in its place.** The same sequence, end to end, on one chain, against real handles, real
gateway proofs and real unmodified Midnight: `confidential/test/100-series-ownership.ts` (12
demonstrations), `102-series-attacks.ts` (8 attacks) and `101-series-browser.ts` (4 in Chromium). What
Sepolia would add is public-network latency and cost at scale, which was UNVERIFIED at the end of Phase 4
and remains so.

---

## The three gates that exist because something was found

**`verify:settlement-abi`** is new. Phase 5 calls across the 0.8.36 / 0.8.34 boundary in the direction
`verify:curve-abi` does not cover. `SettlementQuoteExecution` packs three `uint128`s and two `uint40`s:
reorder one field and `exactUnits` decodes as `expectedBuyerAssets` — both plausible values of the same
magnitude — so `SeriesAllocator` would compare the vault's credit against the wrong number and mint
claims anyway, with nothing reverting.

**The funding preflight** is a gate rather than a script somebody remembers to run. It is the difference
between "we did not deploy" and "we priced it, here is the number, here is the shortfall". The
append-only ledger exists so the 35% multiplier is eventually learned from public samples instead of
asserted from one.

**The decision gate** is first for a reason. P4-2 sat open across two phases. A gate that could report a
phase as passed without ever reading the architectural decision that phase existed to make would be a
gate that had learned nothing from that.
