// SPDX-License-Identifier: GPL-2.0-or-later
pragma solidity 0.8.36;

import {Nox, ebool, euint256, externalEuint256} from "@iexec-nox/nox-protocol-contracts/contracts/sdk/Nox.sol";

import {KyrveCurveBase} from "./KyrveCurveBase.sol";
import {KyrveEmergencyController} from "./KyrveEmergencyController.sol";
import {KyrveWrappedAsset} from "./KyrveWrappedAsset.sol";

/**
 * @title KyrveCustodyVault
 * @notice The P5-1 discharge: a reservation that moves real capital, inside one custody contract.
 *
 * Read `docs/phase5/P5-1-DECISION.md` before changing anything here. This contract is the chosen
 * option and the rejected one is recorded beside it.
 *
 * ════════════════════════════════════════════════════════════════════════════════════════════
 * WHY THIS EXISTS AND WHY IT IS A NEW DEPLOYMENT
 * ════════════════════════════════════════════════════════════════════════════════════════════
 *
 * `KyrveConfidentialAssetVault` (Phase 2) cannot lock capital, for two independent and measured
 * reasons — delta [T-3](../../docs/phase5/PRD-DELTA.md):
 *
 *   1. its `openReservation` takes `(externalEuint256, bytes inputProof)`. `Nox.fromExternal` needs
 *      a gateway proof for a value its owner knows in PLAINTEXT. A curve allocation exists only as
 *      a handle — that is the point of the engine — so no such proof can ever be minted. Delta R-1.
 *   2. its `reserver` is `immutable` and reads `0x0` on the vault deployed at
 *      `0x07e7247726270f7d409580fe2a872ea333257e45`. `onlyReserver` reverts `ReserverNotConfigured`
 *      while it is zero, so both reservation entry points are unreachable FOREVER and `_locked` is
 *      permanently encrypted zero.
 *
 * So the lock needed a new contract, and this is it. Everything else about the Phase 2 vault —
 * what it holds, how it fails, what it refuses to reveal — is preserved deliberately, because that
 * part was reviewed, deployed and correct.
 *
 * ════════════════════════════════════════════════════════════════════════════════════════════
 * THE ONE SUBTRACTION
 * ════════════════════════════════════════════════════════════════════════════════════════════
 *
 * Phase 3's `ReservationLedger` performed its own `safeSub` against a SNAPSHOT of the provider's
 * vault balance, because it had nowhere else to do it. That produced the exact defect P5-1 names:
 * `sum(reserved)` and `the capital that can actually pay` were two independent quantities that
 * happened to agree.
 *
 * They are now ONE quantity. There is exactly one `safeSub`, it is here, and it is against the
 * LIVE `_available` balance in the same contract that holds the wrapper coverage backing it. The
 * ledger keeps epoch state and delegates the arithmetic; it no longer tracks a parallel remainder,
 * because a parallel remainder is the thing that was wrong.
 *
 * ════════════════════════════════════════════════════════════════════════════════════════════
 * WHY NO PATH HERE CAN REVERT ON A SHORT BALANCE
 * ════════════════════════════════════════════════════════════════════════════════════════════
 *
 * A provider whose balance cannot cover their allocation must not be identifiable. A public revert
 * would tell an observer that *this* provider was short at *this* moment, which is exactly the
 * private fact the product exists to protect (PRD invariant 1, §6.4). So every balance-changing
 * path is the same shape, and it is the shape the Phase 2 vault already uses:
 *
 *     (ok, candidate) = safeSub(balance, amount)          // ok and candidate are CIPHERTEXTS
 *     applied         = select(ok, amount, 0)             // encrypted zero when short
 *     balance         = select(ok, candidate, balance)    // unchanged when short
 *
 * `ok` can never be branched on in Solidity. The transaction succeeds either way, writes the same
 * slots either way and emits the same event either way. Threat T-C.
 *
 * Two silent Nox failure modes this guards against, both verified against `sdk/Nox.sol` (version 0.2.4):
 *   - a failed safe op returns encrypted `false` AND an encrypted ZERO result while the transaction
 *     succeeds. An unthreaded result silently becomes a zero lock;
 *   - unsafe `div` saturates to the type maximum rather than reverting. This contract never divides.
 *
 * ════════════════════════════════════════════════════════════════════════════════════════════
 * PUBLIC / PRIVATE BOUNDARY
 * ════════════════════════════════════════════════════════════════════════════════════════════
 *
 *   PUBLIC     that a deposit, withdrawal, lock, release or consumption happened; whose lock it is;
 *              which funding round consumed it; when. And — see {unwrapQuoteFunding} — the AGGREGATE amount
 *              unwrapped to fund one quote, which was already public before this contract saw it.
 *   PRIVATE    every balance, every lock size, every provider's contribution to the aggregate, and
 *              whether any of them succeeded or silently contributed encrypted zero.
 *
 * ════════════════════════════════════════════════════════════════════════════════════════════
 * RECOVERY IS NEVER PAUSABLE
 * ════════════════════════════════════════════════════════════════════════════════════════════
 *
 * `deposit` and `lockAllocation` are entries and are pausable. `withdraw`, `releaseLock` and
 * `restoreLock` have no flag in {KyrveEmergencyController} and cannot acquire one — the enum has no
 * member for them and must never gain one (delta Q-6, PRD invariant 20). A provider can always take
 * back capital no live lock holds. Threat T-H.
 */
