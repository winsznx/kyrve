# Morpho Midnight licence position

> **Kyrve is open-source software integrating an unmodified, source-available Morpho Midnight
> testnet replica under its applicable non-production licence.**

That sentence is exact and every clause of it is load-bearing. This document explains each one, and
`pnpm verify:licence` enforces the parts that can be checked mechanically.

## Midnight is BUSL-1.1. It is not open source.

| Scope | Licence |
|---|---|
| `vendor/midnight/src/Midnight.sol` — the core, 1018 lines | **BUSL-1.1** |
| All 26 other files under `src/` | GPL-2.0-or-later |

BUSL-1.1 parameters, verbatim from `vendor/midnight/LICENSE`:

- **Licensor:** Morpho Association
- **Licensed Work:** Morpho Midnight, © 2026 Morpho Association
- **Additional Use Grant:** "Any uses listed and defined at `morpho-midnight-license-grants.morpho.eth`"
- **Change Date:** the earlier of 2030-05-01, or a date at `morpho-midnight-license-date.morpho.eth`
- **Change License:** GNU General Public License v2.0 or later

BUSL-1.1 grants the right to copy, modify, create derivative works, redistribute, and make
**non-production use**. Production use requires a matching Additional Use Grant or a commercial
licence.

## The Additional Use Grant is empty

Both ENS names were resolved on 2026-07-28 against mainnet. They resolve to the ENS public resolver
`0x4976fb03C32e5B8cfe2b6cCB31c09Ba78EBaBa41` and carry **no contenthash and no text records across
17 candidate keys**.

There is no additional grant. Only BUSL's default terms apply.

This is recorded as a **fact**, not an assumption, in `vendor-lock.json` and `source-lock.json`.

## What follows, and is enforced

1. **Kyrve's Sepolia deployment is a non-production testnet replica.** Not an official Morpho
   deployment, not maintained by Morpho Association, no Morpho branding — BUSL-1.1 grants no
   trademark or logo rights.
2. **Kyrve never describes Midnight as open source.** `verify:licence` fails the build on any file
   that does, checking polarity so a *denial* is not mistaken for a claim.
3. **The deployment manifest validator rejects** any manifest whose `disclosure` field omits the
   non-production qualification. Tested.
4. **Production operation beyond non-production use requires a separate grant** from Morpho
   Association. That is a legal decision, not an engineering one, and it is open.

## Kyrve's own licences

| Scope | Licence | Why |
|---|---|---|
| `contracts/` | GPL-2.0-or-later | Kyrve contracts `import` GPL-2.0-or-later Midnight interfaces, and `ConstantsLib` is linked into deployed bytecode. Solidity `import` is compile-time source inclusion. |
| `packages/`, `workers/`, `apps/`, `scripts/` | MIT | No GPL-derived source. MIT over Apache-2.0 deliberately: MIT is GPL-2.0-compatible, so the boundary above never becomes a compatibility question if code moves. |

All 16 Kyrve Solidity files are checked for the SPDX identifier on every run.

## iExec Nox — the metadata is wrong

`@iexec-nox/nox-protocol-contracts@0.2.4` declares `MIT` in `package.json` while its core modules
(`NoxCompute.sol`, `modules/Compute.sol`, `modules/ACL.sol`, `modules/Admin.sol`,
`modules/Common.sol`) are **BUSL-1.1 with "Additional Use Grant: None"**. Only `sdk/Nox.sol`,
`interfaces/INoxCompute.sol` and `utils/*` are genuinely MIT.

Kyrve imports **only** the MIT files. The BUSL modules are already-deployed infrastructure Kyrve
calls and never redistributes — materially better than Midnight, which Kyrve deploys itself.

## What remains open

The hackathon requires open-source code and states the prize covers a year of hosting. Deploying a
replica to a public testnet for judging is a strong candidate for "non-production use", which BUSL
permits outright. Running it as a hosted product for a year is a much weaker fit.

**Action, unchanged since Day 0:** contact Morpho Association for a grant covering hosted operation
beyond the hackathon. This does not block engineering and has never done so.
