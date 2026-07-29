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