contract KyrveCustodyVault is KyrveCurveBase {
    // ─────────────────────────────────────────────────────────────────────────────────────────
    // Isolation domains, declared HERE rather than in {KyrveCurveBase}
    // ─────────────────────────────────────────────────────────────────────────────────────────

    /**
     * @dev These are deliberately not added to {KyrveCurveBase}. That base is inherited by
     *      `NoxCurveEngine`, whose runtime code is 464 bytes over EIP-170 at the default optimizer
     *      profile and only fits at `runs: 1` (delta R-10). Nothing that touches the engine's
     *      bytecode is worth the convenience of sharing four constants.
     */
    bytes32 private constant ROLE_CUSTODY_LOCK = keccak256("kyrve.custody.lock");
    bytes32 private constant ROLE_CUSTODY_AVAILABLE = keccak256("kyrve.custody.available");
    bytes32 private constant ROLE_CUSTODY_LOCKED = keccak256("kyrve.custody.locked");
    bytes32 private constant ROLE_CUSTODY_CONSUMED_TOTAL = keccak256("kyrve.custody.consumedTotal");

    // ─────────────────────────────────────────────────────────────────────────────────────────
    // Types
    // ─────────────────────────────────────────────────────────────────────────────────────────

    /**
     * @dev A lock's whole life. `Consumed` and `Released` are both terminal for the LOCK; only
     *      `Consumed` can be undone, and only by `restoreLock` after the quote its round funded was
     *      retired without settling. There is no state a lock can occupy twice.
     */
    enum LockState {
        None,
        Locked,
        Released,
        Consumed,
        Restored
    }

    struct Lock {
        LockState state;
        address provider;
        bytes32 epochId;
        /**
         * @dev Set when the lock is consumed. Binds the capital to exactly one FUNDING ROUND, so a
         *      restoration cannot be attributed to a round that did not draw on it.
         *
         *      It is the EPOCH id rather than a quote id, and the ordering forces that: activation
         *      calls `KyrveSeriesVault.prepareQuote`, which refuses a vault that cannot already pay,
         *      so the funding must land BEFORE a quote id exists. The quote binds later, at
         *      allocation, where `SeriesAllocator` checks the quote's own provenance names this
         *      epoch. Delta T-9.
         */
        bytes32 fundingKey;
        uint64 openedAt;
        uint64 changedAt;
    }

    /// @dev Per-funding-round state. `Funded` means the aggregate was unwrapped and the public
    ///      tokens are the series vault's problem from that point on.
    enum FundingState {
        None,
        Consumed,
        Funded,
        Restored
    }

    // ─────────────────────────────────────────────────────────────────────────────────────────
    // Wiring
    // ─────────────────────────────────────────────────────────────────────────────────────────

    KyrveWrappedAsset public immutable asset;
    address public immutable deployer;

    /**
     * @notice The only address that may lock and release. Bound once, to `ReservationLedger`.
     * @dev Bind-once rather than a constructor argument because the ledger needs this vault's
     *      address at construction, so one of the two references cannot be a constructor argument.
     *      Bind-once rather than a setter because a mutable reserver is an arbitrary-spend surface
     *      over every balance this contract holds. Threat T-B, and the same shape as
     *      `ReservationLedger.bindEngine`.
     */
    address public reserver;

    /// @notice The only address that may consume a lock into a quote, or restore one. `SeriesAllocator`.
    address public settler;

    // ─────────────────────────────────────────────────────────────────────────────────────────
    // Storage
    // ─────────────────────────────────────────────────────────────────────────────────────────

    mapping(address provider => euint256) private _available;
    mapping(address provider => euint256) private _locked;

    /// @dev The encrypted size actually locked. Encrypted zero when the provider was short.
    mapping(bytes32 lockId => euint256) private _lockAmount;
    mapping(bytes32 lockId => Lock) private _locks;

    /**
     * @dev The sum of the locks one quote consumed.
     *
     * THIS IS AN ENCRYPTED AGGREGATE AND THEREFORE THE Q-5 HAZARD, so read the isolation note in
     * {consumeLocksInto} before touching it. It exists — unlike the Phase 2 vault's removed
     * accumulator — because the funding unwrap needs exactly one handle, and it is safe only
     * because it is isolated under a quote-scoped domain before anything is granted or published.
     */
    mapping(bytes32 fundingKey => euint256) private _consumedTotal;
    mapping(bytes32 fundingKey => uint32) private _consumedCount;
    mapping(bytes32 fundingKey => FundingState) private _funding;
    /// @dev The publicly-decryptable handle `asset.unwrap` returned. Public by construction.
    mapping(bytes32 fundingKey => euint256) private _unwrapRequest;

    // ─────────────────────────────────────────────────────────────────────────────────────────
    // Events — one shape per operation, identical whatever the encrypted outcome was
    // ─────────────────────────────────────────────────────────────────────────────────────────

    event ReserverBound(address indexed reserverAddress);
    event SettlerBound(address indexed settlerAddress);
    event Deposited(address indexed provider, uint256 indexed nonce);
    event Withdrawn(address indexed provider, uint256 indexed nonce);
    event LockOpened(bytes32 indexed epochId, address indexed provider, bytes32 indexed lockId);
    event LockReleased(bytes32 indexed epochId, address indexed provider, bytes32 indexed lockId);
    event LockConsumed(bytes32 indexed fundingKey, address indexed provider, bytes32 indexed lockId);
    event LockRestored(bytes32 indexed fundingKey, address indexed provider, bytes32 indexed lockId);
    /// @notice The aggregate crossing the public boundary. `unwrapRequest` is publicly decryptable.
    event QuoteFundingUnwrapped(bytes32 indexed fundingKey, address indexed to, bytes32 unwrapRequest, uint32 lockCount);

    error AssetIsZero();
    error LockAlreadyOpen(bytes32 lockId);
    error LockNotOpen(bytes32 lockId, LockState state);
    error LockNotConsumed(bytes32 lockId, LockState state);
    error NotDeployer(address caller, address expected);
    error NotReserver(address caller, address expected);
    error NotSettler(address caller, address expected);
    error NothingConsumed(bytes32 fundingKey);
    error QuoteFundingNotConsumed(bytes32 fundingKey, FundingState state);
    error QuoteFundingNotFunded(bytes32 fundingKey, FundingState state);
    error ReserverAlreadyBound(address existing);
    error ReserverNotBound();
    error SettlerAlreadyBound(address existing);
    error SettlerNotBound();
    error WrongFundingForLock(bytes32 lockId, bytes32 expected, bytes32 actual);
    error ZeroAddress();

    constructor(KyrveWrappedAsset asset_, KyrveEmergencyController controller) KyrveCurveBase(controller) {
        if (address(asset_) == address(0)) revert AssetIsZero();
        asset = asset_;
        deployer = msg.sender;
    }

    // ─────────────────────────────────────────────────────────────────────────────────────────
    // Binding
    // ─────────────────────────────────────────────────────────────────────────────────────────

    function bindReserver(address reserverAddress) external {
        if (msg.sender != deployer) revert NotDeployer(msg.sender, deployer);
        if (reserver != address(0)) revert ReserverAlreadyBound(reserver);
        if (reserverAddress == address(0)) revert ZeroAddress();
        reserver = reserverAddress;
        emit ReserverBound(reserverAddress);
    }

    function bindSettler(address settlerAddress) external {
        if (msg.sender != deployer) revert NotDeployer(msg.sender, deployer);
        if (settler != address(0)) revert SettlerAlreadyBound(settler);
        if (settlerAddress == address(0)) revert ZeroAddress();
        settler = settlerAddress;
        emit SettlerBound(settlerAddress);
    }

    modifier onlyReserver() {
        if (reserver == address(0)) revert ReserverNotBound();
        if (msg.sender != reserver) revert NotReserver(msg.sender, reserver);
        _;
    }

    modifier onlySettler() {
        if (settler == address(0)) revert SettlerNotBound();
        if (msg.sender != settler) revert NotSettler(msg.sender, settler);
        _;
    }

    /**
     * @notice The vault's immutable transient-handle allowlist.
     * @dev Three recipients, every one fixed at deployment or bound once and never again: the
     *      wrapped asset this vault was deployed against, which performs the ERC-7984 arithmetic;
     *      the reserver, which folds a locked handle into the epoch's running aggregate; and the
     *      settler, which mints a provider's series claim from a consumed lock.
     *
     *      Transient access carries FULL persistent-grant power — the recipient can
     *      `allowPublicDecryption` the handle inside that one transaction, or `allow` a third party
     *      permanently — so this is never a mutable set and never an arbitrary address. Threat T-J.
     */
    function isReviewedTransientRecipient(address recipient) public view override returns (bool) {
        if (recipient == address(0)) return false;
        return recipient == address(asset) || recipient == reserver || recipient == settler;
    }

    // ─────────────────────────────────────────────────────────────────────────────────────────
    // Entry: deposit
    // ─────────────────────────────────────────────────────────────────────────────────────────

    /**
     * @notice Moves an encrypted amount of the wrapped asset from the caller into custody.
     * @dev Identical in shape and in hazards to `KyrveConfidentialAssetVault.deposit`. The caller
     *      must first grant this vault a short ERC-7984 operator window; that grant is
     *      all-or-nothing because ERC-7984 has NO per-amount allowance, which is why
     *      {KyrveWrappedAsset} caps it at seven days and why the correct pattern is grant, deposit,
     *      set `until = 0`. A user interface must state the blast radius before the grant is signed.
     *
     *      A caller whose wrapper balance is short is credited encrypted zero by the official
     *      ERC-7984 `transfer` primitive rather than reverting, and this function emits the same
     *      event. No public reason is produced.
     */
    function deposit(externalEuint256 encryptedAmount, bytes calldata inputProof, uint256 nonce) external {
        emergencyController.requireNotPaused(KyrveEmergencyController.Activity.VaultDeposit);
        _assertDirectCaller();
        _consumeNonce(nonce);

        euint256 amount = Nox.fromExternal(encryptedAmount, inputProof);
        _consumeHandle(euint256.unwrap(amount));

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
     *
     * @dev THE ORDERING HAZARD, AND WHY IT IS SAFE — carried verbatim from the Phase 2 vault
     *      because the reasoning is unchanged. The internal balance is debited BEFORE the ERC-7984
     *      transfer, and that transfer can silently move encrypted zero if this vault's own wrapper
     *      balance were short, burning the provider's claim while paying them nothing. Nothing about
     *      the transfer's success is branchable, so the ordering cannot be defended by a check. It is
     *      defended by an accounting invariant:
     *
     *          sum(available) + sum(locked)  <=  asset.confidentialBalanceOf(this)
     *
     *      It holds because `deposit` credits exactly the handle the token returned, `withdraw`
     *      debits at most what is available, `lockAllocation` only moves value between `available`
     *      and `locked`, and `consumeLock` plus `unwrapQuoteFunding` remove from `locked` exactly what leaves
     *      the wrapper balance. There is no path that creates internal credit without a matching
     *      increase in coverage.
     *
     *      ANY FUTURE PATH THAT CREDITS `_available` MUST PRESERVE THAT. A credit not backed by a
     *      coverage increase would not fail loudly; it would make some later withdrawal silently pay
     *      zero. {confidentialCoverage} exposes the right-hand side so `AggregateSolvencyVerifier`
     *      checks it on chain rather than by argument. Threat T-I.
     */
    function withdraw(externalEuint256 encryptedAmount, bytes calldata inputProof, uint256 nonce) external {
        _assertDirectCaller();
        _consumeNonce(nonce);

        euint256 amount = Nox.fromExternal(encryptedAmount, inputProof);
        _consumeHandle(euint256.unwrap(amount));

        euint256 balance = _available[msg.sender];
        (ebool ok, euint256 candidate) = Nox.safeSub(balance, amount);

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
    // The lock. This is P5-1.
    // ─────────────────────────────────────────────────────────────────────────────────────────

    /**
     * @notice Moves an encrypted allocation out of a provider's available balance and locks it.
     *
     * @param lockId unique per `(epochId, provider)`, derived by the caller. One-shot: the state
     *        machine admits `None -> Locked` exactly once, for this id, forever.
     * @param amount the allocation handle the sealed curve graph produced. **Handle-native** — this
     *        is the entire difference from the Phase 2 vault, and the reason it is a new deployment.
     * @param epochCondition the epoch's isolation condition, supplied by the caller so this contract
     *        and the ledger isolate under one shared, epoch-unique lineage.
     * @return lockId the derived one-shot identifier for this `(epochId, provider)` pair.
     * @return lockedHandle the isolated amount actually locked. Encrypted zero if the provider was
     *         short. The caller sums these into the public aggregate, which is why the aggregate is
     *         the sum of what was TAKEN rather than of what was asked for.
     *
     * @dev THE ONE-SHOT GUARD IS NOT OPTIONAL. Nox supplies none of it: `validateInputProof` has no
     *      nonce and no consumption marker (delta Q-2), and an on-chain operation output has no
     *      guard at all. So an allocation handle is consumed exactly once at this contract, and the
     *      `lockId` state machine refuses a second lock for the same epoch and provider. Threat T-D.
     *
     *      Both isolations are required before either grant. Handles are deterministic in their
     *      operands, so two providers whose allocation and balance coincide would otherwise share
     *      ONE handle with ONE permanent ACL entry — and there is no `removeAdmin`. Threat T-F, and
     *      note R-6: the obvious test for this passes with the defence removed.
     */
    function lockAllocation(bytes32 epochId, address provider, euint256 amount, ebool epochCondition)
        external
        onlyReserver
        returns (bytes32 lockId, euint256 lockedHandle)
    {
        emergencyController.requireNotPaused(KyrveEmergencyController.Activity.ReservationOpening);

        // Derived here rather than supplied, so a caller cannot present an id belonging to a
        // different (epoch, provider) pair and have this contract record the wrong one.
        lockId = lockIdFor(epochId, provider);
        Lock storage lock = _locks[lockId];
        if (lock.state != LockState.None) revert LockAlreadyOpen(lockId);
        _consumeHandle(euint256.unwrap(amount));

        euint256 available = _available[provider];
        (ebool ok, euint256 candidate) = Nox.safeSub(available, amount);

        // `ok` is a ciphertext and cannot be branched on. Threaded through both selects, so a short
        // balance locks encrypted zero and leaves `available` untouched.
        euint256 applied = Nox.select(ok, amount, Nox.toEuint256(0));
        euint256 newAvailable = Nox.select(ok, candidate, available);

        lockedHandle = _isolate(applied, epochCondition, isolationDomain(lockId, ROLE_CUSTODY_LOCK, 0));
        euint256 isolatedAvailable =
            _isolate(newAvailable, epochCondition, isolationDomain(lockId, ROLE_CUSTODY_AVAILABLE, 0));
        euint256 isolatedLocked = _isolate(
            Nox.add(_locked[provider], lockedHandle), epochCondition, isolationDomain(lockId, ROLE_CUSTODY_LOCKED, 0)
        );

        _available[provider] = isolatedAvailable;
        _locked[provider] = isolatedLocked;
        _lockAmount[lockId] = lockedHandle;

        lock.state = LockState.Locked;
        lock.provider = provider;
        lock.epochId = epochId;
        lock.openedAt = uint64(block.timestamp);
        lock.changedAt = uint64(block.timestamp);

        // The provider may decrypt their own three quantities. Nobody else may, and none of them
        // can equal another provider's — that is what the isolation domains above buy.
        _grantOwnerOnly(lockedHandle, provider);
        _grantOwnerOnly(isolatedAvailable, provider);
        _grantOwnerOnly(isolatedLocked, provider);
        Nox.allowThis(lockedHandle);

        // The caller needs the locked handle for exactly this transaction, to fold it into the
        // running aggregate. Transient, and only to the one reviewed contract bound as reserver.
        _assertReviewedTransientRecipient(msg.sender);
        Nox.allowTransient(lockedHandle, msg.sender);

        emit LockOpened(epochId, provider, lockId);
    }

    /**
     * @notice Returns a lock's amount to the provider's available balance, in full. Never pausable.
     *
     * @dev `add` rather than a safe op on purpose: the value restored is exactly the value this
     *      contract subtracted, so the sum cannot exceed what was there and cannot overflow.
     *
     *      No pause flag exists for this path and none can be added — {KyrveEmergencyController}'s
     *      enum has no member for it (PRD invariant 20, delta Q-6). An expired or cancelled epoch
     *      must always release capital, whatever the emergency state. Threat T-H, invariant 10.
     */
    function releaseLock(bytes32 lockId, ebool epochCondition) external onlyReserver {
        Lock storage lock = _locks[lockId];
        if (lock.state != LockState.Locked) revert LockNotOpen(lockId, lock.state);

        address provider = lock.provider;
        euint256 amount = _lockAmount[lockId];

        (euint256 isolatedAvailable, euint256 isolatedLocked) =
            _restoreBalances(lockId, provider, amount, epochCondition, 1);

        _available[provider] = isolatedAvailable;
        _locked[provider] = isolatedLocked;
        // `delete` has no meaning for an encrypted handle: it is a reference, not a value, and the
        // ciphertext behind it cannot be destroyed. Clearing the slot to the undefined handle is the
        // closest correct action — Nox resolves an undefined handle to encrypted zero.
        _lockAmount[lockId] = euint256.wrap(bytes32(0));

        lock.state = LockState.Released;
        lock.changedAt = uint64(block.timestamp);

        _grantOwnerOnly(isolatedAvailable, provider);
        _grantOwnerOnly(isolatedLocked, provider);

        emit LockReleased(lock.epochId, provider, lockId);
    }

    // ─────────────────────────────────────────────────────────────────────────────────────────
    // Consumption — locked confidential capital becomes public quote funding
    // ─────────────────────────────────────────────────────────────────────────────────────────

    /**
     * @notice Consumes one lock into a quote's funding total. Exactly once per lock, ever.
     * @dev Invariant 11. The state machine admits `Locked -> Consumed` and nothing admits
     *      `Consumed -> Consumed`, so a second call for the same `lockId` reverts publicly with
     *      `LockNotOpen` — which is a public fault (the settler asked twice) and discloses no
     *      amount.
     *
     *      THE AGGREGATE ISOLATION, AND WHY IT IS HERE. `_consumedTotal` is an encrypted aggregate
     *      accumulated beside per-provider quantities, which is precisely the mechanism of delta
     *      Q-5: on the first consumption into an empty total, `add(undefinedHandle, lock)` and the
     *      provider's own arithmetic could be the same operation over the same operands, hence ONE
     *      handle with ONE PERMANENT ACL entry. The Phase 2 vault removed its accumulator rather
     *      than carry that hazard. This one keeps it because the funding unwrap needs exactly one
     *      handle, and it is safe only because it is isolated under a quote-scoped domain before
     *      anything is granted, transferred or published.
     */
    function consumeLock(bytes32 lockId, bytes32 fundingKey) external onlySettler returns (euint256 consumed) {
        Lock storage lock = _locks[lockId];
        if (lock.state != LockState.Locked) revert LockNotOpen(lockId, lock.state);

        FundingState state = _funding[fundingKey];
        if (state != FundingState.None && state != FundingState.Consumed) {
            revert QuoteFundingNotConsumed(fundingKey, state);
        }

        address provider = lock.provider;
        euint256 amount = _lockAmount[lockId];
        consumed = amount;

        // The condition is built here rather than passed in, and that is the correct choice for this
        // path. `lockAllocation` and `releaseLock` run inside an epoch and their caller — the ledger —
        // already holds the epoch condition, so threading it costs nothing and keeps one lineage.
        // Consumption runs AFTER the epoch completed, driven by the settler, which has no epoch
        // condition and could only obtain one by widening the engine's ACL surface. Every quantity
        // isolated here is `euint256`, where the tag carries a full 256-bit domain hash — so a
        // self-condition separates nothing the domain does not already separate. See
        // `KyrveCurveBase._buildEpochCondition`, whose 16-bit caveat is the reason that base threads
        // a condition at all.
        ebool epochCondition = _selfCondition(amount);

        // The provider's locked balance falls by exactly what this contract locked, so `sub` is
        // sound and bounded: `_locked[provider] >= amount` holds by construction.
        euint256 isolatedLocked = _isolate(
            Nox.sub(_locked[provider], amount),
            epochCondition,
            isolationDomain(lockId, ROLE_CUSTODY_LOCKED, uint256(uint160(provider)) + 2)
        );
        _locked[provider] = isolatedLocked;
        _grantOwnerOnly(isolatedLocked, provider);

        uint32 count = _consumedCount[fundingKey];
        euint256 runningTotal = count == 0 ? amount : Nox.add(_consumedTotal[fundingKey], amount);
        // Isolated on EVERY fold, not only the last, because the intermediate is written to storage
        // and read back next call — an unisolated intermediate that coincided with a provider
        // quantity would be indistinguishable from it for the rest of the quote's life.
        euint256 isolatedTotal = _isolate(
            runningTotal, epochCondition, isolationDomain(fundingKey, ROLE_CUSTODY_CONSUMED_TOTAL, uint256(count))
        );
        _consumedTotal[fundingKey] = isolatedTotal;
        _consumedCount[fundingKey] = count + 1;
        Nox.allowThis(isolatedTotal);

        lock.state = LockState.Consumed;
        lock.fundingKey = fundingKey;
        lock.changedAt = uint64(block.timestamp);
        _funding[fundingKey] = FundingState.Consumed;

        // The settler mints the provider's series claim from this exact handle. It gets a TRANSIENT
        // grant, and no persistent one: what it does with the transient grant — grant the series
        // token persistent access so a later transaction can mint — is the settler's decision to
        // make and the settler's code to justify, not this contract's to pre-authorise.
        _assertReviewedTransientRecipient(msg.sender);
        Nox.allowTransient(amount, msg.sender);

        emit LockConsumed(fundingKey, provider, lockId);
    }

    /**
     * @notice Unwraps a quote's consumed total into public loan tokens for the series vault.
     *
     * @dev THE PUBLIC BOUNDARY CROSSING, AND IT IS IRREVERSIBLE. `asset.unwrap` calls
     *      `allowPublicDecryption` on the burn amount. Nox has no un-publish — no `removeViewer`, no
     *      `removeAdmin`, no way to un-set public decryption — so from this call the unwrapped
     *      amount is public forever.
     *
     *      WHAT THAT DISCLOSES, EXACTLY. The amount unwrapped is the sum of the locks this quote
     *      consumed, which is the epoch's PUBLISHED AGGREGATE — a value `publishAggregate` already
     *      made public before this contract saw it. PRD §19.2 states the identity directly: *"sum
     *      encrypted provider reservations = publicly unwrapped quote funding"*. Per-provider
     *      contributions are not disclosed and cannot be recovered from the sum.
     *
     *      WHAT IT DOES DISCLOSE THAT IS NEW, stated rather than glossed: if this vault's coverage
     *      were short, `_burn` returns encrypted zero and the published plaintext is 0. So the
     *      unwrap reveals whether the vault could cover the aggregate IN TOTAL. It never reveals
     *      which provider was short, and an aggregate coverage failure is a protocol solvency fault
     *      rather than a private fact — which is why `AggregateSolvencyVerifier` exists to make it
     *      observable before it is discovered here.
     *
     *      Unwrapping is asynchronous by construction: this call records the request and marks the
     *      handle publicly decryptable; `asset.finalizeUnwrap(requestId, proof)` moves the ERC-20
     *      once a gateway proof exists. Anyone may finalise — the recipient is fixed here and cannot
     *      be redirected — so a stalled keeper cannot strand the funding.
     */
    function unwrapQuoteFunding(bytes32 fundingKey, address to) external onlySettler returns (euint256 unwrapRequest) {
        FundingState state = _funding[fundingKey];
        if (state != FundingState.Consumed) revert QuoteFundingNotConsumed(fundingKey, state);
        if (to == address(0)) revert ZeroAddress();
        uint32 count = _consumedCount[fundingKey];
        if (count == 0) revert NothingConsumed(fundingKey);

        euint256 total = _consumedTotal[fundingKey];

        _assertReviewedTransientRecipient(address(asset));
        Nox.allowTransient(total, address(asset));

        unwrapRequest = asset.unwrap(address(this), to, total);
        _unwrapRequest[fundingKey] = unwrapRequest;
        _funding[fundingKey] = FundingState.Funded;

        emit QuoteFundingUnwrapped(fundingKey, to, euint256.unwrap(unwrapRequest), count);
    }

    /**
     * @notice Restores a consumed lock after the quote it funded was retired without settling.
     * @dev Invariant 10's post-funding half, and the honest limit is stated in delta
     *      [T-4](../../docs/phase5/PRD-DELTA.md): the public tokens must physically come back to
     *      this contract and be re-wrapped first, and this contract cannot compel that. What it can
     *      guarantee — and does — is that once coverage returns, the restoration is bounded by
     *      exactly what was consumed, is not pausable, and cannot be performed twice.
     *
     *      Not pausable, deliberately, for the same reason `releaseLock` is not.
     */
    function restoreLock(bytes32 lockId, bytes32 fundingKey) external onlySettler {
        Lock storage lock = _locks[lockId];
        if (lock.state != LockState.Consumed) revert LockNotConsumed(lockId, lock.state);
        if (lock.fundingKey != fundingKey) revert WrongFundingForLock(lockId, lock.fundingKey, fundingKey);

        FundingState state = _funding[fundingKey];
        if (state != FundingState.Funded && state != FundingState.Restored) {
            revert QuoteFundingNotFunded(fundingKey, state);
        }

        address provider = lock.provider;
        euint256 amount = _lockAmount[lockId];

        (euint256 isolatedAvailable,) = _restoreBalances(lockId, provider, amount, _selfCondition(amount), 3);

        _available[provider] = isolatedAvailable;
        _lockAmount[lockId] = euint256.wrap(bytes32(0));

        lock.state = LockState.Restored;
        lock.changedAt = uint64(block.timestamp);
        _funding[fundingKey] = FundingState.Restored;

        _grantOwnerOnly(isolatedAvailable, provider);

        emit LockRestored(fundingKey, provider, lockId);
    }

    // ─────────────────────────────────────────────────────────────────────────────────────────
    // Encrypted views. Every one returns a HANDLE, never a value.
    // ─────────────────────────────────────────────────────────────────────────────────────────

    /// @notice The provider's free balance. Only the provider holds a grant to decrypt it.
    function confidentialAvailableOf(address provider) external view returns (euint256) {
        return _available[provider];
    }

    /// @notice The provider's locked balance. Only the provider holds a grant to decrypt it.
    function confidentialLockedOf(address provider) external view returns (euint256) {
        return _locked[provider];
    }

    /**
     * @notice The wrapper balance backing every claim above.
     * @dev The coverage side of `sum(available) + sum(locked) <= coverage`, delta Q-6. Its lineage
     *      runs through `Nox.transfer` at a distinct output index and is therefore structurally
     *      incapable of colliding with a provider's balance.
     */
    function confidentialCoverage() external view returns (euint256) {
        return asset.confidentialBalanceOf(address(this));
    }

    /// @notice The encrypted size a lock actually took. Encrypted zero if the provider was short.
    function confidentialLockAmount(bytes32 lockId) external view returns (euint256) {
        return _lockAmount[lockId];
    }

    /// @notice The sum of the locks one funding round consumed. Granted to this contract only.
    function confidentialConsumedTotal(bytes32 fundingKey) external view returns (euint256) {
        return _consumedTotal[fundingKey];
    }

    /// @notice The publicly-decryptable handle whose plaintext is the round's unwrapped funding.
    function unwrapRequestOf(bytes32 fundingKey) external view returns (euint256) {
        return _unwrapRequest[fundingKey];
    }

    function lockOf(bytes32 lockId) external view returns (Lock memory) {
        return _locks[lockId];
    }

    function lockStateOf(bytes32 lockId) external view returns (LockState) {
        return _locks[lockId].state;
    }

    function fundingStateOf(bytes32 fundingKey) external view returns (FundingState) {
        return _funding[fundingKey];
    }

    function consumedCountOf(bytes32 fundingKey) external view returns (uint32) {
        return _consumedCount[fundingKey];
    }

    /// @notice The lock id for one `(epochId, provider)` pair. Deterministic and collision-free.
    function lockIdFor(bytes32 epochId, address provider) public pure returns (bytes32) {
        return keccak256(abi.encode("kyrve.custody.lockId", epochId, provider));
    }

    // ─────────────────────────────────────────────────────────────────────────────────────────
    // Internals
    // ─────────────────────────────────────────────────────────────────────────────────────────

    /**
     * @dev An isolation condition anchored on a handle this contract already holds.
     *
     *      `eq(anchor, anchor)` is encrypted `true`, and because `anchor` is confidential the handle
     *      seed is 0 and the result is reproducible off chain — which is what makes an isolated handle
     *      checkable rather than decorative. It is sufficient HERE and not in `KyrveCurveBase` because
     *      every quantity isolated on this path is `euint256`, whose tag carries the full 256-bit
     *      domain hash; the `euint16` case, where a 16-bit tag cannot separate two epochs, is exactly
     *      why that base threads a per-epoch condition instead.
     */
    function _selfCondition(euint256 anchor) private returns (ebool) {
        _requireConfidential(euint256.unwrap(anchor));
        return Nox.eq(anchor, anchor);
    }

    /**
     * @dev Restores `amount` to `available` and removes it from `locked`, isolating both.
     * @param salt distinguishes the release path from the restore path, so the two can never
     *        produce the same domain for the same lock and therefore never the same handle.
     */
    function _restoreBalances(
        bytes32 lockId,
        address provider,
        euint256 amount,
        ebool epochCondition,
        uint256 salt
    ) private returns (euint256 isolatedAvailable, euint256 isolatedLocked) {
        isolatedAvailable = _isolate(
            Nox.add(_available[provider], amount),
            epochCondition,
            isolationDomain(lockId, ROLE_CUSTODY_AVAILABLE, uint256(uint160(provider)) + salt)
        );
        isolatedLocked = _isolate(
            Nox.sub(_locked[provider], amount),
            epochCondition,
            isolationDomain(lockId, ROLE_CUSTODY_LOCKED, uint256(uint160(provider)) + salt)
        );
    }
}
