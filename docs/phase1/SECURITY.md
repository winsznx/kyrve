# Phase 1 security

Four scans, all runnable locally with `pnpm verify:security`, all wired into CI. Each is scoped so
that its output is worth reading — a scan reporting hundreds of results in vendored code trains
people to ignore it, which is worse than not running it at all.

Two of these scans were **wrong when first written**, in the same way: they flagged text that said
the opposite of what they were looking for. Both corrections are recorded below, because a scan's
false-positive history is part of knowing how much to trust it.

## Slither

`pnpm verify:slither` — scoped to the six contract paths Kyrve deploys.

A raw run reports **810** results across the repository. Almost all are in `forge-std`, the
vendored Midnight core, or Kyrve's own test and script files, where `vm.prank`-driven helpers
legitimately do things that would be defects in production. The scan reports the total, states the
exclusions, and fails only on **High or Medium impact in deployed code**.

| Impact | In-scope count | Disposition |
|---|---:|---|
| High | 0 | — |
| Medium | 0 | one was found and **fixed**, see below |
| Low | 6 | triaged individually, below |
| Informational | 9 | triaged individually, below |

### The Medium finding, fixed

`unused-return` — `KyrveExactFillVault.onBuy` discarded the return value of `approve`.

A token that signals failure by returning `false` rather than reverting would have left the
allowance unset, and the failure would have surfaced later as an opaque revert inside Midnight's
`transferFrom`. Now checked with a named error:

```solidity
bool approved = IERC20Approve(market.loanToken).approve(MIDNIGHT, buyerAssets);
require(approved, ApprovalRejected(market.loanToken, buyerAssets));
```

Caveat stated at the call site: this requires a token that actually returns a bool. Midnight's own
`SafeTransferLib` provides `safeTransfer` and `safeTransferFrom` but **no `safeApprove`**, so there
is nothing upstream to reuse.

### Low, triaged

| Finding | Disposition |
|---|---|
| `missing-zero-check` on `KyrveExactFillVault` constructor (×2) | **Fixed** — `ZeroAddress(field)` guards added |
| `missing-zero-check` on `KyrveQuoteRatifier` constructor | **Fixed** — same |
| `reentrancy-events` in `onBuy` and `cancelQuote` (×2) | **Accepted.** State is written before the external call in both; only the event follows it. Checks-effects-interactions is satisfied for state, and an event ordering difference cannot be exploited. |
| `timestamp` in `KyrveQuoteRatifier.isRatified` and the registry (×4) | **Accepted.** Quote expiry is inherently time-based, and Midnight itself gates on `block.timestamp` for `offer.expiry`. Miner drift of a few seconds is immaterial against a one-hour quote window. |

### Informational, triaged

| Finding | Disposition |
|---|---|
| `assembly` in `KyrveOsakaProbe.clz` | **Accepted, required.** `CLZ` has no Solidity intrinsic; inline assembly is the only way to reach the opcode this probe exists to test. |
| `pragma` — four Solidity versions in the tree | **Accepted.** Kyrve contracts are pinned to 0.8.34 to match the Midnight release; forge-std and Nox contracts carry their own. Mixing is confined to test tooling. |
| `missing-inheritance` — `TestERC20` should inherit `IERC20` (×2) | **Accepted.** `TestERC20` deliberately declares its own surface because Midnight's `IERC20` omits `approve`, which the maker needs. Inheriting a partial interface would be less clear, not more. |
| `naming-convention` — immutables in SCREAMING_CASE (×5) | **Accepted, deliberate.** `MIDNIGHT`, `ACTIVATOR`, `REGISTRY`, `BINDING` are immutable pinned addresses. Screaming case marks them as constants-in-effect at every use site, which is the property that matters when reading a settlement path. |

## Secret scan

`pnpm verify:secrets` — two passes.

1. **Known-value.** Reads real values from `.env` and searches every tracked and untracked file.
   Catches the exact credentials that matter, in any format.
2. **Pattern.** Credential-shaped strings regardless of `.env`, so a key pasted from elsewhere is
   still caught.

Values in `.env` that are **public by design** — the NoxCompute address, a public RPC hostname, the
Alchemy base URL — are classified and reported as checked-and-public rather than flagged.

The scan never prints a secret. It reports the **variable name** and the file.

> **Correction.** The BIP-39 pattern originally matched *any* twelve lowercase words in sequence
> and flagged ordinary prose in the PRD. A scan that cries wolf trains the reader to ignore it. It
> now requires a **quoted literal**, and allowlists anvil's public test mnemonic **by value** —
> never by file, because allowlisting a path would hide a real leak that happened to land there.

CI runs the pattern pass only: no `.env` exists in CI, by design, and the workflow says so rather
than silently reducing coverage.

## Licence scan

`pnpm verify:licence` — checks that:

- all 16 Kyrve Solidity files carry `SPDX-License-Identifier: GPL-2.0-or-later`;
- the vendored Midnight core still declares BUSL-1.1;
- `LICENSE` states BUSL-1.1, the empty Additional Use Grant, and non-production use;
- **no file describes Morpho Midnight as open source.** It is source-available.

> **Correction.** The scan initially reported eleven findings, all of them *denials* — "**not** an
> official Morpho deployment". It matched the phrase regardless of polarity. It now checks for a
> negation within the same sentence, and normalises TypeScript string-concatenation seams, because
> one denial was split across a line by a `+` and read as two fragments with the negation stranded
> on the far side.

## Dependency audit and import boundary

- `pnpm audit --audit-level moderate` — **no known vulnerabilities**.
- `pnpm lint:imports` — only `packages/nox` may import `@iexec-nox/*` or `encrypted-types`;
  `viem/node` is forbidden everywhere. Verified to fail on a deliberate violation.
- `pnpm verify:bundles` — 0 unenv stubs, 0 forbidden `node:` builtins, `viem/node` absent, 0
  secrets inlined across 688 KiB of Worker bundles.

## Deployed-bytecode comparison

`pnpm verify:deployed-bytecode sepolia` closes a gap the other checks left open.
`verify:midnight-bytecode` proves the build is **reproducible**; this proves the build still
**matches what is deployed and verified on Etherscan**.

It caught a real problem while being written: a zero-address guard added to
`KyrveDeploymentVerifier` — which Slither had *not* flagged — would have made repository source
differ from the contract already deployed and verified on Sepolia. Reverted.

It also caught a flaw in itself. Solidity embeds immutables into **runtime** bytecode, so a
freshly-compiled template with zeroed placeholders can never match on-chain code, and every
contract with an immutable reported a false mismatch. It now masks the exact offsets Foundry
records in `immutableReferences`.

Proven non-vacuous: it fails on a deliberate source change and passes when reverted.

## Not covered in Phase 1

Stated so absence is not mistaken for coverage:

- no formal verification of Kyrve contracts (Midnight ships its own `certora/` and `rocq/` specs);
- no fuzzing beyond Foundry's default runs on the properties that have fuzz tests;
- no external audit;
- no economic or MEV analysis of the settlement path;
- timing and handle-count side channels are unmeasured — only gas was investigated (P-5).
