# Phase 4 gate — quote activation and Midnight settlement

`pnpm verify:phase4`

Phase 4 turns one verified confidential curve result into one executable Midnight offer and settles
it exactly, or not at all. This file records what is proven, what is not, and what a reader should
not conclude from either.

---

## What is proven

### Against real, unmodified Morpho Midnight (release `2026-07-23`, `dbd8d3d5`)

**121 Foundry tests pass**, 68 of them new. Nothing on the protocol path is mocked: a real Midnight
is deployed through the same fixture `scripts/deploy/local.ts` uses, real markets are created, and
every fill runs through the real `take` entry point.

| Property | Where |
|---|---|
| the exact fill settles | `test_exactFill_settlesThroughUnmodifiedMidnight` |
| a partial fill reverts — which Midnight itself permits | `test_attack_partialFill_reverts`, `test_attack_halfFill_reverts` |
| an oversized fill reverts, through Midnight's own accounting | `test_attack_oversizedFill_reverts` |
| a rejected fill leaves NO consumption, credit, debt, tokens or allowance | `test_failedPartialFill_rollsBackEverything` |
| a replay reverts | `test_attack_replay_reverts` |
| an unapproved taker reverts | `test_attack_wrongTaker_reverts` |
| tick, market, callback, maxUnits, group and deployment substitutions each revert by name | `test_attack_altered*`, `test_attack_wrongDeployment_reverts` |
| callback spoofing reverts, direct and with the right caller | `test_attack_directCallbackCall_reverts`, `test_attack_spoofedCallbackValues_reverts` |
| the taker's own callback cannot settle twice | `test_attack_reentrantTakerCallback_cannotSettleTwice` |
| a false-returning `approve` reverts; a silent one fails closed | `test_falseReturningApprove_*`, `test_silentApprove_failsClosed` |
| a re-entrant `approve` cannot settle twice | `test_reentrantApprove_cannotSettleTwice` |
| a settlement leaves no allowance residue | `test_exactFill_leavesNoAllowanceResidue` |
| cancellation is real at the protocol level | `test_cancel_retiresTheQuoteAtTheProtocolLevel` |
| the expiry boundary is exact on both sides | `test_expiry_boundaryIsExact` |
| expiry is permissionless and recovers funding | `test_expiry_isPermissionless_andRecoversFunding` |
| recovery cannot touch committed funding | `test_recovery_cannotTouchCommittedFunding` |
| the cancellation race resolves either way, never both | `test_cancellationRace_*` |
| duplicate activation reverts, per quote id AND per epoch | `test_activation_isOncePerQuoteId`, `test_activation_isOncePerEpoch_evenWithDifferentTerms` |
| delta R-14: a partial handle set is refused before any proof | `test_r14_partialHandleSet_isRefusedBeforeAnyProof` and two more |
| a tampered proof, a stale epoch, a wrong graph root, request or universe each revert by name | `contracts/kyrve/test/Activation.t.sol` |

`CurveLayerStub` stands in for the confidential layer in that suite, and only because it compiles at
a different solc and needs a live Nox stack Foundry cannot drive. **Nothing it returns is evidence
about confidentiality.** Its own file says so in those words.

### Against the real Nox stack AND real Midnight, on one chain

`confidential/test/90-quote-settlement.ts` — **17 demonstrations, one connected lifecycle.** Real
handles, a real KMS, a real runner, real gateway proofs, real ACL refusals; and Midnight deployed
from the exact artifacts `forge build` produced, so "unmodified" is literally true rather than a
re-compilation.

It is deliberately not seventeen isolated tests. The quote that rejects a partial fill is the quote
that then settles; the quote that settles is the quote that then rejects a replay. A suite that
rebuilt its fixture between attacks would prove the easier claim.

1. a real curve epoch runs to a sealed graph and a published aggregate, matching the plaintext
   reference model exactly
