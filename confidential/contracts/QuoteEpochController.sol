// SPDX-License-Identifier: GPL-2.0-or-later
pragma solidity 0.8.36;

import {ConfidentialRequestBook} from "./ConfidentialRequestBook.sol";
import {
    CURVE_ALLOCATE_CHUNK_PROVIDERS,
    CURVE_CACHE_CHUNK_UNITS,
    CURVE_FINALIZE_CHUNK_LEAVES,
    CURVE_REDUCE_CHUNK_LEAVES
} from "./CurveConstants.sol";
import {CurveUniverseRegistry} from "./CurveUniverseRegistry.sol";
import {EncryptedMandateBook} from "./EncryptedMandateBook.sol";

/**
 * @title QuoteEpochController
 * @notice The epoch state machine (PRD §13.7, OPERATION-BUDGET §6).
 *
 * ────────────────────────────────────────────────────────────────────────────────────────────
 * THE EPOCH IS THE ATOMIC UNIT, NOT THE TRANSACTION
 * ────────────────────────────────────────────────────────────────────────────────────────────
 *
 * A 16 x 128 universe costs roughly 243M gas — eight block-limits' worth — so one quote is
 * physically 18 transactions. Everything that makes that safe lives here:
 *
 *   deterministic ids     a chunk is identified by (epoch, stage, index) and nothing else. No
 *                         timestamp, no random value, no address. Cloudflare Workflow step names
 *                         are memoisation keys, so a non-deterministic id silently breaks
 *                         resumption rather than failing (A-20).
 *   idempotence           re-running a completed chunk returns `false` and changes nothing. A
 *                         keeper that retries after a dropped receipt cannot double-count.
 *   completeness          a stage cannot advance until every one of its chunks is marked, so a
 *                         skipped chunk stalls the epoch instead of producing a quote computed
 *                         over part of the universe.
 *   monotone stages       stages advance in one direction. A chunk offered for a stage that is
 *                         behind or ahead of the cursor is refused publicly.
 *
 * ────────────────────────────────────────────────────────────────────────────────────────────
 * PUBLIC / PRIVATE BOUNDARY
 * ────────────────────────────────────────────────────────────────────────────────────────────
 *
 *   PUBLIC   that an epoch exists, for which universe and request, which providers were sealed
 *            into it, which stage it has reached, which chunks are done, and when it was sealed.
 *   PRIVATE  every value the epoch computes. This contract stores no handle and no ciphertext.
 *
 * Provider participation is public and deliberately so: an observer learns that a provider was
 * *considered*, never whether they were eligible, at what rate, in what size, or whether they were
 * allocated anything. Demonstration 5 asserts exactly that separation.
 *
 * ────────────────────────────────────────────────────────────────────────────────────────────
 * THE ONE-SHOT ENGINE BINDING, AND WHY IT IS NOT A BACK DOOR
 * ────────────────────────────────────────────────────────────────────────────────────────────
 *
 * The controller and the engine reference each other, so one of the two addresses cannot be a
 * constructor argument. {bindEngine} is callable exactly once, by the deployer, and reverts
 * forever after — there is no re-bind, no owner and no upgrade. `verify:phase3` reads the binding
 * back from chain state and fails if it is unset, so a half-wired deployment cannot look healthy.
 */
