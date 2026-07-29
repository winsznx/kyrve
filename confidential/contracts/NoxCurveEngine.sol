// SPDX-License-Identifier: GPL-2.0-or-later
pragma solidity 0.8.36;

import {Nox, ebool, euint16, euint256} from "@iexec-nox/nox-protocol-contracts/contracts/sdk/Nox.sol";
import {INoxCompute} from "@iexec-nox/nox-protocol-contracts/contracts/interfaces/INoxCompute.sol";

import {ConfidentialRequestBook} from "./ConfidentialRequestBook.sol";
import {
    CURVE_ALLOCATE_CHUNK_PROVIDERS,
    CURVE_CACHE_CHUNK_UNITS,
    CURVE_FINALIZE_CHUNK_LEAVES,
    CURVE_MATURITY_RANK_STRIDE,
    CURVE_MAX_LEAVES,
    CURVE_RANK_CEILING,
    CURVE_REDUCE_CHUNK_LEAVES
} from "./CurveConstants.sol";
import {CurveGraphRegistry} from "./CurveGraphRegistry.sol";
import {DecryptedValue} from "./DecryptedValue.sol";
import {CurveUniverseRegistry} from "./CurveUniverseRegistry.sol";
import {EncryptedMandateBook} from "./EncryptedMandateBook.sol";
import {KyrveCustodyVault} from "./KyrveCustodyVault.sol";
import {KyrveCurveBase} from "./KyrveCurveBase.sol";
import {KyrveEmergencyController} from "./KyrveEmergencyController.sol";
import {QuoteEpochController} from "./QuoteEpochController.sol";
import {ReservationLedger} from "./ReservationLedger.sol";

/**
 * @title NoxCurveEngine
 * @notice The confidential term-structure engine (PRD §9, §11.5–§11.11, §13.7).
 *
 *   encrypted mandates + encrypted request + confidential balances
 *     -> private eligibility -> private capacity per leaf -> privacy floor
 *     -> deterministic selected leaf -> encrypted provider reservations
 *     -> ONE publicly decryptable market, rate and aggregate amount
 *
 * ════════════════════════════════════════════════════════════════════════════════════════════
 * READ FIRST
 * ════════════════════════════════════════════════════════════════════════════════════════════
 *
 *   docs/phase3/HANDLE-LINEAGE.md    why every granted handle is isolated, and what breaks if not
 *   docs/phase3/SELECTION-POLICY.md  how a public ordering and one encrypted term pick a leaf
 *   docs/day0/OPERATION-BUDGET.md    why this is 18 transactions and not one
 *
 * ════════════════════════════════════════════════════════════════════════════════════════════
 * THREE THINGS THAT ARE NOT OPTIONAL
 * ════════════════════════════════════════════════════════════════════════════════════════════
 *
 * 1. **No encrypted boolean operations exist.** There is no `and`, `or`, `not` or `xor`, and
 *    `select` has no `ebool` overload, so even `and(a,b) = select(a,b,false)` is unavailable. The
 *    six-term eligibility conjunction is arithmetised: each predicate becomes a 0/1 `euint16` via
 *    `select`, the indicators are multiplied, and the product is compared to 1. A failed predicate
 *    contributes encrypted zero and **no public event distinguishes which one failed.**
 *
 * 2. **Safe operations fail silently.** `safeSub`/`safeMul`/`safeDiv` return encrypted `false` AND
 *    an encrypted ZERO result while the transaction succeeds; unsafe `div` saturates to the type
 *    maximum instead of reverting. Neither can be branched on in Solidity. Every success flag here
 *    is threaded through `select`, and every division goes through `safeDiv`.
 *
 * 3. **The gateway sees plaintext.** `encryptInput` sends the value to the Nox handle gateway,
 *    which encrypts it inside a TEE. Kyrve must never claim otherwise; the rule is that no *Kyrve*
 *    component receives a decrypted value (delta Q-10). Nor may Kyrve claim gas
 *    indistinguishability — see `docs/phase3/GAS-SIDE-CHANNEL.md`.
 *
 * ════════════════════════════════════════════════════════════════════════════════════════════
 * PUBLIC / PRIVATE BOUNDARY — the whole product is this line
 * ════════════════════════════════════════════════════════════════════════════════════════════
 *
 *   PUBLIC FROM SUBMISSION   the universe and its full rate grid; that an epoch exists, for which
 *                            request; which providers were sealed into it; which stage and chunk
 *                            ran; the graph root.
 *
 *   PRIVATE FOREVER          every provider's budget, caps, minimum rates and enabled markets; the
 *                            borrower's desired size, minimum size, maximum rates and maturity
 *                            preference; every leaf's capacity; the exact provider count for any
 *                            leaf; whether any particular provider was eligible, included or
 *                            allocated; the second-best leaf; the winning leaf's total capacity;
 *                            and the dust residue.
 *
 *   PUBLIC ON PUBLICATION    exactly five values, listed in {Published}, each isolated and
 *                            registered in {CurveGraphRegistry} before `allowPublicDecryption` —
 *                            which is IRREVERSIBLE — is called.
 *
 * Provider participation being public is deliberate and is the honest cost of a permissionless
 * keeper: an observer learns a provider was *considered*, never whether they were eligible, at what
 * rate, in what size, or whether they were allocated anything.
 */
