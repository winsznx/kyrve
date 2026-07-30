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
  /**
   * The mandate lifecycle. Three states past Active, and only one of them is reversible.
   *
   * `pauseMandate` stops a mandate being quoted against without discarding it; `resumeMandate` puts
   * it back on its existing epoch. `retireMandate` is TERMINAL and cannot be undone — `mandateId` is
   * deterministic in (provider, universe), so a retired mandate's identifier can never be reused and
   * no new mandate for the same pair can be created. The interface has to say that before the click,
   * because the contract will not say it after.
   */
  {
    type: "function",
    name: "pauseMandate",
    stateMutability: "nonpayable",
    inputs: [{ name: "mandateId", type: "bytes32" }],
    outputs: [],
  },
  {
    type: "function",
    name: "resumeMandate",
    stateMutability: "nonpayable",
    inputs: [{ name: "mandateId", type: "bytes32" }],
    outputs: [],
  },
  {
    type: "function",
    name: "retireMandate",
    stateMutability: "nonpayable",
    inputs: [{ name: "mandateId", type: "bytes32" }],
    outputs: [],
  },
  {
    type: "function",
    name: "isUsable",
    stateMutability: "view",
    inputs: [{ type: "bytes32" }, { type: "uint32" }],
    outputs: [{ type: "bool" }],
  },
] as const;

/** `EncryptedMandateBook.MandateState`, in enum order. */
export enum MandateState {
  None = 0,
  Active = 1,
  Paused = 2,
  Retired = 3,
}

export const MANDATE_STATE_LABEL: Readonly<Record<MandateState, string>> = {
  [MandateState.None]: "no mandate",
  [MandateState.Active]: "active",
  [MandateState.Paused]: "paused",
  [MandateState.Retired]: "retired — permanently",
};

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

/**
 * The Phase 5 confidential series claim.
 *
 * Only the READ surface, and deliberately so. This page never mints, never burns and never redeems —
 * `mintClaim` is `onlyAllocator` and `redeem` is a holder action that belongs on a redemption
 * surface, not on an ownership view. A terminal that could not perform an action cannot be tricked
 * into performing it.
 *
 * `confidentialBalanceOf` returns a HANDLE, never a value. The plaintext exists only after a real
 * gateway round trip that NoxCompute authorised against the connected wallet, which is what makes
 * "only its owner can read it" a chain fact rather than a UI convention.
 */
export const SERIES_TOKEN_ABI = [
  {
    type: "function",
    name: "confidentialBalanceOf",
    stateMutability: "view",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ type: "bytes32" }],
  },
  {
    type: "function",
    name: "publishedSupply",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "bytes32" }],
  },
  {
    type: "function",
    name: "redemptionFactorWad",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function",
    name: "SERIES_ID",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "bytes32" }],
  },
  /**
   * The LIVE total-supply handle, which is admin-granted to the token alone and must NEVER equal
   * `publishedSupply`. Publication isolates a snapshot first; if these two handles ever agreed, the
   * live handle would have been made permanently decryptable and Nox offers no way to undo it.
   */
  {
    type: "function",
    name: "confidentialAggregateSupply",
    stateMutability: "view",
    inputs: [],
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
    name: "decimals",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "uint8" }],
  },
] as const;

/** The provenance a balance cannot carry: which epoch, which sealed root, which lock. */
export const SERIES_OWNERSHIP_ABI = [
  {
    type: "function",
    name: "bindingOf",
    stateMutability: "view",
    inputs: [{ name: "quoteId", type: "bytes32" }],
    outputs: [
      {
        type: "tuple",
        components: [
          { name: "bound", type: "bool" },
          { name: "closed", type: "bool" },
          { name: "epochId", type: "bytes32" },
          { name: "graphRoot", type: "bytes32" },
          { name: "aggregateFillAmount", type: "uint256" },
          { name: "allocatedCount", type: "uint32" },
          { name: "unwoundCount", type: "uint32" },
        ],
      },
    ],
  },
  {
    type: "function",
    name: "claimOf",
    stateMutability: "view",
    inputs: [
      { name: "quoteId", type: "bytes32" },
      { name: "provider", type: "address" },
    ],
    outputs: [
      {
        type: "tuple",
        components: [
          { name: "state", type: "uint8" },
          { name: "provider", type: "address" },
          { name: "lockId", type: "bytes32" },
          { name: "allocatedAt", type: "uint64" },
          { name: "changedAt", type: "uint64" },
        ],
      },
    ],
  },
  {
    type: "function",
    name: "providersOf",
    stateMutability: "view",
    inputs: [{ name: "quoteId", type: "bytes32" }],
    outputs: [{ type: "address[]" }],
  },
] as const;

