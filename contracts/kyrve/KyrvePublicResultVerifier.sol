// SPDX-License-Identifier: GPL-2.0-or-later
pragma solidity 0.8.34;

import {
    CurveEpoch,
    CurveEpochStage,
    CurvePublishedHandles,
    CurveQuoteResult,
    CurveResultRole,
    ICurveGraphRegistry,
    ICurveResultVerifier,
    INoxCurveEngine,
    IQuoteEpochController
} from "./interfaces/ICurveLayer.sol";

/// @notice One epoch's public surface, verified and bound, ready to become an offer.
struct VerifiedCurveResult {
    bytes32 epochId;
    bytes32 graphRoot;
    bytes32 requestId;
    bytes32 universeId;
    bytes32 universeHash;
    address borrower;
    uint8 marketIndex;
    uint8 rateIndex;
    /// @dev The sum of RESERVED PROVIDER ALLOCATIONS, exactly. Not the winning leaf's capacity.
    uint256 aggregateFillAmount;
    CurvePublishedHandles handles;
}

/**
 * @title KyrvePublicResultVerifier
 * @notice The settlement layer's only door onto the confidential layer, and the contract that turns
 *         "a valid gateway proof exists" into "this number belongs to this quote" (PRD §14.1,
 *         v1.1 A-11).
 *
 * ────────────────────────────────────────────────────────────────────────────────────────────
 * FOUR THINGS A GATEWAY PROOF DOES NOT SAY
 * ────────────────────────────────────────────────────────────────────────────────────────────
 *
 * `INoxCompute.validateDecryptionProof` is a pure EIP-712 signature check: no ACL, no nonce, no
 * expiry, no caller binding. It attests only that the gateway decrypted SOME handle to SOME value,
 * and once issued it is replayable by anyone forever. It does not say which epoch the handle
 * belongs to, which role it plays, whether the computation that produced it finished, or whether
 * the handle is even one this epoch published. `CurveResultVerifier` supplies the first two by
 * binding through the sealed operation graph. This contract supplies the other two, and the checks
 * that make the answer usable for settlement.
 *
 * ────────────────────────────────────────────────────────────────────────────────────────────
 * DELTA R-14, WHICH IS THE REASON THE HANDLES ARE RE-READ HERE
 * ────────────────────────────────────────────────────────────────────────────────────────────
 *
 * The five published handles are written across TWO transactions: `publishWinner` sets four,
 * `publishAggregate` sets the fifth and seals the graph. A caller that reads the set after the
 * first gets four valid handles and one that has never been written. The undefined handle carries
 * an embedded chain id of 0, so the gateway answers `unknown_chain: chain_id 0 not configured` — a
 * message naming neither the handle nor the mistake, on a path where the other four decrypt
 * perfectly.
 *
 * Two defences, both here:
 *
 *   1. The handle set is read from the ENGINE at call time, never accepted from the caller, so a
 *      stale off-chain snapshot cannot be presented.
 *   2. Every one of the five is checked against the handle the GRAPH registered for its role,
 *      BEFORE any proof reaches the gateway. A zero handle, an unwritten handle, a handle from
 *      another epoch and a handle for the wrong role are each refused by name, on chain, for free.
 *
 * The seal check subsumes the ordering problem — `sealGraph` requires all five roles registered —
 * but the per-role check is kept because it names WHICH handle is wrong, and because
 * `requireRegisteredResult` is the weaker mid-epoch form the engine itself uses.
 *
 * Everything here is `view`. This contract holds no state, moves nothing, and can be called by
 * anyone at any time.
 */
