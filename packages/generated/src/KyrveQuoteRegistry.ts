/**
 * GENERATED FILE — do not edit by hand.
 *
 * Contract:  KyrveQuoteRegistry
 * Source:    contracts/kyrve/KyrveQuoteRegistry.sol
 * Note:      The one quote lifecycle both enforcement points read.
 *
 * Command:   pnpm generate
 * Verify:    pnpm verify:generated  (regenerates and asserts `git diff` is empty)
 * Pinned:    Midnight 2026-07-23 @ dbd8d3d54d324a03df9f06d3c77d50a7bd1e09a0
 * Content:   sha256:27ec9bc78f1a1eec57c1e6293c82d70260d5a26637f3df0622373e7d14fe4477
 *
 * TIMESTAMP POLICY: none is emitted, deliberately. A generation timestamp would change this file
 * on every run with no source change, which would make the diff check above worthless. The pinned
 * release and content hash change only when the input actually changes.
 */

export const KyrveQuoteRegistryAbi = [
  {
    "type": "constructor",
    "inputs": [
      {
        "name": "midnight",
        "type": "address",
        "internalType": "address"
      }
    ],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "DEPLOYER",
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
    "name": "DEPLOYMENT_ID",
    "inputs": [],
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
    "name": "MIDNIGHT",
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
    "name": "activate",
    "inputs": [
      {
        "name": "quoteId",
        "type": "bytes32",
        "internalType": "bytes32"
      },
      {
        "name": "execution",
        "type": "tuple",
        "internalType": "struct QuoteExecution",
        "components": [
          {
            "name": "offerHash",
            "type": "bytes32",
            "internalType": "bytes32"
          },
          {
            "name": "marketId",
            "type": "bytes32",
            "internalType": "bytes32"
          },
          {
            "name": "exactUnits",
            "type": "uint128",
            "internalType": "uint128"
          },
          {
            "name": "expectedBuyerAssets",
            "type": "uint128",
            "internalType": "uint128"
          },
          {
            "name": "maxPendingFee",
            "type": "uint128",
            "internalType": "uint128"
          },
          {
            "name": "expiry",
            "type": "uint40",
            "internalType": "uint40"
          },
          {
            "name": "activatedAt",
            "type": "uint40",
            "internalType": "uint40"
          },
          {
            "name": "status",
            "type": "uint8",
            "internalType": "enum QuoteStatus"
          },
          {
            "name": "taker",
            "type": "address",
            "internalType": "address"
          },
          {
            "name": "vault",
            "type": "address",
            "internalType": "address"
          },
          {
            "name": "ratifier",
            "type": "address",
            "internalType": "address"
          }
        ]
      },
      {
        "name": "provenance",
        "type": "tuple",
        "internalType": "struct QuoteProvenance",
        "components": [
          {
            "name": "epochId",
            "type": "bytes32",
            "internalType": "bytes32"
          },
          {
            "name": "graphRoot",
            "type": "bytes32",
            "internalType": "bytes32"
          },
          {
            "name": "requestId",
            "type": "bytes32",
            "internalType": "bytes32"
          },
          {
            "name": "universeId",
            "type": "bytes32",
            "internalType": "bytes32"
          },
          {
            "name": "deploymentId",
            "type": "bytes32",
            "internalType": "bytes32"
          },
          {
            "name": "marketStructHash",
            "type": "bytes32",
            "internalType": "bytes32"
          },
          {
            "name": "aggregateFillAmount",
            "type": "uint256",
            "internalType": "uint256"
          },
          {
            "name": "tick",
            "type": "int24",
            "internalType": "int24"
          },
          {
            "name": "marketIndex",
            "type": "uint8",
            "internalType": "uint8"
          },
          {
            "name": "rateIndex",
            "type": "uint8",
            "internalType": "uint8"
          },
          {
            "name": "leafIndex",
            "type": "uint16",
            "internalType": "uint16"
          }
        ]
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "activator",
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
    "name": "bindActivator",
    "inputs": [
      {
        "name": "activator_",
        "type": "address",
        "internalType": "address"
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "bindExpiryController",
    "inputs": [
      {
        "name": "expiryController_",
        "type": "address",
        "internalType": "address"
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "executionOf",
    "inputs": [
      {
        "name": "quoteId",
        "type": "bytes32",
        "internalType": "bytes32"
      }
    ],
    "outputs": [
      {
        "name": "",
        "type": "tuple",
        "internalType": "struct QuoteExecution",
        "components": [
          {
            "name": "offerHash",
            "type": "bytes32",
            "internalType": "bytes32"
          },
          {
            "name": "marketId",
            "type": "bytes32",
            "internalType": "bytes32"
          },
          {
            "name": "exactUnits",
            "type": "uint128",
            "internalType": "uint128"
          },
          {
            "name": "expectedBuyerAssets",
            "type": "uint128",
            "internalType": "uint128"
          },
          {
            "name": "maxPendingFee",
            "type": "uint128",
            "internalType": "uint128"
          },
          {
            "name": "expiry",
            "type": "uint40",
            "internalType": "uint40"
          },
          {
            "name": "activatedAt",
            "type": "uint40",
            "internalType": "uint40"
          },
          {
            "name": "status",
            "type": "uint8",
            "internalType": "enum QuoteStatus"
          },
          {
            "name": "taker",
            "type": "address",
            "internalType": "address"
          },
          {
            "name": "vault",
            "type": "address",
            "internalType": "address"
          },
          {
            "name": "ratifier",
            "type": "address",
            "internalType": "address"
          }
        ]
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "expiryController",
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
    "name": "markConsumed",
    "inputs": [
      {
        "name": "quoteId",
        "type": "bytes32",
        "internalType": "bytes32"
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "provenanceOf",
    "inputs": [
      {
        "name": "quoteId",
        "type": "bytes32",
        "internalType": "bytes32"
      }
    ],
    "outputs": [
      {
        "name": "",
        "type": "tuple",
        "internalType": "struct QuoteProvenance",
        "components": [
          {
            "name": "epochId",
            "type": "bytes32",
            "internalType": "bytes32"
          },
          {
            "name": "graphRoot",
            "type": "bytes32",
            "internalType": "bytes32"
          },
          {
            "name": "requestId",
            "type": "bytes32",
            "internalType": "bytes32"
          },
          {
            "name": "universeId",
            "type": "bytes32",
            "internalType": "bytes32"
          },
          {
            "name": "deploymentId",
            "type": "bytes32",
            "internalType": "bytes32"
          },
          {
            "name": "marketStructHash",
            "type": "bytes32",
            "internalType": "bytes32"
          },
          {
            "name": "aggregateFillAmount",
            "type": "uint256",
            "internalType": "uint256"
          },
          {
            "name": "tick",
            "type": "int24",
            "internalType": "int24"
          },
          {
            "name": "marketIndex",
            "type": "uint8",
            "internalType": "uint8"
          },
          {
            "name": "rateIndex",
            "type": "uint8",
            "internalType": "uint8"
          },
          {
            "name": "leafIndex",
            "type": "uint16",
            "internalType": "uint16"
          }
        ]
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "quoteOfEpoch",
    "inputs": [
      {
        "name": "epochId",
        "type": "bytes32",
        "internalType": "bytes32"
      }
    ],
    "outputs": [
      {
        "name": "quoteId",
        "type": "bytes32",
        "internalType": "bytes32"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "requireKnown",
    "inputs": [
      {
        "name": "quoteId",
        "type": "bytes32",
        "internalType": "bytes32"
      }
    ],
    "outputs": [
      {
        "name": "",
        "type": "tuple",
        "internalType": "struct QuoteExecution",
        "components": [
          {
            "name": "offerHash",
            "type": "bytes32",
            "internalType": "bytes32"
          },
          {
            "name": "marketId",
            "type": "bytes32",
            "internalType": "bytes32"
          },
          {
            "name": "exactUnits",
            "type": "uint128",
            "internalType": "uint128"
          },
          {
            "name": "expectedBuyerAssets",
            "type": "uint128",
            "internalType": "uint128"
          },
          {
            "name": "maxPendingFee",
            "type": "uint128",
            "internalType": "uint128"
          },
          {
            "name": "expiry",
            "type": "uint40",
            "internalType": "uint40"
          },
          {
            "name": "activatedAt",
            "type": "uint40",
            "internalType": "uint40"
          },
          {
            "name": "status",
            "type": "uint8",
            "internalType": "enum QuoteStatus"
          },
          {
            "name": "taker",
            "type": "address",
            "internalType": "address"
          },
          {
            "name": "vault",
            "type": "address",
            "internalType": "address"
          },
          {
            "name": "ratifier",
            "type": "address",
            "internalType": "address"
          }
        ]
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "retire",
    "inputs": [
      {
        "name": "quoteId",
        "type": "bytes32",
        "internalType": "bytes32"
      },
      {
        "name": "terminal",
        "type": "uint8",
        "internalType": "enum QuoteStatus"
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "statusOf",
    "inputs": [
      {
        "name": "quoteId",
        "type": "bytes32",
        "internalType": "bytes32"
      }
    ],
    "outputs": [
      {
        "name": "",
        "type": "uint8",
        "internalType": "enum QuoteStatus"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "event",
    "name": "ActivatorBound",
    "inputs": [
      {
        "name": "activator",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "ExpiryControllerBound",
    "inputs": [
      {
        "name": "expiryController",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "QuoteActivated",
    "inputs": [
      {
        "name": "quoteId",
        "type": "bytes32",
        "indexed": true,
        "internalType": "bytes32"
      },
      {
        "name": "epochId",
        "type": "bytes32",
        "indexed": true,
        "internalType": "bytes32"
      },
      {
        "name": "vault",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      },
      {
        "name": "offerHash",
        "type": "bytes32",
        "indexed": false,
        "internalType": "bytes32"
      },
      {
        "name": "exactUnits",
        "type": "uint128",
        "indexed": false,
        "internalType": "uint128"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "QuoteConsumed",
    "inputs": [
      {
        "name": "quoteId",
        "type": "bytes32",
        "indexed": true,
        "internalType": "bytes32"
      },
      {
        "name": "vault",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      },
      {
        "name": "exactUnits",
        "type": "uint128",
        "indexed": false,
        "internalType": "uint128"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "QuoteRetired",
    "inputs": [
      {
        "name": "quoteId",
        "type": "bytes32",
        "indexed": true,
        "internalType": "bytes32"
      },
      {
        "name": "vault",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      },
      {
        "name": "status",
        "type": "uint8",
        "indexed": false,
        "internalType": "enum QuoteStatus"
      }
    ],
    "anonymous": false
  },
  {
    "type": "error",
    "name": "ActivatorAlreadyBound",
    "inputs": [
      {
        "name": "existing",
        "type": "address",
        "internalType": "address"
      }
    ]
  },
  {
    "type": "error",
    "name": "ActivatorNotBound",
    "inputs": []
  },
  {
    "type": "error",
    "name": "EpochAlreadyQuoted",
    "inputs": [
      {
        "name": "epochId",
        "type": "bytes32",
        "internalType": "bytes32"
      },
      {
        "name": "quoteId",
        "type": "bytes32",
        "internalType": "bytes32"
      }
    ]
  },
  {
    "type": "error",
    "name": "ExpiryControllerAlreadyBound",
    "inputs": [
      {
        "name": "existing",
        "type": "address",
        "internalType": "address"
      }
    ]
  },
  {
    "type": "error",
    "name": "NotActivator",
    "inputs": [
      {
        "name": "caller",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "expected",
        "type": "address",
        "internalType": "address"
      }
    ]
  },
  {
    "type": "error",
    "name": "NotDeployer",
    "inputs": [
      {
        "name": "caller",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "expected",
        "type": "address",
        "internalType": "address"
      }
    ]
  },
  {
    "type": "error",
    "name": "NotQuoteVault",
    "inputs": [
      {
        "name": "quoteId",
        "type": "bytes32",
        "internalType": "bytes32"
      },
      {
        "name": "caller",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "expected",
        "type": "address",
        "internalType": "address"
      }
    ]
  },
  {
    "type": "error",
    "name": "NotTerminalStatus",
    "inputs": [
      {
        "name": "status",
        "type": "uint8",
        "internalType": "uint8"
      }
    ]
  },
  {
    "type": "error",
    "name": "QuoteAlreadyActivated",
    "inputs": [
      {
        "name": "quoteId",
        "type": "bytes32",
        "internalType": "bytes32"
      },
      {
        "name": "status",
        "type": "uint8",
        "internalType": "uint8"
      }
    ]
  },
  {
    "type": "error",
    "name": "QuoteNotExecutable",
    "inputs": [
      {
        "name": "quoteId",
        "type": "bytes32",
        "internalType": "bytes32"
      },
      {
        "name": "status",
        "type": "uint8",
        "internalType": "uint8"
      }
    ]
  },
  {
    "type": "error",
    "name": "UnknownQuote",
    "inputs": [
      {
        "name": "quoteId",
        "type": "bytes32",
        "internalType": "bytes32"
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
  },
  {
    "type": "error",
    "name": "ZeroValue",
    "inputs": [
      {
        "name": "field",
        "type": "string",
        "internalType": "string"
      }
    ]
  }
] as const;
