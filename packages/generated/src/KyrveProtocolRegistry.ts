/**
 * GENERATED FILE — do not edit by hand.
 *
 * Contract:  KyrveProtocolRegistry
 * Source:    contracts/registry/KyrveProtocolRegistry.sol
 * Note:      On-chain anchor for the supported Midnight and Nox deployment.
 *
 * Command:   pnpm generate
 * Verify:    pnpm verify:generated  (regenerates and asserts `git diff` is empty)
 * Commit:    eaf759022bbdc05d71dfe85fb968314efe2c49d8
 * Content:   sha256:e6459b413f5591fe55b93ad8ad1fe77992dd4b4fb0c6686101aa8c648df5260e
 *
 * TIMESTAMP POLICY: none is emitted, deliberately. A generation timestamp would change this file
 * on every run with no source change, which would make the diff check above worthless. The commit
 * and content hash change only when the input actually changes.
 */

export const KyrveProtocolRegistryAbi = [
  {
    "type": "constructor",
    "inputs": [
      {
        "name": "initialAdmin",
        "type": "address",
        "internalType": "address"
      }
    ],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "acceptAdminTransfer",
    "inputs": [],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "admin",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "address",
        "internalType": "address"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "beginAdminTransfer",
    "inputs": [
      {
        "name": "newAdmin",
        "type": "address",
        "internalType": "address"
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "confidentialWrapper",
    "inputs": [
      {
        "name": "underlying",
        "type": "address",
        "internalType": "address"
      }
    ],
    "outputs": [
      {
        "name": "wrapper",
        "type": "address",
        "internalType": "address"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "currentDeployment",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "tuple",
        "internalType": "struct KyrveProtocolRegistry.Deployment",
        "components": [
          {
            "name": "chainId",
            "type": "uint256",
            "internalType": "uint256"
          },
          {
            "name": "midnight",
            "type": "address",
            "internalType": "address"
          },
          {
            "name": "midnightRelease",
            "type": "bytes32",
            "internalType": "bytes32"
          },
          {
            "name": "midnightRuntimeHash",
            "type": "bytes32",
            "internalType": "bytes32"
          },
          {
            "name": "noxCompute",
            "type": "address",
            "internalType": "address"
          },
          {
            "name": "noxImplementation",
            "type": "address",
            "internalType": "address"
          },
          {
            "name": "noxImplementationHash",
            "type": "bytes32",
            "internalType": "bytes32"
          },
          {
            "name": "kyrveVersion",
            "type": "bytes32",
            "internalType": "bytes32"
          },
          {
            "name": "manifestHash",
            "type": "bytes32",
            "internalType": "bytes32"
          },
          {
            "name": "licenceDisclosureHash",
            "type": "bytes32",
            "internalType": "bytes32"
          },
          {
            "name": "osakaProbe",
            "type": "address",
            "internalType": "address"
          },
          {
            "name": "registeredAt",
            "type": "uint64",
            "internalType": "uint64"
          },
          {
            "name": "exists",
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
    "name": "deployment",
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
        "type": "tuple",
        "internalType": "struct KyrveProtocolRegistry.Deployment",
        "components": [
          {
            "name": "chainId",
            "type": "uint256",
            "internalType": "uint256"
          },
          {
            "name": "midnight",
            "type": "address",
            "internalType": "address"
          },
          {
            "name": "midnightRelease",
            "type": "bytes32",
            "internalType": "bytes32"
          },
          {
            "name": "midnightRuntimeHash",
            "type": "bytes32",
            "internalType": "bytes32"
          },
          {
            "name": "noxCompute",
            "type": "address",
            "internalType": "address"
          },
          {
            "name": "noxImplementation",
            "type": "address",
            "internalType": "address"
          },
          {
            "name": "noxImplementationHash",
            "type": "bytes32",
            "internalType": "bytes32"
          },
          {
            "name": "kyrveVersion",
            "type": "bytes32",
            "internalType": "bytes32"
          },
          {
            "name": "manifestHash",
            "type": "bytes32",
            "internalType": "bytes32"
          },
          {
            "name": "licenceDisclosureHash",
            "type": "bytes32",
            "internalType": "bytes32"
          },
          {
            "name": "osakaProbe",
            "type": "address",
            "internalType": "address"
          },
          {
            "name": "registeredAt",
            "type": "uint64",
            "internalType": "uint64"
          },
          {
            "name": "exists",
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
    "name": "emergencyStopped",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "bool",
        "internalType": "bool"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "isSupportedMidnight",
    "inputs": [
      {
        "name": "midnight",
        "type": "address",
        "internalType": "address"
      }
    ],
    "outputs": [
      {
        "name": "",
        "type": "bool",
        "internalType": "bool"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "isSupportedNoxCompute",
    "inputs": [
      {
        "name": "noxCompute",
        "type": "address",
        "internalType": "address"
      }
    ],
    "outputs": [
      {
        "name": "",
        "type": "bool",
        "internalType": "bool"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "latestVersion",
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
    "name": "pendingAdmin",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "address",
        "internalType": "address"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "registerDeployment",
    "inputs": [
      {
        "name": "version",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "d",
        "type": "tuple",
        "internalType": "struct KyrveProtocolRegistry.Deployment",
        "components": [
          {
            "name": "chainId",
            "type": "uint256",
            "internalType": "uint256"
          },
          {
            "name": "midnight",
            "type": "address",
            "internalType": "address"
          },
          {
            "name": "midnightRelease",
            "type": "bytes32",
            "internalType": "bytes32"
          },
          {
            "name": "midnightRuntimeHash",
            "type": "bytes32",
            "internalType": "bytes32"
          },
          {
            "name": "noxCompute",
            "type": "address",
            "internalType": "address"
          },
          {
            "name": "noxImplementation",
            "type": "address",
            "internalType": "address"
          },
          {
            "name": "noxImplementationHash",
            "type": "bytes32",
            "internalType": "bytes32"
          },
          {
            "name": "kyrveVersion",
            "type": "bytes32",
            "internalType": "bytes32"
          },
          {
            "name": "manifestHash",
            "type": "bytes32",
            "internalType": "bytes32"
          },
          {
            "name": "licenceDisclosureHash",
            "type": "bytes32",
            "internalType": "bytes32"
          },
          {
            "name": "osakaProbe",
            "type": "address",
            "internalType": "address"
          },
          {
            "name": "registeredAt",
            "type": "uint64",
            "internalType": "uint64"
          },
          {
            "name": "exists",
            "type": "bool",
            "internalType": "bool"
          }
        ]
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "setConfidentialWrapper",
    "inputs": [
      {
        "name": "underlying",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "wrapper",
        "type": "address",
        "internalType": "address"
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "setEmergencyStopped",
    "inputs": [
      {
        "name": "stopped",
        "type": "bool",
        "internalType": "bool"
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "event",
    "name": "AdminTransferStarted",
    "inputs": [
      {
        "name": "from",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      },
      {
        "name": "to",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "AdminTransferred",
    "inputs": [
      {
        "name": "from",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      },
      {
        "name": "to",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "ConfidentialWrapperSet",
    "inputs": [
      {
        "name": "underlying",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      },
      {
        "name": "wrapper",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "DeploymentRegistered",
    "inputs": [
      {
        "name": "version",
        "type": "uint256",
        "indexed": true,
        "internalType": "uint256"
      },
      {
        "name": "manifestHash",
        "type": "bytes32",
        "indexed": false,
        "internalType": "bytes32"
      },
      {
        "name": "midnight",
        "type": "address",
        "indexed": false,
        "internalType": "address"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "EmergencyStopSet",
    "inputs": [
      {
        "name": "stopped",
        "type": "bool",
        "indexed": false,
        "internalType": "bool"
      }
    ],
    "anonymous": false
  },
  {
    "type": "error",
    "name": "AlreadyRegistered",
    "inputs": [
      {
        "name": "version",
        "type": "uint256",
        "internalType": "uint256"
      }
    ]
  },
  {
    "type": "error",
    "name": "NotAdmin",
    "inputs": [
      {
        "name": "caller",
        "type": "address",
        "internalType": "address"
      }
    ]
  },
  {
    "type": "error",
    "name": "NotPendingAdmin",
    "inputs": [
      {
        "name": "caller",
        "type": "address",
        "internalType": "address"
      }
    ]
  },
  {
    "type": "error",
    "name": "UnknownVersion",
    "inputs": [
      {
        "name": "version",
        "type": "uint256",
        "internalType": "uint256"
      }
    ]
  },
  {
    "type": "error",
    "name": "WrongChain",
    "inputs": [
      {
        "name": "expected",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "actual",
        "type": "uint256",
        "internalType": "uint256"
      }
    ]
  },
  {
    "type": "error",
    "name": "ZeroAddress",
    "inputs": [
      {
        "name": "field",
        "type": "string",
        "internalType": "string"
      }
    ]
  }
] as const;
