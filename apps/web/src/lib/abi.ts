/**
 * The exact contract surface the terminal touches.
 *
 * Hand-written rather than imported from the Hardhat artifacts, and deliberately minimal: the
 * interface should be able to do what it shows and nothing else. A full ABI would let a future edit
 * call `openReservation` or `pauseAll` from the browser without anybody noticing the change.
 */

export const ERC20_ABI = [
  {
    type: "function",
    name: "balanceOf",
    stateMutability: "view",
    inputs: [{ type: "address" }],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function",
    name: "decimals",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "uint8" }],
  },
  {
    type: "function",
    name: "approve",
    stateMutability: "nonpayable",
    inputs: [{ type: "address" }, { type: "uint256" }],
    outputs: [{ type: "bool" }],
  },
  {
    type: "function",
    name: "mint",
    stateMutability: "nonpayable",
    inputs: [{ type: "address" }, { type: "uint256" }],
    outputs: [],
  },
] as const;

export const WRAPPED_ASSET_ABI = [
  {
    type: "function",
    name: "wrap",
    stateMutability: "nonpayable",
    inputs: [{ type: "address" }, { type: "uint256" }],
    outputs: [{ type: "bytes32" }],
  },
  {
    type: "function",
    name: "confidentialBalanceOf",
    stateMutability: "view",
    inputs: [{ type: "address" }],
    outputs: [{ type: "bytes32" }],
  },
  {
    type: "function",
    name: "symbol",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "string" }],
  },
  {
    type: "function",
    name: "MAX_OPERATOR_WINDOW",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "uint48" }],
  },
] as const;

const MANDATE_INPUT = {
  type: "tuple",
  components: [
    { name: "totalBudget", type: "bytes32" },
    { name: "marketCaps", type: "bytes32[8]" },
    { name: "minRateIndexes", type: "bytes32[8]" },
    { name: "enabledFlags", type: "bytes32[8]" },
    { name: "collateralFamilyCaps", type: "bytes32[4]" },
    { name: "maturityBucketCaps", type: "bytes32[4]" },
    { name: "maxDurationIndex", type: "bytes32" },
    { name: "allocationWeight", type: "bytes32" },
  ],
} as const;

const MANDATE_HANDLES = {
  type: "tuple",
  components: [
    { name: "totalBudget", type: "bytes32" },
    { name: "marketCaps", type: "bytes32[8]" },
    { name: "minRateIndexes", type: "bytes32[8]" },
    { name: "enabledFlags", type: "bytes32[8]" },
    { name: "collateralFamilyCaps", type: "bytes32[4]" },
    { name: "maturityBucketCaps", type: "bytes32[4]" },
    { name: "maxDurationIndex", type: "bytes32" },
    { name: "allocationWeight", type: "bytes32" },
  ],
} as const;

export const MANDATE_BOOK_ABI = [
  {
    type: "function",
    name: "submitMandate",
    stateMutability: "nonpayable",
    inputs: [
      { name: "universeId", type: "bytes32" },
      { name: "input", ...MANDATE_INPUT },
      { name: "proofs", type: "bytes[]" },
      { name: "nonce", type: "uint256" },
    ],
    outputs: [{ type: "bytes32" }],
  },
  {
    type: "function",
    name: "replaceMandate",
    stateMutability: "nonpayable",
    inputs: [
      { name: "mandateId", type: "bytes32" },
      { name: "input", ...MANDATE_INPUT },
      { name: "proofs", type: "bytes[]" },
      { name: "nonce", type: "uint256" },
    ],
    outputs: [{ type: "uint32" }],
  },
  {
    type: "function",
    name: "mandateIdFor",
    stateMutability: "view",
    inputs: [{ type: "address" }, { type: "bytes32" }],
    outputs: [{ type: "bytes32" }],
  },
  {
    type: "function",
    name: "mandateOf",
    stateMutability: "view",
    inputs: [{ type: "bytes32" }],
    outputs: [
      {
        type: "tuple",
        components: [
          { name: "provider", type: "address" },
          { name: "universeId", type: "bytes32" },
          { name: "activeEpoch", type: "uint32" },
          { name: "schemaVersion", type: "uint16" },
          { name: "state", type: "uint8" },
          { name: "submittedAt", type: "uint64" },
          { name: "updatedAt", type: "uint64" },
        ],
      },
    ],
  },
  {
    type: "function",
    name: "handlesOf",
    stateMutability: "view",
    inputs: [{ type: "bytes32" }, { type: "uint32" }],
    outputs: [{ name: "handles", ...MANDATE_HANDLES }],
  },
  {
    type: "function",
    name: "nextNonce",
    stateMutability: "view",
    inputs: [{ type: "address" }],
    outputs: [{ type: "uint256" }],
  },
] as const;

