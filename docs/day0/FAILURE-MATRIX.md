# Failure matrix

Every failure mode Kyrve must distinguish, and whether the distinction is public.

| # | Failure | Public? | Surface | Proven |
|---|---|---|---|---|
| F-1 | Partial fill attempted | **public revert** | `KyrveSeriesVault.WrongUnits(expected, actual)` | `ExactFill.t.sol` |
| F-2 | Oversized fill | **public revert** | Midnight `ConsumedUnits` | `ExactFill.t.sol` |
| F-3 | Unauthorised taker | **public revert** | `KyrveQuoteRatifier.UnauthorisedTaker` | `ExactFill.t.sol` |
| F-4 | Altered offer field | **public revert** | `KyrveQuoteRatifier.AlteredOffer` | `ExactFill.t.sol` |
| F-5 | Replayed quote | **public revert** | `QuoteNotExecutable` | `ExactFill.t.sol` |
| F-6 | Spoofed callback caller | **public revert** | `CallbackCallerNotMidnight` | `ExactFill.t.sol` |
| F-7 | Expired offer | **public revert** | Midnight `OfferExpired` | `ExactFill.t.sol` |
| F-8 | Ratifier not authorised by maker | **public revert** | Midnight `RatifierUnauthorized` | `ExactFill.t.sol` |
| F-9 | Tick priced below settlement fee | **public revert** | Midnight underflow | `QuoteMathDifferential.t.sol` |
| F-10 | Invalid input proof — wrong owner | **public revert** | Nox `InvalidProof("Owner mismatch")` | `03-binding-acl-lifecycle.ts` |
| F-11 | Invalid input proof — wrong contract | **public revert** | Nox `InvalidProof("App mismatch")` | `03-binding-acl-lifecycle.ts` |
| F-12 | Malformed / truncated proof | **public revert** | Nox `InvalidProof` | `03-binding-acl-lifecycle.ts` |
| F-13 | Provider rate-ineligible | **PRIVATE** | encrypted zero contribution | `03-binding-acl-lifecycle.ts` |
| F-14 | Provider underfunded | **PRIVATE** | encrypted zero contribution | `03-binding-acl-lifecycle.ts` |
| F-15 | Provider portfolio-capped | **PRIVATE** | encrypted zero contribution | `03-binding-acl-lifecycle.ts` |
| F-16 | Provider market-disabled | **PRIVATE** | encrypted zero contribution | `03-binding-acl-lifecycle.ts` |
| F-17 | Privacy floor not met | **PRIVATE** | leaf fillable becomes encrypted zero | `KyrveCurveEngine.finalizeLeaf` |
| F-18 | `safeMul` / `safeDiv` overflow | **PRIVATE** | encrypted zero, flags threaded through `select` | `KyrveCurveEngine.allocate` |
| F-19 | Handle not yet ready | **not a failure** | poll with backoff; SDK gives up at ~7 s | `03-binding-acl-lifecycle.ts` |
| F-20 | Nox service unavailable | **public status** | keeper retry, epoch timeout | not exercised |
| F-21 | Cron tick missed | **invisible** | reconcile forward from stored cursor | `spikes/cloudflare` |
| F-22 | Workflow step retry | **invisible** | idempotent stage + DO nonce | `spikes/cloudflare` |
| F-23 | RPC provider rejects `eth_getLogs` | **public error** | pin provider; range is configuration | observed live |

**Rule.** F-13 through F-18 must never produce a public reason. Proven for F-13..F-16: identical
status, log count and event topic. Gas is not yet proven identical — see THREAT-MODEL T-1.
