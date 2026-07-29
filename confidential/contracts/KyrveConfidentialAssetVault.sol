// SPDX-License-Identifier: GPL-2.0-or-later
pragma solidity 0.8.36;

import {
    Nox,
    ebool,
    euint256,
    externalEuint256
} from "@iexec-nox/nox-protocol-contracts/contracts/sdk/Nox.sol";

import {KyrveConfidentialBase} from "./KyrveConfidentialBase.sol";
import {KyrveEmergencyController} from "./KyrveEmergencyController.sol";
import {KyrveWrappedAsset} from "./KyrveWrappedAsset.sol";

/**
 * @title KyrveConfidentialAssetVault
 * @notice Confidential provider balances and settlement reservations (PRD §13.3).
 *
 * A provider's capital exists in three encrypted places, and the sum of the first two is what the
 * vault owes them:
 *
 *   `confidentialAvailableOf(p)`  — free, withdrawable at any time, never pausable.
 *   `confidentialLockedOf(p)`     — reserved against a settlement, released on expiry or fill.
 *   the wrapper balance in the provider's own wallet — outside the vault entirely.
 *
 * ────────────────────────────────────────────────────────────────────────────────────────────
 * WHY RESERVATION CANNOT REVERT
 * ────────────────────────────────────────────────────────────────────────────────────────────
 *
 * A provider whose balance is too small to cover a reservation must not be identifiable. If the
 * vault reverted, the failure would be a public oracle: an observer would learn that *this*
 * provider was short at *this* moment, which is exactly the private fact the product exists to
 * protect (PRD invariant 3, §6.4).
 *
 * So every balance-changing operation here uses the same shape:
 *
 *     (ok, candidate) = safeSub(balance, amount)          // ok and candidate are CIPHERTEXTS
 *     applied         = select(ok, amount, 0)             // encrypted zero when short
 *     balance         = select(ok, candidate, balance)    // unchanged when short
 *
 * `ok` can never be branched on in Solidity — it is an encrypted boolean — so it is threaded
 * through `select` instead. The transaction succeeds either way, emits the same event either way,
 * and touches the same storage slots either way. Nothing public separates the two outcomes.
 *
 * TWO SILENT FAILURE MODES THIS GUARDS AGAINST, both verified against `sdk/Nox.sol` (version 0.2.4):
 *   - a failed safe op returns encrypted `false` AND an encrypted ZERO result, while the
 *     transaction still succeeds. An unthreaded result would silently become a zero allocation.
 *   - unsafe `div` does not revert on divide-by-zero; it saturates to the type maximum. The vault
 *     performs no division.
 *
 * ────────────────────────────────────────────────────────────────────────────────────────────
 * PUBLIC / PRIVATE BOUNDARY
 * ────────────────────────────────────────────────────────────────────────────────────────────
 *
 *   PUBLIC   that a deposit, withdrawal, reservation or release happened; who did it; when.
 *   PRIVATE  every amount, every balance, every reservation size, and whether any of them
 *            succeeded or silently contributed zero.
 *
 * ────────────────────────────────────────────────────────────────────────────────────────────
 * RECOVERY IS NEVER PAUSABLE
 * ────────────────────────────────────────────────────────────────────────────────────────────
 *
 * `deposit` and `openReservation` are entries and are pausable. `withdraw` and `releaseReservation`
 * have no pause flag in {KyrveEmergencyController} and cannot acquire one — the enum has no member
 * for them. A provider can always take their own capital back (PRD invariant 20).
 */
