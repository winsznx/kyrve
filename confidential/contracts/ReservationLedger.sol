// SPDX-License-Identifier: GPL-2.0-or-later
pragma solidity 0.8.36;

import {Nox, ebool, euint256} from "@iexec-nox/nox-protocol-contracts/contracts/sdk/Nox.sol";

import {KyrveCurveBase} from "./KyrveCurveBase.sol";
import {KyrveEmergencyController} from "./KyrveEmergencyController.sol";

/**
 * @title ReservationLedger
 * @notice Encrypted per-provider reservations for one curve epoch (PRD §11.10, §13.3).
 *
 * ────────────────────────────────────────────────────────────────────────────────────────────
 * WHY THIS IS NOT `KyrveConfidentialAssetVault.openReservation`
 * ────────────────────────────────────────────────────────────────────────────────────────────
 *
 * The Phase 2 vault's reservation entry point takes `(externalEuint256, bytes inputProof)` — a
 * gateway proof minted by the reserver for an amount the reserver knows in plaintext. That shape is
 * correct for a human keeper reserving a number it chose, and it is **structurally incapable** of
 * accepting a curve-engine allocation, because the whole point of the engine is that nobody knows
 * that number. No proof can be minted for a value that exists only as a handle.
 *
 * The vault is deployed, verified and immutable, so Phase 3 does not edit it and does not fork it.
 * This ledger is the handle-native counterpart: it takes an `euint256` the engine computed, and
 * performs the same `safeSub -> select -> select` shape the vault uses, against a snapshot of the
 * provider's vault balance sealed into the epoch. Recorded as delta [R-1](../../docs/phase3/PRD-DELTA.md).
 *
 * **The honest limit, stated here rather than in a footnote.** This ledger reserves against a
 * SNAPSHOT handle. It does not custody capital and it cannot stop the provider withdrawing from the
 * vault after the snapshot was taken. Making a reservation move real vault capital requires the
 * vault to gain a handle-native entry point, which is a change to a deployed contract's trust model
 * and belongs with `QuoteActivator` in Phase 4, where a reservation first becomes a payment
 * obligation. Phase 3 proves the arithmetic, the conservation and the release; it does not claim
 * the capital is locked.
 *
 * ────────────────────────────────────────────────────────────────────────────────────────────
 * WHY A SHORT RESERVATION CANNOT REVERT
 * ────────────────────────────────────────────────────────────────────────────────────────────
 *
 * A provider whose snapshot is too small must not be identifiable — that is exactly the private
 * fact the product exists to protect (PRD invariant 1, §6.4). So every path here is
 *
 *     (ok, candidate) = safeSub(remaining, amount)      // both CIPHERTEXTS
 *     applied         = select(ok, amount, 0)           // encrypted zero when short
 *     remaining       = select(ok, candidate, remaining) // unchanged when short
 *
 * `ok` can never be branched on in Solidity. The transaction succeeds either way, writes the same
 * slots either way and emits the same event either way.
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
 * contract returns, under an epoch- and role-scoped isolation domain that no provider handle can
 * share. See {KyrveCurveBase._isolate}.
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

    /// @notice The only contract permitted to seed, reserve or release. Bound once, never again.
    address public engine;

    mapping(bytes32 epochId => mapping(address provider => Reservation)) private _reservations;
    /// @dev The provider's vault balance as sealed into this epoch. Never mutated.
    mapping(bytes32 epochId => mapping(address provider => euint256)) private _seed;
    mapping(bytes32 epochId => mapping(address provider => euint256)) private _remaining;
    mapping(bytes32 epochId => mapping(address provider => euint256)) private _reserved;

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

    constructor(KyrveEmergencyController controller) KyrveCurveBase(controller) {
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
     * @dev The ledger hands transient handles to exactly one contract: the engine that drives it,
     *      fixed at binding. Transient access carries full persistent-grant power, so this is a
     *      single address rather than a set.
     */
    function isReviewedTransientRecipient(address recipient) public view override returns (bool) {
        return recipient != address(0) && recipient == engine;
    }

    // ─────────────────────────────────────────────────────────────────────────────────────────
    // Seeding
    // ─────────────────────────────────────────────────────────────────────────────────────────

    /**
     * @notice Records the provider's sealed vault-balance snapshot for one epoch.
     * @dev Stores a handle; it performs no operation, so it creates no new handle and cannot
     *      collide with anything. The provider must already have granted this contract access to
     *      `balanceSnapshot` — the engine proves that on chain before calling, because a ledger
     *      that discovered the missing grant at `safeSub` time would revert mid-epoch with a
     *      NoxCompute error that says nothing useful.
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
        _remaining[epochId][provider] = balanceSnapshot;

        emit ProviderSeeded(epochId, provider, mandateId, mandateEpoch);
    }

    // ─────────────────────────────────────────────────────────────────────────────────────────
    // Reserve
    // ─────────────────────────────────────────────────────────────────────────────────────────

    /**
     * @notice Moves an encrypted amount from a provider's remaining snapshot into a reservation.
     * @param epochCondition the epoch's isolation condition, supplied by the engine so that both
     *        contracts isolate under one shared, epoch-unique lineage.
     * @return reservedHandle the isolated amount actually reserved — encrypted zero if the snapshot
     *         was short. The engine sums these into the public aggregate, which is why the aggregate
     *         is the sum of what was TAKEN rather than of what was asked for.
     *
     * @dev Double reservation is refused publicly. It is a public fault: the keeper asked twice for
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
        // (delta Q-2), and an on-chain operation output has no guard at all.
        _consumeHandle(euint256.unwrap(amount));

        euint256 remaining = _remaining[epochId][provider];
        (ebool ok, euint256 candidate) = Nox.safeSub(remaining, amount);

        // `ok` is a ciphertext and cannot be branched on. It is threaded through both selects, so a
        // short snapshot reserves encrypted zero and leaves `remaining` untouched.
        euint256 applied = Nox.select(ok, amount, Nox.toEuint256(0));
        euint256 newRemaining = Nox.select(ok, candidate, remaining);

        reservedHandle =
            _isolate(applied, epochCondition, isolationDomain(epochId, ROLE_RESERVED, uint256(uint160(provider))));
        euint256 isolatedRemaining = _isolate(
            newRemaining, epochCondition, isolationDomain(epochId, ROLE_REMAINING, uint256(uint160(provider)))
        );

        _reserved[epochId][provider] = reservedHandle;
        _remaining[epochId][provider] = isolatedRemaining;
        reservation.state = ReservationState.Reserved;
        reservation.changedAt = uint64(block.timestamp);

        // The provider may decrypt their own reservation and their own remaining balance. Nobody
        // else may, and neither handle can equal another provider's — that is what the isolation
        // domains above buy, and demonstration 17 asserts it on chain.
        _grantOwnerOnly(reservedHandle, provider);
        _grantOwnerOnly(isolatedRemaining, provider);

        // The engine needs the reserved handle for exactly this transaction, to fold it into the
        // running aggregate. Transient, and only to the one reviewed contract that drives us.
        _assertReviewedTransientRecipient(msg.sender);
        Nox.allowTransient(reservedHandle, msg.sender);

        emit ReservationOpened(epochId, provider);
    }

    // ─────────────────────────────────────────────────────────────────────────────────────────
    // Release. Never pausable.
    // ─────────────────────────────────────────────────────────────────────────────────────────

    /**
     * @notice Returns a reservation to the provider's remaining snapshot, in full.
     * @dev `add` rather than a safe op on purpose: the value being restored is exactly the value
     *      this contract subtracted, so the sum cannot exceed the seed and cannot overflow. The
     *      conservation invariant `remaining + reserved == seed` therefore holds before and after,
     *      and the suite asserts it by decrypting all three.
     *
     *      No pause flag exists for this path and none can be added — {KyrveEmergencyController}'s
     *      enum has no member for it (PRD invariant 20).
     */
    function release(bytes32 epochId, address provider, ebool epochCondition) external onlyEngine {
        Reservation storage reservation = _reservations[epochId][provider];
        if (reservation.state != ReservationState.Reserved) revert NothingReserved(epochId, provider);

        euint256 reservedAmount = _reserved[epochId][provider];
        euint256 restored = Nox.add(_remaining[epochId][provider], reservedAmount);
        euint256 isolatedRemaining = _isolate(
            restored, epochCondition, isolationDomain(epochId, ROLE_REMAINING, uint256(uint160(provider)) + 1)
        );

        _remaining[epochId][provider] = isolatedRemaining;
        // `delete` is meaningless for a handle — it is a reference and the ciphertext behind it
        // cannot be destroyed. Clearing the slot to the undefined handle is the closest correct
        // action; Nox resolves an undefined handle to encrypted zero.
        _reserved[epochId][provider] = euint256.wrap(bytes32(0));
        reservation.state = ReservationState.Released;
        reservation.changedAt = uint64(block.timestamp);

        _grantOwnerOnly(isolatedRemaining, provider);

        emit ReservationReleased(epochId, provider);
    }

    // ─────────────────────────────────────────────────────────────────────────────────────────
    // Encrypted views. Every one returns a HANDLE, never a value.
    // ─────────────────────────────────────────────────────────────────────────────────────────

    /// @notice The snapshot the epoch sealed. Only the provider holds a grant to decrypt it.
    function confidentialSeedOf(bytes32 epochId, address provider) external view returns (euint256) {
        return _seed[epochId][provider];
    }

    function confidentialRemainingOf(bytes32 epochId, address provider) external view returns (euint256) {
        return _remaining[epochId][provider];
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