/**
 * PRD §19.1 as one published bit.
 *
 * `latestSnapshot` carries the PUBLIC inputs the verdict was computed from, so the page shows the
 * numbers as they stood at that block rather than as they are now — a coverage ratio recomputed from
 * live state beside a verdict computed from an older one would be two claims presented as one.
 */
export const SOLVENCY_VERIFIER_ABI = [
  {
    type: "function",
    name: "latestSnapshot",
    stateMutability: "view",
    inputs: [],
    outputs: [
      {
        type: "tuple",
        components: [
          { name: "blockNumber", type: "uint64" },
          { name: "takenAt", type: "uint64" },
          { name: "credit", type: "uint128" },
          { name: "pendingFee", type: "uint128" },
          { name: "vaultReserves", type: "uint256" },
          { name: "residueReserves", type: "uint256" },
          { name: "publicCoverage", type: "uint256" },
          { name: "verdictHandle", type: "bytes32" },
        ],
      },
    ],
  },
  {
    type: "function",
    name: "snapshotCount",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "uint32" }],
  },
  {
    type: "function",
    name: "publicCoverage",
    stateMutability: "view",
    inputs: [],
    outputs: [
      { name: "credit", type: "uint128" },
      { name: "pendingFee", type: "uint128" },
      { name: "vaultReserves", type: "uint256" },
      { name: "residueReserves", type: "uint256" },
      { name: "total", type: "uint256" },
    ],
  },
] as const;

/** Phase 6. Frozen selective disclosure — bindings only; a capsule's value is never read here. */
export const CAPSULE_VAULT_ABI = [
  {
    type: "function",
    name: "SERIES_ID",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "bytes32" }],
  },
  {
    type: "function",
    name: "DEPLOYMENT_ID",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "bytes32" }],
  },
  {
    type: "function",
    name: "capsuleCount",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "uint32" }],
  },
] as const;

/**
 * Phase 6. The Cross book's economics, all of them `immutable`.
 *
 * `MAX_FEE_BPS` is read alongside `FEE_BPS` on purpose: a fee is only meaningfully bounded if the
 * bound is read from the same contract rather than asserted by the page displaying it.
 */
export const CROSS_BOOK_ABI = [
  {
    type: "function",
    name: "PRICE_WAD",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "uint256" }],
  },
  // `uint16`, matching the contract. A uint16 return occupies a full word so decoding it as uint256
  // would produce the same number — but a declared width that is not the contract's width is a
  // transcription, and transcriptions are what `source-lock.json` exists to stop.
  {
    type: "function",
    name: "FEE_BPS",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "uint16" }],
  },
  {
    type: "function",
    name: "MAX_FEE_BPS",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "uint16" }],
  },
  {
    type: "function",
    name: "FEE_BENEFICIARY",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "address" }],
  },
  {
    type: "function",
    name: "SERIES_ID",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "bytes32" }],
  },
  {
    type: "function",
    name: "DEPLOYMENT_ID",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "bytes32" }],
  },
  {
    type: "function",
    name: "LOAN_TOKEN",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "address" }],
  },
  {
    type: "function",
    name: "KEEPER",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "address" }],
  },
  {
    type: "function",
    name: "MAX_ORDER_LIFETIME",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "uint64" }],
  },
] as const;

