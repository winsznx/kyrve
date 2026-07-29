// SPDX-License-Identifier: GPL-2.0-or-later
pragma solidity 0.8.34;

import {
    CurveEpoch,
    CurveLeaf,
    CurveMarketSpec,
    CurvePublishedHandles,
    CurveQuoteResult,
    ICurveGraphRegistry,
    ICurveResultVerifier,
    ICurveUniverseRegistry,
    INoxCurveEngine,
    IQuoteEpochController
} from "../interfaces/ICurveLayer.sol";

/**
 * @notice A test double for the confidential curve layer, and NOTHING MORE.
 *
 * ════════════════════════════════════════════════════════════════════════════════════════════
 * WHAT THIS PROVES AND WHAT IT CANNOT
 * ════════════════════════════════════════════════════════════════════════════════════════════
 *
 * The confidential layer compiles at solc 0.8.36 against the pinned iExec Nox protocol contracts,
 * and every Nox primitive is an external call whose result is computed off chain by a real KMS,
 * ingestor and runner. Foundry cannot drive that stack, and `vm.etch`-ing a fake NoxCompute would
 * be a mocked confidentiality path, which is forbidden outright.
 *
 * So this suite deliberately splits the question in two:
 *
 *   HERE, against REAL unmodified Midnight, with this stub standing in for Kyrve's own curve
 *   contracts: does the settlement composition hold? Exact fill, rollback, replay, cancellation,
 *   expiry, funding, callback authorisation, offer binding.
 *
 *   IN `confidential/test/90-quote-settlement.ts`, against the REAL Nox stack AND real unmodified
 *   Midnight on one chain: does a real encrypted epoch produce a real public result that really
 *   settles? Real handles, real gateway proofs, real ACL refusals.
 *
 * **Nothing this stub returns is evidence about confidentiality.** It answers "given a verified
 * result, does settlement behave?", and the word "given" is doing all the work. The proof that a
 * result is verified at all is the other suite's job, and the gate reports the two separately.
 *
 * The stub is faithful in the two ways that matter for the settlement tests: it reverts
 * `ResultNotRegistered` for a role that was never registered, exactly as `CurveGraphRegistry` does,
 * so the partial-handle-set failure of delta R-14 is reachable here; and it rejects a proof whose
 * bytes are not the bytes it was configured with, so a tampered proof is refused rather than
 * silently accepted.
 */
