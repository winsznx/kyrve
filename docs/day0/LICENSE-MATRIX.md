# Licence matrix

Retrieved 2026-07-28. Sources are the `LICENSE` files and per-file SPDX headers in the pinned
artifacts themselves, not registry metadata.

> This is a disclosure and planning document, not legal advice. Item L-1 needs a human decision
> before the submission is published.

## 1. Morpho Midnight, pinned release `2026-07-23` (`dbd8d3d5`)

| Scope | Licence | Evidence |
|---|---|---|
| `src/Midnight.sol` (the core, 1018 lines) | **BUSL-1.1** | SPDX header; `grep -rl 'BUSL-1.1' src/` returns exactly this one file |
| All 26 other files under `src/` | GPL-2.0-or-later | SPDX headers |
| `LICENSE` | Business Source License 1.1 | repo root |
| `LICENSE-SECONDARY` | GNU GPL v2 | repo root |

BUSL-1.1 parameters, quoted verbatim from `vendor/midnight/LICENSE`:

- **Licensor:** Morpho Association
- **Licensed Work:** Morpho Midnight, © 2026 Morpho Association
- **Additional Use Grant:** "Any uses listed and defined at `morpho-midnight-license-grants.morpho.eth`"
- **Change Date:** "The earlier of 2030-05-01, or a date specified at `morpho-midnight-license-date.morpho.eth`"
- **Change License:** GNU General Public License v2.0 or later

Operative terms: BUSL-1.1 grants the right to "copy, modify, create derivative works, redistribute,
and make **non-production use**" of the work. Production use requires either a matching Additional
Use Grant or a commercial licence.

## 2. iExec Nox

| Artifact | `package.json` says | Actual `LICENSE` / SPDX | Discrepancy |
|---|---|---|---|
| `@iexec-nox/nox-protocol-contracts@0.2.4` | `MIT` | **BUSL-1.1**, "Additional Use Grant: None" — on `NoxCompute.sol`, `modules/Compute.sol`, `modules/ACL.sol`, `modules/Admin.sol`, `modules/Common.sol`. MIT only on `sdk/Nox.sol`, `interfaces/INoxCompute.sol`, `utils/TypeUtils.sol`, `utils/HandleUtils.sol` | **YES** |
| `@iexec-nox/nox-confidential-contracts@0.2.2` | `MIT` | MIT | no |
| `@iexec-nox/nox-hardhat-plugin@0.1.0` | `MIT` | MIT | no |
| `@iexec-nox/handle@0.1.0-beta.13` | `MIT` | MIT | no |

The package also ships a `DISCLAIMER` that disclaims all warranties and any MiCA / financial
regulatory compliance, and states that the disclaimer survives the Change Date.

**Kyrve imports only `sdk/Nox.sol` (MIT) from that package.** The BUSL-covered modules are the
already-deployed `NoxCompute` implementation, which Kyrve calls but does not redistribute. That is
a materially better position than the Midnight core, which Kyrve must itself deploy.

## 3. Cloudflare and JS toolchain

| Package | Licence |
|---|---|
| `wrangler@4.115.0` | MIT OR Apache-2.0 |
| `@cloudflare/vite-plugin@1.48.0` | MIT |
| `@cloudflare/vitest-pool-workers@0.19.0` | MIT |
| `viem@2.55.10` | MIT |

No copyleft exposure from this layer.

## 4. Consequences for Kyrve

### L-1 — Two BUSL cores versus a hackathon that requires open source (**needs a human decision**)

`hack.md` requires "Complete, viewable, open-source code" in a public repository, and states the
prize "will also cover hosting costs for the dApp for one year" — which implies a deployment that
outlives the judging period.

Two independent constraints apply:

1. **Midnight core is BUSL-1.1** and Kyrve *deploys it itself*. Deploying a replica to a public
   testnet for a hackathon demo is a strong candidate for "non-production use", which BUSL permits
   outright. Running it for a year as a hosted product is a much weaker fit.
2. The Additional Use Grant is not in the repository — it lives at the ENS name
   `morpho-midnight-license-grants.morpho.eth`. **Its contents were not resolved during Day 0 and
   are unknown.** They may already permit exactly this use.

**Required action before submission:** resolve `morpho-midnight-license-grants.morpho.eth` and
`morpho-midnight-license-date.morpho.eth`, record their contents verbatim in the repository, and
state plainly which grant Kyrve relies on. If no grant covers it, contact Morpho Association. Do not
publish an unqualified "open source" claim over a BUSL core.

### L-2 — GPL-2.0-or-later reaches Kyrve's own contracts

`KyrveQuoteRatifier` imports `midnight/interfaces/IRatifier.sol`, and `KyrveSeriesVault` imports
`midnight/interfaces/ICallbacks.sol` and `midnight/libraries/ConstantsLib.sol` — all
GPL-2.0-or-later. Solidity `import` is compile-time source inclusion, and `ConstantsLib` is linked
into the deployed bytecode.

**Decision taken for Day 0:** every Kyrve contract carries `SPDX-License-Identifier:
GPL-2.0-or-later`. This is the conservative, compatible choice and it is already applied in
`contracts/`. Choosing a permissive licence for Kyrve contracts would require a re-derivation of the
interfaces from scratch, which is not worth the risk.

### L-3 — Kyrve's non-contract code

Apps, packages, workers and SDK contain no GPL-derived source and may carry a permissive licence.
Keep the boundary explicit in `LICENSE` so the GPL obligation is visibly scoped to `contracts/`.

### L-4 — Deployment labelling

PRD §3.1 already requires the replica be labelled a Sepolia testnet replica and never presented as
an official Morpho deployment. The BUSL trademark clause reinforces this: the licence "does not
grant you any right in any trademark or logo of Licensor". Do not use Morpho branding.
