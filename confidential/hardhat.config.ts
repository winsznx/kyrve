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
        version: "0.8.36",
        settings: {
          optimizer: { enabled: true, runs: 200 },
          viaIR: true,
          // Ethereum Sepolia is on Osaka (proven in docs/day0/evidence/sepolia-osaka.md), so the
          // same artifact deploys locally and on Sepolia. One bytecode, both environments.
          evmVersion: "osaka",
          metadata: { bytecodeHash: "none" },
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
