// SPDX-License-Identifier: GPL-2.0-or-later
pragma solidity 0.8.36;

import {
    Nox,
    euint16,
    euint256,
    externalEuint16,
    externalEuint256
} from "@iexec-nox/nox-protocol-contracts/contracts/sdk/Nox.sol";

import {KyrveConfidentialBase} from "./KyrveConfidentialBase.sol";
import {KyrveEmergencyController} from "./KyrveEmergencyController.sol";

/**
 * @title EncryptedMandateBook
 * @notice The direct provider entry point for encrypted lending mandates (PRD §13.4, §11.3).
 *
 * A mandate is the private half of the product. It says, in ciphertext, how much a provider will
 * lend, into which markets, at what minimum rate, and under what concentration limits. None of that
 * is ever public. What *is* public is only that a provider has an active mandate for a universe,
 * which epoch it is on, and whether it is paused or retired.
 *
 * ────────────────────────────────────────────────────────────────────────────────────────────
 * EPOCHS — why replacement is not an update
 * ────────────────────────────────────────────────────────────────────────────────────────────
 *
 * Nox handles are immutable and their ACL grants are PERMANENT. A mandate therefore cannot be
 * edited: `sdk/Nox.sol` (version 0.2.4) has no `removeViewer` and no `removeAdmin`, so any grant already made
 * against an old handle survives forever. The only sound model is replacement.
 *
 * `replaceMandate` creates a NEW epoch with NEW handles and leaves the old handles exactly where
 * they were. What changes is authorisation: `activeEpoch` moves forward, and every consumer must
 * present the epoch it read. `assertUsable(mandateId, epoch)` reverts `StaleMandateEpoch` for
 * anything else, so an old handle set — however valid, however decryptable by whoever already had
 * access — can never authorise new activity. PRD invariant 13, and demonstrated in the suite.
 *
 * A user interface must therefore never say a replaced mandate was "revoked" or "deleted". The
 * honest wording is that its epoch no longer authorises activity; anyone who could already decrypt
 * those handles still can.
 *
 * ────────────────────────────────────────────────────────────────────────────────────────────
 * PUBLIC / PRIVATE BOUNDARY
 * ────────────────────────────────────────────────────────────────────────────────────────────
 *
 *   PUBLIC FROM SUBMISSION   provider address, universe id, epoch, schema version, lifecycle state,
 *                            submission and replacement timestamps, the commitment hash.
 *   PRIVATE FOREVER          total budget, every per-market cap, every minimum rate index, every
 *                            enabled flag, collateral-family caps, maturity-bucket caps, maximum
 *                            duration and allocation weight.
 *
 * The commitment hash is a keccak over the *handles*, not the values. Handles are opaque
 * references; publishing one reveals nothing without an ACL grant.
 */
