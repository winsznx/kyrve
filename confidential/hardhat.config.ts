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
  paths: {
    sources: "./contracts",
    tests: { nodejs: "./test" },
  },
};

export default config;
