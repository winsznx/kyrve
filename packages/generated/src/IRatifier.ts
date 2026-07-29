/**
 * GENERATED FILE — do not edit by hand.
 *
 * Contract:  IRatifier
 * Source:    vendor/midnight/src/interfaces/IRatifier.sol
 * Note:      isRatified is view and receives no units — it cannot enforce fill size.
 *
 * Command:   pnpm generate
 * Verify:    pnpm verify:generated  (regenerates and asserts `git diff` is empty)
 * Commit:    eaf759022bbdc05d71dfe85fb968314efe2c49d8
 * Content:   sha256:42c01bfb0a84ff4ebf726239eb932aeeb264f48b3423a0f601b8d2115b9d07d8
 *
 * TIMESTAMP POLICY: none is emitted, deliberately. A generation timestamp would change this file
 * on every run with no source change, which would make the diff check above worthless. The commit
 * and content hash change only when the input actually changes.
 */

export const IRatifierAbi = [
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
        "name": "ratifierData",
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
  }
] as const;
