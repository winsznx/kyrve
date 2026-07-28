import type { HardhatUserConfig } from "hardhat/config";
import hardhatToolboxViem from "@nomicfoundation/hardhat-toolbox-viem";
import noxPlugin from "@iexec-nox/nox-hardhat-plugin";

const config: HardhatUserConfig = {
  plugins: [hardhatToolboxViem, noxPlugin],
  solidity: {
    profiles: {
      default: {
        version: "0.8.36",
        settings: {
          optimizer: { enabled: true, runs: 200 },
          viaIR: true,
          evmVersion: "cancun",
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