/**
 * Phase 6. The Roll book.
 *
 * `conversionWad` is a view, so reading it proves only what the contract chose to return. The
 * operands are read too, so the arithmetic can be reproduced rather than trusted.
 */
export const ROLL_BOOK_ABI = [
  {
    type: "function",
    name: "SOURCE_TOKEN",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "address" }],
  },
  {
    type: "function",
    name: "TARGET_TOKEN",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "address" }],
  },
  {
    type: "function",
    name: "TARGET_PRICE_WAD",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function",
    name: "MAX_ROLL_LIFETIME",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "uint64" }],
  },
  {
    type: "function",
    name: "SOURCE_SERIES_ID",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "bytes32" }],
  },
  {
    type: "function",
    name: "TARGET_SERIES_ID",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "bytes32" }],
  },
  {
    type: "function",
    name: "KEEPER",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "address" }],
  },
  {
    type: "function",
    name: "conversionWad",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function",
    name: "quoteRoll",
    stateMutability: "view",
    inputs: [{ name: "sourceAmount", type: "uint256" }],
    outputs: [{ name: "targetAmount", type: "uint256" }],
  },
  {
    type: "function",
    name: "submitIntent",
    stateMutability: "nonpayable",
    inputs: [
      { name: "encryptedAmount", type: "bytes32" },
      { name: "inputProof", type: "bytes" },
      { name: "expiry", type: "uint64" },
      { name: "nonce", type: "uint256" },
    ],
    outputs: [{ type: "bytes32" }],
  },
  {
    type: "function",
    name: "cancelIntent",
    stateMutability: "nonpayable",
    inputs: [{ name: "intentId", type: "bytes32" }],
    outputs: [],
  },
  {
    type: "function",
    name: "submittedBy",
    stateMutability: "view",
    inputs: [{ type: "address" }],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function",
    name: "intentIdFor",
    stateMutability: "view",
    inputs: [{ type: "address" }, { type: "uint256" }],
    outputs: [{ type: "bytes32" }],
  },
  {
    type: "function",
    name: "confidentialIntentEscrow",
    stateMutability: "view",
    inputs: [{ type: "bytes32" }],
    outputs: [{ type: "bytes32" }],
  },
  /**
   * `statusOf` returns the NEXT ACTION, which is why a roll survives being interrupted.
   *
   * A roll is not atomic and nothing in Kyrve claims it is (U-F11). A progress bar implying one
   * transaction would be the claim the contracts deliberately do not make, so the interface renders
   * the next action instead of a percentage.
   */
  {
    type: "function",
    name: "statusOf",
    stateMutability: "view",
    inputs: [{ type: "bytes32" }],
    outputs: [
      { name: "state", type: "uint8" },
      { name: "holder", type: "address" },
      { name: "netCount", type: "uint32" },
      { name: "residualHandle", type: "bytes32" },
      { name: "residualUnwound", type: "uint256" },
      { name: "next", type: "uint8" },
    ],
  },
  {
    type: "function",
    name: "supplyStatusOf",
    stateMutability: "view",
    inputs: [{ type: "bytes32" }],
    outputs: [
      { name: "state", type: "uint8" },
      { name: "supplier", type: "address" },
      { name: "expiry", type: "uint64" },
      { name: "netCount", type: "uint32" },
    ],
  },
  {
    type: "function",
    name: "supplyIdFor",
    stateMutability: "view",
    inputs: [{ type: "address" }, { type: "uint256" }],
    outputs: [{ type: "bytes32" }],
  },
  {
    type: "function",
    name: "nextNonce",
    stateMutability: "view",
    inputs: [{ type: "address" }],
    outputs: [{ type: "uint256" }],
  },
] as const;

/** `KyrveRollBook.IntentState`, in enum order. */
export enum IntentState {
  None = 0,
  Open = 1,
  ResidualDeclared = 2,
  Completed = 3,
  Cancelled = 4,
}

