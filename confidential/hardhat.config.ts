import noxPlugin from "@iexec-nox/nox-hardhat-plugin";
import hardhatToolboxViem from "@nomicfoundation/hardhat-toolbox-viem";
import type { HardhatUserConfig } from "hardhat/config";

/**
 * The Kyrve confidential contract layer.
 *
 * WHY THIS IS A SEPARATE COMPILATION UNIT FROM `contracts/`.
 *
 * `@iexec-nox/nox-protocol-contracts@0.2.4` declares `pragma solidity ^0.8.35` across all nine of
 * its sources. The Midnight substrate is pinned at solc **0.8.34** so its runtime bytecode stays
 * byte-comparable with the pinned release (PRD v1.1 A-1, `.claude/rules/contracts.md`). Those two
 * constraints are mutually exclusive, so the confidential layer gets its own compiler and its own
 * project rather than either being silently relaxed. Recorded as delta Q-1.
 *
 * WHY HARDHAT AND NOT FOUNDRY. Every Nox primitive is an external call into the NoxCompute proxy,
 * whose results are computed off chain by the KMS, ingestor and runner. Foundry cannot drive that
 * stack, and `vm.etch`-ing a fake NoxCompute would be a mocked confidentiality path — forbidden.
 * `@iexec-nox/nox-hardhat-plugin` boots the real stack, so every test in `test/` runs against real
 * encrypted handles and real gateway proofs.
 */
const config: HardhatUserConfig = {
  plugins: [hardhatToolboxViem, noxPlugin],
  solidity: {
    profiles: {
      default: {
        compilers: [
          {
            version: "0.8.36",
            settings: {
              optimizer: { enabled: true, runs: 200 },
              viaIR: true,
              // Ethereum Sepolia is on Osaka (proven in docs/day0/evidence/sepolia-osaka.md), so
              // the same artifact deploys locally and on Sepolia. One bytecode, both environments.
              evmVersion: "osaka",
              metadata: { bytecodeHash: "none" },
            },
          },
        ],
        /**
         * ONE FILE COMPILES DIFFERENTLY, AND ONLY BECAUSE IT HAS TO.
         *
         * `NoxCurveEngine` at `runs: 200` produces 25,040 bytes of runtime code, 464 over the
         * EIP-170 limit of 24,576. Sepolia refused it with `CreateContractSizeLimit`. Nothing
         * local had caught it: a Hardhat node allows unlimited contract size, so the entire suite
         * — every demonstration, the full 16 x 128 benchmark — ran green against a contract that
         * could not be deployed to any real chain. Recorded as delta R-10, and `verify:phase3`
         * now measures every deployable artifact against EIP-170 so this cannot recur silently.
         *
         * `runs: 1` tells the optimizer to favour deployment size over per-call gas, which is the
         * correct trade for a contract deployed once and whose hot loop is dominated by external
         * calls into NoxCompute rather than by local arithmetic.
         *
         * The override is scoped to this ONE file deliberately. Changing the profile globally
         * would alter the bytecode of the five Phase 2 contracts already deployed and verified on
         * Sepolia, so the repository would stop reproducing what is actually on chain.
         */
        overrides: {
          "contracts/NoxCurveEngine.sol": {
            version: "0.8.36",
            settings: {
              optimizer: { enabled: true, runs: 1 },
              viaIR: true,
              evmVersion: "osaka",
              metadata: { bytecodeHash: "none" },
            },
          },
        },
      },
    },
  },
  networks: {
    /**
     * The Nox plugin's own node, overridden. Its `withInjectedNetworks` spreads user entries LAST,
     * so naming `noxHost` here replaces the plugin's defaults rather than sitting beside them.
     *
     * ────────────────────────────────────────────────────────────────────────────────────────
     * BOTH OF THESE EXIST BECAUSE THE DEFAULTS HID A REAL FAILURE
     * ────────────────────────────────────────────────────────────────────────────────────────
     *
     * `allowUnlimitedContractSize` STAYS TRUE, and that is the plugin's choice rather than ours.
     * It is why `NoxCurveEngine` compiled to 25,040 bytes — 464 over EIP-170 — and the entire
     * suite ran green against a contract Sepolia then refused with `CreateContractSizeLimit`.
     *
     * Setting it to `false` was tried and reverted: the node then cannot deploy NoxCompute itself,
     * which is over the limit and is the reason the plugin relaxes it. So the local node CANNOT be
     * made to enforce EIP-170 on Kyrve's contracts without breaking the stack they are tested
     * against, and the check has to live outside it. That is `verify:contract-size`, which
     * measures every compiled artifact, and `verify:curve`, which measures the code the CHAIN
     * returned. Delta R-10.
     *
     * `allowBlocksWithSameTimestamp` — a Hardhat node advances `block.timestamp` by at least a
     * second per mined block, and this suite mines thousands: the 16 x 128 benchmark alone is
     * roughly 700 transactions, because `INoxCompute` has no batch entry point and each of sixteen
     * providers needs 36 separate ACL grants. Once the chain clock is more than 3,600 seconds
     * ahead of wall clock, every gateway proof looks expired to `validateInputProof`, which
     * compares a `createdAt` stamped from the GATEWAY's real clock against `block.timestamp`. The
     * failure appeared only in the last two test files, only on a full-suite run, and only after
     * the benchmark was added. It is an artefact of on-demand mining, not a product defect: on any
     * real chain block time tracks wall clock, and the Sepolia smoke test round-tripped nineteen
     * proofs without going near it. Delta R-12.
     */
    noxHost: {
      type: "edr-simulated",
      chainType: "op",
      allowUnlimitedContractSize: true,
      allowBlocksWithSameTimestamp: true,
    },
  },
  paths: {
    sources: "./contracts",
    tests: { nodejs: "./test" },
  },
};

export default config;
