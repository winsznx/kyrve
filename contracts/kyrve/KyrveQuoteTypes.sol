// SPDX-License-Identifier: GPL-2.0-or-later
pragma solidity 0.8.34;

/**
 * @title KyrveQuoteTypes
 * @notice The shape of one activated Kyrve quote, split by who reads it and how often.
 *
 * ────────────────────────────────────────────────────────────────────────────────────────────
 * WHY TWO STRUCTS AND NOT ONE
 * ────────────────────────────────────────────────────────────────────────────────────────────
 *
 * `isRatified` runs inside `Midnight.take` and `onBuy` runs inside the same transaction, so both
 * are on the settlement hot path and both pay for every storage word they touch. The provenance
 * fields — which epoch, which graph root, which request, which universe, which deployment — are
 * needed to AUDIT a quote and never to EXECUTE one. Folding them into a single struct would make
 * every `take` read thirteen cold slots to check four values.
 *
 * The split is not a weakening: provenance is bound into `offerHash` indirectly (through the quote
 * id, which is `offer.group`) and directly through {QuoteProvenance}, and `quoteIdFor` folds every
 * provenance field, so a quote cannot carry execution terms from one epoch and provenance from
 * another.
 *
 * ────────────────────────────────────────────────────────────────────────────────────────────
 * PUBLIC / PRIVATE BOUNDARY
 * ────────────────────────────────────────────────────────────────────────────────────────────
 *
 *   PUBLIC FROM ACTIVATION   every field in both structs, without exception. Activating a quote is
 *                            the moment the selected market, the selected rate, the aggregate
 *                            amount and the approved borrower become public, and the UI must say so
 *                            before the signature (`.claude/rules/security.md`).
 *   PRIVATE, ALWAYS          the rest of the curve: per-provider allocations, per-leaf capacities,
 *                            the provider count for the winning leaf, every rejected leaf, and the
 *                            winning leaf's own total capacity. None of them is representable here,
 *                            which is the point — a struct that cannot hold a private value cannot
 *                            leak one.
 *
 * The one number that deserves naming explicitly is {QuoteProvenance-aggregateFillAmount}. It is
 * the SUM OF RESERVED PROVIDER ALLOCATIONS, not the winning leaf's capacity. Those differ by
 * deterministic floor-division dust, and publishing the capacity instead would disclose private
 * capacity and would not match what providers actually owe. See `NoxCurveEngine.publishAggregate`.
 */

/// @notice Lifecycle of one activated quote. Terminal states are never left.
/// @dev `Cancelled` and `Expired` are deliberately distinct despite both being terminal and both
///      pre-consuming the Midnight group. They record WHO ended the quote and WHY: `Cancelled` is a
///      deliberate retirement while the window was still open, `Expired` is recovery after it
///      closed and is permissionless. Collapsing them would make an operator-initiated cancellation
///      indistinguishable from a keeper timeout in the public record.
enum QuoteStatus {
    None,
    Executable,
    Consumed,
    Cancelled,
    Expired
}

/**
 * @notice What the ratifier and the series vault need to authorise and size one fill.
 * @dev Seven slots, ordered so the four the ratifier reads land in the first four.
 *
 *      `maxPendingFee` exists because `onBuy` receives `pendingFeeIncrease` — the continuous fee
 *      accruing on new credit — which is the maker's real fee exposure. The SETTLEMENT fee is
 *      deliberately absent: for a buy offer the maker's payment is exactly
 *      `floor(units * tickToPrice(tick) / WAD)`, independent of it, so binding it would defend the
 *      wrong threat (PRD v1.1 A-4, A-6).
 */
struct QuoteExecution {
    /// @dev `keccak256(abi.encode(offer))` over the ENTIRE `Offer`, including the embedded `Market`.
    bytes32 offerHash;
    /// @dev Midnight's own `IdLib.toId`, which is a CREATE2 hash and not `keccak256(market)`.
    bytes32 marketId;
    uint128 exactUnits;
    uint128 expectedBuyerAssets;
    uint128 maxPendingFee;
    uint40 expiry;
    uint40 activatedAt;
    QuoteStatus status;
    /// @dev The one borrower this quote may settle for. Anyone else is a public revert.
    address taker;
    /// @dev The maker, the callback, and the only address permitted to mark this quote consumed.
    address vault;
    address ratifier;
}

/**
 * @notice Where this quote came from, and the identity it can never be separated from.
 * @dev Read by verifiers, indexers and the terminal. Never read inside `take`.
 */
struct QuoteProvenance {
    bytes32 epochId;
    /// @dev The sealed `CurveGraphRegistry` root at activation. A later epoch has a different root,
    ///      so a quote can never be re-presented against a different computation.
    bytes32 graphRoot;
    bytes32 requestId;
    bytes32 universeId;
    /// @dev `keccak256` over this settlement deployment's immutable wiring. See
    ///      {KyrveQuoteRegistry.DEPLOYMENT_ID}.
    bytes32 deploymentId;
    /// @dev `keccak256(abi.encode(market))` — NOT the market id. Both are bound because they answer
    ///      different questions: the id says which market Midnight accounts against, the struct
    ///      hash says which exact bytes were presented to it.
    bytes32 marketStructHash;
    /// @dev The published aggregate: the sum of reserved provider allocations, exactly.
    uint256 aggregateFillAmount;
    int24 tick;
    uint8 marketIndex;
    uint8 rateIndex;
    uint16 leafIndex;
}