contract EncryptedMandateBook is KyrveConfidentialBase {
    /// @dev Fixed-length arrays, sized from PRD §11.3. Unused slots carry encrypted zero, which is
    /// what makes the shape of a mandate uninformative — every mandate has the same 35 handles.
    uint256 public constant MARKET_SLOTS = 8;
    uint256 public constant COLLATERAL_FAMILY_SLOTS = 4;
    uint256 public constant MATURITY_BUCKET_SLOTS = 4;
    uint256 public constant MANDATE_HANDLE_COUNT = 1 + 8 + 8 + 8 + 4 + 4 + 1 + 1;

    enum MandateState {
        None,
        Active,
        Paused,
        Retired
    }

    /// @notice The encrypted mandate exactly as PRD §11.3 specifies it.
    struct EncryptedMandateInput {
        externalEuint256 totalBudget;
        externalEuint256[8] marketCaps;
        externalEuint16[8] minRateIndexes;
        externalEuint16[8] enabledFlags;
        externalEuint256[4] collateralFamilyCaps;
        externalEuint256[4] maturityBucketCaps;
        externalEuint16 maxDurationIndex;
        externalEuint16 allocationWeight;
    }

    /// @dev The handle set for one epoch. Never contains a value, only references.
    struct MandateEpochHandles {
        euint256 totalBudget;
        euint256[8] marketCaps;
        euint16[8] minRateIndexes;
        euint16[8] enabledFlags;
        euint256[4] collateralFamilyCaps;
        euint256[4] maturityBucketCaps;
        euint16 maxDurationIndex;
        euint16 allocationWeight;
    }

    struct Mandate {
        address provider;
        bytes32 universeId;
        uint32 activeEpoch;
        uint16 schemaVersion;
        MandateState state;
        uint64 submittedAt;
        uint64 updatedAt;
    }

    mapping(bytes32 mandateId => Mandate) private _mandates;
    mapping(bytes32 mandateId => mapping(uint32 epoch => MandateEpochHandles)) private _handles;
    /// @notice Commitment to the handle set of one epoch. Public: it reveals no value.
    mapping(bytes32 mandateId => mapping(uint32 epoch => bytes32)) public epochCommitment;

    event MandateSubmitted(
        bytes32 indexed mandateId,
        address indexed provider,
        bytes32 indexed universeId,
        uint32 epoch,
        bytes32 commitment
    );
    event MandateReplaced(
        bytes32 indexed mandateId, uint32 indexed previousEpoch, uint32 indexed newEpoch, bytes32 commitment
    );
    event MandatePaused(bytes32 indexed mandateId, uint32 indexed epoch);
    event MandateResumed(bytes32 indexed mandateId, uint32 indexed epoch);
    event MandateRetired(bytes32 indexed mandateId, uint32 indexed epoch);

    error MandateAlreadyExists(bytes32 mandateId);
    error UnknownMandate(bytes32 mandateId);
    error NotMandateProvider(bytes32 mandateId, address caller, address provider);
    error MandateNotActive(bytes32 mandateId, MandateState state);
    error MandateNotPaused(bytes32 mandateId, MandateState state);
    error MandateIsRetired(bytes32 mandateId);
    error StaleMandateEpoch(bytes32 mandateId, uint32 supplied, uint32 active);
    error UniverseIsZero();
    error WrongProofCount(uint256 expected, uint256 supplied);

    constructor(KyrveEmergencyController controller) KyrveConfidentialBase(controller) {}

    /**
     * @inheritdoc KyrveConfidentialBase
     * @dev The mandate book hands out no transient handles at all. Mandate handles are read by the
     *      curve engine through a persistent grant in a later phase, never passed transiently,
     *      because a transient recipient could permanently publish a provider's private curve.
     */
    function isReviewedTransientRecipient(address) public pure override returns (bool) {
        return false;
    }

    /// @notice One mandate per provider per universe, bound to this chain and this deployment.
    function mandateIdFor(address provider, bytes32 universeId) public view returns (bytes32) {
        return keccak256(abi.encode(block.chainid, address(this), provider, universeId));
    }

    // ─────────────────────────────────────────────────────────────────────────────────────────
    // Entry: submission and replacement
    // ─────────────────────────────────────────────────────────────────────────────────────────

    /**
     * @notice Seals a provider's first encrypted mandate for a universe.
     * @param universeId the public universe this mandate quotes into.
     * @param input the 35 external handles of PRD §11.3, each bound to this contract, this chain,
     *        the caller, and a 3600 second expiry by the gateway that issued it.
     * @param proofs one 137-byte gateway proof per handle, in the same order as
     *        {mandateHandleOrder}.
     * @param nonce the caller's next submission nonce. Strictly increasing; the replay guard Nox
     *        itself does not provide.
     */
    function submitMandate(
        bytes32 universeId,
        EncryptedMandateInput calldata input,
        bytes[] calldata proofs,
        uint256 nonce
    ) external returns (bytes32 mandateId) {
        emergencyController.requireNotPaused(KyrveEmergencyController.Activity.MandateSubmission);
        if (universeId == bytes32(0)) revert UniverseIsZero();
        _assertDirectCaller();
        _consumeNonce(nonce);

        mandateId = mandateIdFor(msg.sender, universeId);
        if (_mandates[mandateId].provider != address(0)) revert MandateAlreadyExists(mandateId);

        uint32 epoch = 1;
        bytes32 commitment = _seal(mandateId, epoch, input, proofs);

        _mandates[mandateId] = Mandate({
            provider: msg.sender,
            universeId: universeId,
            activeEpoch: epoch,
            schemaVersion: KYRVE_SCHEMA_VERSION,
            state: MandateState.Active,
            submittedAt: uint64(block.timestamp),
            updatedAt: uint64(block.timestamp)
        });

        emit MandateSubmitted(mandateId, msg.sender, universeId, epoch, commitment);
    }

    /**
     * @notice Replaces a mandate with a new epoch of new handles.
     * @dev The old epoch's handles are NOT destroyed — Nox cannot destroy a handle and cannot
     *      withdraw a grant. They simply stop authorising anything, because `activeEpoch` has moved
     *      and every consumer must present the active epoch.
     */
    function replaceMandate(
        bytes32 mandateId,
        EncryptedMandateInput calldata input,
        bytes[] calldata proofs,
        uint256 nonce
    ) external returns (uint32 newEpoch) {
        emergencyController.requireNotPaused(KyrveEmergencyController.Activity.MandateSubmission);
        _assertDirectCaller();
        Mandate storage mandate = _requireProvider(mandateId);
        if (mandate.state == MandateState.Retired) revert MandateIsRetired(mandateId);
        _consumeNonce(nonce);

        uint32 previousEpoch = mandate.activeEpoch;
        newEpoch = previousEpoch + 1;

        bytes32 commitment = _seal(mandateId, newEpoch, input, proofs);

        mandate.activeEpoch = newEpoch;
        mandate.updatedAt = uint64(block.timestamp);
        // A replacement resumes a paused mandate only if the provider says so; it does not here.
        emit MandateReplaced(mandateId, previousEpoch, newEpoch, commitment);
    }

    // ─────────────────────────────────────────────────────────────────────────────────────────
    // Lifecycle. None of these is pausable: a provider must always be able to stop lending.
    // ─────────────────────────────────────────────────────────────────────────────────────────

    /// @notice Stops a mandate from being quoted against, without discarding it.
    function pauseMandate(bytes32 mandateId) external {
        Mandate storage mandate = _requireProvider(mandateId);
        if (mandate.state != MandateState.Active) revert MandateNotActive(mandateId, mandate.state);
        mandate.state = MandateState.Paused;
        mandate.updatedAt = uint64(block.timestamp);
        emit MandatePaused(mandateId, mandate.activeEpoch);
    }

    /// @notice Returns a paused mandate to service on its existing epoch.
    function resumeMandate(bytes32 mandateId) external {
        emergencyController.requireNotPaused(KyrveEmergencyController.Activity.MandateSubmission);
        Mandate storage mandate = _requireProvider(mandateId);
        if (mandate.state != MandateState.Paused) revert MandateNotPaused(mandateId, mandate.state);
        mandate.state = MandateState.Active;
        mandate.updatedAt = uint64(block.timestamp);
        emit MandateResumed(mandateId, mandate.activeEpoch);
    }

    /**
     * @notice Ends a mandate permanently.
     * @dev Terminal. A retired mandate cannot be resumed or replaced, and a new mandate for the
     *      same provider and universe cannot be created either, because `mandateId` is
     *      deterministic. That is deliberate: reusing the identifier would let a retired epoch's
     *      handles be confused with a live one's.
     */
    function retireMandate(bytes32 mandateId) external {
        Mandate storage mandate = _requireProvider(mandateId);
        if (mandate.state == MandateState.Retired) revert MandateIsRetired(mandateId);
        mandate.state = MandateState.Retired;
        mandate.updatedAt = uint64(block.timestamp);
        emit MandateRetired(mandateId, mandate.activeEpoch);
    }

    // ─────────────────────────────────────────────────────────────────────────────────────────
    // Consumption guard
    // ─────────────────────────────────────────────────────────────────────────────────────────

    /**
     * @notice The check every future consumer of a mandate must make.
     * @dev Public, view, and reverting: an epoch mismatch is a PUBLIC fault — the caller supplied
     *      the wrong version — not a confidential one, so a public revert is correct here.
     */
    function assertUsable(bytes32 mandateId, uint32 epoch) public view {
        Mandate storage mandate = _mandates[mandateId];
        if (mandate.provider == address(0)) revert UnknownMandate(mandateId);
        if (mandate.state != MandateState.Active) revert MandateNotActive(mandateId, mandate.state);
        if (epoch != mandate.activeEpoch) {
            revert StaleMandateEpoch(mandateId, epoch, mandate.activeEpoch);
        }
    }

    function isUsable(bytes32 mandateId, uint32 epoch) external view returns (bool) {
        Mandate storage mandate = _mandates[mandateId];
        return mandate.provider != address(0) && mandate.state == MandateState.Active
            && epoch == mandate.activeEpoch;
    }

    // ─────────────────────────────────────────────────────────────────────────────────────────
    // Views
    // ─────────────────────────────────────────────────────────────────────────────────────────

    function mandateOf(bytes32 mandateId) external view returns (Mandate memory) {
        return _mandates[mandateId];
    }

    /**
     * @notice The handle set for one epoch.
     * @dev Handles are opaque. Returning them publicly discloses nothing: without an ACL grant the
     *      gateway refuses to decrypt, which the suite proves with a second wallet.
     */
    function handlesOf(bytes32 mandateId, uint32 epoch)
        external
        view
        returns (MandateEpochHandles memory)
    {
        return _handles[mandateId][epoch];
    }

    /// @notice The canonical order proofs must be supplied in. Documented so a client cannot guess.
    function mandateHandleOrder() external pure returns (string memory) {
        return "totalBudget, marketCaps[0..7], minRateIndexes[0..7], enabledFlags[0..7], "
        "collateralFamilyCaps[0..3], maturityBucketCaps[0..3], maxDurationIndex, allocationWeight";
    }

    // ─────────────────────────────────────────────────────────────────────────────────────────
    // Internals
    // ─────────────────────────────────────────────────────────────────────────────────────────

    function _requireProvider(bytes32 mandateId) private view returns (Mandate storage mandate) {
        mandate = _mandates[mandateId];
        if (mandate.provider == address(0)) revert UnknownMandate(mandateId);
        if (mandate.provider != msg.sender) {
            revert NotMandateProvider(mandateId, msg.sender, mandate.provider);
        }
    }

    /**
     * @dev Validates all 35 proofs, stores the resulting handles, and grants exactly two things per
     *      handle: `allowThis` so this contract can use them later, and `allow(handle, provider)` so
     *      the provider — and only the provider — can decrypt them. No viewer is ever added and
     *      nothing is ever published.
     */
    function _seal(
        bytes32 mandateId,
        uint32 epoch,
        EncryptedMandateInput calldata input,
        bytes[] calldata proofs
    ) private returns (bytes32 commitment) {
        if (proofs.length != MANDATE_HANDLE_COUNT) {
            revert WrongProofCount(MANDATE_HANDLE_COUNT, proofs.length);
        }

        MandateEpochHandles storage stored = _handles[mandateId][epoch];
        bytes32[] memory raw = new bytes32[](MANDATE_HANDLE_COUNT);
        uint256 cursor = 0;

        {
            euint256 budget = Nox.fromExternal(input.totalBudget, proofs[cursor]);
            stored.totalBudget = budget;
            raw[cursor] = euint256.unwrap(budget);
            _consumeHandle(raw[cursor]);
            _grantOwnerOnly(budget, msg.sender);
            unchecked {
                ++cursor;
            }
        }

        for (uint256 i = 0; i < MARKET_SLOTS; ++i) {
            euint256 cap = Nox.fromExternal(input.marketCaps[i], proofs[cursor]);
            stored.marketCaps[i] = cap;
            raw[cursor] = euint256.unwrap(cap);
            _consumeHandle(raw[cursor]);
            _grantOwnerOnly(cap, msg.sender);
            unchecked {
                ++cursor;
            }
        }

        for (uint256 i = 0; i < MARKET_SLOTS; ++i) {
            euint16 minRate = Nox.fromExternal(input.minRateIndexes[i], proofs[cursor]);
            stored.minRateIndexes[i] = minRate;
            raw[cursor] = euint16.unwrap(minRate);
            _consumeHandle(raw[cursor]);
            _grantOwnerOnly(minRate, msg.sender);
            unchecked {
                ++cursor;
            }
        }

        for (uint256 i = 0; i < MARKET_SLOTS; ++i) {
            euint16 enabled = Nox.fromExternal(input.enabledFlags[i], proofs[cursor]);
            stored.enabledFlags[i] = enabled;
            raw[cursor] = euint16.unwrap(enabled);
            _consumeHandle(raw[cursor]);
            _grantOwnerOnly(enabled, msg.sender);
            unchecked {
                ++cursor;
            }
        }

        for (uint256 i = 0; i < COLLATERAL_FAMILY_SLOTS; ++i) {
            euint256 cap = Nox.fromExternal(input.collateralFamilyCaps[i], proofs[cursor]);
            stored.collateralFamilyCaps[i] = cap;
            raw[cursor] = euint256.unwrap(cap);
            _consumeHandle(raw[cursor]);
            _grantOwnerOnly(cap, msg.sender);
            unchecked {
                ++cursor;
            }
        }

        for (uint256 i = 0; i < MATURITY_BUCKET_SLOTS; ++i) {
            euint256 cap = Nox.fromExternal(input.maturityBucketCaps[i], proofs[cursor]);
            stored.maturityBucketCaps[i] = cap;
            raw[cursor] = euint256.unwrap(cap);
            _consumeHandle(raw[cursor]);
            _grantOwnerOnly(cap, msg.sender);
            unchecked {
                ++cursor;
            }
        }

        {
            euint16 duration = Nox.fromExternal(input.maxDurationIndex, proofs[cursor]);
            stored.maxDurationIndex = duration;
            raw[cursor] = euint16.unwrap(duration);
            _consumeHandle(raw[cursor]);
            _grantOwnerOnly(duration, msg.sender);
            unchecked {
                ++cursor;
            }
        }

        {
            euint16 weight = Nox.fromExternal(input.allocationWeight, proofs[cursor]);
            stored.allocationWeight = weight;
            raw[cursor] = euint16.unwrap(weight);
            _consumeHandle(raw[cursor]);
            _grantOwnerOnly(weight, msg.sender);
            unchecked {
                ++cursor;
            }
        }

        // Binds the handle set to this mandate, this epoch, this schema, this chain and this
        // deployment. A handle set from another epoch produces a different commitment, so a stale
        // set can never be presented as a current one.
        commitment = keccak256(
            abi.encode(
                block.chainid, address(this), mandateId, epoch, KYRVE_SCHEMA_VERSION, raw
            )
        );
        epochCommitment[mandateId][epoch] = commitment;
    }
}
