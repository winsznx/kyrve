# Phase 5 gate result

Command: `pnpm verify:phase5`. Full captured output: `evidence/phase5/gate-run.log`.

```
  24 passed, 0 failed, 4 skipped

  VERDICT: CONDITIONAL PASS — every executable gate passed. The skipped gates above need an
  environment or a balance this run did not have, and each names the exact command.
```

A CONDITIONAL PASS is not a PASS and this file does not round it up. Four gates did not execute; each is
named below with what it needs and what has been proven in its place.

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

**Confidential ownership (2 of 3).** **22 passing** against the real Nox stack and real unmodified
Midnight — the Osaka guard, 12 lifecycle demonstrations and 8 attacks. The privacy scan then searched the
captured suite output and found no decrypted value in any log, evidence file or manifest.

**Quality and security (5).** Clean tree, `winsznx` authorship, no `Co-Authored-By` trailer anywhere in
the branch. Biome and `forge fmt` clean. No secrets, no forbidden licence claim. Slither: 0 High/Medium
across the deployed contract paths. The security register: 12 findings recorded, **none High or Medium and
still open** — the gate parses the table rather than trusting a summary line.

---

## What did not execute, and what stands in its place

### 1. The ownership view in real Chromium

```
SKIP  the ownership view renders in real Chromium
      NOT RUN. It needs Docker and a Chromium download. Run:
      pnpm --dir confidential exec hardhat test test/101-series-browser.ts
```

**Not built.** Demonstration 13 of the brief asks for the ownership result shown in a real browser, and
that needs an ownership view in `apps/web` alongside the Phase 4 settlement page plus the Playwright
driver for it. Neither exists yet, so the gate reports the honest thing: the file it would run, and the
absence of the evidence record it would write.

What is proven instead: every value that view would display is read back from chain state in
`100-series-ownership.ts` — each provider's own balance decrypted through the real gateway by their own
wallet, an outsider and *another provider* both refused, total supply published and decrypting to the
aggregate, and the solvency verdict published and decrypting to true. The browser demonstration would add
that a user-facing surface presents them correctly. It would not add a new claim about the protocol.

### 2, 3 and 4. Sepolia deployment, Etherscan verification, one real allocation

```
SKIP  series layer deployed, bound and wired on Sepolia
SKIP  Etherscan source verification
SKIP  one real series allocation executed on Sepolia
```

**Not deployed.** The three scripts the gate names — `deploy:series`, `verify:etherscan:series` and the
allocation flow — are not written yet, so nothing was broadcast and no deployment record exists.

The P5-1 decision costed this before implementation began (§7), and the arithmetic is the reason it is
recorded here rather than attempted and abandoned midway:

| | measured |
|---|---|
| deployer balance | **0.048735 ETH** |
| Phase 4's curve redeploy | 11,580,178 gas / 0.01209 ETH |
| Phase 4's settlement deploy | 7,343,172 gas / 0.00787 ETH |
| one fresh Sepolia curve epoch | **0.029918 ETH** (27% above the local prediction) |

Phase 5's redeployment set is the whole curve and settlement stack plus five new contracts, because
`bindEngine` is one-shot on three contracts and the engine holds the vault as an `immutable` — §3 of the
decision shows the rejected option needed exactly the same set. Deployment plus a fresh epoch does not fit
in the remaining balance, which is why the plan of record allocates against the **already-settled Phase 4
position** (`evidence/phase4/sepolia-settlement.json`, 300,000,599 units of real credit) rather than
running a new epoch.

What is proven instead: the same flow, end to end, on one chain, against real handles, real gateway proofs
and real unmodified Midnight — `confidential/test/100-series-ownership.ts`. What Sepolia would add is
public-network latency and cost at 2,048 cells, which is UNVERIFIED and was already UNVERIFIED at the end
of Phase 4.

---

## The two gates that exist because something was found

**`verify:settlement-abi`** is new. Phase 5 calls across the 0.8.36 / 0.8.34 boundary in the direction
`verify:curve-abi` does not cover. `SettlementQuoteExecution` packs three `uint128`s and two `uint40`s:
reorder one field and `exactUnits` decodes as `expectedBuyerAssets` — both plausible values of the same
magnitude — so `SeriesAllocator` would compare the vault's credit against the wrong number and mint
claims anyway, with nothing reverting.

**The decision gate** is first for a reason. P4-2 sat open across two phases. A gate that could report a
phase as passed without ever reading the architectural decision that phase existed to make would be a
gate that had learned nothing from that.