contract QuoteEpochController {
    // ─────────────────────────────────────────────────────────────────────────────────────────
    // Types
    // ─────────────────────────────────────────────────────────────────────────────────────────

    /**
     * @notice The stages of one epoch, in execution order.
     * @dev The names match `EPOCH_STAGES` in `@kyrve/nox` and the stage labels in
     *      `docs/day0/OPERATION-BUDGET.md` §3, so a gas figure, a workflow step and an on-chain
     *      cursor all refer to the same thing.
     */
    enum Stage {
        Open, // providers and the request may still be sealed in
        CacheProviders, // B
        Accumulate, // C
        FinalizeLeaves, // D
        ReduceWinner, // E
        PublishWinner, // E2
        Allocate, // F
        PublishAggregate, // G
        Complete,
        Cancelled
    }

    struct Epoch {
        bytes32 universeId;
        bytes32 universeHash;
        bytes32 requestId;
        address borrower;
        uint16 providerCount;
        uint16 marketCount;
        uint16 leafCount;
        Stage stage;
        uint64 openedAt;
        uint64 sealedAt;
        /// @dev Past this, the epoch may be cancelled by anyone. Bounded so a stalled epoch cannot
        ///      hold reservations forever, which is the only thing that could trap capital here.
        uint64 deadline;
    }

    /// @notice One provider's participation in one epoch. Public; the mandate itself is not.
    struct SealedProvider {
        address provider;
        bytes32 mandateId;
        uint32 mandateEpoch;
    }

    struct StageProgress {
        uint32 total;
        uint32 done;
    }

    // ─────────────────────────────────────────────────────────────────────────────────────────
    // Configuration
    // ─────────────────────────────────────────────────────────────────────────────────────────

    /// @notice Widths chosen so the peak transaction stays under the 24M measured ceiling.
    /// @dev 64 x 256,553 = 16.4M for stage B, 64 x 94,649 = 6.1M for stage E, 128 x 158,847 =
    ///      20.3M for stage D. Stage C's width is a universe parameter because it is the only one
    ///      that scales with two dimensions at once.
    uint32 public constant CACHE_CHUNK_UNITS = CURVE_CACHE_CHUNK_UNITS;
    uint32 public constant FINALIZE_CHUNK_LEAVES = CURVE_FINALIZE_CHUNK_LEAVES;
    uint32 public constant REDUCE_CHUNK_LEAVES = CURVE_REDUCE_CHUNK_LEAVES;
    uint32 public constant ALLOCATE_CHUNK_PROVIDERS = CURVE_ALLOCATE_CHUNK_PROVIDERS;

    uint64 public constant MIN_EPOCH_LIFETIME = 15 minutes;
    uint64 public constant MAX_EPOCH_LIFETIME = 1 days;

    CurveUniverseRegistry public immutable universes;
    EncryptedMandateBook public immutable mandateBook;
    ConfidentialRequestBook public immutable requestBook;
    address public immutable deployer;

    /// @notice The only contract allowed to advance an epoch. Bound once, never again.
    address public engine;

    // ─────────────────────────────────────────────────────────────────────────────────────────
    // Storage
    // ─────────────────────────────────────────────────────────────────────────────────────────

    mapping(bytes32 epochId => Epoch) private _epochs;
    mapping(bytes32 epochId => SealedProvider[]) private _providers;
    mapping(bytes32 epochId => mapping(address provider => bool)) public isSealedProvider;
    mapping(bytes32 epochId => mapping(Stage stage => StageProgress)) private _progress;
    mapping(bytes32 chunkId => bool) public isChunkComplete;
    /// @notice Set the moment a request is sealed into an epoch. The flag a future revision of
    ///         `ConfidentialRequestBook.cancelUnsealedRequest` must consult — see the delta.
    mapping(bytes32 requestId => bytes32 epochId) public sealedInto;

    event EngineBound(address indexed engineAddress);
    event EpochOpened(bytes32 indexed epochId, bytes32 indexed universeId, bytes32 indexed requestId, uint64 deadline);
    event ProviderSealed(
        bytes32 indexed epochId, address indexed provider, uint16 slot, bytes32 mandateId, uint32 mandateEpoch
    );
    event EpochSealed(bytes32 indexed epochId, uint16 providerCount, uint16 leafCount, uint32 accumulateChunks);
    event ChunkCompleted(bytes32 indexed epochId, Stage indexed stage, uint32 indexed chunkIndex, bytes32 chunkId);
    event StageAdvanced(bytes32 indexed epochId, Stage indexed from, Stage indexed to);
    event EpochCancelled(bytes32 indexed epochId, address indexed by, Stage atStage);

    error EngineAlreadyBound(address existing);
    error EngineNotBound();
    error NotDeployer(address caller, address expected);
    error NotEngine(address caller, address expected);
    error EpochExists(bytes32 epochId);
    error UnknownEpoch(bytes32 epochId);
    error WrongStage(bytes32 epochId, Stage expected, Stage actual);
    error EpochNotOpen(bytes32 epochId, Stage stage);
    error EpochIsTerminal(bytes32 epochId, Stage stage);
    error ProviderAlreadySealed(bytes32 epochId, address provider);
    error TooManyProviders(uint256 supplied, uint256 maximum);
    error NoProvidersSealed(bytes32 epochId);
    error RequestAlreadySealed(bytes32 requestId, bytes32 epochId);
    error RequestNotLive(bytes32 requestId);
    error NotBorrower(bytes32 requestId, address caller, address borrower);
    error UniverseMismatch(bytes32 expected, bytes32 actual);
    error ChunkIndexOutOfRange(Stage stage, uint32 supplied, uint32 total);
    error StageIncomplete(bytes32 epochId, Stage stage, uint32 done, uint32 total);
    error LifetimeOutOfRange(uint64 supplied, uint64 minimum, uint64 maximum);
    error DeadlineNotReached(bytes32 epochId, uint64 deadline, uint64 nowTimestamp);
    error ZeroAddress();

    constructor(
        CurveUniverseRegistry universes_,
        EncryptedMandateBook mandateBook_,
        ConfidentialRequestBook requestBook_
    ) {
        if (address(universes_) == address(0)) revert ZeroAddress();
        if (address(mandateBook_) == address(0)) revert ZeroAddress();
        if (address(requestBook_) == address(0)) revert ZeroAddress();
        universes = universes_;
        mandateBook = mandateBook_;
        requestBook = requestBook_;
        deployer = msg.sender;
    }

    /// @notice Binds the curve engine. Callable once, ever, by the deployer.
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
    // Deterministic identifiers. Never a timestamp, never a random value (A-20).
    // ─────────────────────────────────────────────────────────────────────────────────────────

    function epochIdFor(bytes32 universeId, bytes32 requestId) public view returns (bytes32) {
        return keccak256(abi.encode(block.chainid, address(this), universeId, requestId));
    }

    function chunkIdFor(bytes32 epochId, Stage stage, uint32 chunkIndex) public view returns (bytes32) {
        return keccak256(abi.encode(block.chainid, address(this), epochId, uint8(stage), chunkIndex));
    }

    // ─────────────────────────────────────────────────────────────────────────────────────────
    // Opening and sealing
    // ─────────────────────────────────────────────────────────────────────────────────────────

    /**
     * @notice Opens an epoch for one live request against one activated universe.
     * @dev Permissioned to the borrower. Anyone else opening an epoch against someone's request
     *      would let a third party decide which providers get sealed in, which is a censorship
     *      surface rather than a privacy one — but a censorship surface all the same.
     */
    function openEpoch(bytes32 universeId, bytes32 requestId, uint64 lifetime) external returns (bytes32 epochId) {
        bytes32 universeHash = universes.requireActive(universeId);
        if (lifetime < MIN_EPOCH_LIFETIME || lifetime > MAX_EPOCH_LIFETIME) {
            revert LifetimeOutOfRange(lifetime, MIN_EPOCH_LIFETIME, MAX_EPOCH_LIFETIME);
        }

        ConfidentialRequestBook.Request memory request = requestBook.requestOf(requestId);
        if (request.borrower == address(0) || request.state != ConfidentialRequestBook.RequestState.Submitted) {
            revert RequestNotLive(requestId);
        }
        if (request.borrower != msg.sender) revert NotBorrower(requestId, msg.sender, request.borrower);
        if (request.universeId != universeId) revert UniverseMismatch(universeId, request.universeId);
        if (sealedInto[requestId] != bytes32(0)) revert RequestAlreadySealed(requestId, sealedInto[requestId]);

        epochId = epochIdFor(universeId, requestId);
        if (_epochs[epochId].borrower != address(0)) revert EpochExists(epochId);

        CurveUniverseRegistry.UniverseHeader memory header = universes.headerOf(universeId);

        _epochs[epochId] = Epoch({
            universeId: universeId,
            universeHash: universeHash,
            requestId: requestId,
            borrower: request.borrower,
            providerCount: 0,
            marketCount: header.marketCount,
            leafCount: header.leafCount,
            stage: Stage.Open,
            openedAt: uint64(block.timestamp),
            sealedAt: 0,
            deadline: uint64(block.timestamp) + lifetime
        });
        sealedInto[requestId] = epochId;

        emit EpochOpened(epochId, universeId, requestId, uint64(block.timestamp) + lifetime);
    }

    /**
     * @notice Records that a provider joined this epoch. Called by the engine, which has already
     *         checked the mandate is active and on the epoch the caller presented.
     * @dev The engine, not this contract, verifies the ACL grants — this contract holds no handle
     *      and could not check one.
     */
    function sealProvider(bytes32 epochId, address provider, bytes32 mandateId, uint32 mandateEpoch)
        external
        onlyEngine
        returns (uint16 slot)
    {
        Epoch storage epoch = _requireEpoch(epochId);
        if (epoch.stage != Stage.Open) revert EpochNotOpen(epochId, epoch.stage);
        if (isSealedProvider[epochId][provider]) revert ProviderAlreadySealed(epochId, provider);

        CurveUniverseRegistry.UniverseHeader memory header = universes.headerOf(epoch.universeId);
        SealedProvider[] storage sealed_ = _providers[epochId];
        if (sealed_.length >= header.maxProviders) {
            revert TooManyProviders(sealed_.length + 1, header.maxProviders);
        }

        slot = uint16(sealed_.length);
        sealed_.push(SealedProvider({provider: provider, mandateId: mandateId, mandateEpoch: mandateEpoch}));
        isSealedProvider[epochId][provider] = true;
        epoch.providerCount = uint16(sealed_.length);

        emit ProviderSealed(epochId, provider, slot, mandateId, mandateEpoch);
    }

    /**
     * @notice Freezes the provider set and fixes every stage's chunk count.
     * @dev After this the epoch's shape cannot change, which is what makes "a skipped chunk
     *      prevents finalisation" enforceable: `total` is written once and only compared to
     *      thereafter.
     */
    function sealEpoch(bytes32 epochId) external onlyEngine {
        Epoch storage epoch = _requireEpoch(epochId);
        if (epoch.stage != Stage.Open) revert EpochNotOpen(epochId, epoch.stage);
        uint16 providerCount = epoch.providerCount;
        if (providerCount == 0) revert NoProvidersSealed(epochId);

        CurveUniverseRegistry.UniverseHeader memory header = universes.headerOf(epoch.universeId);

        uint32 cacheUnits = uint32(providerCount) * uint32(epoch.marketCount);
        uint32 cells = uint32(providerCount) * uint32(epoch.leafCount);

        _progress[epochId][Stage.CacheProviders].total = _chunks(cacheUnits, CACHE_CHUNK_UNITS);
        _progress[epochId][Stage.Accumulate].total = _chunks(cells, header.cellsPerChunk);
        _progress[epochId][Stage.FinalizeLeaves].total = _chunks(epoch.leafCount, FINALIZE_CHUNK_LEAVES);
        _progress[epochId][Stage.ReduceWinner].total = _chunks(epoch.leafCount, REDUCE_CHUNK_LEAVES);
        _progress[epochId][Stage.PublishWinner].total = 1;
        _progress[epochId][Stage.Allocate].total = _chunks(providerCount, ALLOCATE_CHUNK_PROVIDERS);
        _progress[epochId][Stage.PublishAggregate].total = 1;

        epoch.stage = Stage.CacheProviders;
        epoch.sealedAt = uint64(block.timestamp);

        emit EpochSealed(epochId, providerCount, epoch.leafCount, _progress[epochId][Stage.Accumulate].total);
        emit StageAdvanced(epochId, Stage.Open, Stage.CacheProviders);
    }

    // ─────────────────────────────────────────────────────────────────────────────────────────
    // Progress
    // ─────────────────────────────────────────────────────────────────────────────────────────

    /**
     * @notice Claims one chunk of the current stage.
     * @return isFirstExecution false when this chunk was already done, so the caller must perform
     *         no encrypted work and no state change.
     *
     * @dev THIS RETURN VALUE IS THE WHOLE IDEMPOTENCE MECHANISM. It is not a convenience. A keeper
     *      whose transaction landed but whose receipt was lost will retry, and every Nox primitive
     *      is a state-changing external call — replaying stage C for a chunk that already ran would
     *      add each provider's capacity to the leaf a second time and produce a quote for capital
     *      that does not exist. The engine returns early on `false`, and the epoch's arithmetic is
     *      therefore a function of which chunks completed, never of how many times they were sent.
     */
    function claimChunk(bytes32 epochId, Stage stage, uint32 chunkIndex)
        external
        onlyEngine
        returns (bool isFirstExecution)
    {
        Epoch storage epoch = _requireEpoch(epochId);
        if (epoch.stage != stage) revert WrongStage(epochId, stage, epoch.stage);

        StageProgress storage progress = _progress[epochId][stage];
        if (chunkIndex >= progress.total) revert ChunkIndexOutOfRange(stage, chunkIndex, progress.total);

        bytes32 chunkId = chunkIdFor(epochId, stage, chunkIndex);
        if (isChunkComplete[chunkId]) return false;

        isChunkComplete[chunkId] = true;
        progress.done += 1;

        emit ChunkCompleted(epochId, stage, chunkIndex, chunkId);
        return true;
    }

    /**
     * @notice Advances to the next stage once every chunk of the current one is complete.
     * @dev Refuses publicly when a chunk is missing, naming how many are done out of how many.
     *      That is a public fault about scheduling and reveals nothing confidential.
     */
    function advanceStage(bytes32 epochId) external onlyEngine returns (Stage next) {
        Epoch storage epoch = _requireEpoch(epochId);
        Stage current = epoch.stage;
        if (current == Stage.Open || current == Stage.Complete || current == Stage.Cancelled) {
            revert EpochIsTerminal(epochId, current);
        }

        StageProgress storage progress = _progress[epochId][current];
        if (progress.done < progress.total) {
            revert StageIncomplete(epochId, current, progress.done, progress.total);
        }

        next = Stage(uint8(current) + 1);
        epoch.stage = next;
        emit StageAdvanced(epochId, current, next);
    }

    /**
     * @notice Cancels an epoch. The engine calls this after releasing every reservation.
     * @dev Not pausable and not privileged past the deadline: a stalled epoch holds encrypted
     *      reservations, and nothing may make those permanent by inaction. Before the deadline
     *      only the borrower may cancel; after it, anyone may.
     */
    function cancelEpoch(bytes32 epochId, address caller) external onlyEngine {
        Epoch storage epoch = _requireEpoch(epochId);
        if (epoch.stage == Stage.Complete || epoch.stage == Stage.Cancelled) {
            revert EpochIsTerminal(epochId, epoch.stage);
        }
        if (caller != epoch.borrower && block.timestamp <= epoch.deadline) {
            revert DeadlineNotReached(epochId, epoch.deadline, uint64(block.timestamp));
        }

        Stage atStage = epoch.stage;
        epoch.stage = Stage.Cancelled;
        emit EpochCancelled(epochId, caller, atStage);
    }

    // ─────────────────────────────────────────────────────────────────────────────────────────
    // Views
    // ─────────────────────────────────────────────────────────────────────────────────────────

    function epochOf(bytes32 epochId) external view returns (Epoch memory) {
        return _requireEpochView(epochId);
    }

    function providersOf(bytes32 epochId) external view returns (SealedProvider[] memory) {
        return _providers[epochId];
    }

    function providerAt(bytes32 epochId, uint256 slot) external view returns (SealedProvider memory) {
        return _providers[epochId][slot];
    }

    function progressOf(bytes32 epochId, Stage stage) external view returns (StageProgress memory) {
        return _progress[epochId][stage];
    }

    /// @notice The check a future `ConfidentialRequestBook` revision must make before refunding.
    function isRequestSealed(bytes32 requestId) external view returns (bool) {
        return sealedInto[requestId] != bytes32(0);
    }

    /// @notice Reverts unless the epoch is at exactly this stage. The engine's entry guard.
    function requireStage(bytes32 epochId, Stage stage) external view returns (Epoch memory) {
        Epoch memory epoch = _requireEpochView(epochId);
        if (epoch.stage != stage) revert WrongStage(epochId, stage, epoch.stage);
        return epoch;
    }

    // ─────────────────────────────────────────────────────────────────────────────────────────
    // Internals
    // ─────────────────────────────────────────────────────────────────────────────────────────

    function _requireEpoch(bytes32 epochId) private view returns (Epoch storage epoch) {
        epoch = _epochs[epochId];
        if (epoch.borrower == address(0)) revert UnknownEpoch(epochId);
    }

    function _requireEpochView(bytes32 epochId) private view returns (Epoch memory epoch) {
        epoch = _epochs[epochId];
        if (epoch.borrower == address(0)) revert UnknownEpoch(epochId);
    }

    /// @dev Ceiling division. `perChunk` is non-zero on every call site: the universe registry
    ///      rejects a zero `cellsPerChunk`, and the other three widths are non-zero constants.
    function _chunks(uint32 units, uint32 perChunk) private pure returns (uint32) {
        if (units == 0) return 0;
        return (units + perChunk - 1) / perChunk;
    }
}
