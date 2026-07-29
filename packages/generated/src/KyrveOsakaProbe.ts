/**
 * GENERATED FILE — do not edit by hand.
 *
 * Contract:  KyrveOsakaProbe
 * Source:    contracts/registry/KyrveOsakaProbe.sol
 * Note:      Permanent on-chain CLZ proof that the host chain executes Osaka.
 *
 * Command:   pnpm generate
 * Verify:    pnpm verify:generated  (regenerates and asserts `git diff` is empty)
 * Pinned:    Midnight 2026-07-23 @ dbd8d3d54d324a03df9f06d3c77d50a7bd1e09a0
 * Content:   sha256:aa2a9218254be5712c2d9fdc65c757bbe483f66ee418996e41c6e8c1fa30e1ee
 *
 * TIMESTAMP POLICY: none is emitted, deliberately. A generation timestamp would change this file
 * on every run with no source change, which would make the diff check above worthless. The pinned
 * release and content hash change only when the input actually changes.
 */

export const KyrveOsakaProbeAbi = [
  {
    "type": "function",
    "name": "assertOsaka",
    "inputs": [],
    "outputs": [],
    "stateMutability": "pure"
  },
  {
    "type": "function",
    "name": "chainId",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "clz",
    "inputs": [
      {
        "name": "x",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "outputs": [
      {
        "name": "result",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "stateMutability": "pure"
  },
  {
    "type": "function",
    "name": "verifyOsaka",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "bool",
        "internalType": "bool"
      }
    ],
    "stateMutability": "pure"
  },
  {
    "type": "error",
    "name": "OsakaNotAvailable",
    "inputs": []
  }
] as const;
