# Validation matrix

Every load-bearing assumption, its evidence level, and its verdict. Updated 2026-07-28.

Evidence levels: **EXEC-local** (executed here) · **EXEC-chain** (live read-only chain state) ·
**SOURCE** (pinned package/repo source) · **UNVERIFIED**.

| # | Assumption | Level | Evidence | Verdict |
|---|---|---|---|---|
| V-1 | Ratifier cannot enforce fill size (`view`, no `units`) | EXEC-local | `ExactFill.t.sol` 14/14 | **PASS** |
| V-2 | `onBuy` can enforce exact fill | EXEC-local | `ExactFill.t.sol` | **PASS** |
| V-3 | Callback revert rolls back group, credit, debt | EXEC-local | `test_failedPartialFill_leavesNoState` | **PASS** |
| V-4 | Quote math matches real `take` | EXEC-local | `QuoteMathDifferential.t.sol`, 10-point grid | **PASS** |
| V-5 | Maker payment independent of settlement fee | EXEC-local | fee raised to max, payment unchanged | **PASS** |
| V-6 | `tickToPrice` monotone → sort by decreasing tick | EXEC-local | full grid | **PASS** |
| V-7 | Rounding down never overdraws; dust ≤ 2 wei | EXEC-local | fuzz, 256 runs | **PASS** |
| V-8 | Ticks below settlement fee revert | EXEC-local | `test_rateGrid_lowTicks…` | **PASS** |
| V-9 | Maker must authorise ratifier | EXEC-local | `test_ratifierMustBeAuthorised…` | **PASS** |
| V-10 | Sepolia executes Osaka | EXEC-chain | CLZ probe + control | **PASS** |
| V-11 | Midnight release 2026-07-23 exists at `dbd8d3d5` | SOURCE | submodule pin, builds clean | **PASS** |
| V-12 | Nox stack computes real encrypted operations | EXEC-local | `add(40,2)` → 42 via real Runner | **PASS** |
| V-13 | All required primitives exist and execute | EXEC-local | 22 primitives measured | **PASS** |
| V-14 | Encrypted ÷ encrypted division exists | EXEC-local | `div`, `safeDiv` measured | **PASS** |
| V-15 | No boolean ops; no `select(ebool,ebool,ebool)`; no batch API | EXEC-local + SOURCE | full surface enumerated | **CONFIRMED ABSENT** |
| V-16 | `fromExternal` binds owner, app, chain, expiry | EXEC-local | 4 negatives all revert | **PASS** |
| V-17 | Direct-caller rule is policy, not impossibility | SOURCE | `owner` is a caller-supplied param | **PASS (reframed)** |
| V-18 | Viewer/public-decrypt grants irreversible | EXEC-local | false→true, no inverse in ABI | **PASS** |
| V-19 | Decryption proofs replayable (no ACL/nonce/expiry) | SOURCE | `validateDecryptionProof` is a pure sig check | **CONFIRMED** |
| V-20 | Async lifecycle works; no callback; polling required | EXEC-local | 10 samples, median 468 ms | **PASS** |
| V-21 | Full 16×128 universe is executable | EXEC-local | 195.7M gas, 11 tx, measured | **PASS** |
| V-22 | Encrypted curve matches plaintext reference | EXEC-local | leaf 5 / 50,000,000 exact match | **PASS** |
| V-23 | Confidential failure emits no public reason | EXEC-local | identical status/logs/topic ×5 | **PASS** |
| V-24 | Confidential failure is gas-indistinguishable | EXEC-local | 4 distinct values, 2,974 spread | **FAIL — open** |
| V-25 | ERC-7984 wrap public / balance private / unwrap public | EXEC-local | `04-erc7984.ts` 6/6 | **PASS** |
| V-26 | Operator has no per-amount allowance | EXEC-local | no allowance fn in ABI | **CONFIRMED** |
| V-27 | Operator expiry enforced | EXEC-local | `isOperator` false past `until` | **PASS** |
| V-28 | viem executes under workerd | EXEC-local | 6/6 workerd tests, clean bundle | **PASS** |
| V-29 | Worker config valid; all bindings resolve | EXEC-local | `wrangler deploy --dry-run` | **PASS** |
| V-30 | D1 unsuitable as full event store | SOURCE | 10 GB cap, single-threaded | **CONFIRMED** |
| V-31 | Midnight core is BUSL-1.1 | SOURCE | `LICENSE` + SPDX headers | **CONFIRMED** |
| V-32 | Morpho Additional Use Grant contents | EXEC-chain | ENS: **no contenthash, no text records** | **EMPTY — no grant** |
| V-33 | Testnet Nox latency and gas | — | not measured | **UNVERIFIED** |
| V-34 | Storage behaviour under realistic load | — | not measured | **UNVERIFIED** |
| V-35 | Concurrent epoch behaviour | — | not measured | **UNVERIFIED** |

**32 PASS/CONFIRMED · 1 FAIL (V-24, gas side channel) · 3 UNVERIFIED (deferred to Phase 1 with test plans).**