const REQUEST_INPUT = {
  type: "tuple",
  components: [
    { name: "desiredAssets", type: "bytes32" },
    { name: "minimumAssets", type: "bytes32" },
    { name: "maxRateIndexes", type: "bytes32[8]" },
    { name: "enabledFlags", type: "bytes32[8]" },
    { name: "preferredMaturityIndex", type: "bytes32" },
  ],
} as const;

export const REQUEST_BOOK_ABI = [
  {
    type: "function",
    name: "submitRequest",
    stateMutability: "payable",
    inputs: [
      { name: "universeId", type: "bytes32" },
      { name: "input", ...REQUEST_INPUT },
      { name: "proofs", type: "bytes[]" },
      { name: "lifetime", type: "uint64" },
      { name: "exactFillRequired", type: "bool" },
      { name: "collateralReference", type: "bytes32" },
      { name: "nonce", type: "uint256" },
    ],
    outputs: [{ type: "bytes32" }],
  },
  {
    type: "function",
    name: "cancelUnsealedRequest",
    stateMutability: "nonpayable",
    inputs: [{ type: "bytes32" }],
    outputs: [],
  },
  {
    type: "function",
    name: "liveRequest",
    stateMutability: "view",
    inputs: [{ type: "address" }, { type: "bytes32" }],
    outputs: [{ type: "bytes32" }],
  },
  {
    type: "function",
    name: "requestOf",
    stateMutability: "view",
    inputs: [{ type: "bytes32" }],
    outputs: [
      {
        type: "tuple",
        components: [
          { name: "borrower", type: "address" },
          { name: "universeId", type: "bytes32" },
          { name: "schemaVersion", type: "uint16" },
          { name: "state", type: "uint8" },
          { name: "exactFillRequired", type: "bool" },
          { name: "submittedAt", type: "uint64" },
          { name: "expiresAt", type: "uint64" },
          { name: "bondWei", type: "uint256" },
          { name: "collateralReference", type: "bytes32" },
          { name: "commitment", type: "bytes32" },
        ],
      },
    ],
  },
  {
    type: "function",
    name: "handlesOf",
    stateMutability: "view",
    inputs: [{ type: "bytes32" }],
    outputs: [
      {
        type: "tuple",
        components: [
          { name: "desiredAssets", type: "bytes32" },
          { name: "minimumAssets", type: "bytes32" },
          { name: "maxRateIndexes", type: "bytes32[8]" },
          { name: "enabledFlags", type: "bytes32[8]" },
          { name: "preferredMaturityIndex", type: "bytes32" },
        ],
      },
    ],
  },
  {
    type: "function",
    name: "nextNonce",
    stateMutability: "view",
    inputs: [{ type: "address" }],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function",
    name: "MIN_BOND_WEI",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "uint256" }],
  },
] as const;

// ────────────────────────────────────────────────────────────────────────────────────────────
// The Phase 4 settlement surface
//
// Minimal in the same way and for the same reason as the four above: the panel can verify,
// activate, attempt a fill, settle, cancel and recover, and it can read the resulting public
// position. It cannot authorise a ratifier, create a series or bind anything, because those entry
// points are absent here rather than merely unused.
// ────────────────────────────────────────────────────────────────────────────────────────────

