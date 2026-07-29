// SPDX-License-Identifier: GPL-2.0-or-later
pragma solidity 0.8.36;

import {QuoteEpochController} from "./QuoteEpochController.sol";

/**
 * @title CurveGraphRegistry
 * @notice The consensus-critical binding between a decryption proof and the quote it belongs to
 *         (PRD v1.1 A-11).
 *
 * ────────────────────────────────────────────────────────────────────────────────────────────
 * THE PROBLEM THIS EXISTS FOR, STATED EXACTLY
 * ────────────────────────────────────────────────────────────────────────────────────────────
 *
 * `INoxCompute.validateDecryptionProof` is a pure EIP-712 signature check. Read the source
 * (`modules/Compute.sol`, 0.2.4): it verifies a length, recovers a signer and compares it to the
 * gateway. There is **no ACL check, no nonce, no expiry and no caller binding**. A valid proof
 * therefore establishes exactly one thing:
 *
 *     "the gateway attests that handle H decrypts to value V"
 *
 * and never
 *
 *     "V is this quote's aggregate".
 *
 * Once issued, a proof is replayable by anyone, in any contract, forever. Treating "a valid proof
 * exists" as authorisation would let an attacker settle a quote at a number taken from a different
 * request, a different epoch, or a different universe entirely.
 *
 * ────────────────────────────────────────────────────────────────────────────────────────────
 * THE FIX
 * ────────────────────────────────────────────────────────────────────────────────────────────
 *
 * Handles are deterministic in their operation graph. So before any proof can arrive, Kyrve
 * commits to *which handle* each public result must be, and to the whole ordered computation that
 * produced it. A proof is then authorisation only if its handle is the committed handle for the
 * role being claimed, under a sealed root.
 *
 * The root folds, in order:
 *
 *   genesis    chain id, this contract, the engine, the universe id and hash, the request id and
 *              its commitment, the epoch id, and every sealed provider's mandate id, mandate epoch
 *              and epoch commitment
 *   per chunk  the stage, the chunk index, the deterministic chunk id, and a commitment the engine
 *              folds over that chunk's ordered input and output handles
 *   per result the role and the exact handle about to be published
 *   terminator the stage cursor at seal
 *
 * A sequential fold rather than a Merkle tree, deliberately: the graph executes in a fixed order
 * across ~16 transactions, so **order is the structure**. An omitted, reordered or duplicated chunk
 * changes the root; a Merkle root over an unordered set would not notice.
 *
 * ────────────────────────────────────────────────────────────────────────────────────────────
 * PUBLIC / PRIVATE BOUNDARY
 * ────────────────────────────────────────────────────────────────────────────────────────────
 *
 *   PUBLIC   the root, every chunk commitment, and the five result HANDLES.
 *   PRIVATE  every VALUE. A handle is an opaque reference; publishing one discloses nothing
 *            without an ACL grant, which is why the mandate and request commitments in the genesis
 *            fold are hashes over handles rather than over values.
 *
 * Storing the result handles publicly is not a leak and is load-bearing: the verifier must be able
 * to compare an incoming proof's handle against them without decrypting anything.
 */
