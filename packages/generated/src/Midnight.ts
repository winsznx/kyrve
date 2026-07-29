/**
 * GENERATED FILE — do not edit by hand.
 *
 * Contract:  Midnight
 * Source:    vendor/midnight/src/Midnight.sol
 * Note:      The pinned, unmodified Morpho Midnight core. BUSL-1.1; see LICENSE.
 *
 * Command:   pnpm generate
 * Verify:    pnpm verify:generated  (regenerates and asserts `git diff` is empty)
 * Commit:    eaf759022bbdc05d71dfe85fb968314efe2c49d8
 * Content:   sha256:edc75e77b7b7302dd65d34f87c06959404d504d24c6e864c7660a062325472f6
 *
 * TIMESTAMP POLICY: none is emitted, deliberately. A generation timestamp would change this file
 * on every run with no source change, which would make the diff check above worthless. The commit
 * and content hash change only when the input actually changes.
 */

export const MidnightAbi = [
  {
    "type": "constructor",
    "inputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "claimContinuousFee",
    "inputs": [
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
        "name": "amount",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "receiver",
        "type": "address",
        "internalType": "address"
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "claimSettlementFee",
    "inputs": [
      {
        "name": "token",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "amount",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "receiver",
        "type": "address",
        "internalType": "address"
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "claimableSettlementFee",
    "inputs": [
      {
        "name": "token",
        "type": "address",
        "internalType": "address"
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
    "name": "collateral",
    "inputs": [
      {
        "name": "id",
        "type": "bytes32",
        "internalType": "bytes32"
      },
      {
        "name": "user",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "index",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "outputs": [
      {
        "name": "",
        "type": "uint128",
        "internalType": "uint128"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "collateralBitmap",
    "inputs": [
      {
        "name": "id",
        "type": "bytes32",
        "internalType": "bytes32"
      },
      {
        "name": "user",
        "type": "address",
        "internalType": "address"
      }
    ],
    "outputs": [
      {
        "name": "",
        "type": "uint128",
        "internalType": "uint128"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "configurator",
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
    "name": "consumed",
    "inputs": [
      {
        "name": "user",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "group",
        "type": "bytes32",
        "internalType": "bytes32"
      }
    ],
    "outputs": [
      {
        "name": "",
        "type": "uint128",
        "internalType": "uint128"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "continuousFee",
    "inputs": [
      {
        "name": "id",
        "type": "bytes32",
        "internalType": "bytes32"
      }
    ],
    "outputs": [
      {
        "name": "",
        "type": "uint32",
        "internalType": "uint32"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "continuousFeeCredit",
    "inputs": [
      {
        "name": "id",
        "type": "bytes32",
        "internalType": "bytes32"
      }
    ],
    "outputs": [
      {
        "name": "",
        "type": "uint128",
        "internalType": "uint128"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "credit",
    "inputs": [
      {
        "name": "id",
        "type": "bytes32",
        "internalType": "bytes32"
      },
      {
        "name": "user",
        "type": "address",
        "internalType": "address"
      }
    ],
    "outputs": [
      {
        "name": "",
        "type": "uint128",
        "internalType": "uint128"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "debt",
    "inputs": [
      {
        "name": "id",
        "type": "bytes32",
        "internalType": "bytes32"
      },
      {
        "name": "user",
        "type": "address",
        "internalType": "address"
      }
    ],
    "outputs": [
      {
        "name": "",
        "type": "uint128",
        "internalType": "uint128"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "defaultContinuousFee",
    "inputs": [
      {
        "name": "loanToken",
        "type": "address",
        "internalType": "address"
      }
    ],
    "outputs": [
      {
        "name": "",
        "type": "uint32",
        "internalType": "uint32"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "defaultSettlementFeeCbp",
    "inputs": [
      {
        "name": "loanToken",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "outputs": [
      {
        "name": "",
        "type": "uint16",
        "internalType": "uint16"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "enableLiquidationCursor",
    "inputs": [
      {
        "name": "liquidationCursor",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "enableLltv",
    "inputs": [
      {
        "name": "lltv",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "feeClaimer",
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
    "name": "feeSetter",
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
    "name": "flashLoan",
    "inputs": [
      {
        "name": "tokens",
        "type": "address[]",
        "internalType": "address[]"
      },
      {
        "name": "assets",
        "type": "uint256[]",
        "internalType": "uint256[]"
      },
      {
        "name": "callback",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "data",
        "type": "bytes",
        "internalType": "bytes"
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "isAuthorized",
    "inputs": [
      {
        "name": "authorizer",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "authorized",
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
    "name": "isHealthy",
    "inputs": [
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
        "name": "id",
        "type": "bytes32",
        "internalType": "bytes32"
      },
      {
        "name": "borrower",
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
    "name": "isLiquidationCursorEnabled",
    "inputs": [
      {
        "name": "liquidationCursor",
        "type": "uint256",
        "internalType": "uint256"
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
    "name": "isLltvEnabled",
    "inputs": [
      {
        "name": "lltv",
        "type": "uint256",
        "internalType": "uint256"
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
    "name": "lastAccrual",
    "inputs": [
      {
        "name": "id",
        "type": "bytes32",
        "internalType": "bytes32"
      },
      {
        "name": "user",
        "type": "address",
        "internalType": "address"
      }
    ],
    "outputs": [
      {
        "name": "",
        "type": "uint128",
        "internalType": "uint128"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "lastLossFactor",
    "inputs": [
      {
        "name": "id",
        "type": "bytes32",
        "internalType": "bytes32"
      },
      {
        "name": "user",
        "type": "address",
        "internalType": "address"
      }
    ],
    "outputs": [
      {
        "name": "",
        "type": "uint128",
        "internalType": "uint128"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "liquidate",
    "inputs": [
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
        "name": "collateralIndex",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "seizedAssets",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "repaidUnits",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "borrower",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "postMaturityMode",
        "type": "bool",
        "internalType": "bool"
      },
      {
        "name": "receiver",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "callback",
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
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "liquidationLocked",
    "inputs": [
      {
        "name": "id",
        "type": "bytes32",
        "internalType": "bytes32"
      },
      {
        "name": "user",
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
    "name": "lossFactor",
    "inputs": [
      {
        "name": "id",
        "type": "bytes32",
        "internalType": "bytes32"
      }
    ],
    "outputs": [
      {
        "name": "",
        "type": "uint128",
        "internalType": "uint128"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "marketState",
    "inputs": [
      {
        "name": "id",
        "type": "bytes32",
        "internalType": "bytes32"
      }
    ],
    "outputs": [
      {
        "name": "totalUnits",
        "type": "uint128",
        "internalType": "uint128"
      },
      {
        "name": "lossFactor",
        "type": "uint128",
        "internalType": "uint128"
      },
      {
        "name": "withdrawable",
        "type": "uint128",
        "internalType": "uint128"
      },
      {
        "name": "continuousFeeCredit",
        "type": "uint128",
        "internalType": "uint128"
      },
      {
        "name": "settlementFeeCbp0",
        "type": "uint16",
        "internalType": "uint16"
      },
      {
        "name": "settlementFeeCbp1",
        "type": "uint16",
        "internalType": "uint16"
      },
      {
        "name": "settlementFeeCbp2",
        "type": "uint16",
        "internalType": "uint16"
      },
      {
        "name": "settlementFeeCbp3",
        "type": "uint16",
        "internalType": "uint16"
      },
      {
        "name": "settlementFeeCbp4",
        "type": "uint16",
        "internalType": "uint16"
      },
      {
        "name": "settlementFeeCbp5",
        "type": "uint16",
        "internalType": "uint16"
      },
      {
        "name": "settlementFeeCbp6",
        "type": "uint16",
        "internalType": "uint16"
      },
      {
        "name": "continuousFee",
        "type": "uint32",
        "internalType": "uint32"
      },
      {
        "name": "tickSpacing",
        "type": "uint8",
        "internalType": "uint8"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "multicall",
    "inputs": [
      {
        "name": "calls",
        "type": "bytes[]",
        "internalType": "bytes[]"
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "pendingFee",
    "inputs": [
      {
        "name": "id",
        "type": "bytes32",
        "internalType": "bytes32"
      },
      {
        "name": "user",
        "type": "address",
        "internalType": "address"
      }
    ],
    "outputs": [
      {
        "name": "",
        "type": "uint128",
        "internalType": "uint128"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "position",
    "inputs": [
      {
        "name": "id",
        "type": "bytes32",
        "internalType": "bytes32"
      },
      {
        "name": "user",
        "type": "address",
        "internalType": "address"
      }
    ],
    "outputs": [
      {
        "name": "credit",
        "type": "uint128",
        "internalType": "uint128"
      },
      {
        "name": "pendingFee",
        "type": "uint128",
        "internalType": "uint128"
      },
      {
        "name": "lastLossFactor",
        "type": "uint128",
        "internalType": "uint128"
      },
      {
        "name": "lastAccrual",
        "type": "uint128",
        "internalType": "uint128"
      },
      {
        "name": "debt",
        "type": "uint128",
        "internalType": "uint128"
      },
      {
        "name": "collateralBitmap",
        "type": "uint128",
        "internalType": "uint128"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "repay",
    "inputs": [
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
        "name": "units",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "onBehalf",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "callback",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "data",
        "type": "bytes",
        "internalType": "bytes"
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "setConfigurator",
    "inputs": [
      {
        "name": "newConfigurator",
        "type": "address",
        "internalType": "address"
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "setConsumed",
    "inputs": [
      {
        "name": "group",
        "type": "bytes32",
        "internalType": "bytes32"
      },
      {
        "name": "amount",
        "type": "uint128",
        "internalType": "uint128"
      },
      {
        "name": "onBehalf",
        "type": "address",
        "internalType": "address"
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "setDefaultContinuousFee",
    "inputs": [
      {
        "name": "loanToken",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "newContinuousFee",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "setDefaultSettlementFee",
    "inputs": [
      {
        "name": "loanToken",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "index",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "newSettlementFee",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "setFeeClaimer",
    "inputs": [
      {
        "name": "newFeeClaimer",
        "type": "address",
        "internalType": "address"
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "setFeeSetter",
    "inputs": [
      {
        "name": "newFeeSetter",
        "type": "address",
        "internalType": "address"
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "setIsAuthorized",
    "inputs": [
      {
        "name": "authorized",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "newIsAuthorized",
        "type": "bool",
        "internalType": "bool"
      },
      {
        "name": "onBehalf",
        "type": "address",
        "internalType": "address"
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "setMarketContinuousFee",
    "inputs": [
      {
        "name": "id",
        "type": "bytes32",
        "internalType": "bytes32"
      },
      {
        "name": "newContinuousFee",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "setMarketSettlementFee",
    "inputs": [
      {
        "name": "id",
        "type": "bytes32",
        "internalType": "bytes32"
      },
      {
        "name": "index",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "newSettlementFee",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "setMarketTickSpacing",
    "inputs": [
      {
        "name": "id",
        "type": "bytes32",
        "internalType": "bytes32"
      },
      {
        "name": "newTickSpacing",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "setTickSpacingSetter",
    "inputs": [
      {
        "name": "newTickSpacingSetter",
        "type": "address",
        "internalType": "address"
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "settlementFee",
    "inputs": [
      {
        "name": "id",
        "type": "bytes32",
        "internalType": "bytes32"
      },
      {
        "name": "timeToMaturity",
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
    "name": "settlementFeeCbps",
    "inputs": [
      {
        "name": "id",
        "type": "bytes32",
        "internalType": "bytes32"
      }
    ],
    "outputs": [
      {
        "name": "",
        "type": "uint16[7]",
        "internalType": "uint16[7]"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "supplyCollateral",
    "inputs": [
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
        "name": "collateralIndex",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "assets",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "onBehalf",
        "type": "address",
        "internalType": "address"
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "take",
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
        "name": "ratifierData",
        "type": "bytes",
        "internalType": "bytes"
      },
      {
        "name": "units",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "taker",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "receiverIfTakerIsSeller",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "takerCallback",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "takerCallbackData",
        "type": "bytes",
        "internalType": "bytes"
      }
    ],
    "outputs": [
      {
        "name": "",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "tickSpacing",
    "inputs": [
      {
        "name": "id",
        "type": "bytes32",
        "internalType": "bytes32"
      }
    ],
    "outputs": [
      {
        "name": "",
        "type": "uint8",
        "internalType": "uint8"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "tickSpacingSetter",
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
    "name": "toMarket",
    "inputs": [
      {
        "name": "id",
        "type": "bytes32",
        "internalType": "bytes32"
      }
    ],
    "outputs": [
      {
        "name": "",
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
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "totalUnits",
    "inputs": [
      {
        "name": "id",
        "type": "bytes32",
        "internalType": "bytes32"
      }
    ],
    "outputs": [
      {
        "name": "",
        "type": "uint128",
        "internalType": "uint128"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "touchMarket",
    "inputs": [
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
    "name": "updatePosition",
    "inputs": [
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
        "name": "user",
        "type": "address",
        "internalType": "address"
      }
    ],
    "outputs": [
      {
        "name": "",
        "type": "uint128",
        "internalType": "uint128"
      },
      {
        "name": "",
        "type": "uint128",
        "internalType": "uint128"
      },
      {
        "name": "",
        "type": "uint128",
        "internalType": "uint128"
      }
    ],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "updatePositionView",
    "inputs": [
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
        "name": "id",
        "type": "bytes32",
        "internalType": "bytes32"
      },
      {
        "name": "user",
        "type": "address",
        "internalType": "address"
      }
    ],
    "outputs": [
      {
        "name": "",
        "type": "uint128",
        "internalType": "uint128"
      },
      {
        "name": "",
        "type": "uint128",
        "internalType": "uint128"
      },
      {
        "name": "",
        "type": "uint128",
        "internalType": "uint128"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "withdraw",
    "inputs": [
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
        "name": "units",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "onBehalf",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "receiver",
        "type": "address",
        "internalType": "address"
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "withdrawCollateral",
    "inputs": [
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
        "name": "collateralIndex",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "assets",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "onBehalf",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "receiver",
        "type": "address",
        "internalType": "address"
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "withdrawable",
    "inputs": [
      {
        "name": "id",
        "type": "bytes32",
        "internalType": "bytes32"
      }
    ],
    "outputs": [
      {
        "name": "",
        "type": "uint128",
        "internalType": "uint128"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "event",
    "name": "ClaimContinuousFee",
    "inputs": [
      {
        "name": "caller",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      },
      {
        "name": "id_",
        "type": "bytes32",
        "indexed": true,
        "internalType": "bytes32"
      },
      {
        "name": "amount",
        "type": "uint256",
        "indexed": false,
        "internalType": "uint256"
      },
      {
        "name": "receiver",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "ClaimSettlementFee",
    "inputs": [
      {
        "name": "caller",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      },
      {
        "name": "token",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      },
      {
        "name": "amount",
        "type": "uint256",
        "indexed": false,
        "internalType": "uint256"
      },
      {
        "name": "receiver",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "Constructor",
    "inputs": [
      {
        "name": "configurator",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "EnableLiquidationCursor",
    "inputs": [
      {
        "name": "liquidationCursor",
        "type": "uint256",
        "indexed": false,
        "internalType": "uint256"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "EnableLltv",
    "inputs": [
      {
        "name": "lltv",
        "type": "uint256",
        "indexed": false,
        "internalType": "uint256"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "FlashLoan",
    "inputs": [
      {
        "name": "caller",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      },
      {
        "name": "tokens",
        "type": "address[]",
        "indexed": false,
        "internalType": "address[]"
      },
      {
        "name": "assets",
        "type": "uint256[]",
        "indexed": false,
        "internalType": "uint256[]"
      },
      {
        "name": "callback",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "Liquidate",
    "inputs": [
      {
        "name": "caller",
        "type": "address",
        "indexed": false,
        "internalType": "address"
      },
      {
        "name": "id_",
        "type": "bytes32",
        "indexed": true,
        "internalType": "bytes32"
      },
      {
        "name": "collateral",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      },
      {
        "name": "seizedAssets",
        "type": "uint256",
        "indexed": false,
        "internalType": "uint256"
      },
      {
        "name": "repaidUnits",
        "type": "uint256",
        "indexed": false,
        "internalType": "uint256"
      },
      {
        "name": "borrower",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      },
      {
        "name": "postMaturityMode",
        "type": "bool",
        "indexed": false,
        "internalType": "bool"
      },
      {
        "name": "receiver",
        "type": "address",
        "indexed": false,
        "internalType": "address"
      },
      {
        "name": "payer",
        "type": "address",
        "indexed": false,
        "internalType": "address"
      },
      {
        "name": "badDebt",
        "type": "uint256",
        "indexed": false,
        "internalType": "uint256"
      },
      {
        "name": "latestLossFactor",
        "type": "uint256",
        "indexed": false,
        "internalType": "uint256"
      },
      {
        "name": "latestContinuousFeeCredit",
        "type": "uint256",
        "indexed": false,
        "internalType": "uint256"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "MarketCreated",
    "inputs": [
      {
        "name": "market",
        "type": "tuple",
        "indexed": false,
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
        "name": "id_",
        "type": "bytes32",
        "indexed": true,
        "internalType": "bytes32"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "Repay",
    "inputs": [
      {
        "name": "caller",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      },
      {
        "name": "id_",
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
        "name": "onBehalf",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      },
      {
        "name": "payer",
        "type": "address",
        "indexed": false,
        "internalType": "address"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "SetConfigurator",
    "inputs": [
      {
        "name": "configurator",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "SetConsumed",
    "inputs": [
      {
        "name": "caller",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      },
      {
        "name": "group",
        "type": "bytes32",
        "indexed": true,
        "internalType": "bytes32"
      },
      {
        "name": "amount",
        "type": "uint256",
        "indexed": false,
        "internalType": "uint256"
      },
      {
        "name": "onBehalf",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "SetDefaultContinuousFee",
    "inputs": [
      {
        "name": "loanToken",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      },
      {
        "name": "newContinuousFee",
        "type": "uint256",
        "indexed": false,
        "internalType": "uint256"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "SetDefaultSettlementFee",
    "inputs": [
      {
        "name": "loanToken",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      },
      {
        "name": "index",
        "type": "uint256",
        "indexed": true,
        "internalType": "uint256"
      },
      {
        "name": "newSettlementFee",
        "type": "uint256",
        "indexed": false,
        "internalType": "uint256"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "SetFeeClaimer",
    "inputs": [
      {
        "name": "feeClaimer",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "SetFeeSetter",
    "inputs": [
      {
        "name": "feeSetter",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "SetIsAuthorized",
    "inputs": [
      {
        "name": "caller",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      },
      {
        "name": "authorized",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      },
      {
        "name": "newIsAuthorized",
        "type": "bool",
        "indexed": false,
        "internalType": "bool"
      },
      {
        "name": "onBehalf",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "SetMarketContinuousFee",
    "inputs": [
      {
        "name": "id_",
        "type": "bytes32",
        "indexed": true,
        "internalType": "bytes32"
      },
      {
        "name": "newContinuousFee",
        "type": "uint256",
        "indexed": false,
        "internalType": "uint256"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "SetMarketSettlementFee",
    "inputs": [
      {
        "name": "id_",
        "type": "bytes32",
        "indexed": true,
        "internalType": "bytes32"
      },
      {
        "name": "index",
        "type": "uint256",
        "indexed": true,
        "internalType": "uint256"
      },
      {
        "name": "newSettlementFee",
        "type": "uint256",
        "indexed": false,
        "internalType": "uint256"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "SetMarketTickSpacing",
    "inputs": [
      {
        "name": "id_",
        "type": "bytes32",
        "indexed": true,
        "internalType": "bytes32"
      },
      {
        "name": "newTickSpacing",
        "type": "uint256",
        "indexed": false,
        "internalType": "uint256"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "SetTickSpacingSetter",
    "inputs": [
      {
        "name": "tickSpacingSetter",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "SupplyCollateral",
    "inputs": [
      {
        "name": "caller",
        "type": "address",
        "indexed": false,
        "internalType": "address"
      },
      {
        "name": "id_",
        "type": "bytes32",
        "indexed": true,
        "internalType": "bytes32"
      },
      {
        "name": "collateral",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      },
      {
        "name": "assets",
        "type": "uint256",
        "indexed": false,
        "internalType": "uint256"
      },
      {
        "name": "onBehalf",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "Take",
    "inputs": [
      {
        "name": "caller",
        "type": "address",
        "indexed": false,
        "internalType": "address"
      },
      {
        "name": "offerHash",
        "type": "bytes32",
        "indexed": false,
        "internalType": "bytes32"
      },
      {
        "name": "id_",
        "type": "bytes32",
        "indexed": true,
        "internalType": "bytes32"
      },
      {
        "name": "offerIsBuy",
        "type": "bool",
        "indexed": false,
        "internalType": "bool"
      },
      {
        "name": "maker",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      },
      {
        "name": "group",
        "type": "bytes32",
        "indexed": false,
        "internalType": "bytes32"
      },
      {
        "name": "ratifier",
        "type": "address",
        "indexed": false,
        "internalType": "address"
      },
      {
        "name": "ratifierData",
        "type": "bytes",
        "indexed": false,
        "internalType": "bytes"
      },
      {
        "name": "units",
        "type": "uint256",
        "indexed": false,
        "internalType": "uint256"
      },
      {
        "name": "taker",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      },
      {
        "name": "buyerAssets",
        "type": "uint256",
        "indexed": false,
        "internalType": "uint256"
      },
      {
        "name": "sellerAssets",
        "type": "uint256",
        "indexed": false,
        "internalType": "uint256"
      },
      {
        "name": "consumed",
        "type": "uint256",
        "indexed": false,
        "internalType": "uint256"
      },
      {
        "name": "buyerPendingFeeIncrease",
        "type": "uint256",
        "indexed": false,
        "internalType": "uint256"
      },
      {
        "name": "sellerPendingFeeDecrease",
        "type": "uint256",
        "indexed": false,
        "internalType": "uint256"
      },
      {
        "name": "totalUnitsDelta",
        "type": "int256",
        "indexed": false,
        "internalType": "int256"
      },
      {
        "name": "receiver",
        "type": "address",
        "indexed": false,
        "internalType": "address"
      },
      {
        "name": "payer",
        "type": "address",
        "indexed": false,
        "internalType": "address"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "UpdatePosition",
    "inputs": [
      {
        "name": "id_",
        "type": "bytes32",
        "indexed": true,
        "internalType": "bytes32"
      },
      {
        "name": "user",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      },
      {
        "name": "creditDecrease",
        "type": "uint256",
        "indexed": false,
        "internalType": "uint256"
      },
      {
        "name": "pendingFeeDecrease",
        "type": "uint256",
        "indexed": false,
        "internalType": "uint256"
      },
      {
        "name": "accruedFee",
        "type": "uint256",
        "indexed": false,
        "internalType": "uint256"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "Withdraw",
    "inputs": [
      {
        "name": "caller",
        "type": "address",
        "indexed": false,
        "internalType": "address"
      },
      {
        "name": "id_",
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
        "name": "onBehalf",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      },
      {
        "name": "receiver",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      },
      {
        "name": "pendingFeeDecrease",
        "type": "uint256",
        "indexed": false,
        "internalType": "uint256"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "WithdrawCollateral",
    "inputs": [
      {
        "name": "caller",
        "type": "address",
        "indexed": false,
        "internalType": "address"
      },
      {
        "name": "id_",
        "type": "bytes32",
        "indexed": true,
        "internalType": "bytes32"
      },
      {
        "name": "collateral",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      },
      {
        "name": "assets",
        "type": "uint256",
        "indexed": false,
        "internalType": "uint256"
      },
      {
        "name": "onBehalf",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      },
      {
        "name": "receiver",
        "type": "address",
        "indexed": false,
        "internalType": "address"
      }
    ],
    "anonymous": false
  },
  {
    "type": "error",
    "name": "AlreadyConsumed",
    "inputs": []
  },
  {
    "type": "error",
    "name": "BuyerGatedFromIncreasingCredit",
    "inputs": []
  },
  {
    "type": "error",
    "name": "CannotIncreaseDebtPostMaturity",
    "inputs": []
  },
  {
    "type": "error",
    "name": "CastOverflow",
    "inputs": []
  },
  {
    "type": "error",
    "name": "CollateralParamsNotSorted",
    "inputs": []
  },
  {
    "type": "error",
    "name": "ConsumedAssets",
    "inputs": []
  },
  {
    "type": "error",
    "name": "ConsumedUnits",
    "inputs": []
  },
  {
    "type": "error",
    "name": "ContinuousFeeAboveMax",
    "inputs": []
  },
  {
    "type": "error",
    "name": "ContinuousFeeAboveOfferCap",
    "inputs": []
  },
  {
    "type": "error",
    "name": "FeeNotMultipleOfFeeCbp",
    "inputs": []
  },
  {
    "type": "error",
    "name": "InconsistentInput",
    "inputs": []
  },
  {
    "type": "error",
    "name": "InvalidChainId",
    "inputs": []
  },
  {
    "type": "error",
    "name": "InvalidFeeIndex",
    "inputs": []
  },
  {
    "type": "error",
    "name": "InvalidLiquidationCursor",
    "inputs": []
  },
  {
    "type": "error",
    "name": "InvalidLltv",
    "inputs": []
  },
  {
    "type": "error",
    "name": "InvalidMaxLif",
    "inputs": []
  },
  {
    "type": "error",
    "name": "InvalidMidnight",
    "inputs": []
  },
  {
    "type": "error",
    "name": "InvalidOfferCaps",
    "inputs": []
  },
  {
    "type": "error",
    "name": "InvalidTickSpacing",
    "inputs": []
  },
  {
    "type": "error",
    "name": "LiquidationCursorNotEnabled",
    "inputs": []
  },
  {
    "type": "error",
    "name": "LiquidatorGatedFromLiquidating",
    "inputs": []
  },
  {
    "type": "error",
    "name": "LltvNotEnabled",
    "inputs": []
  },
  {
    "type": "error",
    "name": "MakerCreditOrDebtIncreased",
    "inputs": []
  },
  {
    "type": "error",
    "name": "MarketLossFactorMaxedOut",
    "inputs": []
  },
  {
    "type": "error",
    "name": "MarketNotCreated",
    "inputs": []
  },
  {
    "type": "error",
    "name": "MaturityTooFar",
    "inputs": []
  },
  {
    "type": "error",
    "name": "MaxLifTooHigh",
    "inputs": []
  },
  {
    "type": "error",
    "name": "NoCode",
    "inputs": []
  },
  {
    "type": "error",
    "name": "NoCollateralParams",
    "inputs": []
  },
  {
    "type": "error",
    "name": "NotBorrower",
    "inputs": []
  },
  {
    "type": "error",
    "name": "NotLiquidatable",
    "inputs": []
  },
  {
    "type": "error",
    "name": "OfferExpired",
    "inputs": []
  },
  {
    "type": "error",
    "name": "OfferNotStarted",
    "inputs": []
  },
  {
    "type": "error",
    "name": "OnlyConfigurator",
    "inputs": []
  },
  {
    "type": "error",
    "name": "OnlyFeeClaimer",
    "inputs": []
  },
  {
    "type": "error",
    "name": "OnlyFeeSetter",
    "inputs": []
  },
  {
    "type": "error",
    "name": "OnlyTickSpacingSetter",
    "inputs": []
  },
  {
    "type": "error",
    "name": "RatifierFailed",
    "inputs": []
  },
  {
    "type": "error",
    "name": "RatifierUnauthorized",
    "inputs": []
  },
  {
    "type": "error",
    "name": "RecoveryCloseFactorConditionsViolated",
    "inputs": []
  },
  {
    "type": "error",
    "name": "SStore2DeploymentFailed",
    "inputs": []
  },
  {
    "type": "error",
    "name": "SelfTake",
    "inputs": []
  },
  {
    "type": "error",
    "name": "SellerGatedFromIncreasingDebt",
    "inputs": []
  },
  {
    "type": "error",
    "name": "SellerIsLiquidatable",
    "inputs": []
  },
  {
    "type": "error",
    "name": "SettlementFeeAboveMax",
    "inputs": []
  },
  {
    "type": "error",
    "name": "TakerUnauthorized",
    "inputs": []
  },
  {
    "type": "error",
    "name": "TickNotAccessible",
    "inputs": []
  },
  {
    "type": "error",
    "name": "TickOutOfRange",
    "inputs": []
  },
  {
    "type": "error",
    "name": "TooManyActivatedCollaterals",
    "inputs": []
  },
  {
    "type": "error",
    "name": "TooManyCollateralParams",
    "inputs": []
  },
  {
    "type": "error",
    "name": "TransferFromReturnedFalse",
    "inputs": []
  },
  {
    "type": "error",
    "name": "TransferReturnedFalse",
    "inputs": []
  },
  {
    "type": "error",
    "name": "Unauthorized",
    "inputs": []
  },
  {
    "type": "error",
    "name": "UnhealthyBorrower",
    "inputs": []
  },
  {
    "type": "error",
    "name": "UnusedReceiverMustBeZero",
    "inputs": []
  },
  {
    "type": "error",
    "name": "WrongBuyCallbackReturnValue",
    "inputs": []
  },
  {
    "type": "error",
    "name": "WrongFlashLoanCallbackReturnValue",
    "inputs": []
  },
  {
    "type": "error",
    "name": "WrongLiquidateCallbackReturnValue",
    "inputs": []
  },
  {
    "type": "error",
    "name": "WrongRepayCallbackReturnValue",
    "inputs": []
  },
  {
    "type": "error",
    "name": "WrongSellCallbackReturnValue",
    "inputs": []
  }
] as const;