const MARKET_TUPLE = {
  type: "tuple",
  name: "market",
  components: [
    { name: "chainId", type: "uint256" },
    { name: "midnight", type: "address" },
    { name: "loanToken", type: "address" },
    {
      name: "collateralParams",
      type: "tuple[]",
      components: [
        { name: "token", type: "address" },
        { name: "lltv", type: "uint256" },
        { name: "liquidationCursor", type: "uint256" },
        { name: "oracle", type: "address" },
      ],
    },
    { name: "maturity", type: "uint256" },
    { name: "rcfThreshold", type: "uint256" },
    { name: "enterGate", type: "address" },
    { name: "liquidatorGate", type: "address" },
  ],
} as const;

const OFFER_TUPLE = {
  type: "tuple",
  name: "offer",
  components: [
    { ...MARKET_TUPLE, name: "market" },
    { name: "buy", type: "bool" },
    { name: "maker", type: "address" },
    { name: "start", type: "uint256" },
    { name: "expiry", type: "uint256" },
    { name: "tick", type: "uint256" },
    { name: "group", type: "bytes32" },
    { name: "callback", type: "address" },
    { name: "callbackData", type: "bytes" },
    { name: "receiverIfMakerIsSeller", type: "address" },
    { name: "ratifier", type: "address" },
    { name: "reduceOnly", type: "bool" },
    { name: "maxUnits", type: "uint128" },
    { name: "maxAssets", type: "uint128" },
    { name: "continuousFeeCap", type: "uint256" },
  ],
} as const;

export const QUOTE_REGISTRY_ABI = [
  {
    type: "function",
    name: "executionOf",
    stateMutability: "view",
    inputs: [{ name: "quoteId", type: "bytes32" }],
    outputs: [
      {
        type: "tuple",
        components: [
          { name: "offerHash", type: "bytes32" },
          { name: "marketId", type: "bytes32" },
          { name: "exactUnits", type: "uint128" },
          { name: "expectedBuyerAssets", type: "uint128" },
          { name: "maxPendingFee", type: "uint128" },
          { name: "expiry", type: "uint40" },
          { name: "activatedAt", type: "uint40" },
          { name: "status", type: "uint8" },
          { name: "taker", type: "address" },
          { name: "vault", type: "address" },
          { name: "ratifier", type: "address" },
        ],
      },
    ],
  },
  {
    type: "function",
    name: "quoteOfEpoch",
    stateMutability: "view",
    inputs: [{ name: "epochId", type: "bytes32" }],
    outputs: [{ type: "bytes32" }],
  },
] as const;

export const PUBLIC_RESULT_VERIFIER_ABI = [
  {
    type: "function",
    name: "verifyForActivation",
    stateMutability: "view",
    inputs: [
      { name: "epochId", type: "bytes32" },
      { name: "expectedGraphRoot", type: "bytes32" },
      { name: "expectedRequestId", type: "bytes32" },
      { name: "expectedUniverseId", type: "bytes32" },
      { name: "marketProof", type: "bytes" },
      { name: "rateProof", type: "bytes" },
      { name: "floorProof", type: "bytes" },
      { name: "readyProof", type: "bytes" },
      { name: "aggregateProof", type: "bytes" },
    ],
    outputs: [
      {
        type: "tuple",
        components: [
          { name: "epochId", type: "bytes32" },
          { name: "graphRoot", type: "bytes32" },
          { name: "requestId", type: "bytes32" },
          { name: "universeId", type: "bytes32" },
          { name: "universeHash", type: "bytes32" },
          { name: "borrower", type: "address" },
          { name: "marketIndex", type: "uint8" },
          { name: "rateIndex", type: "uint8" },
          { name: "aggregateFillAmount", type: "uint256" },
          {
            name: "handles",
            type: "tuple",
            components: [
              { name: "marketIndex", type: "bytes32" },
              { name: "rateIndex", type: "bytes32" },
              { name: "floorPassed", type: "bytes32" },
              { name: "quoteReady", type: "bytes32" },
              { name: "aggregateFill", type: "bytes32" },
            ],
          },
        ],
      },
    ],
  },
] as const;