2. the selected leaf decrypts publicly, through the real gateway
3. the proof and the graph binding verify on chain, before anything is activated
4. one Midnight offer is activated, bound to every term of the epoch
5. only the approved borrower may take it
6. a partial fill is rejected
7. the rejected fill leaves no state behind
8. an oversized fill is rejected
9. the exact fill settles
10. the vault holds public credit and the borrower public debt
11. exactly the quoted assets moved, and no allowance survived
12. the quote is consumed, in Kyrve's registry and in Midnight's group accounting
13. a replay is rejected
14. an unused quote is cancelled, and the cancellation is real at the protocol level
15. an expired quote is recovered, by an address with no privileges at all
16. wrong market, tick, callback, ratifier, group and deployment are each rejected — and the
    unmutated offer then still settles, so every rejection was about the mutation
17. a tampered decryption proof is rejected

Plus `09-osaka.ts`, which asserts the local chain executes Osaka and measures the per-transaction
gas cap on both sides of the boundary.

### The cross-compiler boundary

The settlement layer calls the confidential layer at 0.8.34 → 0.8.36, declaring the five entry
points rather than importing them, because the two compiler pins are mutually exclusive (Q-1).
`pnpm verify:curve-abi` compares selectors AND return shapes recursively against the compiled
confidential artifacts. A reordered struct field would otherwise encode cleanly, decode cleanly, and
deliver a graph root where a universe hash was meant.

---

## What is NOT proven, stated plainly

### The launch-scale epoch cannot execute on Sepolia — delta S-2

Osaka caps a single transaction at 16,777,216 gas. Phase 3's stage widths were sized against
24,000,000, measured on a local node with no cap. Measured against the recorded evidence, exactly
one stage exceeds it: `accumulateLeafChunk` at **18,193,386 gas**, over by 1,416,170. Every other
stage fits, most with millions to spare.

So the 16 × 128 universe is not executable on the chain Kyrve targets — and the fix is small.
`cellsPerChunk` is a **universe parameter**, not a compiled constant, so creating universes at 192
rather than 256 resolves it with no redeployment. Lowering
`CurveUniverseRegistry.MAX_CELLS_PER_TRANSACTION` so an over-wide universe cannot be created at all
does need one. Both are specified in delta S-2.

`pnpm verify:gas-cap` is wired into this gate and **fails** until that lands. The failure is
deliberate and must not be relaxed. Phase 4's own settlement path is nowhere near the cap.

### Outstanding, and not started

| What | Why it matters | Status |
|---|---|---|
| the terminal's settlement panel, driven in a real Chromium | the settlement path is proven headlessly; what is missing is the interface over it | **NOT BUILT.** The gate reports SKIP with that reason. |
| the gas side-channel experiment against activation and settlement | Phase 3 measured the curve engine's confidential branch only | **NOT MEASURED.** Nothing is claimed about the settlement path's gas distinguishability. The gate reports SKIP with that reason. |
| Etherscan verification of the settlement layer | Sepolia source verification | script not yet written; the gate reports SKIP |
| one real Sepolia epoch → activation → settlement | a public-network end-to-end | **NOT RUN.** Needs the layer deployed on Sepolia and the funding budget reporting FUNDED. |

None of these is claimed as done anywhere, and each gate entry names the exact reason rather than a
generic skip.

### And what the passing gates do not mean

- Settlement working locally against real Midnight and a real Nox stack is not evidence that it works
  on a public network under real latency. The Phase 3 four-cell Sepolia epoch is the only public-network
  confidential evidence that exists.
- The vault settles from **public** funding. A curve reservation is still not a capital lock — P4-2 is
  open, deliberately, and delta S-6 says so.
- No confidential series ownership is minted. That is Phase 5.
- Nothing here says a confidential failure is gas-indistinguishable. Phase 3's measurement disclaims
  it and Phase 4 has not extended it.

---

## Reproducing

```
pnpm install --frozen-lockfile
forge build
pnpm --filter @kyrve/confidential build
pnpm verify:phase4
```

The confidential settlement suite needs Docker and multi-gigabyte images. Without it the gate reports
**NOT VERIFIED** and exits non-zero rather than reporting green over an unexercised confidentiality
path.
