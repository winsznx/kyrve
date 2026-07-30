# Phase 5 gate result

Command: `pnpm verify:phase5`. Full captured output: `evidence/phase5/gate-run.log`.

```
  32 passed, 0 failed, 0 skipped

  VERDICT: PASS — every gate executed and passed.
```

Every condition executed. Nothing is reported as skipped, nothing is assumed, and no local result stands
in for a public one.

---

## What ran on Ethereum Sepolia

| | |
|---|---|
| deployment | 18 contracts, 12 one-shot bindings, 28,318,988 gas of contract creations |
| read-back | 56 checks against chain state, none against the manifest |
| Etherscan V2 | 19/19 verified, both compiler pins |
| epoch | `0x760d3261…` — aggregate **299,999,999**, matching the plaintext reference model |
| funding | two real confidential locks, burned out of the ERC-7984 wrapper |
| unwrap plaintext | **299,999,999** — equal to the published aggregate |
| quote | `0xf05e7d39…` activated from proofs the gateway signed |
| settlement | exact fill, **300,000,599** units of credit and the same units of debt |
| refused | a partial fill (rolled back to zero consumption) and a replay |
| allocation | 2/2 claims minted from the handles the locks became, then sealed |
| supply | **299,999,999** published and read back — the aggregate, not the units |
| per-provider | both decrypted their OWN balance; both were refused the other's |
| solvency | published as one bit: solvent, coverage 300,000,594 against 299,999,999 of claims |
| residue | **1** recorded against an immutable declared beneficiary |
| refused | a duplicate allocation |

**The series layer.** `0xadcfb277…`, vault `0xA910E1E263338bE447ab24922693bc5c63BEC539`.

```
KyrveCustodyVault          0x69b8b911ec83673e35d369c100a5812734f997e3
KyrveSeriesToken           0xe2aea76cf8a2bf4877943792eb3ea877e8dec073
SeriesOwnershipRegistry    0xd0a3e53c7c089b1b47207237f2a923ced601bfff
SeriesAllocator            0x4a5092e1ca49044e4be2755873c116fa199b7428
AggregateSolvencyVerifier  0xf5da1616407ad9e9e4bb593b9e6049589d912f33
SeriesResidueAccount       0x372bd4fed1c8d08a97f24359befb9399431f68ec
```

### The three numbers that must not coincide, on a public network

```
published aggregate  299,999,999   what providers reserved, and what supply equals
Midnight units       300,000,599   the credit the vault holds. Never a mint quantity
buyer assets         299,999,998   what the borrower received. Never a mint quantity
funding residue      299,999,999 - 299,999,998 = 1   public, declared destination
unreserved residue   private forever, and never arrives anywhere it could leak
```

An implementation that conflated any pair fails the gate rather than passing by luck, because the gate
asserts the set has three members rather than checking one equality.

---

## What the funding forecast turned out to cost

The preflight runs on every gate invocation, prices the whole sequence from `eth_estimateGas` against the
live network plus real measured transaction gas, and appends to a never-edited ledger. Once the sequence
has executed it reports `ALREADY EXECUTED` and closes the loop — a forecast is not a receipt, and an
earlier version of this gate confused the two and failed the phase for having completed it.

| | |
|---|---|
| forecast | 58,546,501 gas |
| predicted | 0.057417399176360444 ETH |
| **measured** | **0.06788508245487313 ETH** |
| **prediction error** | **+18%** |

Phase 3's one public sample under-predicted by 27%. This one under-predicted by 18%. The 35% floor held
both times, which is the first evidence the multiplier has ever had beyond a single sample — and it stays
at 35% rather than dropping to 20%, because two samples are not a distribution either.

The measured figure includes provider float still sitting in the dust wallets, recoverable with
`pnpm dust:sweep`. It is a spend, not a cost, and the preflight says so rather than letting the number
read as one.

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

**Confidential ownership (3).** **22 passing** against the real Nox stack and real unmodified
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

## The four gates that exist because something went wrong

**`verify:settlement-abi`.** Phase 5 calls across the 0.8.36 / 0.8.34 boundary in the direction
`verify:curve-abi` does not cover. `SettlementQuoteExecution` packs three `uint128`s and two `uint40`s:
reorder one and `exactUnits` decodes as `expectedBuyerAssets` — both plausible values of the same
magnitude — so `SeriesAllocator` would compare the vault's credit against the wrong number and mint
anyway, with nothing reverting.

**The wrapper's loan-token identity.** Delta T-12: on Sepolia the deployed wrapper wrapped a different
tUSDC than the market lends, and the guard fired before a single contract was deployed. Without it every
encrypted step succeeds and activation reverts `FundingShortfall` naming a number with no hint of the
cause.

**The deployment id, checked against the superseded one.** A quote carries it in its provenance, so a
collision would let a Phase 4 quote authenticate against Phase 5's registry. Measured: `0x3cb6089353…`
against `0xb2f6707578…`.

**The decision gate.** It is first for a reason. P4-2 sat open across two phases. A gate that could report
a phase as passed without ever reading the architectural decision that phase existed to make would be a
gate that had learned nothing from that.