contract CurveLayerStub is
    ICurveResultVerifier,
    ICurveGraphRegistry,
    INoxCurveEngine,
    IQuoteEpochController,
    ICurveUniverseRegistry
{
    error ResultNotRegistered(bytes32 epochId, uint8 role);
    error StubGraphNotSealed(bytes32 epochId);
    error StubProofRejected(bytes32 epochId, uint8 role);
    error UnknownUniverse(bytes32 universeId);
    error UniverseNotActive(bytes32 universeId);

    mapping(bytes32 => CurveEpoch) private _epochs;
    mapping(bytes32 => bool) private _sealed;
    mapping(bytes32 => bytes32) private _roots;
    mapping(bytes32 => CurvePublishedHandles) private _published;
    mapping(bytes32 => mapping(uint8 => bytes32)) private _resultHandle;
    mapping(bytes32 => mapping(uint8 => bool)) private _resultRegistered;
    mapping(bytes32 => CurveQuoteResult) private _results;
    mapping(bytes32 => mapping(uint8 => bytes32)) private _expectedProof;

    mapping(bytes32 => bool) private _universeKnown;
    mapping(bytes32 => bool) private _universeActive;
    mapping(bytes32 => bytes32) private _universeHash;
    mapping(bytes32 => CurveMarketSpec[]) private _markets;
    mapping(bytes32 => CurveLeaf[]) private _leaves;

    // ── Configuration
    // ─────────────────────────────────────────────────────────────────────────

    function setEpoch(bytes32 epochId, CurveEpoch calldata epoch) external {
        _epochs[epochId] = epoch;
    }

    function setStage(bytes32 epochId, uint8 stage) external {
        _epochs[epochId].stage = stage;
    }

    function setSealed(bytes32 epochId, bool sealedGraph, bytes32 root) external {
        _sealed[epochId] = sealedGraph;
        _roots[epochId] = root;
    }

    function setPublished(bytes32 epochId, CurvePublishedHandles calldata handles) external {
        _published[epochId] = handles;
    }

    /// @dev Registering a role is what `CurveGraphRegistry.registerResult` does before publication.
    ///      A role left unregistered reverts on read, which is the behaviour delta R-14 depends on.
    function registerResult(bytes32 epochId, uint8 role, bytes32 handle, bytes32 proofDigest) external {
        _resultHandle[epochId][role] = handle;
        _resultRegistered[epochId][role] = true;
        _expectedProof[epochId][role] = proofDigest;
    }

    function unregisterResult(bytes32 epochId, uint8 role) external {
        _resultRegistered[epochId][role] = false;
    }

    function setResult(bytes32 epochId, CurveQuoteResult calldata result) external {
        _results[epochId] = result;
    }

    function setUniverse(bytes32 universeId, bool active, bytes32 hash_) external {
        _universeKnown[universeId] = true;
        _universeActive[universeId] = active;
        _universeHash[universeId] = hash_;
    }

    function addMarket(bytes32 universeId, CurveMarketSpec calldata spec) external {
        _markets[universeId].push(spec);
    }

    function addLeaf(bytes32 universeId, CurveLeaf calldata leaf) external {
        _leaves[universeId].push(leaf);
    }

    function setMarket(bytes32 universeId, uint256 index, CurveMarketSpec calldata spec) external {
        _markets[universeId][index] = spec;
    }

    function setLeaf(bytes32 universeId, uint256 index, CurveLeaf calldata leaf) external {
        _leaves[universeId][index] = leaf;
    }

    // ── ICurveResultVerifier
    // ──────────────────────────────────────────────────────────────────

    function verifyQuote(
        bytes32 epochId,
        bytes calldata marketProof,
        bytes calldata rateProof,
        bytes calldata floorProof,
        bytes calldata readyProof,
        bytes calldata aggregateProof
    ) external view returns (CurveQuoteResult memory) {
        if (!_sealed[epochId]) revert StubGraphNotSealed(epochId);
        _requireProof(epochId, 0, marketProof);
        _requireProof(epochId, 1, rateProof);
        _requireProof(epochId, 2, floorProof);
        _requireProof(epochId, 3, readyProof);
        _requireProof(epochId, 4, aggregateProof);
        return _results[epochId];
    }

    function isVerifiable(bytes32 epochId) external view returns (bool) {
        return _sealed[epochId];
    }

    // ── ICurveGraphRegistry
    // ───────────────────────────────────────────────────────────────────

    function isSealed(bytes32 epochId) external view returns (bool) {
        return _sealed[epochId];
    }

    function rootOf(bytes32 epochId) external view returns (bytes32) {
        return _roots[epochId];
    }

    function expectedResultHandle(bytes32 epochId, uint8 role) external view returns (bytes32) {
        if (!_resultRegistered[epochId][role]) revert ResultNotRegistered(epochId, role);
        return _resultHandle[epochId][role];
    }

    function isRegisteredResult(bytes32 epochId, bytes32 handle) external view returns (bool) {
        for (uint8 role = 0; role < 5; ++role) {
            if (_resultRegistered[epochId][role] && _resultHandle[epochId][role] == handle) return true;
        }
        return false;
    }

    // ── INoxCurveEngine
    // ───────────────────────────────────────────────────────────────────────

    function publishedOf(bytes32 epochId) external view returns (CurvePublishedHandles memory) {
        return _published[epochId];
    }

    // ── IQuoteEpochController
    // ─────────────────────────────────────────────────────────────────

    function epochOf(bytes32 epochId) external view returns (CurveEpoch memory) {
        return _epochs[epochId];
    }

    // ── ICurveUniverseRegistry
    // ────────────────────────────────────────────────────────────────

    function requireActive(bytes32 universeId) external view returns (bytes32) {
        if (!_universeKnown[universeId]) revert UnknownUniverse(universeId);
        if (!_universeActive[universeId]) revert UniverseNotActive(universeId);
        return _universeHash[universeId];
    }

    function marketAt(bytes32 universeId, uint256 marketIndex) external view returns (CurveMarketSpec memory) {
        return _markets[universeId][marketIndex];
    }

    function leafAt(bytes32 universeId, uint256 leafIndex) external view returns (CurveLeaf memory) {
        return _leaves[universeId][leafIndex];
    }

    function leafCount(bytes32 universeId) external view returns (uint256) {
        return _leaves[universeId].length;
    }

    function _requireProof(bytes32 epochId, uint8 role, bytes calldata proof) private view {
        if (keccak256(proof) != _expectedProof[epochId][role]) revert StubProofRejected(epochId, role);
    }
}
