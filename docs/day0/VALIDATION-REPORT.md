# Validation report

Narrative companion to [`GATE.md`](GATE.md) (verdict), [`VALIDATION-MATRIX.md`](VALIDATION-MATRIX.md)
(assumption-by-assumption) and [`BENCHMARKS.md`](BENCHMARKS.md) (numbers).

## What was asked

Discharge three residual Day 0 conditions — genuine Nox runtime, a measured curve operation budget,
and Cloudflare/viem runtime compatibility — then apply the 20 recorded PRD corrections and re-issue
the gate.

## What happened

**The disk was diagnosed, not assumed.** A restart did not fix it. The Data volume sat at 96% with
19 GiB free. The cause was Docker build cache: 23.98 GB, 20.67 GB of it reclaimable and attached to
no active image. `docker builder prune --all --force` returned 38 GiB. No image, volume or user file
was touched.

**The Nox stack came up and genuinely computed.** Encrypted `add(40, 2)` validated through
`fromExternal`, executed by the real Runner, publicly decrypted to `42` — 173,988 gas, handle ready
in 597 ms, 97-byte proof. Everything downstream rests on that being real rather than mocked.

**The decisive measurement.** A naive six-term arithmetised eligibility cell costs 146,865 gas, so
the PRD's monolithic 16×128 universe would need 300.8M gas — ten times a block. That was the finding
capable of invalidating the declared execution design.

It did not. Three structural optimisations — caching provider-level predicates so they run 16 times
instead of 2,048, using `select(cond, cachedValue, 0)` to test and apply eligibility in one
operation, and exploiting the fact that the rate grid is public — bring one cell to **76,402 gas**,
verified linear across chunk widths 1 through 16. The full universe executes in ~195.7M gas across
~11 transactions.

**No scope was reduced.** The complete private universe is preserved; only the execution schedule
changed, from one transaction to an idempotent multi-transaction epoch. The encrypted engine's
output matched a plaintext reference model exactly.

**Binding and ACL behaved as the source predicted.** Wrong owner, wrong application contract,
tampered signature and truncated proof all revert. `addViewer` and `allowPublicDecryption` flip
false → true with no inverse anywhere in the ABI.

**viem runs under workerd.** The previous run could only offer structural evidence. Now: zero
`[unenv]` stubs, zero residual `node:` imports, `viem/node` absent, and 6/6 tests executing inside
workerd including a live `eth_getLogs` with ABI decoding. `wrangler deploy --dry-run` succeeds at
131.41 KiB gzipped with all six bindings resolved.

## What did not pass

**Gas is not indistinguishable across confidential failures.** Status, log count and event topic are
identical across all five scenarios, and only the eligible contribution reaches the encrypted total.
But four distinct gas values appeared, spread 2,974 gas (2.1%).

The likely cause is calldata zero-byte counts and cold/warm storage rather than the private
predicate — that was not proven, so the claim is not made. This narrows an existing side channel; it
does not invalidate the design.

## Corrections found in my own work

Three test defects were found and fixed rather than worked around:

- `vm.expectRevert` bound to an internal call, so the assertion silently attached to the wrong call.
- Chain time was compared against wall-clock `Date.now()`, making an operator-expiry test flap.
- A handle granted only `allowThis` was undecryptable by the caller; it needed an explicit
  `Nox.allow`.

One apparent protocol failure — `App mismatch` on an unwrap — turned out to be the binding working
correctly against a test that bound a proof to one contract and called another.

## Where reality still differs from the PRD

Twenty findings, now applied in [`kyrve-production-prd-v1.1.md`](../../kyrve-production-prd-v1.1.md).
The three that change engineering most:

1. **§11.5's boolean conjunction does not exist in Nox** and must be arithmetised (A-9).
2. **§9.1's universe was unbudgeted**; it is now measured and normative (A-10).
3. **§20.2 defended the wrong threat** — settlement-fee drift affects borrower proceeds, not maker
   funding (A-6).

## Licence

Both Morpho BUSL ENS names resolve but carry no contenthash and no text records across 17 candidate
keys. The Additional Use Grant is **empty**, so only non-production use is granted. This is a
submission-eligibility and production-operation question. It does not touch the architecture, and it
should not gate engineering.

## Conclusion

Technical PASS. Conditional only on the external licence clarification. Phase 1 may begin.
