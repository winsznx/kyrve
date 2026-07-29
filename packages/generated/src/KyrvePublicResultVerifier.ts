/**
 * GENERATED FILE — do not edit by hand.
 *
 * Contract:  KyrvePublicResultVerifier
 * Source:    contracts/kyrve/KyrvePublicResultVerifier.sol
 * Note:      Binds a replayable gateway proof to one sealed epoch, and enforces handle freshness (R-14).
 *
 * Command:   pnpm generate
 * Verify:    pnpm verify:generated  (regenerates and asserts `git diff` is empty)
 * Pinned:    Midnight 2026-07-23 @ dbd8d3d54d324a03df9f06d3c77d50a7bd1e09a0
 * Content:   sha256:2a7ed494037768b381d90302d1de4d77215fe941810480ea69767a647f19931f
 *
 * TIMESTAMP POLICY: none is emitted, deliberately. A generation timestamp would change this file
 * on every run with no source change, which would make the diff check above worthless. The pinned
 * release and content hash change only when the input actually changes.
 */

export const KyrvePublicResultVerifierAbi = [
  {
    "type": "constructor",
    "inputs": [
      {
        "name": "curveVerifier",
        "type": "address",
        "internalType": "contract ICurveResultVerifier"
      },
      {
        "name": "graph",
        "type": "address",
        "internalType": "contract ICurveGraphRegistry"
      },
      {
        "name": "engine",
        "type": "address",
        "internalType": "contract INoxCurveEngine"
      },
      {
        "name": "epochs",
        "type": "address",
        "internalType": "contract IQuoteEpochController"
      }
    ],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "CURVE_VERIFIER",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "address",
        "internalType": "contract ICurveResultVerifier"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "ENGINE",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "address",
        "internalType": "contract INoxCurveEngine"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "EPOCHS",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "address",
        "internalType": "contract IQuoteEpochController"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "GRAPH",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "address",
        "internalType": "contract ICurveGraphRegistry"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "isActivatable",
    "inputs": [
      {
        "name": "epochId",
        "type": "bytes32",
        "internalType": "bytes32"
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
    "name": "requireFreshHandles",
    "inputs": [
      {
        "name": "epochId",
        "type": "bytes32",
        "internalType": "bytes32"
      }
    ],
    "outputs": [
      {
        "name": "handles",
        "type": "tuple",
        "internalType": "struct CurvePublishedHandles",
        "components": [
          {
            "name": "marketIndex",
            "type": "bytes32",
            "internalType": "bytes32"
          },
          {
            "name": "rateIndex",
            "type": "bytes32",
            "internalType": "bytes32"
          },
          {
            "name": "floorPassed",
            "type": "bytes32",
            "internalType": "bytes32"
          },
          {
            "name": "quoteReady",
            "type": "bytes32",
            "internalType": "bytes32"
          },
          {
            "name": "aggregateFill",
            "type": "bytes32",
            "internalType": "bytes32"
          }
        ]
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "verifyForActivation",
    "inputs": [
      {
        "name": "epochId",
        "type": "bytes32",
        "internalType": "bytes32"
      },
      {
        "name": "expectedGraphRoot",
        "type": "bytes32",
        "internalType": "bytes32"
      },
      {
        "name": "expectedRequestId",
        "type": "bytes32",
        "internalType": "bytes32"
      },
      {
        "name": "expectedUniverseId",
        "type": "bytes32",
        "internalType": "bytes32"
      },
      {
        "name": "marketProof",
        "type": "bytes",
        "internalType": "bytes"
      },
      {
        "name": "rateProof",
        "type": "bytes",
        "internalType": "bytes"
      },
      {
        "name": "floorProof",
        "type": "bytes",
        "internalType": "bytes"
      },
      {
        "name": "readyProof",
        "type": "bytes",
        "internalType": "bytes"
      },
      {
        "name": "aggregateProof",
        "type": "bytes",
        "internalType": "bytes"
      }
    ],
    "outputs": [
      {
        "name": "verified",
        "type": "tuple",
        "internalType": "struct VerifiedCurveResult",
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
            "name": "universeHash",
            "type": "bytes32",
            "internalType": "bytes32"
          },
          {
            "name": "borrower",
            "type": "address",
            "internalType": "address"
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
            "name": "aggregateFillAmount",
            "type": "uint256",
            "internalType": "uint256"
          },
          {
            "name": "handles",
            "type": "tuple",
            "internalType": "struct CurvePublishedHandles",
            "components": [
              {
                "name": "marketIndex",
                "type": "bytes32",
                "internalType": "bytes32"
              },
              {
                "name": "rateIndex",
                "type": "bytes32",
                "internalType": "bytes32"
              },
              {
                "name": "floorPassed",
                "type": "bytes32",
                "internalType": "bytes32"
              },
              {
                "name": "quoteReady",
                "type": "bytes32",
                "internalType": "bytes32"
              },
              {
                "name": "aggregateFill",
                "type": "bytes32",
                "internalType": "bytes32"
              }
            ]
          }
        ]
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "error",
    "name": "AggregateIsZero",
    "inputs": [
      {
        "name": "epochId",
        "type": "bytes32",
        "internalType": "bytes32"
      }
    ]
  },
  {
    "type": "error",
    "name": "EpochNotComplete",
    "inputs": [
      {
        "name": "epochId",
        "type": "bytes32",
        "internalType": "bytes32"
      },
      {
        "name": "stage",
        "type": "uint8",
        "internalType": "uint8"
      }
    ]
  },
  {
    "type": "error",
    "name": "GraphNotSealed",
    "inputs": [
      {
        "name": "epochId",
        "type": "bytes32",
        "internalType": "bytes32"
      }
    ]
  },
  {
    "type": "error",
    "name": "GraphRootMismatch",
    "inputs": [
      {
        "name": "epochId",
        "type": "bytes32",
        "internalType": "bytes32"
      },
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
    "name": "IndexOutOfRange",
    "inputs": [
      {
        "name": "role",
        "type": "uint8",
        "internalType": "uint8"
      },
      {
        "name": "value",
        "type": "uint256",
        "internalType": "uint256"
      }
    ]
  },
  {
    "type": "error",
    "name": "PrivacyFloorNotMet",
    "inputs": [
      {
        "name": "epochId",
        "type": "bytes32",
        "internalType": "bytes32"
      }
    ]
  },
  {
    "type": "error",
    "name": "PublishedHandleMissing",
    "inputs": [
      {
        "name": "epochId",
        "type": "bytes32",
        "internalType": "bytes32"
      },
      {
        "name": "role",
        "type": "uint8",
        "internalType": "uint8"
      }
    ]
  },
  {
    "type": "error",
    "name": "PublishedHandleUnregistered",
    "inputs": [
      {
        "name": "epochId",
        "type": "bytes32",
        "internalType": "bytes32"
      },
      {
        "name": "role",
        "type": "uint8",
        "internalType": "uint8"
      },
      {
        "name": "expected",
        "type": "bytes32",
        "internalType": "bytes32"
      },
      {
        "name": "published",
        "type": "bytes32",
        "internalType": "bytes32"
      }
    ]
  },
  {
    "type": "error",
    "name": "QuoteNotReady",
    "inputs": [
      {
        "name": "epochId",
        "type": "bytes32",
        "internalType": "bytes32"
      }
    ]
  },
  {
    "type": "error",
    "name": "RequestMismatch",
    "inputs": [
      {
        "name": "epochId",
        "type": "bytes32",
        "internalType": "bytes32"
      },
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
    "name": "UniverseMismatch",
    "inputs": [
      {
        "name": "epochId",
        "type": "bytes32",
        "internalType": "bytes32"
      },
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
