/**
 * GENERATED FILE — do not edit by hand.
 *
 * Contract:  KyrveExactFillVault
 * Source:    contracts/integration/KyrveExactFillVault.sol
 * Note:      Exact-fill regression harness. NOT the production series vault.
 *
 * Command:   pnpm generate
 * Verify:    pnpm verify:generated  (regenerates and asserts `git diff` is empty)
 * Pinned:    Midnight 2026-07-23 @ dbd8d3d54d324a03df9f06d3c77d50a7bd1e09a0
 * Content:   sha256:d8983debec7ce3dd244c82c74fbbf475e890bd8ae8bdebd37109d1f61c85e394
 *
 * TIMESTAMP POLICY: none is emitted, deliberately. A generation timestamp would change this file
 * on every run with no source change, which would make the diff check above worthless. The pinned
 * release and content hash change only when the input actually changes.
 */

export const KyrveExactFillVaultAbi = [
  {
    "type": "constructor",
    "inputs": [
      {
        "name": "midnight",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "activator",
        "type": "address",
        "internalType": "address"
      }
    ],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "ACTIVATOR",
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
    "name": "activateQuote",
    "inputs": [
      {
        "name": "quoteId",
        "type": "bytes32",
        "internalType": "bytes32"
      },
      {
        "name": "q",
        "type": "tuple",
        "internalType": "struct ActivatedQuote",
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
            "name": "taker",
            "type": "address",
            "internalType": "address"
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
            "name": "status",
            "type": "uint8",
            "internalType": "enum QuoteStatus"
          }
        ]
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "authoriseRatifier",
    "inputs": [
      {
        "name": "ratifier",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "authorised",
        "type": "bool",
        "internalType": "bool"
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "cancelQuote",
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
    "name": "onBuy",
    "inputs": [
      {
        "name": "id",
        "type": "bytes32",
        "internalType": "bytes32"
      },
      {
        "name": "market",
        "type": "tuple",
        "internalType": "struct Market",
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
            "name": "loanToken",
            "type": "address",
            "internalType": "address"
          },
          {
            "name": "collateralParams",
            "type": "tuple[]",
            "internalType": "struct CollateralParams[]",
            "components": [
              {
                "name": "token",
                "type": "address",
                "internalType": "address"
              },
              {
                "name": "lltv",
                "type": "uint256",
                "internalType": "uint256"
              },
              {
                "name": "liquidationCursor",
                "type": "uint256",
                "internalType": "uint256"
              },
              {
                "name": "oracle",
                "type": "address",
                "internalType": "address"
              }
            ]
          },
          {
            "name": "maturity",
            "type": "uint256",
            "internalType": "uint256"
          },
          {
            "name": "rcfThreshold",
            "type": "uint256",
            "internalType": "uint256"
          },
          {
            "name": "enterGate",
            "type": "address",
            "internalType": "address"
          },
          {
            "name": "liquidatorGate",
            "type": "address",
            "internalType": "address"
          }
        ]
      },
      {
        "name": "buyerAssets",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "units",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "pendingFeeIncrease",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "buyer",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "data",
        "type": "bytes",
        "internalType": "bytes"
      }
    ],
    "outputs": [
      {
        "name": "",
        "type": "bytes32",
        "internalType": "bytes32"
      }
    ],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "quote",
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
        "internalType": "struct ActivatedQuote",
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
            "name": "taker",
            "type": "address",
            "internalType": "address"
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
            "name": "status",
            "type": "uint8",
            "internalType": "enum QuoteStatus"
          }
        ]
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "event",
    "name": "ExactFill",
    "inputs": [
      {
        "name": "quoteId",
        "type": "bytes32",
        "indexed": true,
        "internalType": "bytes32"
      },
      {
        "name": "marketId",
        "type": "bytes32",
        "indexed": true,
        "internalType": "bytes32"
      },
      {
        "name": "units",
        "type": "uint256",
        "indexed": false,
        "internalType": "uint256"
      },
      {
        "name": "buyerAssets",
        "type": "uint256",
        "indexed": false,
        "internalType": "uint256"
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
    "name": "QuoteCancelled",
    "inputs": [
      {
        "name": "quoteId",
        "type": "bytes32",
        "indexed": true,
        "internalType": "bytes32"
      },
      {
        "name": "consumedAmount",
        "type": "uint128",
        "indexed": false,
        "internalType": "uint128"
      }
    ],
    "anonymous": false
  },
  {
    "type": "error",
    "name": "CallbackCallerNotMidnight",
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
    "name": "FeeAboveCap",
    "inputs": [
      {
        "name": "cap",
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
    "name": "NotActivator",
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
    "name": "QuoteAlreadyActivated",
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
    "name": "QuoteNotExecutable",
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
    "name": "WrongBuyer",
    "inputs": [
      {
        "name": "expected",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "actual",
        "type": "address",
        "internalType": "address"
      }
    ]
  },
  {
    "type": "error",
    "name": "WrongBuyerAssets",
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
    "name": "WrongMarket",
    "inputs": [
      {
        "name": "expected",
        "type": "bytes32",
        "internalType": "bytes32"
      },
      {
        "name": "actual",
        "type": "bytes32",
        "internalType": "bytes32"
      }
    ]
  },
  {
    "type": "error",
    "name": "WrongUnits",
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
  }
] as const;