export const INTENT_STATE_LABEL: Readonly<Record<IntentState, string>> = {
  [IntentState.None]: "no intent",
  [IntentState.Open]: "open",
  [IntentState.ResidualDeclared]: "residual declared",
  [IntentState.Completed]: "completed",
  [IntentState.Cancelled]: "cancelled",
};

/** `KyrveRollBook.NextAction`, in enum order. The honest alternative to a progress bar. */
export enum NextAction {
  Nothing = 0,
  Net = 1,
  DeclareResidual = 2,
  SettleResidual = 3,
  Cancel = 4,
}

export const NEXT_ACTION_LABEL: Readonly<Record<NextAction, string>> = {
  [NextAction.Nothing]: "nothing further",
  [NextAction.Net]: "the keeper nets this intent against a supply",
  [NextAction.DeclareResidual]: "declare the residual",
  [NextAction.SettleResidual]: "settle the declared residual publicly",
  [NextAction.Cancel]: "cancel — the window has closed",
};

/**
 * Phase 6. The Cross book's order surface.
 *
 * `submitExit` and `submitEntry` take an `externalEuint256` and its input proof. The wallet that
 * encrypted must be the DIRECT CALLER — `Nox.fromExternal` binds the proof to owner, app contract,
 * chain id and a 3600 s expiry — so there is no relayer, no paymaster and no batch router on this path.
 */
export const CROSS_BOOK_ORDER_ABI = [
  {
    type: "function",
    name: "submitExit",
    stateMutability: "nonpayable",
    inputs: [
      { name: "encryptedAmount", type: "bytes32" },
      { name: "inputProof", type: "bytes" },
      { name: "expiry", type: "uint64" },
      { name: "nonce", type: "uint256" },
    ],
    outputs: [{ type: "bytes32" }],
  },
  {
    type: "function",
    name: "submitEntry",
    stateMutability: "nonpayable",
    inputs: [
      { name: "encryptedAmount", type: "bytes32" },
      { name: "inputProof", type: "bytes" },
      { name: "expiry", type: "uint64" },
      { name: "nonce", type: "uint256" },
    ],
    outputs: [{ type: "bytes32" }],
  },
  {
    type: "function",
    name: "cancel",
    stateMutability: "nonpayable",
    inputs: [{ name: "orderId", type: "bytes32" }],
    outputs: [],
  },
  {
    type: "function",
    name: "orderOf",
    stateMutability: "view",
    inputs: [{ type: "bytes32" }],
    outputs: [
      { name: "state", type: "uint8" },
      { name: "side", type: "uint8" },
      { name: "owner", type: "address" },
      { name: "openedAt", type: "uint64" },
      { name: "expiry", type: "uint64" },
      { name: "matchCount", type: "uint32" },
      { name: "residualHandle", type: "bytes32" },
      { name: "residualSettled", type: "uint256" },
    ],
  },
  {
    type: "function",
    name: "confidentialEscrowOf",
    stateMutability: "view",
    inputs: [{ type: "bytes32" }],
    outputs: [{ type: "bytes32" }],
  },
  {
    type: "function",
    name: "submittedBy",
    stateMutability: "view",
    inputs: [{ type: "address" }],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function",
    name: "orderIdFor",
    stateMutability: "view",
    inputs: [{ type: "address" }, { type: "uint8" }, { type: "uint256" }],
    outputs: [{ type: "bytes32" }],
  },
  {
    type: "function",
    name: "quoteAssets",
    stateMutability: "view",
    inputs: [{ name: "amount", type: "uint256" }],
    outputs: [
      { name: "proceeds", type: "uint256" },
      { name: "fee", type: "uint256" },
      { name: "net", type: "uint256" },
    ],
  },
  {
    type: "function",
    name: "MAX_ORDER_LIFETIME",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "uint64" }],
  },
  {
    type: "function",
    name: "nextNonce",
    stateMutability: "view",
    inputs: [{ type: "address" }],
    outputs: [{ type: "uint256" }],
  },
] as const;

/** `KyrveCrossBook.Side` and `OrderState`, in enum order. */
export const CROSS_SIDE = { Exit: 0, Entry: 1 } as const;

