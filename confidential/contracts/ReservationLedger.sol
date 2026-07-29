// SPDX-License-Identifier: GPL-2.0-or-later
pragma solidity 0.8.36;

import {Nox, ebool, euint256} from "@iexec-nox/nox-protocol-contracts/contracts/sdk/Nox.sol";

import {KyrveCurveBase} from "./KyrveCurveBase.sol";
import {KyrveCustodyVault} from "./KyrveCustodyVault.sol";
import {KyrveEmergencyController} from "./KyrveEmergencyController.sol";

/**
 * @title ReservationLedger
 * @notice Epoch state for encrypted per-provider reservations (PRD §11.10, §13.3).
 *
 * ────────────────────────────────────────────────────────────────────────────────────────────
 * WHAT CHANGED IN PHASE 5, AND WHY THIS FILE IS SHORTER THAN IT WAS
 * ────────────────────────────────────────────────────────────────────────────────────────────
 *
 * Phase 3's version performed its own `safeSub` against a SNAPSHOT of the provider's vault balance,
 * because there was nowhere else to do it: the Phase 2 vault's reservation entry point takes
 * `(externalEuint256, bytes inputProof)` and `Nox.fromExternal` needs a gateway proof for a value
 * its owner knows in plaintext — which a curve allocation, existing only as a handle, can never
 * have. Delta [R-1](../../docs/phase3/PRD-DELTA.md).
 *
 * That produced exactly the defect prerequisite P5-1 names: `sum(reserved)` and *the capital that
 * can actually pay* were two independent quantities that happened to agree because one operator
 * funded both. This ledger reserved against a snapshot, took no custody, and could not stop a
 * provider withdrawing afterwards.
 *
 * **There is now exactly one subtraction and it is not here.** {KyrveCustodyVault.lockAllocation}
 * takes the `euint256` the engine computed and subtracts it from the provider's LIVE available
 * balance, in the same contract that holds the wrapper coverage backing it. This ledger keeps epoch
 * state — who was seeded, who reserved, which lock is theirs — and delegates the arithmetic. It no
 * longer tracks a parallel remainder, because a parallel remainder is the thing that was wrong.
 * See `docs/phase5/P5-1-DECISION.md`.
 *
 * ────────────────────────────────────────────────────────────────────────────────────────────
 * WHY A SHORT RESERVATION STILL CANNOT REVERT
 * ────────────────────────────────────────────────────────────────────────────────────────────
 *
 * A provider whose balance is too small must not be identifiable — that is exactly the private fact
 * the product exists to protect (PRD invariant 1, §6.4). The `safeSub -> select -> select` shape
 * that guarantees it now lives in the custody vault, unchanged in behaviour: the transaction
 * succeeds either way, writes the same slots either way, and emits the same event either way.
 *
 * Public reverts here are reserved for PUBLIC faults — a provider seeded twice, a reservation asked
 * for twice, a release with nothing reserved. None of them discloses an amount.
 *
 * ────────────────────────────────────────────────────────────────────────────────────────────
 * THERE IS DELIBERATELY NO ENCRYPTED GLOBAL TOTAL HERE
 * ────────────────────────────────────────────────────────────────────────────────────────────
 *
 * Read `docs/phase2/PRD-DELTA.md` Q-5 before adding one. An encrypted running total accumulated
 * beside a provider's balance is how Phase 2 leaked the protocol aggregate to its first depositor:
 * on the first reservation into an empty ledger both would be the same operation over the same
 * operands, hence one handle with one PERMANENT ACL entry, and `allow` has no inverse.
 *
 * The public aggregate is instead summed by the engine from the isolated `reserved` handles this
 * contract passes through from the custody vault, each isolated there under a lock-scoped domain
 * that no provider handle can share. See {KyrveCurveBase._isolate}.
 *
 * ────────────────────────────────────────────────────────────────────────────────────────────
 * PUBLIC / PRIVATE BOUNDARY
 * ────────────────────────────────────────────────────────────────────────────────────────────
 *
 *   PUBLIC   that a provider was seeded into an epoch, that a reservation was opened or released,
 *            and when.
 *   PRIVATE  the snapshot, the remaining balance, the reserved amount, and whether the reservation
 *            took the full amount or silently took encrypted zero.
 *
 * Release is NOT pausable and has no flag in {KyrveEmergencyController} — the enum has no member
 * for it and must never gain one (PRD invariant 20, delta Q-6).
 */