contract CurveGraphRegistry {
    /// @notice The five values that may ever cross the public boundary. Nothing else is registrable.
    enum ResultRole {
        SelectedMarketIndex,
        SelectedRateIndex,
        PrivacyFloorPassed,
        QuoteReady,
        AggregateFillAmount
    }

    uint256 public constant RESULT_ROLE_COUNT = 5;

    struct Graph {
        bytes32 root;
        uint32 chunkCount;
        uint8 resultCount;
        bool opened;
        bool sealedGraph;
        uint64 openedAt;
        uint64 sealedAt;
    }

    QuoteEpochController public immutable controller;
    address public immutable deployer;

    /// @notice The only contract permitted to fold into a root. Bound once, never again.
    address public engine;

    mapping(bytes32 epochId => Graph) private _graphs;
    mapping(bytes32 epochId => mapping(ResultRole role => bytes32)) private _resultHandle;
    mapping(bytes32 epochId => mapping(ResultRole role => bool)) private _resultRegistered;
    /// @notice Reverse index. Answers "is this handle a registered public result of this epoch?"
    ///         in one read, which is what the verifier needs and what a linear scan would not give.
    mapping(bytes32 epochId => mapping(bytes32 handle => bool)) public isRegisteredResult;

    event EngineBound(address indexed engineAddress);
    event GraphOpened(bytes32 indexed epochId, bytes32 genesisRoot);
    event ChunkFolded(
        bytes32 indexed epochId,
        QuoteEpochController.Stage indexed stage,
        uint32 indexed chunkIndex,
        bytes32 chunkCommitment,
        bytes32 root
    );
    event ResultRegistered(bytes32 indexed epochId, ResultRole indexed role, bytes32 handle, bytes32 root);
    event GraphSealed(bytes32 indexed epochId, bytes32 root, uint32 chunkCount, uint8 resultCount);

    error EngineAlreadyBound(address existing);
    error EngineNotBound();
    error NotDeployer(address caller, address expected);
    error NotEngine(address caller, address expected);
    error GraphAlreadyOpen(bytes32 epochId);
    error GraphNotOpen(bytes32 epochId);
    error GraphAlreadySealed(bytes32 epochId);
    error GraphNotSealed(bytes32 epochId);
    error ResultAlreadyRegistered(bytes32 epochId, ResultRole role, bytes32 existing);
    error ResultNotRegistered(bytes32 epochId, ResultRole role);
    error HandleIsZero(ResultRole role);
    error IncompleteResults(bytes32 epochId, uint8 registered, uint256 required);
    error ZeroAddress();

    constructor(QuoteEpochController controller_) {
        if (address(controller_) == address(0)) revert ZeroAddress();
        controller = controller_;
        deployer = msg.sender;
    }

    /// @notice Binds the curve engine. Callable once, ever, by the deployer. See the controller.
    function bindEngine(address engineAddress) external {
        if (msg.sender != deployer) revert NotDeployer(msg.sender, deployer);
        if (engine != address(0)) revert EngineAlreadyBound(engine);
        if (engineAddress == address(0)) revert ZeroAddress();
        engine = engineAddress;
        emit EngineBound(engineAddress);
    }

    modifier onlyEngine() {
        if (engine == address(0)) revert EngineNotBound();
        if (msg.sender != engine) revert NotEngine(msg.sender, engine);
        _;
    }

    // ─────────────────────────────────────────────────────────────────────────────────────────
    // Folding
    // ─────────────────────────────────────────────────────────────────────────────────────────

    /**
     * @notice Opens a graph with its genesis fold.
     * @param snapshotRoot the engine's fold over every sealed provider's (address, mandate id,
     *        mandate epoch, mandate epoch commitment) in slot order, and the request's commitment.
     *        Computed by the engine because only the engine has read those values; committed here
     *        because only this contract is consulted at verification time.
     */
    function openGraph(
        bytes32 epochId,
        bytes32 universeId,
        bytes32 universeHash,
        bytes32 requestId,
        bytes32 snapshotRoot
    ) external onlyEngine returns (bytes32 genesisRoot) {
        Graph storage graph = _graphs[epochId];
        if (graph.opened) revert GraphAlreadyOpen(epochId);

        genesisRoot = keccak256(
            abi.encode(
                block.chainid,
                address(this),
                engine,
                address(controller),
                epochId,
                universeId,
                universeHash,
                requestId,
                snapshotRoot
            )
        );

        graph.root = genesisRoot;
        graph.opened = true;
        graph.openedAt = uint64(block.timestamp);

        emit GraphOpened(epochId, genesisRoot);
    }

    /**
     * @notice Folds one completed chunk into the root.
     * @dev Called only on a chunk's FIRST execution. A retried chunk does no encrypted work and
     *      must fold nothing, or an idempotent retry would move the root and invalidate every
     *      handle committed after it.
     */
    function foldChunk(bytes32 epochId, QuoteEpochController.Stage stage, uint32 chunkIndex, bytes32 chunkCommitment)
        external
        onlyEngine
        returns (bytes32 root)
    {
        Graph storage graph = _requireOpen(epochId);

        root = keccak256(
            abi.encode(
                graph.root, uint8(stage), chunkIndex, controller.chunkIdFor(epochId, stage, chunkIndex), chunkCommitment
            )
        );
        graph.root = root;
        graph.chunkCount += 1;

        emit ChunkFolded(epochId, stage, chunkIndex, chunkCommitment, root);
    }

    /**
     * @notice Commits to the exact handle a public result will be, BEFORE it is published.
     * @dev Order matters and is enforced by the engine: register, then `allowPublicDecryption`. If
     *      publication came first, a proof could be minted and replayed against a role that had not
     *      yet been committed to.
     */
    function registerResult(bytes32 epochId, ResultRole role, bytes32 handle)
        external
        onlyEngine
        returns (bytes32 root)
    {
        Graph storage graph = _requireOpen(epochId);
        if (handle == bytes32(0)) revert HandleIsZero(role);
        if (_resultRegistered[epochId][role]) {
            revert ResultAlreadyRegistered(epochId, role, _resultHandle[epochId][role]);
        }

        _resultHandle[epochId][role] = handle;
        _resultRegistered[epochId][role] = true;
        isRegisteredResult[epochId][handle] = true;
        graph.resultCount += 1;

        root = keccak256(abi.encode(graph.root, uint8(role), handle));
        graph.root = root;

        emit ResultRegistered(epochId, role, handle, root);
    }

    /**
     * @notice Freezes the graph. Nothing may fold into it afterwards.
     * @dev Requires all five results, so a partially published epoch can never be verified against.
     */
    function sealGraph(bytes32 epochId) external onlyEngine returns (bytes32 root) {
        Graph storage graph = _requireOpen(epochId);
        if (graph.resultCount != RESULT_ROLE_COUNT) {
            revert IncompleteResults(epochId, graph.resultCount, RESULT_ROLE_COUNT);
        }

        root = keccak256(abi.encode(graph.root, "kyrve.curve.graph.sealed", graph.chunkCount));
        graph.root = root;
        graph.sealedGraph = true;
        graph.sealedAt = uint64(block.timestamp);

        emit GraphSealed(epochId, root, graph.chunkCount, graph.resultCount);
    }

    // ─────────────────────────────────────────────────────────────────────────────────────────
    // Views — everything a verifier needs, and nothing that could decrypt
    // ─────────────────────────────────────────────────────────────────────────────────────────

    function graphOf(bytes32 epochId) external view returns (Graph memory) {
        return _graphs[epochId];
    }

    function rootOf(bytes32 epochId) external view returns (bytes32) {
        return _graphs[epochId].root;
    }

    function isSealed(bytes32 epochId) external view returns (bool) {
        return _graphs[epochId].sealedGraph;
    }

    /**
     * @notice The handle this epoch's result for `role` MUST be.
     * @dev Reverts if unregistered rather than returning zero. A zero return would compare equal to
     *      an uninitialised expectation somewhere downstream, which is the shape of bug that makes
     *      a verifier pass everything.
     */
    function expectedResultHandle(bytes32 epochId, ResultRole role) public view returns (bytes32) {
        if (!_resultRegistered[epochId][role]) revert ResultNotRegistered(epochId, role);
        return _resultHandle[epochId][role];
    }

    /// @notice Reverts unless the graph is sealed and `handle` is exactly this role's handle.
    function requireBoundResult(bytes32 epochId, ResultRole role, bytes32 handle) external view {
        if (!_graphs[epochId].sealedGraph) revert GraphNotSealed(epochId);
        bytes32 expected = expectedResultHandle(epochId, role);
        if (expected != handle) revert UnboundHandle(epochId, role, expected, handle);
    }

    error UnboundHandle(bytes32 epochId, ResultRole role, bytes32 expected, bytes32 supplied);

    function _requireOpen(bytes32 epochId) private view returns (Graph storage graph) {
        graph = _graphs[epochId];
        if (!graph.opened) revert GraphNotOpen(epochId);
        if (graph.sealedGraph) revert GraphAlreadySealed(epochId);
    }
}
