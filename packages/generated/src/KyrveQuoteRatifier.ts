/**
 * GENERATED FILE — do not edit by hand.
 *
 * Contract:  KyrveQuoteRatifier
 * Source:    contracts/integration/KyrveQuoteRatifier.sol
 * Note:      Authenticates the exact activated offer and the approved taker.
 *
 * Command:   pnpm generate
 * Verify:    pnpm verify:generated  (regenerates and asserts `git diff` is empty)
 * Pinned:    Midnight 2026-07-23 @ dbd8d3d54d324a03df9f06d3c77d50a7bd1e09a0
 * Content:   sha256:81f33d8dc7eeb41588637ff596df199e73a0869e067f0eb44c7cc5378794c71f
 *
 * TIMESTAMP POLICY: none is emitted, deliberately. A generation timestamp would change this file
 * on every run with no source change, which would make the diff check above worthless. The pinned
 * release and content hash change only when the input actually changes.
 */

export const KyrveQuoteRatifierAbi = [
  {
    "type": "constructor",
    "inputs": [
      {
        "name": "midnight",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "binding",
        "type": "address",
        "internalType": "address"
      }
    ],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "BINDING",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "address",
        "internalType": "contract IKyrveQuoteBinding"
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
    "name": "isRatified",
    "inputs": [
      {
        "name": "offer",
        "type": "tuple",
        "internalType": "struct Offer",
        "components": [
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
            "name": "buy",
            "type": "bool",
            "internalType": "bool"
          },
          {
            "name": "maker",
            "type": "address",
            "internalType": "address"
          },
          {
            "name": "start",
            "type": "uint256",
            "internalType": "uint256"
          },
          {
            "name": "expiry",
            "type": "uint256",
            "internalType": "uint256"
          },
          {
            "name": "tick",
            "type": "uint256",
            "internalType": "uint256"
          },
          {
            "name": "group",
            "type": "bytes32",
            "internalType": "bytes32"
          },
          {
            "name": "callback",
            "type": "address",
            "internalType": "address"
          },
          {
            "name": "callbackData",
            "type": "bytes",
            "internalType": "bytes"
          },
          {
            "name": "receiverIfMakerIsSeller",
            "type": "address",
            "internalType": "address"
          },
          {
            "name": "ratifier",
            "type": "address",
            "internalType": "address"
          },
          {
            "name": "reduceOnly",
            "type": "bool",
            "internalType": "bool"
          },
          {
            "name": "maxUnits",
            "type": "uint128",
            "internalType": "uint128"
          },
          {
            "name": "maxAssets",
            "type": "uint128",
            "internalType": "uint128"
          },
          {
            "name": "continuousFeeCap",
            "type": "uint256",
            "internalType": "uint256"
          }
        ]
      },
      {
        "name": "",
        "type": "bytes",
        "internalType": "bytes"
      },
      {
        "name": "taker",
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
    "type": "error",
    "name": "AlteredOffer",
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
    "name": "QuoteExpired",
    "inputs": [
      {
        "name": "expiry",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "nowTs",
        "type": "uint256",
        "internalType": "uint256"
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
    "name": "UnauthorisedTaker",
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
