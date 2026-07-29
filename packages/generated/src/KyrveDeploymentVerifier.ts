/**
 * GENERATED FILE — do not edit by hand.
 *
 * Contract:  KyrveDeploymentVerifier
 * Source:    contracts/registry/KyrveDeploymentVerifier.sol
 * Note:      Read-only verification of a live deployment against the registry.
 *
 * Command:   pnpm generate
 * Verify:    pnpm verify:generated  (regenerates and asserts `git diff` is empty)
 * Commit:    eaf759022bbdc05d71dfe85fb968314efe2c49d8
 * Content:   sha256:481fcdab84764e609c42388e6f27d3c2ed49a7e445750c42bb8352b02485c8f0
 *
 * TIMESTAMP POLICY: none is emitted, deliberately. A generation timestamp would change this file
 * on every run with no source change, which would make the diff check above worthless. The commit
 * and content hash change only when the input actually changes.
 */

export const KyrveDeploymentVerifierAbi = [
  {
    "type": "constructor",
    "inputs": [
      {
        "name": "registry",
        "type": "address",
        "internalType": "address"
      }
    ],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "REGISTRY",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "address",
        "internalType": "contract KyrveProtocolRegistry"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "eip1967ImplementationSlot",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "bytes32",
        "internalType": "bytes32"
      }
    ],
    "stateMutability": "pure"
  },
  {
    "type": "function",
    "name": "expectedChainId",
    "inputs": [
      {
        "name": "version",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
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
    "name": "expectedManifestHash",
    "inputs": [
      {
        "name": "version",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "outputs": [
      {
        "name": "",
        "type": "bytes32",
        "internalType": "bytes32"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "expectedMidnightRuntimeHash",
    "inputs": [
      {
        "name": "version",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "outputs": [
      {
        "name": "",
        "type": "bytes32",
        "internalType": "bytes32"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "expectedRelease",
    "inputs": [
      {
        "name": "version",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "outputs": [
      {
        "name": "",
        "type": "bytes32",
        "internalType": "bytes32"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "runtimeCodeHash",
    "inputs": [
      {
        "name": "target",
        "type": "address",
        "internalType": "address"
      }
    ],
    "outputs": [
      {
        "name": "",
        "type": "bytes32",
        "internalType": "bytes32"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "verify",
    "inputs": [],
    "outputs": [
      {
        "name": "report",
        "type": "tuple",
        "internalType": "struct KyrveDeploymentVerifier.VerificationReport",
        "components": [
          {
            "name": "chainMatches",
            "type": "bool",
            "internalType": "bool"
          },
          {
            "name": "midnightCodeMatches",
            "type": "bool",
            "internalType": "bool"
          },
          {
            "name": "noxComputeHasCode",
            "type": "bool",
            "internalType": "bool"
          },
          {
            "name": "noxImplementationMatches",
            "type": "bool",
            "internalType": "bool"
          },
          {
            "name": "osakaAvailable",
            "type": "bool",
            "internalType": "bool"
          },
          {
            "name": "registryConsistent",
            "type": "bool",
            "internalType": "bool"
          },
          {
            "name": "notEmergencyStopped",
            "type": "bool",
            "internalType": "bool"
          },
          {
            "name": "allPassed",
            "type": "bool",
            "internalType": "bool"
          }
        ]
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "verifyVersion",
    "inputs": [
      {
        "name": "version",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "outputs": [
      {
        "name": "report",
        "type": "tuple",
        "internalType": "struct KyrveDeploymentVerifier.VerificationReport",
        "components": [
          {
            "name": "chainMatches",
            "type": "bool",
            "internalType": "bool"
          },
          {
            "name": "midnightCodeMatches",
            "type": "bool",
            "internalType": "bool"
          },
          {
            "name": "noxComputeHasCode",
            "type": "bool",
            "internalType": "bool"
          },
          {
            "name": "noxImplementationMatches",
            "type": "bool",
            "internalType": "bool"
          },
          {
            "name": "osakaAvailable",
            "type": "bool",
            "internalType": "bool"
          },
          {
            "name": "registryConsistent",
            "type": "bool",
            "internalType": "bool"
          },
          {
            "name": "notEmergencyStopped",
            "type": "bool",
            "internalType": "bool"
          },
          {
            "name": "allPassed",
            "type": "bool",
            "internalType": "bool"
          }
        ]
      }
    ],
    "stateMutability": "view"
  }
] as const;