export enum OrderState {
  None = 0,
  Open = 1,
  Cancelled = 2,
  Settled = 3,
}

export const ORDER_STATE_LABEL: Readonly<Record<OrderState, string>> = {
  [OrderState.None]: "no order",
  [OrderState.Open]: "open",
  [OrderState.Cancelled]: "cancelled",
  [OrderState.Settled]: "settled",
};

/**
 * Phase 6. Reading a capsule, and the one way a holder creates one.
 *
 * A holder does not call the vault. `KyrveSeriesToken.issueOwnershipCapsule` is the entry point,
 * because `Nox.allow` requires the caller to be an admin on the handle and the token is the only
 * contract that ever is — so the token grants and the vault records. The vault could not make that
 * grant and must not be able to.
 */
export const CAPSULE_READ_ABI = [
  {
    type: "function",
    name: "capsuleOf",
    stateMutability: "view",
    inputs: [{ type: "bytes32" }],
    outputs: [
      {
        type: "tuple",
        components: [
          { name: "issued", type: "bool" },
          { name: "scope", type: "uint8" },
          { name: "subject", type: "address" },
          { name: "recipient", type: "address" },
          { name: "issuedAt", type: "uint64" },
          { name: "expiry", type: "uint64" },
          { name: "snapshotBlock", type: "uint64" },
          { name: "quoteId", type: "bytes32" },
          { name: "snapshotHandle", type: "bytes32" },
          { name: "factsDigest", type: "bytes32" },
        ],
      },
    ],
  },
  {
    type: "function",
    name: "capsulesFor",
    stateMutability: "view",
    inputs: [{ type: "address" }],
    outputs: [{ type: "bytes32[]" }],
  },
  {
    type: "function",
    name: "issuedBy",
    stateMutability: "view",
    inputs: [{ type: "address" }],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function",
    name: "originDigest",
    stateMutability: "view",
    inputs: [{ type: "bytes32" }],
    outputs: [{ type: "bytes32" }],
  },
  {
    type: "function",
    name: "assertsValidAt",
    stateMutability: "view",
    inputs: [{ type: "bytes32" }, { type: "uint256" }],
    outputs: [{ type: "bool" }],
  },
  {
    type: "function",
    name: "SERIES_ID",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "bytes32" }],
  },
  {
    type: "function",
    name: "DEPLOYMENT_ID",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "bytes32" }],
  },
  {
    type: "function",
    name: "CHAIN_ID",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function",
    name: "MARKET_ID",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "bytes32" }],
  },
  {
    type: "function",
    name: "CURATOR",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "address" }],
  },
  {
    type: "function",
    name: "MAX_CAPSULE_LIFETIME",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "uint64" }],
  },
] as const;

/** `KyrveCapsuleVault.Scope`, in enum order. */
export const CAPSULE_SCOPE_LABEL: readonly string[] = [
  "one provider's series ownership",
  "the aggregate series supply",
  "the public Midnight credit",
  "the solvency verdict",
  "a settled quote summary",
  "the declared residue",
  "allocation provenance",
];

/** The holder's own capsule entry point, on the series token. */
export const SERIES_TOKEN_CAPSULE_ABI = [
  {
    type: "function",
    name: "issueOwnershipCapsule",
    stateMutability: "nonpayable",
    inputs: [
      { name: "recipient", type: "address" },
      { name: "quoteId", type: "bytes32" },
      { name: "expiry", type: "uint64" },
      { name: "nonce", type: "uint256" },
    ],
    outputs: [
      { name: "capsuleId", type: "bytes32" },
      { name: "snapshot", type: "bytes32" },
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
    type: "event",
    name: "OwnershipCapsuleIssued",
    inputs: [
      { name: "capsuleId", type: "bytes32", indexed: true },
      { name: "subject", type: "address", indexed: true },
      { name: "recipient", type: "address", indexed: true },
      { name: "snapshotHandle", type: "bytes32", indexed: false },
    ],
  },
] as const;
