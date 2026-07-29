# Vendored Midnight source

Pinned release **`2026-07-23`**, commit **`dbd8d3d54d324a03df9f06d3c77d50a7bd1e09a0`**, vendored at
`vendor/midnight` as a **git submodule**.

Verified by `pnpm verify:vendor`, which fails on a changed pin, a changed core file, a changed
compiler setting, a changed nested submodule, or a dirty worktree.

## Why a submodule

A submodule preserves upstream history, makes the pin a single reviewable SHA, and makes an
accidental edit visible as a dirty worktree rather than blending into Kyrve's own diff. A copied
tree would satisfy none of those.

`vendor/midnight` is **never edited**. Kyrve contracts are separate extension contracts that import
from it.

## What is locked

`vendor-lock.json` records:

- the release tag and commit;
- nested submodule commits (`forge-std` v1.16.1, `morpho-blue`);
- compiler settings: solc 0.8.34, `evm_version = osaka`, `via_ir`, optimizer on, runs 466,
  `bytecode_hash = "none"`;
- **a sha256 for each of the 28 files under `src/`**, plus one `sourceTreeHash` over all of them:
  `7fb501e3483b1f5dd80156862814d0c791e35f81d1a0e544e319d502359747ae`;
- the licence position, including the empty Additional Use Grant.

## Why `bytecode_hash = "none"` matters

With metadata stripped, compiled output is a pure function of (source, compiler, settings). That is
what makes `verify:midnight-bytecode` possible at all: a recompilation differing by a single byte
means one of those three changed.

The result this enables: **the Midnight runtime bytecode hash on Ethereum Sepolia is identical to
the local build.** "Deployed unmodified" is a checkable fact rather than a claim.

| Contract | Runtime size | Note |
|---|---:|---|
| `Midnight` | 24,557 bytes | 19 bytes under the EIP-170 limit — worth knowing before anything is added |
| `KyrveProtocolRegistry` | 2,800 bytes | |
| `KyrveDeploymentVerifier` | 2,574 bytes | |
| `KyrveExactFillVault` | 3,069 bytes | |
| `KyrveQuoteRatifier` | 2,260 bytes | |
| `KyrveOsakaProbe` | 290 bytes | |

## Osaka

The pinned release compiles with `evm_version = "osaka"`. A chain without Osaka would **accept** the
deployment and then behave incorrectly at settlement — silent at deploy time, wrong when it matters.

`KyrveOsakaProbe` makes the check a deployed artifact rather than a recorded result. It runs the
`CLZ` opcode (EIP-7939) on the three inputs Day 0 verified against live Sepolia plus the zero case,
and `DeployKyrveSubstrate` calls `assertOsaka()` during deployment so a missing fork fails loudly.

Confirmed on chain at `0xbbec3e83090F764bB7C55006042aa0438cF6974A`: `verifyOsaka() -> true`.

## Changing the pin

A pin change is **its own commit** that also updates `source-lock.json` and `vendor-lock.json`, and
requires re-running the differential and attack suites. A newer upstream release is a decision, not
an automatic upgrade.