contract NoxCurveEngine is KyrveCurveBase {
    // ─────────────────────────────────────────────────────────────────────────────────────────
    // Types
    // ─────────────────────────────────────────────────────────────────────────────────────────

    /// @dev The mandate fields the engine needs, copied into engine storage at seal so that stage
    ///      B and stage C read warm local slots instead of making 2,048 external calls.
    struct ProviderSnapshot {
        address provider;
        bytes32 mandateId;
        uint32 mandateEpoch;
        euint256 totalBudget;
        euint256 balance;
        euint256[8] marketCaps;
        euint16[8] minRateIndexes;
        euint16[8] enabledFlags;
        euint256[4] collateralFamilyCaps;
        euint256[4] maturityBucketCaps;
    }

    struct RequestSnapshot {
        address borrower;
        bool present;
        euint256 desiredAssets;
        euint256 minimumAssets;
        euint16[8] maxRateIndexes;
        euint16[8] enabledFlags;
        euint16 preferredMaturityIndex;
    }

    /// @dev Stage B's two cached handles per (provider, market). Never granted to anyone.
    struct Cached {
        euint256 capacity;
        euint16 count;
    }

    /// @dev The running best under the selection policy. Only the best is ever materialised, so
    ///      the runner-up does not exist as a handle and cannot be published by accident.
    struct Best {
        euint16 score;
        euint16 marketIndex;
        euint16 rateIndex;
        euint16 floorPassed;
        euint256 fill;
        euint256 capacity;
        bool started;
    }

    /// @dev The five handles that cross the public boundary, and nothing else.
    struct Published {
        bytes32 marketIndex;
        bytes32 rateIndex;
        bytes32 floorPassed;
        bytes32 quoteReady;
        bytes32 aggregateFill;
    }

    struct Runtime {
        ebool epochCondition;
        euint256 aggregate;
        euint256 dustResidue;
        bool aggregateStarted;
        uint8 winnerMarketIndex;
        uint8 winnerRateIndex;
        bool winnerProven;
    }

    // ─────────────────────────────────────────────────────────────────────────────────────────
    // Wiring — all immutable. A protocol address on a hot path never comes from mutable storage.
    // ─────────────────────────────────────────────────────────────────────────────────────────

    CurveUniverseRegistry public immutable universes;
    QuoteEpochController public immutable controller;
    CurveGraphRegistry public immutable graph;
    ReservationLedger public immutable ledger;
    EncryptedMandateBook public immutable mandateBook;
    ConfidentialRequestBook public immutable requestBook;
    KyrveCustodyVault public immutable vault;

    // ─────────────────────────────────────────────────────────────────────────────────────────
    // Storage
    // ─────────────────────────────────────────────────────────────────────────────────────────

    mapping(bytes32 epochId => mapping(uint256 slot => ProviderSnapshot)) private _snapshots;
    mapping(bytes32 epochId => RequestSnapshot) private _request;
    mapping(bytes32 epochId => mapping(uint256 slot => mapping(uint256 marketIndex => Cached))) private _cached;
    mapping(bytes32 epochId => mapping(uint256 leafIndex => euint256)) private _capacityAcc;
    mapping(bytes32 epochId => mapping(uint256 leafIndex => euint16)) private _countAcc;
    mapping(bytes32 epochId => mapping(uint256 leafIndex => euint256)) private _fillable;
    mapping(bytes32 epochId => mapping(uint256 leafIndex => euint256)) private _leafCapacity;
    mapping(bytes32 epochId => mapping(uint256 leafIndex => euint16)) private _leafFloorPassed;
    mapping(bytes32 epochId => mapping(uint256 marketIndex => euint16)) private _maturityTerm;
    mapping(bytes32 epochId => Best) private _best;
    mapping(bytes32 epochId => Published) private _published;
    mapping(bytes32 epochId => Runtime) private _runtime;
    mapping(bytes32 epochId => mapping(uint256 slot => euint256)) private _allocation;
    /// @dev Packed leaf table, copied at seal: (marketIndex << 24) | (rateIndex << 16) | publicRank.
    mapping(bytes32 epochId => uint32[]) private _leafTable;

    // ─────────────────────────────────────────────────────────────────────────────────────────
    // Events — one shape per stage, identical whatever the encrypted outcome was
    // ─────────────────────────────────────────────────────────────────────────────────────────

    event ProviderSnapshotSealed(bytes32 indexed epochId, address indexed provider, uint16 slot);
    event RequestSnapshotSealed(bytes32 indexed epochId, address indexed borrower);
    event EpochPrepared(bytes32 indexed epochId, uint16 providerCount, uint16 leafCount, bytes32 genesisRoot);
    event StageChunkExecuted(
        bytes32 indexed epochId, QuoteEpochController.Stage indexed stage, uint32 indexed chunkIndex
    );
    event StageChunkSkipped(
        bytes32 indexed epochId, QuoteEpochController.Stage indexed stage, uint32 indexed chunkIndex
    );
    event WinnerPublished(
        bytes32 indexed epochId, bytes32 marketHandle, bytes32 rateHandle, bytes32 floorHandle, bytes32 readyHandle
    );
    event WinnerProven(bytes32 indexed epochId, uint8 marketIndex, uint8 rateIndex);
    event AggregatePublished(bytes32 indexed epochId, bytes32 aggregateHandle, bytes32 graphRoot);
    event EpochCancelled(bytes32 indexed epochId, address indexed by);

    // ─────────────────────────────────────────────────────────────────────────────────────────
    // Errors — every one a PUBLIC fault. A confidential shortfall never reaches this list.
    // ─────────────────────────────────────────────────────────────────────────────────────────

    error ZeroAddress();
    error NotSealedProvider(bytes32 epochId, address provider);
    error RequestAlreadySealed(bytes32 epochId);
    error RequestNotSealed(bytes32 epochId);
    error NotRequestBorrower(bytes32 epochId, address caller, address borrower);
    error MandateUniverseMismatch(bytes32 mandateId, bytes32 expected, bytes32 actual);
    error EngineNotAuthorisedForHandle(bytes32 handle, address needsAccess);
    error UniverseTooLarge(uint256 leafCount, uint256 maximum);
    error WinnerNotProven(bytes32 epochId);
    error WinnerAlreadyProven(bytes32 epochId, uint8 marketIndex, uint8 rateIndex);
    error DecryptedValueMismatch(bytes32 handle, uint256 claimed, uint256 decoded);
    error NotEpochParticipant(bytes32 epochId, address caller);
    error LeafIndexOutOfRange(uint256 leafIndex, uint256 leafCount);

    constructor(
        CurveUniverseRegistry universes_,
        QuoteEpochController controller_,
        CurveGraphRegistry graph_,
        ReservationLedger ledger_,
        EncryptedMandateBook mandateBook_,
        ConfidentialRequestBook requestBook_,
        KyrveCustodyVault vault_,
        KyrveEmergencyController controller__
    ) KyrveCurveBase(controller__) {
        if (
            address(universes_) == address(0) || address(controller_) == address(0) || address(graph_) == address(0)
                || address(ledger_) == address(0) || address(mandateBook_) == address(0)
                || address(requestBook_) == address(0) || address(vault_) == address(0)
        ) revert ZeroAddress();
        universes = universes_;
        controller = controller_;
        graph = graph_;
        ledger = ledger_;
        mandateBook = mandateBook_;
        requestBook = requestBook_;
        vault = vault_;
    }

    /**
     * @notice The engine's immutable transient-handle allowlist.
     * @dev Exactly one recipient: the reservation ledger it was deployed against. Transient access
     *      carries full persistent-grant power — the recipient can publish the handle permanently
     *      inside that one transaction — so this is a single immutable address, not a set.
     */
    function isReviewedTransientRecipient(address recipient) public view override returns (bool) {
        return recipient == address(ledger);
    }

    // ═════════════════════════════════════════════════════════════════════════════════════════
    // STAGE A · Seal snapshots
    // ═════════════════════════════════════════════════════════════════════════════════════════

    /**
     * @notice Seals a provider's live mandate and vault balance into an epoch.
     * @dev Called by the PROVIDER, not by a keeper, and not through a relayer — see
     *      {KyrveConfidentialBase._assertDirectCaller}. A Safe or other contract account cannot be
     *      a provider in this release; that is a Kyrve design choice, not a cryptographic
     *      impossibility, and it is stated rather than implied.
     *
     *      WHAT IS AND IS NOT PROVEN HERE. The engine reads the REAL handles the mandate book
     *      holds, so there is no restatement gap: a stale mandate is refused by
     *      `assertUsable(mandateId, epoch)` and cannot be replaced by numbers the caller supplies.
     *      What the provider must do first is grant this contract ACL on each of those handles,
     *      one `INoxCompute.allow` per handle from their own wallet, because the mandate book is
     *      deployed and immutable and cannot grant on their behalf. That grant is PERMANENT — Nox
     *      has no `removeAdmin` — and it makes this contract an admin on those handles. This
     *      contract never publishes them; that is a property of reviewed code, not of the ACL, and
     *      the interface must say so in those words. See HANDLE-LINEAGE.md §5.
     */
    function sealProviderSnapshot(bytes32 epochId, bytes32 mandateId, uint32 mandateEpoch, uint256 nonce)
        external
        returns (uint16 slot)
    {
        _assertDirectCaller();
        _consumeNonce(nonce);

        QuoteEpochController.Epoch memory epoch = controller.requireStage(epochId, QuoteEpochController.Stage.Open);

        // Reverts `StaleMandateEpoch` when the provider replaced their mandate, `MandateNotActive`
        // when they paused or retired it, `UnknownMandate` when it never existed.
        mandateBook.assertUsable(mandateId, mandateEpoch);
        EncryptedMandateBook.Mandate memory mandate = mandateBook.mandateOf(mandateId);
        if (mandate.provider != msg.sender) revert NotSealedProvider(epochId, msg.sender);
        if (mandate.universeId != epoch.universeId) {
            revert MandateUniverseMismatch(mandateId, epoch.universeId, mandate.universeId);
        }

        slot = controller.sealProvider(epochId, msg.sender, mandateId, mandateEpoch);
        _copyProviderSnapshot(epochId, slot, mandateId, mandateEpoch);

        emit ProviderSnapshotSealed(epochId, msg.sender, slot);
    }

    /// @notice Seals the borrower's live request into the epoch. Called by the BORROWER.
    function sealRequestSnapshot(bytes32 epochId, uint256 nonce) external {
        _assertDirectCaller();
        _consumeNonce(nonce);

        QuoteEpochController.Epoch memory epoch = controller.requireStage(epochId, QuoteEpochController.Stage.Open);
        if (epoch.borrower != msg.sender) revert NotRequestBorrower(epochId, msg.sender, epoch.borrower);
        if (_request[epochId].present) revert RequestAlreadySealed(epochId);

        ConfidentialRequestBook.RequestHandles memory handles = requestBook.handlesOf(epoch.requestId);
        RequestSnapshot storage snapshot = _request[epochId];

        _requireEngineAccess(euint256.unwrap(handles.desiredAssets));
        _requireEngineAccess(euint256.unwrap(handles.minimumAssets));
        _requireEngineAccess(euint16.unwrap(handles.preferredMaturityIndex));
        snapshot.desiredAssets = handles.desiredAssets;
        snapshot.minimumAssets = handles.minimumAssets;
        snapshot.preferredMaturityIndex = handles.preferredMaturityIndex;

        for (uint256 m = 0; m < 8; ++m) {
            _requireEngineAccess(euint16.unwrap(handles.maxRateIndexes[m]));
            _requireEngineAccess(euint16.unwrap(handles.enabledFlags[m]));
            snapshot.maxRateIndexes[m] = handles.maxRateIndexes[m];
            snapshot.enabledFlags[m] = handles.enabledFlags[m];
        }

        snapshot.borrower = msg.sender;
        snapshot.present = true;

        emit RequestSnapshotSealed(epochId, msg.sender);
    }

    /**
     * @notice Freezes the epoch and builds everything the later stages read but never recompute.
     * @dev Three preambles live here rather than in a stage, because each is paid once and would
     *      otherwise be paid per chunk:
     *        - the epoch isolation condition (HANDLE-LINEAGE.md §3);
     *        - the packed leaf table, so stage C reads warm local slots;
     *        - the per-market encrypted maturity distance, which has one value per market rather
     *          than one per leaf and would otherwise cost 16x more.
     */
    function prepareEpoch(bytes32 epochId) external {
        QuoteEpochController.Epoch memory epoch = controller.requireStage(epochId, QuoteEpochController.Stage.Open);
        RequestSnapshot storage request = _request[epochId];
        if (!request.present) revert RequestNotSealed(epochId);
        if (msg.sender != epoch.borrower && !controller.isSealedProvider(epochId, msg.sender)) {
            revert NotEpochParticipant(epochId, msg.sender);
        }

        uint256 leaves = universes.leafCount(epoch.universeId);
        if (leaves > CURVE_MAX_LEAVES) revert UniverseTooLarge(leaves, CURVE_MAX_LEAVES);

        // `allowThis` is not optional here and its absence is silent until stage E2. The epoch
        // condition is an `ebool` created in THIS transaction and consumed as a `select` operand in
        // every later one; `_executeOperation` grants only TRANSIENT access to its outputs, so
        // without a persistent grant the condition becomes unusable the moment this transaction
        // ends and `publishWinner` reverts `NotAllowed` eight transactions later.
        ebool epochCondition = _buildEpochCondition(epochId, request.desiredAssets);
        Nox.allowThis(epochCondition);
        _runtime[epochId].epochCondition = epochCondition;
        _buildLeafTable(epochId, epoch.universeId, leaves);
        _buildMaturityTerms(epochId, epoch.universeId, request.preferredMaturityIndex);

        controller.sealEpoch(epochId);

        bytes32 genesisRoot =
            graph.openGraph(epochId, epoch.universeId, epoch.universeHash, epoch.requestId, _snapshotRoot(epochId));

        emit EpochPrepared(epochId, epoch.providerCount, uint16(leaves), genesisRoot);
    }

    // ═════════════════════════════════════════════════════════════════════════════════════════
    // STAGE B · Cache the five leaf-invariant predicates, per (provider, market)
    // ═════════════════════════════════════════════════════════════════════════════════════════

    /**
     * @notice Evaluates the leaf-invariant half of eligibility once per (provider, market).
     *
     * @dev THE CORRECTION THIS STAGE CARRIES. `docs/day0/OPERATION-BUDGET.md` §2 says these
     *      predicates are evaluated "once per provider (16 times)". That was measured on a
     *      single-market spike. `enabled`, the market cap and the portfolio caps all vary by
     *      MARKET, and a leaf carries a market — so the correct unit is (provider, market) and the
     *      stage is `providers x markets` units, not `providers`. Recorded as delta R-3. The
     *      conclusion is unchanged: the full universe still executes well inside the ceiling and
     *      the window; only the schedule grows.
     *
     *      Five predicates, arithmetised because Nox has no boolean operations:
     *        1 provider has this market enabled
     *        2 borrower has this market enabled
     *        3 provider's market cap is at least the universe minimum ticket
     *        4 provider's collateral-family AND maturity-bucket caps are too
     *        5 provider's confidential vault balance is too
     *      The sixth — the rate — varies by leaf and is applied per cell in stage C.
     *
     *      A failed predicate yields encrypted zero capacity and encrypted zero count. Nothing
     *      public separates that from success: same event, same slots, same call count.
     */
    function cacheProviderChunk(bytes32 epochId, uint32 chunkIndex) external returns (bool executed) {
        QuoteEpochController.Epoch memory epoch =
            controller.requireStage(epochId, QuoteEpochController.Stage.CacheProviders);
        if (!controller.claimChunk(epochId, QuoteEpochController.Stage.CacheProviders, chunkIndex)) {
            emit StageChunkSkipped(epochId, QuoteEpochController.Stage.CacheProviders, chunkIndex);
            return false;
        }

        uint256 minTicket = universes.headerOf(epoch.universeId).minTicketAssets;
        // Hoisted: these are public handles and identical for every unit in the chunk, so paying
        // `toEuint*` per unit would be pure waste at 6,256 gas each.
        euint16 one16 = Nox.toEuint16(1);
        euint16 zero16 = Nox.toEuint16(0);
        euint256 minTicketHandle = Nox.toEuint256(minTicket);
        euint256 zero256 = Nox.toEuint256(0);

        uint256 units = uint256(epoch.providerCount) * uint256(epoch.marketCount);
        uint256 start = uint256(chunkIndex) * CURVE_CACHE_CHUNK_UNITS;
        uint256 end = start + CURVE_CACHE_CHUNK_UNITS;
        if (end > units) end = units;

        bytes32 commitment = bytes32(0);
        for (uint256 unit = start; unit < end; ++unit) {
            uint256 slot = unit / epoch.marketCount;
            uint256 market = unit % epoch.marketCount;
            commitment =
                _cacheOne(epochId, epoch.universeId, slot, market, one16, zero16, minTicketHandle, zero256, commitment);
        }

        graph.foldChunk(epochId, QuoteEpochController.Stage.CacheProviders, chunkIndex, commitment);
        emit StageChunkExecuted(epochId, QuoteEpochController.Stage.CacheProviders, chunkIndex);
        return true;
    }

    // ═════════════════════════════════════════════════════════════════════════════════════════
    // STAGE C · Accumulate capacity and provider count per leaf
    // ═════════════════════════════════════════════════════════════════════════════════════════

    /**
     * @notice The hot loop: exactly five Nox operations per (provider, leaf) cell.
     *
     * @dev `ge -> select256 -> add -> select16 -> add16`, 76,402 gas per cell, measured and
     *      confirmed linear across chunk widths 1, 2, 4, 8 and 16 (OPERATION-BUDGET §2).
     *
     *      `select(rateOk, cachedCapacity, 0)` tests eligibility AND applies it in one operation,
     *      which is what removes the indicator conversion and the multiply that a naive six-term
     *      conjunction would need. Comparing a PUBLIC leaf rate index against the provider's
     *      ENCRYPTED minimum is what makes the comparison a single `ge`.
     *
     *      Rate index 0 is the CHEAPEST borrowing and the HIGHEST tick (`RATE-GRIDS.md`). A lender
     *      wants a high rate, so a provider is eligible when the leaf's rate index is at or above
     *      their encrypted minimum — `ge(leafRate, providerMin)`. Getting this backwards would
     *      quote the most expensive rate while every test still passed, which is why the universe
     *      registry enforces the grid ordering rather than documenting it.
     */
    function accumulateLeafChunk(bytes32 epochId, uint32 chunkIndex) external returns (bool executed) {
        QuoteEpochController.Epoch memory epoch =
            controller.requireStage(epochId, QuoteEpochController.Stage.Accumulate);
        if (!controller.claimChunk(epochId, QuoteEpochController.Stage.Accumulate, chunkIndex)) {
            emit StageChunkSkipped(epochId, QuoteEpochController.Stage.Accumulate, chunkIndex);
            return false;
        }

        uint256 perChunk = universes.headerOf(epoch.universeId).cellsPerChunk;
        uint256 cells = uint256(epoch.providerCount) * uint256(epoch.leafCount);
        uint256 start = uint256(chunkIndex) * perChunk;
        uint256 end = start + perChunk;
        if (end > cells) end = cells;

        euint256 zero256 = Nox.toEuint256(0);
        euint16 zero16 = Nox.toEuint16(0);

        // LEAF-MAJOR, and the shape is worth 27,000 gas per cell rather than being a tidiness
        // preference. Cells are numbered `leafIndex * providers + slot`, so a chunk covers whole
        // runs of one leaf, and three things that are per-LEAF were being paid per CELL:
        //
        //   `toEuint16(rateIndex)`   6,256 gas for a public handle identical across the run
        //   two `allowThis`          11,712 gas persisting an accumulator that is about to be
        //                            overwritten by the next provider in the same transaction
        //   two SSTOREs              writing an intermediate nobody will ever read
        //
        // Hoisting them cut the measured cell cost from 128,914 to the figure recorded in
        // `evidence/phase3/stage-gas.json`. The accumulator is carried in memory across the run
        // and persisted once, at the end of the run, which is the only point another transaction
        // could observe it.
        bytes32 commitment = bytes32(0);
        uint256 cell = start;
        while (cell < end) {
            uint256 leafIndex = cell / epoch.providerCount;
            uint256 leafBase = leafIndex * epoch.providerCount;
            uint256 slotEnd = leafBase + epoch.providerCount;
            if (slotEnd > end) slotEnd = end;

            uint32 packed = _leafTable[epochId][leafIndex];
            uint256 market = packed >> 24;
            euint16 rateHandle = Nox.toEuint16(uint16((packed >> 16) & 0xff));

            euint256 capacity = _capacityAcc[epochId][leafIndex];
            euint16 count = _countAcc[epochId][leafIndex];

            for (uint256 slot = cell - leafBase; slot < slotEnd - leafBase; ++slot) {
                Cached storage cached = _cached[epochId][slot][market];

                // The sixth predicate, and the only one that varies by leaf. A PUBLIC rate index
                // against an ENCRYPTED minimum is one comparison; encrypted-against-encrypted
                // would cost an indicator conversion and a multiply on top.
                ebool rateOk = Nox.ge(rateHandle, _snapshots[epochId][slot].minRateIndexes[market]);

                capacity = Nox.add(capacity, Nox.select(rateOk, cached.capacity, zero256));
                count = Nox.add(count, Nox.select(rateOk, cached.count, zero16));

                commitment = keccak256(
                    abi.encode(commitment, leafIndex, slot, euint256.unwrap(capacity), euint16.unwrap(count))
                );
            }

            _capacityAcc[epochId][leafIndex] = capacity;
            _countAcc[epochId][leafIndex] = count;
            Nox.allowThis(capacity);
            Nox.allowThis(count);

            cell = slotEnd;
        }

        graph.foldChunk(epochId, QuoteEpochController.Stage.Accumulate, chunkIndex, commitment);
        emit StageChunkExecuted(epochId, QuoteEpochController.Stage.Accumulate, chunkIndex);
        return true;
    }

    // ═════════════════════════════════════════════════════════════════════════════════════════
    // STAGE D · Apply the borrower's rate ceiling, the privacy floor and the size bounds
    // ═════════════════════════════════════════════════════════════════════════════════════════

    /**
     * @notice Turns a raw accumulator into a fillable amount, or into encrypted zero.
     *
     * @dev THE BORROWER'S RATE CEILING IS APPLIED HERE, NOT PER CELL, AND THAT IS EXACT. It depends
     *      only on the leaf — the leaf's public rate index against the borrower's encrypted maximum
     *      for that leaf's market — so gating the leaf total is arithmetically identical to gating
     *      every cell, at 1/16th the cost.
     *
     *      THE PRIVACY FLOOR IS A CONTRIBUTION OF ENCRYPTED ZERO, NOT A REVERT. A leaf with too few
     *      eligible providers must not be identifiable; reverting would make the floor a public
     *      oracle over private eligibility (PRD invariant 1). So the capacity is selected to zero
     *      and the leaf simply never wins.
     *
     *      Order matters: cap at the desired size FIRST, then test the borrower's minimum. Testing
     *      the minimum against the uncapped capacity would accept a leaf whose fill, once capped,
     *      falls below the minimum the borrower stated.
     */
    function finalizeLeafChunk(bytes32 epochId, uint32 chunkIndex) external returns (bool executed) {
        QuoteEpochController.Epoch memory epoch =
            controller.requireStage(epochId, QuoteEpochController.Stage.FinalizeLeaves);
        if (!controller.claimChunk(epochId, QuoteEpochController.Stage.FinalizeLeaves, chunkIndex)) {
            emit StageChunkSkipped(epochId, QuoteEpochController.Stage.FinalizeLeaves, chunkIndex);
            return false;
        }

        uint256 start = uint256(chunkIndex) * CURVE_FINALIZE_CHUNK_LEAVES;
        uint256 end = start + CURVE_FINALIZE_CHUNK_LEAVES;
        if (end > epoch.leafCount) end = epoch.leafCount;

        euint16 floorHandle = Nox.toEuint16(universes.headerOf(epoch.universeId).privacyFloor);
        euint256 zero256 = Nox.toEuint256(0);
        euint16 one16 = Nox.toEuint16(1);
        euint16 zero16 = Nox.toEuint16(0);

        bytes32 commitment = bytes32(0);
        for (uint256 leafIndex = start; leafIndex < end; ++leafIndex) {
            commitment = _finalizeOne(epochId, leafIndex, floorHandle, zero256, one16, zero16, commitment);
        }

        graph.foldChunk(epochId, QuoteEpochController.Stage.FinalizeLeaves, chunkIndex, commitment);
        emit StageChunkExecuted(epochId, QuoteEpochController.Stage.FinalizeLeaves, chunkIndex);
        return true;
    }

    // ═════════════════════════════════════════════════════════════════════════════════════════
    // STAGE E · Reduce to one winner under the deterministic policy
    // ═════════════════════════════════════════════════════════════════════════════════════════

    /**
     * @notice Folds leaves into a single best, lowest composite score wins.
     *
     * @dev There is no `min` and no `max` in Nox, so this is compare-then-select, six carries wide.
     *      The composite score is positional and every criterion has its own field:
     *
     *          score = rateIndex*512 + maturityDistance*128 + tail(priority, marketIndex)
     *
     *      Criteria 1, 5, 6 and 7 of the policy are entirely public and are precomputed by
     *      {CurveUniverseRegistry.publicLeafRank}. Criterion 4 — the borrower's maturity preference
     *      — is encrypted, and is the only term that has to be added under encryption. Criteria 2
     *      and 3 are not orderings at all: a leaf without capacity or below the privacy floor
     *      already carries encrypted zero and is pushed to `RANK_CEILING`, so it can never win.
     *
     *      The runner-up is never materialised. Only the running best exists as a handle, so "the
     *      second-best leaf stays private" is structural rather than a rule someone must remember.
     */
    function reduceWinnerChunk(bytes32 epochId, uint32 chunkIndex) external returns (bool executed) {
        QuoteEpochController.Epoch memory epoch =
            controller.requireStage(epochId, QuoteEpochController.Stage.ReduceWinner);
        if (!controller.claimChunk(epochId, QuoteEpochController.Stage.ReduceWinner, chunkIndex)) {
            emit StageChunkSkipped(epochId, QuoteEpochController.Stage.ReduceWinner, chunkIndex);
            return false;
        }

        uint256 start = uint256(chunkIndex) * CURVE_REDUCE_CHUNK_LEAVES;
        uint256 end = start + CURVE_REDUCE_CHUNK_LEAVES;
        if (end > epoch.leafCount) end = epoch.leafCount;

        bytes32 commitment = bytes32(0);
        for (uint256 leafIndex = start; leafIndex < end; ++leafIndex) {
            commitment = _reduceOne(epochId, leafIndex, commitment);
        }

        graph.foldChunk(epochId, QuoteEpochController.Stage.ReduceWinner, chunkIndex, commitment);
        emit StageChunkExecuted(epochId, QuoteEpochController.Stage.ReduceWinner, chunkIndex);
        return true;
    }

    // ═════════════════════════════════════════════════════════════════════════════════════════
    // STAGE E2 · Publish the winner. Four of the five boundary crossings.
    // ═════════════════════════════════════════════════════════════════════════════════════════

    /**
     * @notice Isolates, registers and publicly marks the selected market, rate, floor and readiness.
     *
     * @dev ORDER IS LOAD-BEARING: isolate, register in the graph, THEN publish. Publishing before
     *      registering would let a proof be minted for a handle the graph had not yet committed to,
     *      and `allowPublicDecryption` is IRREVERSIBLE — `sdk/Nox.sol` version 0.2.4 has no way to un-set
     *      it, just as it has no `removeViewer` and no `removeAdmin`.
     *
     *      The market and rate indexes are recovered from the winning leaf's carried handles
     *      directly, so no encrypted division is needed and the two published indexes cannot
     *      disagree with the leaf that was actually selected.
     */
    function publishWinner(bytes32 epochId) external returns (bool executed) {
        controller.requireStage(epochId, QuoteEpochController.Stage.PublishWinner);
        if (!controller.claimChunk(epochId, QuoteEpochController.Stage.PublishWinner, 0)) {
            emit StageChunkSkipped(epochId, QuoteEpochController.Stage.PublishWinner, 0);
            return false;
        }

        Best storage best = _best[epochId];
        ebool cond = _runtime[epochId].epochCondition;

        // A quote is ready exactly when the winning leaf carries a non-zero fill. Published as a
        // 0/1 `euint16` so that isolation, publication and off-chain handle derivation all use one
        // code path — and so a published boolean can never be confused with an internal `ebool`.
        euint16 quoteReady = Nox.select(Nox.gt(best.fill, Nox.toEuint256(0)), Nox.toEuint16(1), Nox.toEuint16(0));

        Published storage published = _published[epochId];
        published.marketIndex = _publish(
            epochId,
            CurveGraphRegistry.ResultRole.SelectedMarketIndex,
            _isolate16(best.marketIndex, cond, isolationDomain(epochId, ROLE_SELECTED_MARKET, 0))
        );
        published.rateIndex = _publish(
            epochId,
            CurveGraphRegistry.ResultRole.SelectedRateIndex,
            _isolate16(best.rateIndex, cond, isolationDomain(epochId, ROLE_SELECTED_RATE, 0))
        );
        published.floorPassed = _publish(
            epochId,
            CurveGraphRegistry.ResultRole.PrivacyFloorPassed,
            _isolate16(best.floorPassed, cond, isolationDomain(epochId, ROLE_PRIVACY_FLOOR, 0))
        );
        published.quoteReady = _publish(
            epochId,
            CurveGraphRegistry.ResultRole.QuoteReady,
            _isolate16(quoteReady, cond, isolationDomain(epochId, ROLE_QUOTE_READY, 0))
        );

        emit WinnerPublished(
            epochId, published.marketIndex, published.rateIndex, published.floorPassed, published.quoteReady
        );
        return true;
    }

    /**
     * @notice Proves the decrypted winner on chain so stage F can index the winning leaf publicly.
     *
     * @dev THIS IS THE CONSENSUS-CRITICAL CHECK, and it is the reason `CurveGraphRegistry` exists.
     *      `validateDecryptionProof` is a pure EIP-712 signature check with no ACL, no nonce, no
     *      expiry and no caller binding, so a valid proof attests only that the gateway decrypted
     *      SOME handle to SOME value, and it is replayable by anyone forever. It becomes
     *      authorisation only once the handle is shown to be the handle THIS epoch's sealed graph
     *      committed to for THIS role.
     *
     *      A proof for a real handle from a different epoch is refused by `requireBoundResult`. A
     *      proof for this epoch's handle carrying a different value is refused by the byte
     *      comparison below.
     */
    function proveWinner(
        bytes32 epochId,
        uint8 marketIndex,
        uint8 rateIndex,
        bytes calldata marketProof,
        bytes calldata rateProof
    ) external {
        controller.requireStage(epochId, QuoteEpochController.Stage.Allocate);
        Runtime storage runtime = _runtime[epochId];
        if (runtime.winnerProven) {
            revert WinnerAlreadyProven(epochId, runtime.winnerMarketIndex, runtime.winnerRateIndex);
        }

        Published storage published = _published[epochId];
        _requireProvenValue(
            epochId, CurveGraphRegistry.ResultRole.SelectedMarketIndex, published.marketIndex, marketProof, marketIndex
        );
        _requireProvenValue(
            epochId, CurveGraphRegistry.ResultRole.SelectedRateIndex, published.rateIndex, rateProof, rateIndex
        );

        runtime.winnerMarketIndex = marketIndex;
        runtime.winnerRateIndex = rateIndex;
        runtime.winnerProven = true;

        emit WinnerProven(epochId, marketIndex, rateIndex);
    }

    // ═════════════════════════════════════════════════════════════════════════════════════════
    // STAGE F · Pro-rata allocation and reservation
    // ═════════════════════════════════════════════════════════════════════════════════════════

    /**
     * @notice Allocates each provider a pro-rata share of the winning leaf and reserves it.
     *
     * @dev `allocation = fill * contribution / totalCapacity`. There is no fused `mulDiv`, so this
     *      is `safeMul` then `safeDiv`, and BOTH encrypted success flags are threaded through
     *      `select`. That is not defensive style: unsafe `div` SATURATES to the type maximum on
     *      divide-by-zero instead of reverting, and a failed safe op returns encrypted zero while
     *      the transaction succeeds — either would turn a failure into a plausible-looking
     *      allocation nobody could see was wrong.
     *
     *      The provider's contribution to the winning leaf is RECOMPUTED here rather than stored
     *      during stage C. Storing it would mean 2,048 handles in storage, roughly 41M gas of
     *      SSTORE, to save two operations for 16 of them.
     */
    function allocateChunk(bytes32 epochId, uint32 chunkIndex) external returns (bool executed) {
        QuoteEpochController.Epoch memory epoch = controller.requireStage(epochId, QuoteEpochController.Stage.Allocate);
        Runtime storage runtime = _runtime[epochId];
        if (!runtime.winnerProven) revert WinnerNotProven(epochId);

        if (!controller.claimChunk(epochId, QuoteEpochController.Stage.Allocate, chunkIndex)) {
            emit StageChunkSkipped(epochId, QuoteEpochController.Stage.Allocate, chunkIndex);
            return false;
        }

        uint256 start = uint256(chunkIndex) * CURVE_ALLOCATE_CHUNK_PROVIDERS;
        uint256 end = start + CURVE_ALLOCATE_CHUNK_PROVIDERS;
        if (end > epoch.providerCount) end = epoch.providerCount;

        bytes32 commitment = bytes32(0);
        for (uint256 slot = start; slot < end; ++slot) {
            commitment = _allocateOne(epochId, slot, commitment);
        }

        graph.foldChunk(epochId, QuoteEpochController.Stage.Allocate, chunkIndex, commitment);
        emit StageChunkExecuted(epochId, QuoteEpochController.Stage.Allocate, chunkIndex);
        return true;
    }

    // ═════════════════════════════════════════════════════════════════════════════════════════
    // STAGE G · Publish the aggregate. The fifth and last boundary crossing.
    // ═════════════════════════════════════════════════════════════════════════════════════════

    /**
     * @notice Publishes the aggregate, which is the SUM OF WHAT WAS RESERVED.
     *
     * @dev NOT the winning leaf's fillable capacity, and the difference matters. Every pro-rata
     *      share is floored by `safeDiv`, so the reservations sum to slightly less than the fill.
     *      Publishing the fill would publish a number the reservations then fail to match, and
     *      "reservations sum to the public aggregate" would be false by up to one wei per provider.
     *      Publishing the sum instead makes that invariant true by construction and leaves the
     *      residue as an explicit, bounded dust term.
     *
     *      `dustResidue = fill - aggregate` is kept as a handle for Phase 4's §19.8 dust account.
     *      It is granted to NOBODY and published NEVER: it would otherwise disclose the winning
     *      leaf's total capacity, which is private.
     */
    function publishAggregate(bytes32 epochId) external returns (bool executed) {
        controller.requireStage(epochId, QuoteEpochController.Stage.PublishAggregate);
        if (!controller.claimChunk(epochId, QuoteEpochController.Stage.PublishAggregate, 0)) {
            emit StageChunkSkipped(epochId, QuoteEpochController.Stage.PublishAggregate, 0);
            return false;
        }

        Runtime storage runtime = _runtime[epochId];
        euint256 aggregate = runtime.aggregate;

        bytes32 handle = _publish(
            epochId,
            CurveGraphRegistry.ResultRole.AggregateFillAmount,
            _isolate(aggregate, runtime.epochCondition, isolationDomain(epochId, ROLE_AGGREGATE_FILL, 0))
        );
        _published[epochId].aggregateFill = handle;

        runtime.dustResidue = Nox.sub(_best[epochId].fill, aggregate);
        Nox.allowThis(runtime.dustResidue);

        bytes32 root = graph.sealGraph(epochId);
        emit AggregatePublished(epochId, handle, root);
        return true;
    }

    // ═════════════════════════════════════════════════════════════════════════════════════════
    // Stage advance and cancellation
    // ═════════════════════════════════════════════════════════════════════════════════════════

    /// @notice Advances the epoch once every chunk of the current stage is complete.
    function advanceStage(bytes32 epochId) external returns (QuoteEpochController.Stage) {
        return controller.advanceStage(epochId);
    }

    /**
     * @notice Cancels an epoch and releases every reservation it holds, in full.
     * @dev Not pausable, and permissionless after the deadline. A reservation that could be trapped
     *      by inaction would be capital held hostage by a stalled keeper (PRD invariant 12, 20).
     */
    function cancelEpoch(bytes32 epochId) external {
        QuoteEpochController.Epoch memory epoch = controller.epochOf(epochId);
        ebool cond = _runtime[epochId].epochCondition;

        for (uint256 slot = 0; slot < epoch.providerCount; ++slot) {
            address provider = _snapshots[epochId][slot].provider;
            if (ledger.stateOf(epochId, provider) == ReservationLedger.ReservationState.Reserved) {
                // Release isolates the restored balance under the epoch condition too, so the
                // ledger needs it here for the same reason it needs it in `_allocateOne`.
                _assertReviewedTransientRecipient(address(ledger));
                Nox.allowTransient(cond, address(ledger));
                ledger.release(epochId, provider, cond);
            }
        }

        controller.cancelEpoch(epochId, msg.sender);
        emit EpochCancelled(epochId, msg.sender);
    }

    // ═════════════════════════════════════════════════════════════════════════════════════════
    // Encrypted views. Every one returns a HANDLE, never a value.
    // ═════════════════════════════════════════════════════════════════════════════════════════

    function publishedOf(bytes32 epochId) external view returns (Published memory) {
        return _published[epochId];
    }

    function confidentialAllocationOf(bytes32 epochId, uint256 slot) external view returns (euint256) {
        return _allocation[epochId][slot];
    }

    /// @notice A losing leaf's capacity. The handle is addressable; nobody holds a grant to it.
    function confidentialLeafCapacityOf(bytes32 epochId, uint256 leafIndex) external view returns (euint256) {
        return _leafCapacity[epochId][leafIndex];
    }

    function confidentialFillableOf(bytes32 epochId, uint256 leafIndex) external view returns (euint256) {
        return _fillable[epochId][leafIndex];
    }

    function confidentialProviderCountOf(bytes32 epochId, uint256 leafIndex) external view returns (euint16) {
        return _countAcc[epochId][leafIndex];
    }

    /// @notice The residue between the winning leaf's fill and the reservations actually taken.
    function confidentialDustOf(bytes32 epochId) external view returns (euint256) {
        return _runtime[epochId].dustResidue;
    }

    /**
     * @dev THERE IS DELIBERATELY NO `snapshotOf` OR `leafTableOf` HERE, and both were removed
     *      rather than never written.
     *
     *      Each returned a large struct or dynamic array purely to re-expose data another contract
     *      already publishes: a provider's sealed handles are the SAME handles
     *      `EncryptedMandateBook.handlesOf` returns, and the packed leaf table is derivable from
     *      `CurveUniverseRegistry.leafAt` and `publicLeafRank`. Their ABI encoders cost around 900
     *      bytes of runtime code between them, and this contract sits close enough to the EIP-170
     *      limit that a duplicate accessor is a real cost rather than a convenience. Delta R-10.
     */

    function cachedOf(bytes32 epochId, uint256 slot, uint256 marketIndex) external view returns (Cached memory) {
        return _cached[epochId][slot][marketIndex];
    }

    function winnerOf(bytes32 epochId) external view returns (bool proven, uint8 marketIndex, uint8 rateIndex) {
        Runtime storage runtime = _runtime[epochId];
        return (runtime.winnerProven, runtime.winnerMarketIndex, runtime.winnerRateIndex);
    }

    // ═════════════════════════════════════════════════════════════════════════════════════════
    // Internals
    // ═════════════════════════════════════════════════════════════════════════════════════════

    /// @dev The engine must hold ACL on every handle it computes on, and the owner is the only one
    ///      who can grant it. Checking here turns a missing grant into a named public revert at
    ///      seal time instead of an opaque NoxCompute failure eight transactions later.
    function _requireEngineAccess(bytes32 handle) private view {
        _requireConfidential(handle);
        if (!INoxCompute(Nox.noxComputeContract()).isAllowed(handle, address(this))) {
            revert EngineNotAuthorisedForHandle(handle, address(this));
        }
    }

    function _copyProviderSnapshot(bytes32 epochId, uint16 slot, bytes32 mandateId, uint32 mandateEpoch) private {
        EncryptedMandateBook.MandateEpochHandles memory handles = mandateBook.handlesOf(mandateId, mandateEpoch);
        ProviderSnapshot storage snapshot = _snapshots[epochId][slot];

        snapshot.provider = msg.sender;
        snapshot.mandateId = mandateId;
        snapshot.mandateEpoch = mandateEpoch;

        _requireEngineAccess(euint256.unwrap(handles.totalBudget));
        snapshot.totalBudget = handles.totalBudget;

        for (uint256 m = 0; m < 8; ++m) {
            _requireEngineAccess(euint256.unwrap(handles.marketCaps[m]));
            _requireEngineAccess(euint16.unwrap(handles.minRateIndexes[m]));
            _requireEngineAccess(euint16.unwrap(handles.enabledFlags[m]));
            snapshot.marketCaps[m] = handles.marketCaps[m];
            snapshot.minRateIndexes[m] = handles.minRateIndexes[m];
            snapshot.enabledFlags[m] = handles.enabledFlags[m];
        }
        for (uint256 f = 0; f < 4; ++f) {
            _requireEngineAccess(euint256.unwrap(handles.collateralFamilyCaps[f]));
            _requireEngineAccess(euint256.unwrap(handles.maturityBucketCaps[f]));
            snapshot.collateralFamilyCaps[f] = handles.collateralFamilyCaps[f];
            snapshot.maturityBucketCaps[f] = handles.maturityBucketCaps[f];
        }

        // The custody balance is the sixth eligibility predicate, so this contract needs access and
        // only the provider can grant it.
        //
        // THE LEDGER NO LONGER NEEDS IT, and that is a deliberate reduction rather than an omission.
        // Phase 3 required a second grant here because `ReservationLedger` subtracted from this
        // handle; Phase 5 moved that subtraction into `KyrveCustodyVault`, which computed its own
        // balance and already holds `allowThis` on it. Every grant a provider makes is PERMANENT —
        // there is no `removeAdmin` — so one fewer irreversible grant per provider per epoch is
        // worth naming. Delta T-5.
        euint256 balance = vault.confidentialAvailableOf(msg.sender);
        _requireEngineAccess(euint256.unwrap(balance));
        snapshot.balance = balance;

        ledger.seedProvider(epochId, msg.sender, mandateId, mandateEpoch, balance);
    }

    function _snapshotRoot(bytes32 epochId) private view returns (bytes32 root) {
        QuoteEpochController.SealedProvider[] memory sealedProviders = controller.providersOf(epochId);
        QuoteEpochController.Epoch memory epoch = controller.epochOf(epochId);
        root = keccak256(abi.encode("kyrve.curve.snapshot", epochId, requestBook.requestOf(epoch.requestId).commitment));
        for (uint256 i = 0; i < sealedProviders.length; ++i) {
            root = keccak256(
                abi.encode(
                    root,
                    sealedProviders[i].provider,
                    sealedProviders[i].mandateId,
                    sealedProviders[i].mandateEpoch,
                    mandateBook.epochCommitment(sealedProviders[i].mandateId, sealedProviders[i].mandateEpoch)
                )
            );
        }
    }

    function _buildLeafTable(bytes32 epochId, bytes32 universeId, uint256 leaves) private {
        uint32[] storage table = _leafTable[epochId];
        for (uint256 i = 0; i < leaves; ++i) {
            CurveUniverseRegistry.Leaf memory leaf = universes.leafAt(universeId, i);
            uint32 rank = universes.publicLeafRank(universeId, i);
            table.push((uint32(leaf.marketIndex) << 24) | (uint32(leaf.rateIndex) << 16) | rank);
        }
    }

    /**
     * @dev The encrypted distance between each market's public maturity bucket and the borrower's
     *      encrypted preference — criterion 4 of the selection policy.
     *
     *      There is no `abs` and no encrypted branch, so both differences are computed and one is
     *      selected. The discarded one WRAPS when its subtraction underflows; that is harmless
     *      precisely because it is discarded, and it is called out here because an unsafe `sub`
     *      whose wrap were ever taken would produce an enormous distance and silently demote a
     *      market that should have been preferred.
     *
     *      One value per MARKET, not per leaf: every leaf on a market shares a maturity bucket, so
     *      computing it per leaf would cost 16x more for identical results.
     */
    function _buildMaturityTerms(bytes32 epochId, bytes32 universeId, euint16 preferred) private {
        euint16 stride = Nox.toEuint16(CURVE_MATURITY_RANK_STRIDE);
        CurveUniverseRegistry.MarketSpec[] memory markets = universes.marketsOf(universeId);
        for (uint256 m = 0; m < markets.length; ++m) {
            euint16 bucket = Nox.toEuint16(markets[m].maturityBucket);
            ebool preferredIsHigher = Nox.ge(preferred, bucket);
            euint16 distance = Nox.select(preferredIsHigher, Nox.sub(preferred, bucket), Nox.sub(bucket, preferred));
            euint16 term = Nox.mul(distance, stride);
            Nox.allowThis(term);
            _maturityTerm[epochId][m] = term;
        }
    }

    function _cacheOne(
        bytes32 epochId,
        bytes32 universeId,
        uint256 slot,
        uint256 market,
        euint16 one16,
        euint16 zero16,
        euint256 minTicket,
        euint256 zero256,
        bytes32 commitment
    ) private returns (bytes32) {
        ProviderSnapshot storage snapshot = _snapshots[epochId][slot];
        RequestSnapshot storage request = _request[epochId];
        CurveUniverseRegistry.MarketSpec memory spec = universes.marketAt(universeId, market);

        // Six predicates. No boolean operation exists, so each becomes a 0/1 indicator and the
        // indicators are multiplied — the product is 1 only when every one held.
        euint16 product = Nox.select(Nox.eq(snapshot.enabledFlags[market], one16), one16, zero16);
        product = Nox.mul(product, Nox.select(Nox.eq(request.enabledFlags[market], one16), one16, zero16));
        product = Nox.mul(product, Nox.select(Nox.ge(snapshot.marketCaps[market], minTicket), one16, zero16));
        product = Nox.mul(
            product, Nox.select(Nox.ge(snapshot.collateralFamilyCaps[spec.collateralFamily], minTicket), one16, zero16)
        );
        product = Nox.mul(
            product, Nox.select(Nox.ge(snapshot.maturityBucketCaps[spec.maturityBucket], minTicket), one16, zero16)
        );
        product = Nox.mul(product, Nox.select(Nox.ge(snapshot.balance, minTicket), one16, zero16));
        ebool allSix = Nox.eq(product, one16);

        // The capacity a provider could contribute is the tightest of their four caps and their
        // balance. There is no `min`, so each is compare-then-select.
        euint256 headroom = _min(snapshot.marketCaps[market], snapshot.collateralFamilyCaps[spec.collateralFamily]);
        headroom = _min(headroom, snapshot.maturityBucketCaps[spec.maturityBucket]);
        headroom = _min(headroom, snapshot.totalBudget);
        headroom = _min(headroom, snapshot.balance);

        Cached storage cached = _cached[epochId][slot][market];
        cached.capacity = Nox.select(allSix, headroom, zero256);
        cached.count = Nox.select(allSix, one16, zero16);
        Nox.allowThis(cached.capacity);
        Nox.allowThis(cached.count);

        return
            keccak256(
                abi.encode(commitment, slot, market, euint256.unwrap(cached.capacity), euint16.unwrap(cached.count))
            );
    }

    function _finalizeOne(
        bytes32 epochId,
        uint256 leafIndex,
        euint16 floorHandle,
        euint256 zero256,
        euint16 one16,
        euint16 zero16,
        bytes32 commitment
    ) private returns (bytes32) {
        uint32 packed = _leafTable[epochId][leafIndex];
        uint256 market = packed >> 24;
        uint16 rateIndex = uint16((packed >> 16) & 0xff);
        RequestSnapshot storage request = _request[epochId];

        // The borrower's rate ceiling. Applied to the leaf total rather than per cell — identical
        // arithmetic at a sixteenth of the cost, because it depends only on the leaf.
        ebool rateAcceptable = Nox.ge(request.maxRateIndexes[market], Nox.toEuint16(rateIndex));
        euint256 capacity = Nox.select(rateAcceptable, _capacityAcc[epochId][leafIndex], zero256);
        euint16 count = Nox.select(rateAcceptable, _countAcc[epochId][leafIndex], zero16);

        // The privacy floor. Below it the capacity becomes encrypted ZERO and the leaf simply never
        // wins. It does NOT revert and produces no public reason (PRD invariant 1).
        ebool floorOk = Nox.ge(count, floorHandle);
        capacity = Nox.select(floorOk, capacity, zero256);

        // Cap at the desired size FIRST, then test the borrower's stated minimum against the
        // capped amount. The other order would accept a leaf whose fill, once capped, is below it.
        euint256 fill = _min(capacity, request.desiredAssets);
        fill = Nox.select(Nox.ge(fill, request.minimumAssets), fill, zero256);

        _leafCapacity[epochId][leafIndex] = capacity;
        _fillable[epochId][leafIndex] = fill;
        _leafFloorPassed[epochId][leafIndex] = Nox.select(floorOk, one16, zero16);
        Nox.allowThis(capacity);
        Nox.allowThis(fill);
        Nox.allowThis(_leafFloorPassed[epochId][leafIndex]);

        return keccak256(abi.encode(commitment, leafIndex, euint256.unwrap(fill), euint256.unwrap(capacity)));
    }

    function _reduceOne(bytes32 epochId, uint256 leafIndex, bytes32 commitment) private returns (bytes32) {
        uint32 packed = _leafTable[epochId][leafIndex];
        uint256 market = packed >> 24;
        uint16 rateIndex = uint16((packed >> 16) & 0xff);
        uint16 rank = uint16(packed & 0xffff);

        Best storage best = _best[epochId];
        euint256 fill = _fillable[epochId][leafIndex];

        // score = publicRank + encrypted maturity distance * stride. The public part already
        // encodes criteria 1, 5, 6 and 7 positionally; this adds criterion 4.
        euint16 score = Nox.add(_maturityTerm[epochId][market], Nox.toEuint16(rank));
        // A leaf with no fill is pushed above every real rank, so it can never win however
        // attractive its rate. Criteria 2 and 3 are enforced here, as an exclusion, not an order.
        euint16 effective = Nox.select(Nox.gt(fill, Nox.toEuint256(0)), score, Nox.toEuint16(CURVE_RANK_CEILING));

        if (!best.started) {
            // The first leaf seeds the fold, and the two index carries go through a select even
            // though nothing is being chosen yet.
            //
            // NOT COSMETIC. `Nox.toEuint16(k)` is `wrapAsPublicHandle`, which produces a PUBLIC
            // handle — and a public handle has no ACL, so `allowThis` below reverts on it
            // (`notPublicHandle` in `modules/ACL.sol`), and `_isolate16` at publication would
            // reject it too. A single-leaf universe would therefore fail at stage E2 with an
            // opaque error while every multi-leaf universe passed. `seedTrue` has confidential
            // operands, so the selects are confidential, deterministic and reproducible off chain.
            ebool seedTrue = Nox.eq(effective, effective);
            best.score = effective;
            best.marketIndex = Nox.select(seedTrue, Nox.toEuint16(uint16(market)), Nox.toEuint16(0));
            best.rateIndex = Nox.select(seedTrue, Nox.toEuint16(rateIndex), Nox.toEuint16(0));
            best.floorPassed = _leafFloorPassed[epochId][leafIndex];
            best.fill = fill;
            best.capacity = _leafCapacity[epochId][leafIndex];
            best.started = true;
        } else {
            ebool better = Nox.lt(effective, best.score);
            best.score = Nox.select(better, effective, best.score);
            best.marketIndex = Nox.select(better, Nox.toEuint16(uint16(market)), best.marketIndex);
            best.rateIndex = Nox.select(better, Nox.toEuint16(rateIndex), best.rateIndex);
            best.floorPassed = Nox.select(better, _leafFloorPassed[epochId][leafIndex], best.floorPassed);
            best.fill = Nox.select(better, fill, best.fill);
            best.capacity = Nox.select(better, _leafCapacity[epochId][leafIndex], best.capacity);
        }

        Nox.allowThis(best.score);
        Nox.allowThis(best.marketIndex);
        Nox.allowThis(best.rateIndex);
        Nox.allowThis(best.floorPassed);
        Nox.allowThis(best.fill);
        Nox.allowThis(best.capacity);

        return keccak256(abi.encode(commitment, leafIndex, euint16.unwrap(best.score), euint256.unwrap(best.fill)));
    }

    function _allocateOne(bytes32 epochId, uint256 slot, bytes32 commitment) private returns (bytes32) {
        Runtime storage runtime = _runtime[epochId];
        ProviderSnapshot storage snapshot = _snapshots[epochId][slot];
        Best storage best = _best[epochId];
        uint256 market = runtime.winnerMarketIndex;

        euint256 zero256 = Nox.toEuint256(0);
        ebool rateOk = Nox.ge(Nox.toEuint16(runtime.winnerRateIndex), snapshot.minRateIndexes[market]);
        euint256 contribution = Nox.select(rateOk, _cached[epochId][slot][market].capacity, zero256);

        // No fused mulDiv exists. Both success flags are threaded: `safeMul` overflowing or
        // `safeDiv` dividing by zero must produce encrypted zero, never a plausible number.
        (ebool mulOk, euint256 scaled) = Nox.safeMul(best.fill, contribution);
        (ebool divOk, euint256 share) = Nox.safeDiv(scaled, best.capacity);
        euint256 allocation = Nox.select(mulOk, share, zero256);
        allocation = Nox.select(divOk, allocation, zero256);

        euint256 isolated =
            _isolate(allocation, runtime.epochCondition, isolationDomain(epochId, ROLE_ALLOCATION, slot));
        _allocation[epochId][slot] = isolated;
        _grantOwnerOnly(isolated, snapshot.provider);

        // The ledger performs the safe subtraction against the provider's sealed snapshot and
        // isolates its own two outputs under the SAME epoch condition, so it needs both operands
        // for exactly this transaction and no longer.
        //
        // The condition is easy to forget because the engine holds a persistent grant on it and
        // therefore never notices: the failure appears only inside the ledger, as a bare
        // `NotAllowed` from NoxCompute naming a contract the engine did not think it was calling.
        _lendToLedger(isolated, runtime.epochCondition);
        euint256 reserved = ledger.reserve(epochId, snapshot.provider, isolated, runtime.epochCondition);

        // The aggregate is the sum of what was RESERVED, never of what was asked for.
        runtime.aggregate = runtime.aggregateStarted ? Nox.add(runtime.aggregate, reserved) : reserved;
        runtime.aggregateStarted = true;
        Nox.allowThis(runtime.aggregate);

        return keccak256(abi.encode(commitment, slot, euint256.unwrap(isolated), euint256.unwrap(reserved)));
    }

    /// @dev Hands the ledger the two operands it needs for exactly one transaction: the allocation
    ///      it is reserving, and the epoch condition it isolates its outputs under.
    function _lendToLedger(euint256 allocation, ebool epochCondition) private {
        _assertReviewedTransientRecipient(address(ledger));
        Nox.allowTransient(allocation, address(ledger));
        Nox.allowTransient(epochCondition, address(ledger));
    }

    /// @dev `min` does not exist in Nox. Compare, then select. 25,661 gas.
    function _min(euint256 a, euint256 b) private returns (euint256) {
        return Nox.select(Nox.le(a, b), a, b);
    }

    /// @dev Register in the sealed graph BEFORE publishing. `allowPublicDecryption` cannot be undone.
    function _publish(bytes32 epochId, CurveGraphRegistry.ResultRole role, euint16 value) private returns (bytes32) {
        bytes32 handle = euint16.unwrap(value);
        graph.registerResult(epochId, role, handle);
        Nox.allowThis(value);
        Nox.allowPublicDecryption(value);
        return handle;
    }

    function _publish(bytes32 epochId, CurveGraphRegistry.ResultRole role, euint256 value) private returns (bytes32) {
        bytes32 handle = euint256.unwrap(value);
        graph.registerResult(epochId, role, handle);
        Nox.allowThis(value);
        Nox.allowPublicDecryption(value);
        return handle;
    }

    /**
     * @dev Binds a gateway decryption proof to this epoch's committed handle AND to the claimed
     *      value. Both halves are needed: the graph check refuses a proof from another epoch, the
     *      byte comparison refuses a proof for this epoch's handle carrying a different number.
     */
    function _requireProvenValue(
        bytes32 epochId,
        CurveGraphRegistry.ResultRole role,
        bytes32 handle,
        bytes calldata proof,
        uint256 claimed
    ) private view {
        // The REGISTERED form, not the sealed one. This runs between stage E2 and stage F, and the
        // graph is not sealed until the aggregate is published after stage F — requiring a seal
        // here would make the epoch unfinishable. Registration is what binds the handle to this
        // epoch and this role; sealing additionally means the computation is complete, which is
        // what `CurveResultVerifier` requires of an outside reader.
        graph.requireRegisteredResult(epochId, role, handle);
        bytes memory decoded = INoxCompute(Nox.noxComputeContract()).validateDecryptionProof(handle, proof);
        // NOT `abi.decode`. The gateway returns the plaintext at its natural width — two bytes for
        // a `euint16` — and `abi.decode` reverts on anything under 32 with no reason. Delta R-5.
        uint256 value = DecryptedValue.toUint(decoded);
        if (value != claimed) revert DecryptedValueMismatch(handle, claimed, value);
    }
}