export const QUOTE_ACTIVATOR_ABI = [
  {
    type: "function",
    name: "activate",
    stateMutability: "nonpayable",
    inputs: [
      {
        name: "request",
        type: "tuple",
        components: [
          { name: "epochId", type: "bytes32" },
          { name: "expectedGraphRoot", type: "bytes32" },
          { name: "expectedRequestId", type: "bytes32" },
          { name: "expectedUniverseId", type: "bytes32" },
          MARKET_TUPLE,
          { name: "leafIndex", type: "uint256" },
          { name: "lifetime", type: "uint256" },
          { name: "maxPendingFee", type: "uint128" },
        ],
      },
      {
        name: "proofs",
        type: "tuple",
        components: [
          { name: "marketProof", type: "bytes" },
          { name: "rateProof", type: "bytes" },
          { name: "floorProof", type: "bytes" },
          { name: "readyProof", type: "bytes" },
          { name: "aggregateProof", type: "bytes" },
        ],
      },
    ],
    outputs: [{ name: "quoteId", type: "bytes32" }, OFFER_TUPLE],
  },
  {
    type: "event",
    name: "OfferPublished",
    inputs: [
      { name: "quoteId", type: "bytes32", indexed: true },
      { name: "offer", type: "bytes", indexed: false },
    ],
  },
] as const;

export const EXPIRY_CONTROLLER_ABI = [
  {
    type: "function",
    name: "cancelQuote",
    stateMutability: "nonpayable",
    inputs: [{ name: "quoteId", type: "bytes32" }],
    outputs: [],
  },
  {
    type: "function",
    name: "expireQuote",
    stateMutability: "nonpayable",
    inputs: [{ name: "quoteId", type: "bytes32" }],
    outputs: [],
  },
] as const;

export const SERIES_VAULT_ABI = [
  {
    type: "function",
    name: "positionOf",
    stateMutability: "view",
    inputs: [{ name: "marketId", type: "bytes32" }],
    outputs: [
      { name: "credit", type: "uint128" },
      { name: "debt", type: "uint128" },
      { name: "pendingFee", type: "uint128" },
    ],
  },
  {
    type: "function",
    name: "committedFunding",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function",
    name: "availableFunding",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function",
    name: "recoverFunding",
    stateMutability: "nonpayable",
    inputs: [
      { name: "amount", type: "uint256" },
      { name: "to", type: "address" },
    ],
    outputs: [],
  },
] as const;

export const MIDNIGHT_SETTLEMENT_ABI = [
  {
    type: "function",
    name: "take",
    stateMutability: "nonpayable",
    inputs: [
      OFFER_TUPLE,
      { name: "ratifierData", type: "bytes" },
      { name: "units", type: "uint256" },
      { name: "taker", type: "address" },
      { name: "receiverIfTakerIsSeller", type: "address" },
      { name: "takerCallback", type: "address" },
      { name: "takerCallbackData", type: "bytes" },
    ],
    outputs: [
      { name: "buyerAssets", type: "uint256" },
      { name: "sellerAssets", type: "uint256" },
    ],
  },
  {
    type: "function",
    name: "credit",
    stateMutability: "view",
    inputs: [
      { name: "id", type: "bytes32" },
      { name: "user", type: "address" },
    ],
    outputs: [{ type: "uint128" }],
  },
  {
    type: "function",
    name: "debt",
    stateMutability: "view",
    inputs: [
      { name: "id", type: "bytes32" },
      { name: "user", type: "address" },
    ],
    outputs: [{ type: "uint128" }],
  },
  {
    type: "function",
    name: "consumed",
    stateMutability: "view",
    inputs: [
      { name: "user", type: "address" },
      { name: "group", type: "bytes32" },
    ],
    outputs: [{ type: "uint128" }],
  },
] as const;
