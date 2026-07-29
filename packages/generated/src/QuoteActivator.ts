/**
 * GENERATED FILE — do not edit by hand.
 *
 * Contract:  QuoteActivator
 * Source:    contracts/kyrve/QuoteActivator.sol
 * Note:      The public/private boundary crossing. One verified curve result becomes one Midnight offer.
 *
 * Command:   pnpm generate
 * Verify:    pnpm verify:generated  (regenerates and asserts `git diff` is empty)
 * Pinned:    Midnight 2026-07-23 @ dbd8d3d54d324a03df9f06d3c77d50a7bd1e09a0
 * Content:   sha256:daddcc62b567df1303cb76e3c72f5b828ac5fe7dbfd44d224cbbd97f275f116b
 *
 * TIMESTAMP POLICY: none is emitted, deliberately. A generation timestamp would change this file
 * on every run with no source change, which would make the diff check above worthless. The pinned
 * release and content hash change only when the input actually changes.
 */

export const QuoteActivatorAbi = [
  {
    "type": "constructor",
    "inputs": [
      {
        "name": "registry",
        "type": "address",
        "internalType": "contract KyrveQuoteRegistry"
      },
      {
        "name": "verifier",
        "type": "address",
        "internalType": "contract KyrvePublicResultVerifier"
      },
      {
        "name": "universes",
        "type": "address",
        "internalType": "contract ICurveUniverseRegistry"
      },
      {
        "name": "ratifier",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "keeper",
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
    "name": "KEEPER",
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
    "name": "MAX_QUOTE_LIFETIME",
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
    "name": "MIN_QUOTE_LIFETIME",
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
    "name": "RATIFIER",
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
    "name": "UNIVERSES",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "address",
        "internalType": "contract ICurveUniverseRegistry"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "VERIFIER",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "address",
        "internalType": "contract KyrvePublicResultVerifier"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "activate",
    "inputs": [
      {
        "name": "request",
        "type": "tuple",
        "internalType": "struct QuoteActivator.ActivationRequest",
        "components": [
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
            "name": "leafIndex",
            "type": "uint256",
            "internalType": "uint256"
          },
          {
            "name": "lifetime",
            "type": "uint256",
            "internalType": "uint256"
          },
          {
            "name": "maxPendingFee",
            "type": "uint128",
            "internalType": "uint128"
          }
        ]
      },
      {
        "name": "proofs",
        "type": "tuple",
        "internalType": "struct QuoteActivator.Proofs",
        "components": [
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
        ]
      }
    ],
    "outputs": [
      {
        "name": "quoteId",
        "type": "bytes32",
        "internalType": "bytes32"
      },
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
      }
    ],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "bindFactory",
    "inputs": [
      {
        "name": "factory_",
        "type": "address",
        "internalType": "contract KyrveSeriesFactory"
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "factory",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "address",
        "internalType": "contract KyrveSeriesFactory"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "event",
    "name": "FactoryBound",
    "inputs": [
      {
        "name": "factory",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "OfferPublished",
    "inputs": [
      {
        "name": "quoteId",
        "type": "bytes32",
        "indexed": true,
        "internalType": "bytes32"
      },
      {
        "name": "offer",
        "type": "bytes",
        "indexed": false,
        "internalType": "bytes"
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
        "name": "marketId",
        "type": "bytes32",
        "indexed": false,
        "internalType": "bytes32"
      },
      {
        "name": "exactUnits",
        "type": "uint128",
        "indexed": false,
        "internalType": "uint128"
      },
      {
        "name": "expectedBuyerAssets",
        "type": "uint128",
        "indexed": false,
        "internalType": "uint128"
      },
      {
        "name": "aggregateFillAmount",
        "type": "uint256",
        "indexed": false,
        "internalType": "uint256"
      }
    ],
    "anonymous": false
  },
  {
    "type": "error",
    "name": "BuyerAssetsAboveAggregate",
    "inputs": [
      {
        "name": "aggregate",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "buyerAssets",
        "type": "uint256",
        "internalType": "uint256"
      }
    ]
  },
  {
    "type": "error",
    "name": "FactoryAlreadyBound",
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
    "name": "FactoryNotBound",
    "inputs": []
  },
  {
    "type": "error",
    "name": "LeafIndexOutOfRange",
    "inputs": [
      {
        "name": "leafIndex",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "leafCount",
        "type": "uint256",
        "internalType": "uint256"
      }
    ]
  },
  {
    "type": "error",
    "name": "LeafPriceMismatch",
    "inputs": [
      {
        "name": "registryPrice",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "tickPrice",
        "type": "uint256",
        "internalType": "uint256"
      }
    ]
  },
  {
    "type": "error",
    "name": "LifetimeOutOfRange",
    "inputs": [
      {
        "name": "supplied",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "minimum",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "maximum",
        "type": "uint256",
        "internalType": "uint256"
      }
    ]
  },
  {
    "type": "error",
    "name": "MarketIdMismatch",
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
    "name": "MarketStructMismatch",
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
    "name": "NegativeTick",
    "inputs": [
      {
        "name": "tick",
        "type": "int24",
        "internalType": "int24"
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
    "name": "NotKeeper",
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
    "name": "PriceBelowSettlementFee",
    "inputs": [
      {
        "name": "price",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "settlementFee",
        "type": "uint256",
        "internalType": "uint256"
      }
    ]
  },
  {
    "type": "error",
    "name": "PriceIsZero",
    "inputs": [
      {
        "name": "tick",
        "type": "int24",
        "internalType": "int24"
      }
    ]
  },
  {
    "type": "error",
    "name": "TickOutOfRange",
    "inputs": []
  },
  {
    "type": "error",
    "name": "UnitsAreZero",
    "inputs": [
      {
        "name": "aggregate",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "price",
        "type": "uint256",
        "internalType": "uint256"
      }
    ]
  },
  {
    "type": "error",
    "name": "UniverseHashMismatch",
    "inputs": [
      {
        "name": "universeId",
        "type": "bytes32",
        "internalType": "bytes32"
      },
      {
        "name": "sealedHash",
        "type": "bytes32",
        "internalType": "bytes32"
      },
      {
        "name": "registryHash",
        "type": "bytes32",
        "internalType": "bytes32"
      }
    ]
  },
  {
    "type": "error",
    "name": "UnselectedLeaf",
    "inputs": [
      {
        "name": "leafIndex",
        "type": "uint256",
        "internalType": "uint256"
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
      }
    ]
  },
  {
    "type": "error",
    "name": "ValueTooLarge",
    "inputs": [
      {
        "name": "field",
        "type": "string",
        "internalType": "string"
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
    "name": "WrongMidnight",
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
