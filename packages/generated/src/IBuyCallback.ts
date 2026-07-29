/**
 * GENERATED FILE — do not edit by hand.
 *
 * Contract:  IBuyCallback
 * Source:    vendor/midnight/src/interfaces/ICallbacks.sol
 * Note:      onBuy is the only place actual fill size reaches maker code.
 *
 * Command:   pnpm generate
 * Verify:    pnpm verify:generated  (regenerates and asserts `git diff` is empty)
 * Pinned:    Midnight 2026-07-23 @ dbd8d3d54d324a03df9f06d3c77d50a7bd1e09a0
 * Content:   sha256:80bea538a2f65d8329af3291485265a43be9337e6969adf912281b01839f96f0
 *
 * TIMESTAMP POLICY: none is emitted, deliberately. A generation timestamp would change this file
 * on every run with no source change, which would make the diff check above worthless. The pinned
 * release and content hash change only when the input actually changes.
 */

export const IBuyCallbackAbi = [
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
  }
] as const;