contract ReservationLedger is KyrveCurveBase {
    enum ReservationState {
        None,
        Seeded,
        Reserved,
        Released
    }

    struct Reservation {
        ReservationState state;
        bytes32 mandateId;
        uint32 mandateEpoch;
        uint64 seededAt;
        uint64 changedAt;
    }

    address public immutable deployer;

    /**
     * @notice The custody contract that holds the capital and performs the one subtraction.
     * @dev Immutable. A mutable custodian on this path would let a rebinding redirect every future
     *      reservation at a contract of someone else's choosing while the epoch state stayed valid.
     */
    KyrveCustodyVault public immutable custody;

    /// @notice The only contract permitted to seed, reserve or release. Bound once, never again.
    address public engine;

    mapping(bytes32 epochId => mapping(address provider => Reservation)) private _reservations;
    /// @dev The provider's custody balance as sealed into this epoch. Never mutated. This is the
    ///      sixth eligibility predicate's operand, not an accounting quantity: the live remainder is
    ///      `custody.confidentialAvailableOf(provider)` and there is no second copy of it.
    mapping(bytes32 epochId => mapping(address provider => euint256)) private _seed;
    mapping(bytes32 epochId => mapping(address provider => euint256)) private _reserved;
    /// @dev The custody lock this reservation opened. Recorded so release and consumption address
    ///      exactly the lock this epoch created and cannot reach another.
    mapping(bytes32 epochId => mapping(address provider => bytes32)) private _lockId;

    event EngineBound(address indexed engineAddress);
    event ProviderSeeded(bytes32 indexed epochId, address indexed provider, bytes32 mandateId, uint32 mandateEpoch);
    event ReservationOpened(bytes32 indexed epochId, address indexed provider);
    event ReservationReleased(bytes32 indexed epochId, address indexed provider);

    error EngineAlreadyBound(address existing);
    error EngineNotBound();
    error NotDeployer(address caller, address expected);
    error NotEngine(address caller, address expected);
    error AlreadySeeded(bytes32 epochId, address provider);
    error NotSeeded(bytes32 epochId, address provider);
    error AlreadyReserved(bytes32 epochId, address provider);
    error NothingReserved(bytes32 epochId, address provider);
    error ZeroAddress();

    constructor(KyrveCustodyVault custody_, KyrveEmergencyController controller) KyrveCurveBase(controller) {
        if (address(custody_) == address(0)) revert ZeroAddress();
        custody = custody_;
        deployer = msg.sender;
    }

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

    /**
     * @notice The ledger's immutable transient-handle allowlist.
     * @dev Two contracts, both fixed: the engine that drives it, bound once, and the custody vault
     *      it was deployed against, which needs the allocation and the epoch condition for exactly
     *      the transaction in which it locks them. Transient access carries full persistent-grant
     *      power, so this is never a mutable set.
     */
    function isReviewedTransientRecipient(address recipient) public view override returns (bool) {
        if (recipient == address(0)) return false;
        return recipient == engine || recipient == address(custody);
    }

    // ─────────────────────────────────────────────────────────────────────────────────────────
    // Seeding
    // ─────────────────────────────────────────────────────────────────────────────────────────

    /**
     * @notice Records the provider's sealed custody-balance snapshot for one epoch.
     * @dev Stores a handle; it performs no operation, so it creates no new handle and cannot
     *      collide with anything. The provider must already have granted this contract access to
     *      `balanceSnapshot` — the engine proves that on chain before calling, because a ledger that
     *      discovered the missing grant later would revert mid-epoch with a NoxCompute error that
     *      says nothing useful.
     *
     *      The snapshot is NO LONGER a debit target. Phase 5 moved the subtraction into
     *      {KyrveCustodyVault}, so this handle is read by the engine as the sixth eligibility
     *      predicate and is never mutated by anything. A second copy of the remainder is exactly the
     *      parallel quantity P5-1 removed.
     */
    function seedProvider(
        bytes32 epochId,
        address provider,
        bytes32 mandateId,
        uint32 mandateEpoch,
        euint256 balanceSnapshot
    ) external onlyEngine {
        Reservation storage reservation = _reservations[epochId][provider];
        if (reservation.state != ReservationState.None) revert AlreadySeeded(epochId, provider);
        _requireConfidential(euint256.unwrap(balanceSnapshot));

        reservation.state = ReservationState.Seeded;
        reservation.mandateId = mandateId;
        reservation.mandateEpoch = mandateEpoch;
        reservation.seededAt = uint64(block.timestamp);

        _seed[epochId][provider] = balanceSnapshot;

        emit ProviderSeeded(epochId, provider, mandateId, mandateEpoch);
    }

    // ─────────────────────────────────────────────────────────────────────────────────────────
    // Reserve
    // ─────────────────────────────────────────────────────────────────────────────────────────

    /**
     * @notice Opens a real capital lock for one provider and returns what it actually took.
     *
     * @param amount the allocation handle the engine computed. Handle-native end to end: no gateway
     *        proof exists for it and none is needed.
     * @param epochCondition the epoch's isolation condition, supplied by the engine so that this
     *        contract, the engine and the custody vault all isolate under one shared, epoch-unique
     *        lineage.
     * @return reservedHandle the isolated amount actually locked — encrypted zero if the provider's
     *         live balance was short. The engine sums these into the public aggregate, which is why
     *         the aggregate is the sum of what was TAKEN rather than of what was asked for.
     *
     * @dev THIS IS WHERE A RESERVATION BECAME A LOCK. The subtraction happens inside
     *      {KyrveCustodyVault.lockAllocation}, against the provider's LIVE available balance in the
     *      contract that holds the coverage — not against a snapshot this contract keeps. So the
     *      value the engine folds into the aggregate and the value that can actually pay Midnight
     *      are the same value, which is what prerequisite P5-1 required and delta S-6 said Phase 4
     *      did not have.
     *
     *      Two transient grants, both to the one reviewed custody contract fixed at construction:
     *      the allocation it is locking, and the epoch condition it isolates its three outputs
     *      under. The condition is easy to forget because this contract holds a persistent grant on
     *      nothing and the engine holds one on the condition — the failure surfaces only inside the
     *      vault, as a bare `NotAllowed` from NoxCompute naming a contract the caller did not think
     *      it was calling.
     *
     *      Double reservation is refused publicly. It is a public fault: the keeper asked twice for
     *      the same (epoch, provider), which says nothing about any amount.
     */
    function reserve(bytes32 epochId, address provider, euint256 amount, ebool epochCondition)
        external
        onlyEngine
        returns (euint256 reservedHandle)
    {
        emergencyController.requireNotPaused(KyrveEmergencyController.Activity.ReservationOpening);

        Reservation storage reservation = _reservations[epochId][provider];
        if (reservation.state == ReservationState.None) revert NotSeeded(epochId, provider);
        if (reservation.state == ReservationState.Reserved) revert AlreadyReserved(epochId, provider);

        // One-shot: an allocation handle may fund exactly one reservation, ever, at this contract.
        // Nox supplies no such guard — `validateInputProof` has no nonce and no consumption marker
        // (delta Q-2), and an on-chain operation output has no guard at all. The custody vault
        // applies the same guard independently, because a one-shot enforced in only one of two
        // contracts is a one-shot that a future caller can route around.
        _consumeHandle(euint256.unwrap(amount));

        _assertReviewedTransientRecipient(address(custody));
        Nox.allowTransient(amount, address(custody));
        Nox.allowTransient(epochCondition, address(custody));

        bytes32 lockId;
        (lockId, reservedHandle) = custody.lockAllocation(epochId, provider, amount, epochCondition);

        _reserved[epochId][provider] = reservedHandle;
        _lockId[epochId][provider] = lockId;
        reservation.state = ReservationState.Reserved;
        reservation.changedAt = uint64(block.timestamp);

        // The engine needs the reserved handle for exactly this transaction, to fold it into the
        // running aggregate. The vault granted this contract transient access; passing it on is
        // itself a transient grant, and only to the one reviewed contract that drives us.
        _assertReviewedTransientRecipient(msg.sender);
        Nox.allowTransient(reservedHandle, msg.sender);

        emit ReservationOpened(epochId, provider);
    }

    // ─────────────────────────────────────────────────────────────────────────────────────────
    // Release. Never pausable.
    // ─────────────────────────────────────────────────────────────────────────────────────────

    /**
     * @notice Releases a reservation's lock, returning the capital to the provider in full.
     * @dev The restoration arithmetic is the custody vault's, for the same reason the subtraction is:
     *      there is one place the balance lives and one place it changes. The vault restores exactly
     *      the value it locked, so the sum cannot exceed what was there and cannot overflow, and the
     *      conservation statement is the vault's own
     *      `sum(available) + sum(locked) <= confidentialBalanceOf(vault)` rather than a per-epoch
     *      `remaining + reserved == seed` over a snapshot nothing spends.
     *
     *      No pause flag exists for this path and none can be added — {KyrveEmergencyController}'s
     *      enum has no member for it (PRD invariant 20, delta Q-6). Invariant 10.
     */
    function release(bytes32 epochId, address provider, ebool epochCondition) external onlyEngine {
        Reservation storage reservation = _reservations[epochId][provider];
        if (reservation.state != ReservationState.Reserved) revert NothingReserved(epochId, provider);

        bytes32 lockId = _lockId[epochId][provider];

        // `delete` is meaningless for a handle — it is a reference and the ciphertext behind it
        // cannot be destroyed. Clearing the slot to the undefined handle is the closest correct
        // action; Nox resolves an undefined handle to encrypted zero. Done BEFORE the external call.
        _reserved[epochId][provider] = euint256.wrap(bytes32(0));
        reservation.state = ReservationState.Released;
        reservation.changedAt = uint64(block.timestamp);

        _assertReviewedTransientRecipient(address(custody));
        Nox.allowTransient(epochCondition, address(custody));
        custody.releaseLock(lockId, epochCondition);

        emit ReservationReleased(epochId, provider);
    }

    // ─────────────────────────────────────────────────────────────────────────────────────────
    // Encrypted views. Every one returns a HANDLE, never a value.
    // ─────────────────────────────────────────────────────────────────────────────────────────

    /// @notice The snapshot the epoch sealed. Only the provider holds a grant to decrypt it.
    function confidentialSeedOf(bytes32 epochId, address provider) external view returns (euint256) {
        return _seed[epochId][provider];
    }

    /**
     * @notice The provider's live remaining balance.
     * @dev Reads through to custody deliberately. Phase 3 kept a per-epoch copy and that copy was
     *      the defect: it could disagree with the capital that pays. There is now one remainder and
     *      this accessor names where it is rather than duplicating it.
     */
    function confidentialRemainingOf(bytes32, address provider) external view returns (euint256) {
        return custody.confidentialAvailableOf(provider);
    }

    /// @notice The custody lock this reservation opened, or zero if none.
    function lockIdOf(bytes32 epochId, address provider) external view returns (bytes32) {
        return _lockId[epochId][provider];
    }

    function confidentialReservedOf(bytes32 epochId, address provider) external view returns (euint256) {
        return _reserved[epochId][provider];
    }

    function reservationOf(bytes32 epochId, address provider) external view returns (Reservation memory) {
        return _reservations[epochId][provider];
    }

    function stateOf(bytes32 epochId, address provider) external view returns (ReservationState) {
        return _reservations[epochId][provider].state;
    }
}
