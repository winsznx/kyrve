---
name: nox-docs
description: Look up verified iExec Nox behaviour - encrypted primitives, fromExternal binding, ACL, public decryption, async lifecycle, ERC-7984, networks and local dev stack. Use before writing any confidential contract or client code.
---

# iExec Nox source lookup

**Package source outranks the documentation.** The docs are explicitly marked "under development",
several pages render addresses client-side (so fetched HTML contains none), and the registry licence
metadata is wrong. Read the published tarball.

## Official sources — use only these

- `https://docs.iex.ec/` and `https://docs.iex.ec/nox-protocol/getting-started/welcome`
- `https://docs.noxprotocol.io/`
- `https://www.npmjs.com/org/iexec-nox?activeTab=packages`
- `https://github.com/iExec-Nox/nox-protocol-contracts`
- `https://github.com/iExec-Nox/nox-confidential-contracts`
- `https://github.com/iExec-Nox/nox-hardhat-plugin`
- `https://github.com/iExec-Nox/nox-hardhat-starter`
- The handle SDK repository, discovered from package metadata:
  `npm view @iexec-nox/handle repository`

## Procedure

1. **Check `.claude/rules/nox.md` first.** The complete arithmetic surface, the missing operations,
   the silent failure modes and the async lifecycle are already verified there.

2. **Read the pinned package source.** Versions are in `source-lock.json`.
   ```bash
   npm pack @iexec-nox/nox-protocol-contracts@0.2.4 && tar xzf *.tgz
   # primitives + ACL wrappers:
   less package/contracts/sdk/Nox.sol
   # operator enum, proof layouts, event list:
   less package/contracts/interfaces/INoxCompute.sol
   ```
   For ERC-7984 use `@iexec-nox/nox-confidential-contracts@0.2.2`:
   `contracts/token/ERC7984*.sol` and `contracts/token/extensions/ERC20ToERC7984Wrapper*.sol`.

3. **To answer "does operation X exist?", enumerate rather than search for X:**
   ```bash
   grep -oE '^\s*function [a-zA-Z0-9_]+' package/contracts/sdk/Nox.sol | awk '{print $2}' | sort -u
   ```
   A negative result from a targeted grep is weak evidence; the full list is conclusive.

4. **Check the repository for behaviour not on npm.** Published versions lag `main`, and
   `nox-protocol-contracts` HEAD contains fixes absent from `0.2.4`. Never assume the deployed
   implementation matches either — confirm against chain state.

5. **Confirm deployment facts on-chain, not from the docs.**
   ```bash
   N=0x24Ef36Ec5b626D7DCD09a98F3083c2758F0F77bF   # NoxCompute proxy, Sepolia
   cast call $N "gateway()(address)" --rpc-url "$SEPOLIA_RPC"
   cast call $N "proofExpirationDuration()(uint256)" --rpc-url "$SEPOLIA_RPC"
   ```

6. **Read `nox-hardhat-starter`** for working end-to-end usage, and the plugin's
   `waitForHandlesResolved` for the real handle-readiness endpoint.

## Rules

- Undocumented behaviour requires **source inspection plus a test**. Never infer it.
- Never assume an operation exists because an equivalent exists in another FHE library. Nox has no
  boolean ops, no `min`/`max`, no `rem`, no shifts, and only five encrypted types.
- Never claim a gas cost — no official figures are published, and there is no batch API. Measure it.
- Local test-gateway keys are local-only infrastructure and must be labelled as such.
- Nox is testnet-only. There is no mainnet. Do not imply otherwise.