contract KyrveConfidentialAssetVault is KyrveConfidentialBase {
    KyrveWrappedAsset public immutable asset;

    /// @notice The only address permitted to open and release reservations.
    /// @dev In this release it is set to a reviewed harness or left unset. The curve engine and
    ///      quote activator that will hold it are Phase 3. Unset means every reservation entry
    ///      point reverts publicly, which is the correct behaviour for a capability that does not
    ///      yet exist.
    address public immutable reserver;

    mapping(address provider => euint256) private _available;
    mapping(address provider => euint256) private _locked;

    /// @dev The encrypted size actually locked by each reservation. Zero when the provider was short.
    mapping(bytes32 reservationId => euint256) private _reservationAmount;

    /**
     * @dev THERE IS DELIBERATELY NO ENCRYPTED AGGREGATE ACCUMULATOR HERE. Read this before adding
     *      one — an earlier draft did, and the suite caught it leaking.
     *
     * A Nox handle is a pure function of the operator, the operand handles in order, the output
     * index and a seed derived from those same operands (`modules/Compute.sol::_executeOperation`
     * and `_generateHandleUniqueSeed`). Nothing else enters it. So two logically distinct encrypted
     * quantities that happen to be computed the same way from the same inputs are not merely equal
     * in value — **they are the same handle, and therefore share one ACL entry**.
     *
     * That is exactly what happened. On the first deposit into an empty vault, both the provider's
     * balance and the running total were `add(zeroHandle, received)`, so `allow(balance, provider)`
     * silently handed the provider an admin grant on the protocol's aggregate. The grant is
     * PERMANENT — there is no `removeAdmin`. In that specific case the aggregate genuinely equalled
     * the provider's own balance so nothing new was disclosed, but the mechanism does not care about
     * that: any future path where two distinct quantities coincide in value and lineage would leak
     * one to the owner of the other, permanently and silently.
     *
     * Phase 2 does not need an encrypted aggregate. Comparing claims against coverage is
     * `AggregateSolvencyVerifier` and that is Phase 3. So rather than carry a hazard for a
     * capability nothing uses yet, the accumulators are gone and coverage is read from the wrapper
     * balance instead — see {confidentialCoverage}, whose lineage runs through `Nox.transfer` at a
     * distinct output index and is therefore structurally incapable of colliding with a provider's.
     *
     * PHASE 3 REQUIREMENT: any aggregate introduced later must be proven non-colliding, not assumed
     * so. Recorded as delta Q-5.
     */

    /**
     * @dev One event shape for every outcome of an operation. A short balance and a fully covered
     *      one produce byte-identical logs. Amounts never appear.
     */
    event Deposited(address indexed provider, uint256 indexed nonce);
    event Withdrawn(address indexed provider, uint256 indexed nonce);
    event ReservationOpened(address indexed provider, bytes32 indexed reservationId);
    event ReservationReleased(address indexed provider, bytes32 indexed reservationId);

    error AssetIsZero();
    error ReserverNotConfigured();
    error NotReserver(address caller, address expected);
    error ReservationAlreadyOpen(bytes32 reservationId);
    error UnknownReservation(bytes32 reservationId);

    /// @dev Which reservations are live. Public: the existence of a reservation is public, its
    ///      size is not.
    mapping(bytes32 reservationId => address provider) public reservationProvider;

    constructor(KyrveWrappedAsset asset_, address reserver_, KyrveEmergencyController controller)
        KyrveConfidentialBase(controller)
    {
        if (address(asset_) == address(0)) revert AssetIsZero();
        asset = asset_;
        reserver = reserver_;
    }

    /**
     * @inheritdoc KyrveConfidentialBase
     * @dev The vault hands transient handles to exactly one contract: the wrapped asset it was
     *      deployed against. Transient access carries full persistent-grant power, so the
     *      allowlist is a single immutable address rather than a mutable set.
     */
    function isReviewedTransientRecipient(address recipient) public view override returns (bool) {
        return recipient == address(asset);
    }

    // ─────────────────────────────────────────────────────────────────────────────────────────
    // Entry: deposit
    // ─────────────────────────────────────────────────────────────────────────────────────────

    /**
     * @notice Moves an encrypted amount of the wrapped asset from the caller into their vault
     *         balance.
     *
     * @dev The caller must first grant this vault a short ERC-7984 operator window. That grant is
     *      all-or-nothing — ERC-7984 has no per-amount allowance — which is why
     *      {KyrveWrappedAsset} caps it at seven days and why the correct pattern is: grant, deposit,
     *      set `until = 0`. A user interface must state the blast radius before the grant is signed.
     *
     *      If the caller's wrapper balance is smaller than `encryptedAmount`, the official ERC-7984
     *      `transfer` primitive returns an encrypted zero rather than reverting, so this function
     *      credits zero and emits the same event. No public reason is produced.
     */
    function deposit(externalEuint256 encryptedAmount, bytes calldata inputProof, uint256 nonce)
        external
    {
        emergencyController.requireNotPaused(KyrveEmergencyController.Activity.VaultDeposit);
        _assertDirectCaller();
        _consumeNonce(nonce);

        // Binds owner, application contract, chain id and a 3600s expiry inside NoxCompute, and
        // grants this contract transient access to the handle.
        euint256 amount = Nox.fromExternal(encryptedAmount, inputProof);
        _consumeHandle(euint256.unwrap(amount));

        // The token performs the arithmetic, so it needs its own access to the operand. This is the
        // only transient grant the vault ever makes, and it goes to a reviewed Kyrve contract.
        _assertReviewedTransientRecipient(address(asset));
        Nox.allowTransient(amount, address(asset));

        euint256 received = asset.confidentialTransferFrom(msg.sender, address(this), amount);

        euint256 newAvailable = Nox.add(_available[msg.sender], received);
        _available[msg.sender] = newAvailable;
        _grantOwnerOnly(newAvailable, msg.sender);

        emit Deposited(msg.sender, nonce);
    }

    // ─────────────────────────────────────────────────────────────────────────────────────────
    // Recovery: withdraw. Never pausable.
    // ─────────────────────────────────────────────────────────────────────────────────────────

    /**
     * @notice Returns an encrypted amount from the caller's available balance to their wallet.
     * @dev No pause flag exists for this path and none can be added — {KyrveEmergencyController}
     *      has no enum member for it. Requesting more than is available moves encrypted zero and
     *      leaves the balance unchanged; the transaction still succeeds and says nothing.
     *
     * THE ORDERING HAZARD HERE, AND WHY IT IS SAFE. The internal balance is debited BEFORE the
     * ERC-7984 transfer, and that transfer can silently move encrypted zero if this vault's own
     * wrapper balance were short — which would burn the provider's claim while paying them nothing.
     * Nothing about the transfer's success is branchable, so the ordering cannot be defended by a
     * check; it is defended by an accounting invariant:
     *
     *     sum(available) + sum(locked)  <=  asset.confidentialBalanceOf(this)
     *
     * It holds because `deposit` credits exactly the handle the token returned — encrypted zero if
     * the provider's own balance was short — `withdraw` debits at most what is available, and
     * reservations only move value between `available` and `locked`. There is no path that creates
     * internal credit without a matching increase in the wrapper balance.
     *
     * ANY FUTURE PATH THAT CREDITS `_available` MUST PRESERVE THAT. A credit not backed by a
     * wrapper-balance increase would not fail loudly; it would make some later withdrawal silently
     * pay zero. `confidentialCoverage()` exposes the right-hand side so Phase 3's solvency verifier
     * can check it on chain rather than by argument.
     */
    function withdraw(externalEuint256 encryptedAmount, bytes calldata inputProof, uint256 nonce)
        external
    {
        _assertDirectCaller();
        _consumeNonce(nonce);

        euint256 amount = Nox.fromExternal(encryptedAmount, inputProof);
        _consumeHandle(euint256.unwrap(amount));

        euint256 balance = _available[msg.sender];
        (ebool ok, euint256 candidate) = Nox.safeSub(balance, amount);

        // `ok` is a ciphertext. It cannot be branched on; it is threaded through both selects.
        euint256 applied = Nox.select(ok, amount, Nox.toEuint256(0));
        euint256 newAvailable = Nox.select(ok, candidate, balance);

        _available[msg.sender] = newAvailable;
        _grantOwnerOnly(newAvailable, msg.sender);

        _assertReviewedTransientRecipient(address(asset));
        Nox.allowTransient(applied, address(asset));
        asset.confidentialTransfer(msg.sender, applied);

        emit Withdrawn(msg.sender, nonce);
    }

    // ─────────────────────────────────────────────────────────────────────────────────────────
    // Reservations
    // ─────────────────────────────────────────────────────────────────────────────────────────

    modifier onlyReserver() {
        if (reserver == address(0)) revert ReserverNotConfigured();
        if (msg.sender != reserver) revert NotReserver(msg.sender, reserver);
        _;
    }

    /**
     * @notice Moves an encrypted amount of a provider's available balance into locked.
     * @dev A provider with an insufficient balance locks encrypted zero. The reservation still
     *      opens and the event is identical, because the alternative — reverting — would tell an
     *      observer which provider was short.
     */
    function openReservation(
        bytes32 reservationId,
        address provider,
        externalEuint256 encryptedAmount,
        bytes calldata inputProof
    ) external onlyReserver {
        emergencyController.requireNotPaused(KyrveEmergencyController.Activity.ReservationOpening);
        if (reservationProvider[reservationId] != address(0)) {
            revert ReservationAlreadyOpen(reservationId);
        }

        euint256 amount = Nox.fromExternal(encryptedAmount, inputProof);
        _consumeHandle(euint256.unwrap(amount));

        euint256 available = _available[provider];
        (ebool ok, euint256 candidate) = Nox.safeSub(available, amount);

        euint256 applied = Nox.select(ok, amount, Nox.toEuint256(0));
        euint256 newAvailable = Nox.select(ok, candidate, available);
        euint256 newLocked = Nox.add(_locked[provider], applied);

        _available[provider] = newAvailable;
        _locked[provider] = newLocked;
        _reservationAmount[reservationId] = applied;
        reservationProvider[reservationId] = provider;

        _grantOwnerOnly(newAvailable, provider);
        _grantOwnerOnly(newLocked, provider);
        Nox.allowThis(applied);

        emit ReservationOpened(provider, reservationId);
    }

    /**
     * @notice Returns a reservation's locked amount to the provider's available balance.
     * @dev Not pausable. An expired or cancelled quote must always release capital, whatever the
     *      emergency state (PRD invariant 12 and 20).
     */
    function releaseReservation(bytes32 reservationId) external onlyReserver {
        address provider = reservationProvider[reservationId];
        if (provider == address(0)) revert UnknownReservation(reservationId);

        euint256 amount = _reservationAmount[reservationId];

        delete reservationProvider[reservationId];
        // `delete` has no meaning for an encrypted handle: it is a reference, not a value, and the
        // ciphertext it points at cannot be destroyed. Clearing the slot to the undefined handle is
        // the closest correct action — Nox resolves an undefined handle to encrypted zero.
        _reservationAmount[reservationId] = euint256.wrap(bytes32(0));

        euint256 newLocked = Nox.sub(_locked[provider], amount);
        euint256 newAvailable = Nox.add(_available[provider], amount);
        _locked[provider] = newLocked;
        _available[provider] = newAvailable;

        _grantOwnerOnly(newLocked, provider);
        _grantOwnerOnly(newAvailable, provider);

        emit ReservationReleased(provider, reservationId);
    }

    // ─────────────────────────────────────────────────────────────────────────────────────────
    // Encrypted views. Every one returns a HANDLE, never a value.
    // ─────────────────────────────────────────────────────────────────────────────────────────

    /// @notice The provider's free balance. Only the provider holds a grant to decrypt it.
    function confidentialAvailableOf(address provider) external view returns (euint256) {
        return _available[provider];
    }

    /// @notice The provider's reserved balance. Only the provider holds a grant to decrypt it.
    function confidentialLockedOf(address provider) external view returns (euint256) {
        return _locked[provider];
    }

    /**
     * @notice The wrapper balance backing every claim above.
     * @dev The coverage side of PRD invariant 1. Comparing it against
     *      `totalAvailable + totalLocked` requires an encrypted comparison whose result is
     *      published — that is `AggregateSolvencyVerifier`, and it is Phase 3. This accessor exists
     *      so the handle is addressable now and the invariant is not silently deferred.
     */
    function confidentialCoverage() external view returns (euint256) {
        return asset.confidentialBalanceOf(address(this));
    }

    /// @notice The encrypted size a reservation actually locked. Zero if the provider was short.
    function confidentialReservationAmount(bytes32 reservationId)
        external
        view
        returns (euint256)
    {
        return _reservationAmount[reservationId];
    }
}
