/**
 * GENERATED FILE — do not edit by hand.
 *
 * Contract:  KyrveQuoteExpiryController
 * Source:    contracts/kyrve/KyrveQuoteExpiryController.sol
 * Note:      Who may end a live quote and when. Cancellation is permissioned; expiry is not.
 *
 * Command:   pnpm generate
 * Verify:    pnpm verify:generated  (regenerates and asserts `git diff` is empty)
 * Pinned:    Midnight 2026-07-23 @ dbd8d3d54d324a03df9f06d3c77d50a7bd1e09a0
 * Content:   sha256:2d5ffff22a45b5838be162a93d9d3815ee95207de62af79c156af357582e9283
 *
 * TIMESTAMP POLICY: none is emitted, deliberately. A generation timestamp would change this file
 * on every run with no source change, which would make the diff check above worthless. The pinned
 * release and content hash change only when the input actually changes.
 */

export const KyrveQuoteExpiryControllerAbi = [
  {
    "type": "constructor",
    "inputs": [
      {
        "name": "registry",
        "type": "address",
        "internalType": "contract KyrveQuoteRegistry"
      },
      {
        "name": "operator",
        "type": "address",
        "internalType": "address"
      }
    ],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "OPERATOR",
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
    "name": "REGISTRY",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "address",
        "internalType": "contract KyrveQuoteRegistry"
      }
    ],
    "stateMutability": "view"
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
    "name": "expireQuote",
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
        "name": "vault",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      },
      {
        "name": "by",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "QuoteExpired",
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
        "name": "by",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      },
      {
        "name": "expiry",
        "type": "uint40",
        "indexed": false,
        "internalType": "uint40"
      }
    ],
    "anonymous": false
  },
  {
    "type": "error",
    "name": "NotOperator",
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
    "name": "NotYetExpired",
    "inputs": [
      {
        "name": "quoteId",
        "type": "bytes32",
        "internalType": "bytes32"
      },
      {
        "name": "expiry",
        "type": "uint40",
        "internalType": "uint40"
      },
      {
        "name": "nowTimestamp",
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
