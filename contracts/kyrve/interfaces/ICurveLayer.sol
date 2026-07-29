// SPDX-License-Identifier: GPL-2.0-or-later
pragma solidity 0.8.34;

/**
 * @notice Kyrve's confidential curve layer, as seen from the settlement layer.
 *
 * ────────────────────────────────────────────────────────────────────────────────────────────
 * WHY THESE ARE DECLARED HERE INSTEAD OF IMPORTED
 * ────────────────────────────────────────────────────────────────────────────────────────────
 *
 * The confidential layer is a SEPARATE COMPILATION UNIT at solc 0.8.36, because
 * `@iexec-nox/nox-protocol-contracts@0.2.4` declares `pragma solidity ^0.8.35` and the Midnight
 * substrate is pinned at 0.8.34 so its runtime bytecode stays byte-comparable with the pinned
 * release (Phase 2 delta Q-1, `.claude/rules/contracts.md`). Importing `CurveResultVerifier.sol`
 * into this unit would force one of those two pins to move.
 *
 * A cross-compiler CALL needs no shared source — only a matching ABI. So the settlement layer
 * declares exactly the five entry points it uses, with structs laid out field-for-field against the
 * 0.8.36 originals. `scripts/verify/curve-abi.ts` compares these declarations against the compiled
 * confidential artifacts on every gate run, so a field reordered on either side fails a check
 * rather than silently decoding one number as another.
 *
 * Enums cross the boundary as `uint8`, which is what they already are on the wire. The two that
 * matter are reproduced as constants below so a magic number never appears at a call site.
 */

/// @notice Mirrors `CurveGraphRegistry.ResultRole`. Five values may ever cross the public boundary.
library CurveResultRole {
    uint8 internal constant SELECTED_MARKET_INDEX = 0;
    uint8 internal constant SELECTED_RATE_INDEX = 1;
    uint8 internal constant PRIVACY_FLOOR_PASSED = 2;
    uint8 internal constant QUOTE_READY = 3;
    uint8 internal constant AGGREGATE_FILL_AMOUNT = 4;

    uint8 internal constant COUNT = 5;
}

/// @notice Mirrors `QuoteEpochController.Stage`. Only `Complete` may be settled against.
library CurveEpochStage {
    uint8 internal constant OPEN = 0;
    uint8 internal constant CACHE_PROVIDERS = 1;
    uint8 internal constant ACCUMULATE = 2;
    uint8 internal constant FINALIZE_LEAVES = 3;
    uint8 internal constant REDUCE_WINNER = 4;
    uint8 internal constant PUBLISH_WINNER = 5;
    uint8 internal constant ALLOCATE = 6;
    uint8 internal constant PUBLISH_AGGREGATE = 7;
    uint8 internal constant COMPLETE = 8;
    uint8 internal constant CANCELLED = 9;
}

/// @notice Mirrors `CurveResultVerifier.QuoteResult`.
struct CurveQuoteResult {
    uint256 marketIndex;
    uint256 rateIndex;
    bool privacyFloorPassed;
    bool quoteReady;
    uint256 aggregateFillAmount;
    bytes32 graphRoot;
}

/// @notice Mirrors `NoxCurveEngine.Published`. Five handles, nothing else.
struct CurvePublishedHandles {
    bytes32 marketIndex;
    bytes32 rateIndex;
    bytes32 floorPassed;
    bytes32 quoteReady;
    bytes32 aggregateFill;
}

/// @notice Mirrors `QuoteEpochController.Epoch`.
struct CurveEpoch {
    bytes32 universeId;
    bytes32 universeHash;
    bytes32 requestId;
    address borrower;
    uint16 providerCount;
    uint16 marketCount;
    uint16 leafCount;
    uint8 stage;
    uint64 openedAt;
    uint64 sealedAt;
    uint64 deadline;
}

/// @notice Mirrors `CurveUniverseRegistry.MarketSpec`.
struct CurveMarketSpec {
    bytes32 marketId;
    bytes32 marketStructHash;
    uint64 maturity;
    uint16 collateralFamily;
    uint16 maturityBucket;
    uint32 tickSpacing;
    uint256 settlementFeeFloorWad;
    uint16 publicPriority;
}

/// @notice Mirrors `CurveUniverseRegistry.Leaf`.
struct CurveLeaf {
    uint8 marketIndex;
    uint8 rateIndex;
    int24 tick;
    uint256 priceWad;
}

/**
 * @notice The read-only verifier that turns a replayable gateway proof into a statement about one
 *         specific epoch.
 * @dev `validateDecryptionProof` is a pure EIP-712 signature check — no ACL, no nonce, no expiry,
 *      no caller binding — so a proof is replayable by anyone forever. This interface is the ONLY
 *      route by which a proof reaches the settlement layer, and it refuses any handle the epoch's
 *      sealed graph did not commit to for the role being claimed.
 */
interface ICurveResultVerifier {
    function verifyQuote(
        bytes32 epochId,
        bytes calldata marketProof,
        bytes calldata rateProof,
        bytes calldata floorProof,
        bytes calldata readyProof,
        bytes calldata aggregateProof
    ) external view returns (CurveQuoteResult memory result);

    function isVerifiable(bytes32 epochId) external view returns (bool);
}

interface ICurveGraphRegistry {
    function isSealed(bytes32 epochId) external view returns (bool);
    function rootOf(bytes32 epochId) external view returns (bytes32);
    function expectedResultHandle(bytes32 epochId, uint8 role) external view returns (bytes32);
    function isRegisteredResult(bytes32 epochId, bytes32 handle) external view returns (bool);
}

interface INoxCurveEngine {
    function publishedOf(bytes32 epochId) external view returns (CurvePublishedHandles memory);
}

interface IQuoteEpochController {
    function epochOf(bytes32 epochId) external view returns (CurveEpoch memory);
}

interface ICurveUniverseRegistry {
    function requireActive(bytes32 universeId) external view returns (bytes32 universeHash);
    function marketAt(bytes32 universeId, uint256 marketIndex) external view returns (CurveMarketSpec memory);
    function leafAt(bytes32 universeId, uint256 leafIndex) external view returns (CurveLeaf memory);
    function leafCount(bytes32 universeId) external view returns (uint256);
}
