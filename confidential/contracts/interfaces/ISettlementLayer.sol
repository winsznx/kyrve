// SPDX-License-Identifier: GPL-2.0-or-later
pragma solidity 0.8.36;

/**
 * @notice Kyrve's public settlement layer, as seen from the confidential layer.
 *
 * ────────────────────────────────────────────────────────────────────────────────────────────
 * WHY THESE ARE DECLARED HERE INSTEAD OF IMPORTED
 * ────────────────────────────────────────────────────────────────────────────────────────────
 *
 * This is the mirror image of `contracts/kyrve/interfaces/ICurveLayer.sol`, and it exists for the
 * same reason in the opposite direction. The settlement layer is a SEPARATE COMPILATION UNIT at
 * solc **0.8.34**, because it imports Midnight interfaces and libraries directly and its runtime
 * bytecode must stay byte-comparable with the pinned release. This layer is at **0.8.36**, because
 * `@iexec-nox/nox-protocol-contracts@0.2.4` declares `pragma solidity ^0.8.35`. The two pins are
 * mutually exclusive — Phase 2 delta Q-1 — so importing `KyrveQuoteRegistry.sol` here would force
 * one of them to move.
 *
 * A cross-compiler CALL needs no shared source, only a matching ABI. So this file declares exactly
 * the entry points the confidential layer uses, with structs laid out FIELD FOR FIELD against the
 * 0.8.34 originals. `scripts/verify/settlement-abi.ts` compares these declarations against the
 * compiled Foundry artifacts on every gate run — selectors and return shapes both — so a field
 * reordered on either side fails a check rather than silently decoding one number as another.
 *
 * That check is not theoretical comfort. {QuoteExecution} packs three `uint128`s, two `uint40`s, an
 * enum and three addresses; a single reordering would make `exactUnits` decode as
 * `expectedBuyerAssets`, and both are plausible values of the same magnitude.
 *
 * Enums cross the boundary as `uint8`, which is what they already are on the wire. {KyrveQuoteStatus}
 * reproduces the one that matters so a magic number never appears at a call site.
 */

/// @notice Mirrors `KyrveQuoteTypes.QuoteStatus`. Only `Consumed` may be allocated against.
library KyrveQuoteStatus {
    uint8 internal constant NONE = 0;
    uint8 internal constant EXECUTABLE = 1;
    uint8 internal constant CONSUMED = 2;
    uint8 internal constant CANCELLED = 3;
    uint8 internal constant EXPIRED = 4;
}

/// @notice Mirrors `KyrveQuoteTypes.QuoteExecution`, field for field and in order.
struct SettlementQuoteExecution {
    bytes32 offerHash;
    bytes32 marketId;
    uint128 exactUnits;
    uint128 expectedBuyerAssets;
    uint128 maxPendingFee;
    uint40 expiry;
    uint40 activatedAt;
    uint8 status;
    address taker;
    address vault;
    address ratifier;
}

/// @notice Mirrors `KyrveQuoteTypes.QuoteProvenance`, field for field and in order.
struct SettlementQuoteProvenance {
    bytes32 epochId;
    bytes32 graphRoot;
    bytes32 requestId;
    bytes32 universeId;
    bytes32 deploymentId;
    bytes32 marketStructHash;
    /// @dev The published aggregate: the sum of reserved provider allocations, exactly. NOT the
    ///      winning leaf's capacity and NOT the Midnight units. Delta S-4 and delta T-1.
    uint256 aggregateFillAmount;
    int24 tick;
    uint8 marketIndex;
    uint8 rateIndex;
    uint16 leafIndex;
}

interface IKyrveQuoteRegistry {
    function executionOf(bytes32 quoteId) external view returns (SettlementQuoteExecution memory);
    function provenanceOf(bytes32 quoteId) external view returns (SettlementQuoteProvenance memory);
    /**
     * @notice The one quote an epoch produced, or zero if it never produced one.
     * @dev `KyrveQuoteRegistry` refuses a second quote for an epoch id it has already seen, forever,
     *      so this is total rather than a best guess. It is the ONLY way the confidential layer can
     *      discover whether a funded round has a quote it must not reclaim capital from under.
     */
    function quoteOfEpoch(bytes32 epochId) external view returns (bytes32);
    function DEPLOYMENT_ID() external view returns (bytes32);
}

/**
 * @notice The Midnight maker for one series.
 * @dev `positionOf` is the PUBLIC side of the solvency comparison. Midnight's credit ledger is
 *      public and Kyrve never claims otherwise; what stays private is who the credit is held for and
 *      in what proportions.
 *
 *      Carry-over from Phase 4, and it cost an assertion: `credit` and `debt` are cumulative MARKET
 *      POSITIONS, not per-quote amounts. One vault is the maker for every quote of its series, so the
 *      figure describing one settlement is the DELTA across its block. Delta S-8.
 */
interface IKyrveSeriesVault {
    function positionOf(bytes32 marketId) external view returns (uint128 credit, uint128 debt, uint128 pendingFee);
    function availableFunding() external view returns (uint256);
    function committedFunding() external view returns (uint256);
    function SERIES_ID() external view returns (bytes32);
    function LOAN_TOKEN() external view returns (address);
}

/// @notice The minimum of ERC-20 the residue policy needs. Public amounts only, by construction.
interface IPublicLoanToken {
    function balanceOf(address account) external view returns (uint256);
    function transfer(address to, uint256 amount) external returns (bool);
}