contract KyrvePublicResultVerifier {
    error AggregateIsZero(bytes32 epochId);
    error EpochNotComplete(bytes32 epochId, uint8 stage);
    error GraphNotSealed(bytes32 epochId);
    error GraphRootMismatch(bytes32 epochId, bytes32 expected, bytes32 actual);
    error IndexOutOfRange(uint8 role, uint256 value);
    error PrivacyFloorNotMet(bytes32 epochId);
    error PublishedHandleMissing(bytes32 epochId, uint8 role);
    error PublishedHandleUnregistered(bytes32 epochId, uint8 role, bytes32 expected, bytes32 published);
    error QuoteNotReady(bytes32 epochId);
    error RequestMismatch(bytes32 epochId, bytes32 expected, bytes32 actual);
    error UniverseMismatch(bytes32 epochId, bytes32 expected, bytes32 actual);
    error ZeroAddress(string field);

    ICurveResultVerifier public immutable CURVE_VERIFIER;
    ICurveGraphRegistry public immutable GRAPH;
    INoxCurveEngine public immutable ENGINE;
    IQuoteEpochController public immutable EPOCHS;

    constructor(
        ICurveResultVerifier curveVerifier,
        ICurveGraphRegistry graph,
        INoxCurveEngine engine,
        IQuoteEpochController epochs
    ) {
        require(address(curveVerifier) != address(0), ZeroAddress("curveVerifier"));
        require(address(graph) != address(0), ZeroAddress("graph"));
        require(address(engine) != address(0), ZeroAddress("engine"));
        require(address(epochs) != address(0), ZeroAddress("epochs"));
        CURVE_VERIFIER = curveVerifier;
        GRAPH = graph;
        ENGINE = engine;
        EPOCHS = epochs;
    }

    /// @notice The five published handles, read fresh from the engine and checked against the graph.
    /// @dev Separated out so the terminal and the activation scripts can run exactly the check the
    ///      settlement path runs, without submitting anything and without a gateway round trip.
    function requireFreshHandles(bytes32 epochId) public view returns (CurvePublishedHandles memory handles) {
        handles = ENGINE.publishedOf(epochId);
        _requireBound(epochId, CurveResultRole.SELECTED_MARKET_INDEX, handles.marketIndex);
        _requireBound(epochId, CurveResultRole.SELECTED_RATE_INDEX, handles.rateIndex);
        _requireBound(epochId, CurveResultRole.PRIVACY_FLOOR_PASSED, handles.floorPassed);
        _requireBound(epochId, CurveResultRole.QUOTE_READY, handles.quoteReady);
        _requireBound(epochId, CurveResultRole.AGGREGATE_FILL_AMOUNT, handles.aggregateFill);
    }

    /**
     * @notice Verifies one finished epoch against the identity the caller expects it to have.
     * @param expectedGraphRoot the sealed root the caller believes this epoch produced. Supplied
     *        rather than read so that a caller working from a stale view is refused explicitly
     *        instead of being silently corrected onto a different computation.
     * @param expectedRequestId the borrower request this quote must answer.
     * @param expectedUniverseId the universe it must have been computed over.
     */
    function verifyForActivation(
        bytes32 epochId,
        bytes32 expectedGraphRoot,
        bytes32 expectedRequestId,
        bytes32 expectedUniverseId,
        bytes calldata marketProof,
        bytes calldata rateProof,
        bytes calldata floorProof,
        bytes calldata readyProof,
        bytes calldata aggregateProof
    ) external view returns (VerifiedCurveResult memory verified) {
        // Order matters. Everything free and local happens before anything that touches a proof, so
        // a caller can never learn whether an arbitrary proof would have verified against an epoch
        // that was never going to qualify.
        CurveEpoch memory epoch = EPOCHS.epochOf(epochId);
        require(epoch.stage == CurveEpochStage.COMPLETE, EpochNotComplete(epochId, epoch.stage));
        require(GRAPH.isSealed(epochId), GraphNotSealed(epochId));

        bytes32 root = GRAPH.rootOf(epochId);
        require(root == expectedGraphRoot, GraphRootMismatch(epochId, expectedGraphRoot, root));
        require(epoch.requestId == expectedRequestId, RequestMismatch(epochId, expectedRequestId, epoch.requestId));
        require(epoch.universeId == expectedUniverseId, UniverseMismatch(epochId, expectedUniverseId, epoch.universeId));

        CurvePublishedHandles memory handles = requireFreshHandles(epochId);

        CurveQuoteResult memory result =
            CURVE_VERIFIER.verifyQuote(epochId, marketProof, rateProof, floorProof, readyProof, aggregateProof);

        // `CurveResultVerifier` returns the root it read; if it ever disagreed with the root read
        // above, one of the two contracts is pointed at a different graph registry.
        require(result.graphRoot == root, GraphRootMismatch(epochId, root, result.graphRoot));

        require(result.quoteReady, QuoteNotReady(epochId));
        require(result.privacyFloorPassed, PrivacyFloorNotMet(epochId));
        require(result.aggregateFillAmount != 0, AggregateIsZero(epochId));

        require(
            result.marketIndex <= type(uint8).max,
            IndexOutOfRange(CurveResultRole.SELECTED_MARKET_INDEX, result.marketIndex)
        );
        require(
            result.rateIndex <= type(uint8).max, IndexOutOfRange(CurveResultRole.SELECTED_RATE_INDEX, result.rateIndex)
        );

        verified = VerifiedCurveResult({
            epochId: epochId,
            graphRoot: root,
            requestId: epoch.requestId,
            universeId: epoch.universeId,
            universeHash: epoch.universeHash,
            borrower: epoch.borrower,
            marketIndex: uint8(result.marketIndex),
            rateIndex: uint8(result.rateIndex),
            aggregateFillAmount: result.aggregateFillAmount,
            handles: handles
        });
    }

    /// @notice Whether an epoch has reached a state settlement could be attempted from.
    function isActivatable(bytes32 epochId) external view returns (bool) {
        if (EPOCHS.epochOf(epochId).stage != CurveEpochStage.COMPLETE) return false;
        if (!GRAPH.isSealed(epochId)) return false;
        CurvePublishedHandles memory handles = ENGINE.publishedOf(epochId);
        return handles.marketIndex != bytes32(0) && handles.rateIndex != bytes32(0) && handles.floorPassed != bytes32(0)
            && handles.quoteReady != bytes32(0) && handles.aggregateFill != bytes32(0);
    }

    function _requireBound(bytes32 epochId, uint8 role, bytes32 handle) private view {
        require(handle != bytes32(0), PublishedHandleMissing(epochId, role));
        bytes32 expected = GRAPH.expectedResultHandle(epochId, role);
        require(expected == handle, PublishedHandleUnregistered(epochId, role, expected, handle));
    }
}
