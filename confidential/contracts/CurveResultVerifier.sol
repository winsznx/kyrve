// SPDX-License-Identifier: GPL-2.0-or-later
pragma solidity 0.8.36;

import {Nox} from "@iexec-nox/nox-protocol-contracts/contracts/sdk/Nox.sol";
import {INoxCompute} from "@iexec-nox/nox-protocol-contracts/contracts/interfaces/INoxCompute.sol";

import {CurveGraphRegistry} from "./CurveGraphRegistry.sol";
import {DecryptedValue} from "./DecryptedValue.sol";
import {NoxCurveEngine} from "./NoxCurveEngine.sol";
import {QuoteEpochController} from "./QuoteEpochController.sol";

/**
 * @title CurveResultVerifier
 * @notice Read-only. Turns a replayable gateway proof into a statement about one specific quote.
 *
 * ────────────────────────────────────────────────────────────────────────────────────────────
 * WHAT THIS PROVES, AND WHAT IT DOES NOT
 * ────────────────────────────────────────────────────────────────────────────────────────────
 *
 * `INoxCompute.validateDecryptionProof` is a pure EIP-712 signature check — no ACL, no nonce, no
 * expiry, no caller binding. On its own it establishes only
 *
 *     "the gateway attests that handle H decrypts to V"
 *
 * and a proof, once issued, is replayable by anyone forever.
 *
 * This contract adds the two checks that make it mean something about a quote:
 *
 *   1. the epoch's operation graph is SEALED, so the computation is complete and committed to;
 *   2. `H` is exactly the handle that graph registered for the role being claimed.
 *
 * **A valid gateway proof for an unregistered handle is rejected, and so is a valid proof for a
 * real handle belonging to a different epoch.** That is the whole point, it is demonstration 16,
 * and it is the property `QuoteActivator` will depend on in Phase 4.
 *
 * It does NOT prove that the value is economically correct, that providers can still pay, or that
 * the market is live. Those are settlement concerns and belong to the phase that settles.
 *
 * Every function here is `view`: this contract holds no state, moves nothing, and can be called by
 * anyone at any time without risk.
 */
contract CurveResultVerifier {
    struct QuoteResult {
        uint256 marketIndex;
        uint256 rateIndex;
        bool privacyFloorPassed;
        bool quoteReady;
        uint256 aggregateFillAmount;
        bytes32 graphRoot;
    }

    CurveGraphRegistry public immutable graph;
    NoxCurveEngine public immutable engine;
    QuoteEpochController public immutable controller;

    error ZeroAddress();
    error GraphNotSealed(bytes32 epochId);
    error BooleanOutOfRange(bytes32 handle, uint256 value);

    constructor(CurveGraphRegistry graph_, NoxCurveEngine engine_, QuoteEpochController controller_) {
        if (address(graph_) == address(0) || address(engine_) == address(0) || address(controller_) == address(0)) {
            revert ZeroAddress();
        }
        graph = graph_;
        engine = engine_;
        controller = controller_;
    }

    /**
     * @notice Verifies one public result of one epoch.
     * @param handle the handle the proof was issued for. Supplied by the caller rather than read
     *        from the engine so that a caller presenting the WRONG handle is refused explicitly by
     *        {CurveGraphRegistry.requireBoundResult} instead of being silently corrected.
     * @return value the decrypted number, and only then.
     */
    function verifyResult(
        bytes32 epochId,
        CurveGraphRegistry.ResultRole role,
        bytes32 handle,
        bytes calldata decryptionProof
    ) public view returns (uint256 value) {
        // Order matters. Bind first: an unbound handle must be refused before its proof is even
        // looked at, so a caller can never learn whether an arbitrary proof would have verified.
        graph.requireBoundResult(epochId, role, handle);
        bytes memory decoded = INoxCompute(Nox.noxComputeContract()).validateDecryptionProof(handle, decryptionProof);
        // The gateway encodes the plaintext at its natural width, so a published `euint16` arrives
        // as two bytes and a `euint256` as thirty-two. `abi.decode` would revert on the former.
        value = DecryptedValue.toUint(decoded);
    }

    /// @notice The whole public surface of one quote, verified together.
    function verifyQuote(
        bytes32 epochId,
        bytes calldata marketProof,
        bytes calldata rateProof,
        bytes calldata floorProof,
        bytes calldata readyProof,
        bytes calldata aggregateProof
    ) external view returns (QuoteResult memory result) {
        if (!graph.isSealed(epochId)) revert GraphNotSealed(epochId);
        NoxCurveEngine.Published memory published = engine.publishedOf(epochId);

        result.marketIndex = verifyResult(
            epochId, CurveGraphRegistry.ResultRole.SelectedMarketIndex, published.marketIndex, marketProof
        );
        result.rateIndex =
            verifyResult(epochId, CurveGraphRegistry.ResultRole.SelectedRateIndex, published.rateIndex, rateProof);
        result.privacyFloorPassed = _asBool(
            published.floorPassed,
            verifyResult(epochId, CurveGraphRegistry.ResultRole.PrivacyFloorPassed, published.floorPassed, floorProof)
        );
        result.quoteReady = _asBool(
            published.quoteReady,
            verifyResult(epochId, CurveGraphRegistry.ResultRole.QuoteReady, published.quoteReady, readyProof)
        );
        result.aggregateFillAmount = verifyResult(
            epochId, CurveGraphRegistry.ResultRole.AggregateFillAmount, published.aggregateFill, aggregateProof
        );
        result.graphRoot = graph.rootOf(epochId);
    }

    /// @notice Whether an epoch has reached a state where its results can be verified at all.
    function isVerifiable(bytes32 epochId) external view returns (bool) {
        return graph.isSealed(epochId);
    }

    /**
     * @dev The four boolean results are published as 0/1 `euint16`. Anything else means the
     *      published handle was not what this contract believes it is, so it reverts rather than
     *      coercing — a silent `!= 0` would turn a corrupted result into a confident `true`.
     */
    function _asBool(bytes32 handle, uint256 value) private pure returns (bool) {
        if (value > 1) revert BooleanOutOfRange(handle, value);
        return value == 1;
    }
}
