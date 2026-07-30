// SPDX-License-Identifier: GPL-2.0-or-later
pragma solidity 0.8.36;

import {INoxCompute} from "@iexec-nox/nox-protocol-contracts/contracts/interfaces/INoxCompute.sol";
import {Nox, ebool, euint256, externalEuint256} from "@iexec-nox/nox-protocol-contracts/contracts/sdk/Nox.sol";

import {DecryptedValue} from "./DecryptedValue.sol";
import {KyrveConfidentialBase} from "./KyrveConfidentialBase.sol";
import {KyrveEmergencyController} from "./KyrveEmergencyController.sol";
import {KyrveSeriesToken} from "./KyrveSeriesToken.sol";

/**
 * @title KyrveRollBook
 * @notice Confidential migration of a claim from one maturity to the next: encrypted roll intents
 *         meet escrowed target inventory, netting happens privately, and only the residual unwind
 *         becomes public (PRD §13.18).
 *
 * ════════════════════════════════════════════════════════════════════════════════════════════
 * A ROLL TRANSFERS. IT DOES NOT BURN AND MINT, AND THAT IS A CORRECTION
 * ════════════════════════════════════════════════════════════════════════════════════════════
 *
 * The obvious reading — burn the source claim, mint the target claim — is the same mistake delta
 * T-1 already corrected once. `KyrveSeriesToken`'s supply is the PUBLISHED AGGREGATE of capital
 * providers actually committed, and every unit of it is backed by a real settled Midnight position.
 * A roll book that could mint target claims would be minting claims backed by nothing: invariant 5
 * (allocations sum to supply) would be false by exactly the rolled amount, and
 * `AggregateSolvencyVerifier` would report the target series insolvent — correctly.
 *
 * It could not do it anyway. `mintClaim` is `onlyAllocator`, takes an `euint256` rather than a
 * number, and the allocator is bound once per series. There is no overload that mints from a
 * quantity, so this is structural rather than a policy this contract observes.
 *
 * So the internal leg is a TRANSFER of pre-existing target claims out of an escrowed inventory, and
 * **neither series' total supply changes by one unit across a netting**. That is a far stronger
 * solvency statement than a matched burn-and-mint would be, and demonstration 23 asserts it by
 * proving solvency on both series after the roll rather than by arguing it.
 *
 * ════════════════════════════════════════════════════════════════════════════════════════════
 * THE CONVERSION IS DETERMINISTIC AND PUBLIC, AND IS DERIVED RATHER THAN SUPPLIED
 * ════════════════════════════════════════════════════════════════════════════════════════════
 *
 *     conversionWad = sourceRedemptionFactorWad * WAD / TARGET_PRICE_WAD
 *
 * One source unit redeems for `sourceFactor / WAD` loan units at the source maturity; one target
 * unit costs `TARGET_PRICE_WAD / WAD` loan units now. Both numbers are public and on chain — the
 * factor is `KyrveSeriesToken.redemptionFactorWad`, itself derived on chain from two public
 * quantities (delta T-1), and the target price is an `immutable` fixed before any intent existed.
 *
 * Passing a pre-computed conversion would let a keeper supply any ratio and leave nothing on chain
 * relating it to real state. This one is reproducible by anyone from public data, which is what
 * invariant 14 asks of a factor applied to private claims: not "it was applied consistently" but
 * "it is this, derived this way, from these numbers".
 *
 * The source factor must be SET before a roll can net. Until the curator opens the source series'
 * redemption, {conversionWad} reverts `SourceRedemptionNotOpen` — there is no default, and a roll
 * priced at par by accident would silently transfer value between the two sides.
 *
 * ════════════════════════════════════════════════════════════════════════════════════════════
 * TARGET CAPACITY IS PROVEN BY ESCROW, NOT BY ASSERTION
 * ════════════════════════════════════════════════════════════════════════════════════════════
 *
 * A supplier of target inventory escrows real target claims here before any netting can reach them,
 * through the official ERC-7984 transfer primitive — so the inventory is exactly what they actually
 * held, and encrypted zero if they were short. A roll can never net against capacity that does not
 * exist, and "target capacity must be proven" needs no proof system: the claims are in this
 * contract.
 *
 * ════════════════════════════════════════════════════════════════════════════════════════════
 * MULTI-TRANSACTION, AND NO ATOMICITY IS CLAIMED
 * ════════════════════════════════════════════════════════════════════════════════════════════
 *
 * A full roll is: escrow, one or more nettings, and — for whatever internal liquidity could not
 * absorb — a publicly declared unwind. Those are separate transactions and this contract says so
 * rather than implying otherwise. What it guarantees instead:
 *
 *   RESUMABLE     {statusOf} returns the state and the next action, so an interrupted roll is
 *                 continued rather than restarted. Every step records progress the moment it lands,
 *                 which is deltas T-13 and T-14 applied to a user flow.
 *   IDEMPOTENT    {netRoll} takes the net index the caller believes it is performing and reverts
 *                 `StaleNetIndex` otherwise. A keeper retrying after a dropped receipt learns the
 *                 step already landed, for the price of a revert, and cannot double-net.
 *   RECOVERABLE   every intermediate state has an exit. {cancelIntent} and {cancelSupply} return
 *                 the whole remaining escrow to its owner, from ANY non-terminal state, before or
 *                 after expiry, and have no pause flag in {KyrveEmergencyController} — its enum has
 *                 no member for either and must never gain one (delta Q-6, PRD invariant 20).
 *
 * ════════════════════════════════════════════════════════════════════════════════════════════
 * WHAT THE PUBLIC RESIDUAL IS, AND WHERE IT STOPS
 * ════════════════════════════════════════════════════════════════════════════════════════════
 *
 * Internal netting is confidential. What it cannot absorb has to leave the confidential book,
 * because the only way to convert a source claim into target exposure without an internal
 * counterparty is to unwind the source position publicly and settle a new quote in the target
 * market — and both of those are public by construction.
 *
 * {declareResidual} publishes the intent's remaining escrow, irreversibly, and {settleResidual}
 * returns that publicly-known quantity of source claims to the holder and records the leg. **The
 * new settlement itself is the existing Phase 4 activation path**, driven externally against a
 * fresh epoch, and this contract records the handoff rather than performing it. That boundary is
 * stated here rather than left to be discovered from the absence of a function.
 */
contract KyrveRollBook is KyrveConfidentialBase {
    enum IntentState {
        None,
        Open,
        ResidualDeclared,
        Completed,
        Cancelled
    }

    enum SupplyState {
        None,
        Open,
        Cancelled
    }

    /// @dev What a caller should do next with an intent. The resume surface.
    enum NextAction {
        Nothing,
        Net,
        DeclareResidual,
        SettleResidual,
        Cancel
    }

    struct Intent {
        IntentState state;
        address holder;
        uint64 openedAt;
        uint64 expiry;
        uint32 netCount;
        /// @dev Unmatched source claims. Isolated on every write, granted to the holder only.
        euint256 escrow;
        /// @dev Published residual handle, or zero. IRREVERSIBLE once set.
        bytes32 residualHandle;
        /// @dev How much of the published residual has been unwound in public. Plaintext.
        uint256 residualUnwound;
    }

    struct Supply {
        SupplyState state;
        address supplier;
        uint64 openedAt;
        uint64 expiry;
        uint32 netCount;
        /// @dev Unmatched target claims.
        euint256 escrow;
    }

    uint256 private constant WAD = 1e18;

    bytes32 private constant ROLE_INTENT = keccak256("kyrve.roll.intent");
    bytes32 private constant ROLE_SUPPLY = keccak256("kyrve.roll.supply");
    bytes32 private constant ROLE_RESIDUAL = keccak256("kyrve.roll.residual");

    uint64 public constant MAX_ROLL_LIFETIME = 30 days;

    bytes32 public immutable SOURCE_SERIES_ID;
    bytes32 public immutable TARGET_SERIES_ID;
    bytes32 public immutable DEPLOYMENT_ID;
    KyrveSeriesToken public immutable SOURCE_TOKEN;
    KyrveSeriesToken public immutable TARGET_TOKEN;
    /// @notice What one target claim unit costs in loan units, WAD-scaled. Public, and fixed before
    ///         any intent existed so no key can reprice a roll that is already in flight.
    uint256 public immutable TARGET_PRICE_WAD;
    address public immutable KEEPER;

    uint32 public intentCount;
    uint32 public supplyCount;
    mapping(bytes32 intentId => Intent) private _intents;
    mapping(bytes32 supplyId => Supply) private _supplies;
    mapping(address owner => uint256) private _submitted;

    /// @dev No amount, ever. One shape whatever the encrypted escrow turned out to be.
    event IntentOpened(bytes32 indexed intentId, address indexed holder, uint64 expiry);
    event SupplyOpened(bytes32 indexed supplyId, address indexed supplier, uint64 expiry);
    /// @dev Emitted identically whether the netting moved everything or nothing.
    event RollNetted(bytes32 indexed intentId, bytes32 indexed supplyId, uint32 netIndex, uint256 conversionWad);
    event IntentCancelled(bytes32 indexed intentId, address indexed holder);
    event SupplyCancelled(bytes32 indexed supplyId, address indexed supplier);
    /// @notice IRREVERSIBLE. From here the residual's plaintext is public forever.
    event ResidualDeclared(bytes32 indexed intentId, bytes32 residualHandle);
    /// @dev The ONLY event here carrying an amount, and it is public by the holder's own choice.
    event ResidualUnwound(bytes32 indexed intentId, address indexed holder, uint256 amount);
    event IntentCompleted(bytes32 indexed intentId);

    error EscrowIsNotConfidential(bytes32 handle);
    error IntentNotOpen(bytes32 intentId, IntentState state);
    error LifetimeTooLong(uint64 expiry, uint64 maximum);
    error NotHolder(bytes32 intentId, address expected, address actual);
    error NotKeeper(address caller, address expected);
    error NotSupplier(bytes32 supplyId, address expected, address actual);
    error ResidualAlreadyDeclared(bytes32 intentId, bytes32 handle);
    error ResidualExceeded(bytes32 intentId, uint256 published, uint256 requested);
    error ResidualNotDeclared(bytes32 intentId);
    error RollExpired(bytes32 id, uint64 expiry, uint256 nowTimestamp);
    error SameSeries(bytes32 seriesId);
    error SourceRedemptionNotOpen();
    error StaleNetIndex(bytes32 id, uint32 expected, uint32 supplied);
    error SupplyNotOpen(bytes32 supplyId, SupplyState state);
    error UnknownIntent(bytes32 intentId);
    error UnknownSupply(bytes32 supplyId);
    error ZeroAddress(string field);
    error ZeroValue(string field);

    constructor(
        KyrveSeriesToken sourceToken,
        KyrveSeriesToken targetToken,
        uint256 targetPriceWad,
        bytes32 deploymentId,
        address keeper,
        KyrveEmergencyController controller
    ) KyrveConfidentialBase(controller) {
        if (address(sourceToken) == address(0)) revert ZeroAddress("sourceToken");
        if (address(targetToken) == address(0)) revert ZeroAddress("targetToken");
        if (targetPriceWad == 0) revert ZeroValue("targetPriceWad");
        if (deploymentId == bytes32(0)) revert ZeroValue("deploymentId");
        if (keeper == address(0)) revert ZeroAddress("keeper");

        bytes32 sourceSeries = sourceToken.SERIES_ID();
        bytes32 targetSeries = targetToken.SERIES_ID();
        // A roll between one series and itself is not a roll. It would also make the two escrows
        // the same token, and every conservation identity below trivially true.
        if (sourceSeries == targetSeries) revert SameSeries(sourceSeries);
        // Both series must redeem in the same asset, or the declared conversion relates two numbers
        // denominated in different things. Delta T-10's lesson, in the place it would bite next.
        if (sourceToken.LOAN_TOKEN() != targetToken.LOAN_TOKEN()) revert ZeroAddress("loanToken");

        SOURCE_TOKEN = sourceToken;
        TARGET_TOKEN = targetToken;
        SOURCE_SERIES_ID = sourceSeries;
        TARGET_SERIES_ID = targetSeries;
        TARGET_PRICE_WAD = targetPriceWad;
        DEPLOYMENT_ID = deploymentId;
        KEEPER = keeper;
    }

    /**
     * @notice The two tokens this book moves value through, and nothing else.
     * @dev Transient access carries FULL persistent-grant power, so this set is an immutable pair.
     */
    function isReviewedTransientRecipient(address recipient) public view override returns (bool) {
        if (recipient == address(0)) return false;
        return recipient == address(SOURCE_TOKEN) || recipient == address(TARGET_TOKEN);
    }

    modifier onlyKeeper() {
        if (msg.sender != KEEPER) revert NotKeeper(msg.sender, KEEPER);
        _;
    }

    /**
     * @notice Target claim units obtainable per source claim unit, WAD-scaled.
     * @dev Reverts rather than defaulting. A conversion that quietly fell back to par would move
     *      value between the holder and the supplier on every netting, silently and in one
     *      direction.
     */
    function conversionWad() public view returns (uint256) {
        uint256 factor = SOURCE_TOKEN.redemptionFactorWad();
        if (factor == 0) revert SourceRedemptionNotOpen();
        return (factor * WAD) / TARGET_PRICE_WAD;
    }

    // ─────────────────────────────────────────────────────────────────────────────────────────
    // Escrow — both sides, same guarantee
    // ─────────────────────────────────────────────────────────────────────────────────────────

    /**
     * @notice Opens a roll intent, escrowing the caller's source-series claim.
     * @dev The caller must first grant this book a short ERC-7984 operator window on the source
     *      token. That grant is all-or-nothing — ERC-7984 has no per-amount allowance — so the
     *      honest pattern is grant, submit, `until = 0`, and a user interface must state the blast
     *      radius before it is signed.
     *
     *      A holder intending more than they hold escrows encrypted zero and the transaction
     *      succeeds. A public revert would make this book a balance oracle for every series holder.
     */
    function submitIntent(externalEuint256 encryptedAmount, bytes calldata inputProof, uint64 expiry, uint256 nonce)
        external
        returns (bytes32 intentId)
    {
        emergencyController.requireNotPaused(KyrveEmergencyController.Activity.ReservationOpening);
        _assertDirectCaller();
        _consumeNonce(nonce);
        _requireLifetime(expiry);

        euint256 amount = Nox.fromExternal(encryptedAmount, inputProof);
        _consumeHandle(euint256.unwrap(amount));

        uint256 sequence = _submitted[msg.sender];
        intentId = intentIdFor(msg.sender, sequence);
        _submitted[msg.sender] = sequence + 1;

        _assertReviewedTransientRecipient(address(SOURCE_TOKEN));
        Nox.allowTransient(amount, address(SOURCE_TOKEN));
        euint256 received = SOURCE_TOKEN.confidentialTransferFrom(msg.sender, address(this), amount);

        Intent storage intent = _intents[intentId];
        intent.state = IntentState.Open;
        intent.holder = msg.sender;
        intent.openedAt = uint64(block.timestamp);
        intent.expiry = expiry;
        intent.escrow = _isolateFor(received, ROLE_INTENT, uint256(intentId), msg.sender);

        intentCount += 1;
        emit IntentOpened(intentId, msg.sender, expiry);
    }

    /// @notice Escrows target-series inventory a roll may net against. Same rules, same guarantee.
    function supplyTarget(externalEuint256 encryptedAmount, bytes calldata inputProof, uint64 expiry, uint256 nonce)
        external
        returns (bytes32 supplyId)
    {
        emergencyController.requireNotPaused(KyrveEmergencyController.Activity.ReservationOpening);
        _assertDirectCaller();
        _consumeNonce(nonce);
        _requireLifetime(expiry);

        euint256 amount = Nox.fromExternal(encryptedAmount, inputProof);
        _consumeHandle(euint256.unwrap(amount));

        uint256 sequence = _submitted[msg.sender];
        supplyId = supplyIdFor(msg.sender, sequence);
        _submitted[msg.sender] = sequence + 1;

        _assertReviewedTransientRecipient(address(TARGET_TOKEN));
        Nox.allowTransient(amount, address(TARGET_TOKEN));
        euint256 received = TARGET_TOKEN.confidentialTransferFrom(msg.sender, address(this), amount);

        Supply storage supply = _supplies[supplyId];
        supply.state = SupplyState.Open;
        supply.supplier = msg.sender;
        supply.openedAt = uint64(block.timestamp);
        supply.expiry = expiry;
        supply.escrow = _isolateFor(received, ROLE_SUPPLY, uint256(supplyId), msg.sender);

        supplyCount += 1;
        emit SupplyOpened(supplyId, msg.sender, expiry);
    }

    // ─────────────────────────────────────────────────────────────────────────────────────────
    // Netting — confidential, and idempotent under retry
    // ─────────────────────────────────────────────────────────────────────────────────────────

    /**
     * @notice Nets one intent against one target supply, privately.
     *
     * @param expectedNetIndex the intent's `netCount` the caller believes it is acting on. THIS IS
     *        THE IDEMPOTENCE MECHANISM AND IT IS NOT A CONVENIENCE. A keeper whose receipt was
     *        dropped cannot tell a landed transaction from a lost one, and re-sending would net a
     *        second time against escrow that is still there. Passing the index turns a retry into a
     *        cheap public revert naming both values. `QuoteEpochController` uses the same shape for
     *        the same reason.
     *
     * @dev BOTH FLOORS LEAVE THE REMAINDER WITH THE PARTY WHO SUPPLIED IT.
     *
     *          consumedSource = min(intentEscrow, floor(supplyEscrow * WAD / conversionWad))
     *          movedTarget    = floor(consumedSource * conversionWad / WAD)
     *
     *      `movedTarget <= supplyEscrow` follows from the two floors composing, so the supplier's
     *      escrow can never be over-drawn. The holder keeps unconsumed source; the supplier keeps
     *      unmatched target. Neither remainder goes anywhere else — there is no path on this
     *      contract that sweeps one.
     *
     *      Nox has no `min`, so it is arithmetised as `select(le(a, b), a, b)`. Every safe operation
     *      threads its flag: `safeMul` overflowing or `safeDiv` dividing by zero returns encrypted
     *      `false` AND encrypted zero while the transaction succeeds, and unsafe `div` saturates to
     *      the type maximum rather than reverting, which is why neither appears unguarded.
     *
     *      NEITHER SERIES' SUPPLY CHANGES. This is a transfer on both legs. That is what keeps both
     *      series solvent across a roll and is why nothing here mints.
     */
    function netRoll(bytes32 intentId, bytes32 supplyId, uint32 expectedNetIndex) external onlyKeeper {
        Intent storage intent = _requireOpenIntent(intentId);
        Supply storage supply = _requireOpenSupply(supplyId);
        if (intent.netCount != expectedNetIndex) {
            revert StaleNetIndex(intentId, intent.netCount, expectedNetIndex);
        }

        uint256 conversion = conversionWad();
        euint256 zero = Nox.toEuint256(0);

        // How much source the escrowed target inventory can absorb.
        (ebool mulOk, euint256 scaled) = Nox.safeMul(supply.escrow, Nox.toEuint256(WAD));
        (ebool divOk, euint256 absorbable) = Nox.safeDiv(scaled, Nox.toEuint256(conversion));
        absorbable = Nox.select(mulOk, absorbable, zero);
        absorbable = Nox.select(divOk, absorbable, zero);

        euint256 consumedSource = Nox.select(Nox.le(intent.escrow, absorbable), intent.escrow, absorbable);

        (ebool tMulOk, euint256 tScaled) = Nox.safeMul(consumedSource, Nox.toEuint256(conversion));
        (ebool tDivOk, euint256 movedTarget) = Nox.safeDiv(tScaled, Nox.toEuint256(WAD));
        movedTarget = Nox.select(tMulOk, movedTarget, zero);
        movedTarget = Nox.select(tDivOk, movedTarget, zero);

        (ebool intentOk, euint256 intentLeft) = Nox.safeSub(intent.escrow, consumedSource);
        (ebool supplyOk, euint256 supplyLeft) = Nox.safeSub(supply.escrow, movedTarget);
        euint256 sourceMoved = Nox.select(intentOk, consumedSource, zero);
        euint256 targetMoved = Nox.select(supplyOk, movedTarget, zero);

        intent.escrow = _isolateFor(
            Nox.select(intentOk, intentLeft, intent.escrow), ROLE_INTENT, uint256(intentId) ^ intent.netCount, intent.holder
        );
        supply.escrow = _isolateFor(
            Nox.select(supplyOk, supplyLeft, supply.escrow),
            ROLE_SUPPLY,
            uint256(supplyId) ^ supply.netCount,
            supply.supplier
        );

        // Effects complete. Only now do the tokens move.
        _assertReviewedTransientRecipient(address(SOURCE_TOKEN));
        Nox.allowTransient(sourceMoved, address(SOURCE_TOKEN));
        SOURCE_TOKEN.confidentialTransfer(supply.supplier, sourceMoved);

        _assertReviewedTransientRecipient(address(TARGET_TOKEN));
        Nox.allowTransient(targetMoved, address(TARGET_TOKEN));
        TARGET_TOKEN.confidentialTransfer(intent.holder, targetMoved);

        intent.netCount += 1;
        supply.netCount += 1;
        emit RollNetted(intentId, supplyId, intent.netCount, conversion);
    }

    // ─────────────────────────────────────────────────────────────────────────────────────────
    // Recovery — always available, never pausable
    // ─────────────────────────────────────────────────────────────────────────────────────────

    /**
     * @notice Returns an intent's whole remaining escrow to its holder and closes it.
     * @dev Available from `Open` AND from `ResidualDeclared`, before or after expiry, and with no
     *      pause flag. A roll that could reach a state its holder cannot exit would be capital held
     *      hostage to a keeper's uptime, an expiry timer, or a guardian's configuration — and PRD
     *      invariants 12 and 20 forbid all three.
     */
    function cancelIntent(bytes32 intentId) external {
        Intent storage intent = _intents[intentId];
        if (intent.state == IntentState.None) revert UnknownIntent(intentId);
        if (intent.state != IntentState.Open && intent.state != IntentState.ResidualDeclared) {
            revert IntentNotOpen(intentId, intent.state);
        }
        if (intent.holder != msg.sender) revert NotHolder(intentId, intent.holder, msg.sender);

        euint256 refund = intent.escrow;
        intent.state = IntentState.Cancelled;
        intent.escrow = Nox.toEuint256(0);

        _assertReviewedTransientRecipient(address(SOURCE_TOKEN));
        Nox.allowTransient(refund, address(SOURCE_TOKEN));
        SOURCE_TOKEN.confidentialTransfer(msg.sender, refund);

        emit IntentCancelled(intentId, msg.sender);
    }

    /// @notice Returns a supply's whole remaining inventory to its supplier. Same rules.
    function cancelSupply(bytes32 supplyId) external {
        Supply storage supply = _supplies[supplyId];
        if (supply.state == SupplyState.None) revert UnknownSupply(supplyId);
        if (supply.state != SupplyState.Open) revert SupplyNotOpen(supplyId, supply.state);
        if (supply.supplier != msg.sender) revert NotSupplier(supplyId, supply.supplier, msg.sender);

        euint256 refund = supply.escrow;
        supply.state = SupplyState.Cancelled;
        supply.escrow = Nox.toEuint256(0);

        _assertReviewedTransientRecipient(address(TARGET_TOKEN));
        Nox.allowTransient(refund, address(TARGET_TOKEN));
        TARGET_TOKEN.confidentialTransfer(msg.sender, refund);

        emit SupplyCancelled(supplyId, msg.sender);
    }

    // ─────────────────────────────────────────────────────────────────────────────────────────
    // The public residual
    // ─────────────────────────────────────────────────────────────────────────────────────────

    /**
     * @notice Publishes what internal netting could not absorb, so it can be unwound in the open.
     * @dev IRREVERSIBLE. `allowPublicDecryption` cannot be undone — Nox has no `removeViewer`, no
     *      `removeAdmin` and no un-publish — so this is callable once per intent and reverts
     *      thereafter. What it discloses is the RESIDUAL alone: the escrow was never public, so
     *      `netted = escrow - residual` is one equation in two unknowns and the netted quantity
     *      stays private.
     */
    function declareResidual(bytes32 intentId) external returns (bytes32 residualHandle) {
        Intent storage intent = _intents[intentId];
        if (intent.state == IntentState.None) revert UnknownIntent(intentId);
        if (intent.state != IntentState.Open) revert IntentNotOpen(intentId, intent.state);
        if (intent.holder != msg.sender) revert NotHolder(intentId, intent.holder, msg.sender);
        if (intent.residualHandle != bytes32(0)) {
            revert ResidualAlreadyDeclared(intentId, intent.residualHandle);
        }

        euint256 isolated = _isolateFor(intent.escrow, ROLE_RESIDUAL, uint256(intentId), msg.sender);
        intent.escrow = isolated;
        intent.residualHandle = euint256.unwrap(isolated);
        intent.state = IntentState.ResidualDeclared;

        Nox.allowPublicDecryption(isolated);

        residualHandle = intent.residualHandle;
        emit ResidualDeclared(intentId, residualHandle);
    }

    /**
     * @notice Unwinds a publicly-known quantity of the residual, returning those source claims to
     *         the holder so they can be redeemed and re-deployed in the open.
     *
     * @dev WHERE THIS STOPS, STATED RATHER THAN IMPLIED. It returns the claims and records the leg.
     *      It does NOT redeem the source position and does NOT settle a new quote in the target
     *      market: redemption is `KyrveSeriesToken.redeem` and settlement is the Phase 4 activation
     *      path against a fresh epoch, both driven externally. A roll book that pretended to do
     *      either would be claiming an atomicity it cannot have.
     *
     *      The proof is checked against the intent's OWN published handle first.
     *      `validateDecryptionProof` is a pure signature check with no ACL, no nonce and no caller
     *      binding, so a valid proof establishes nothing about which intent a value belongs to —
     *      delta R-4, and here a substituted proof would move real claims.
     */
    function settleResidual(bytes32 intentId, uint256 amount, bytes calldata decryptionProof)
        external
        returns (uint256 unwound)
    {
        Intent storage intent = _intents[intentId];
        if (intent.state == IntentState.None) revert UnknownIntent(intentId);
        if (intent.state != IntentState.ResidualDeclared) revert IntentNotOpen(intentId, intent.state);
        if (intent.holder != msg.sender) revert NotHolder(intentId, intent.holder, msg.sender);
        if (intent.residualHandle == bytes32(0)) revert ResidualNotDeclared(intentId);

        uint256 published = DecryptedValue.toUint(
            INoxCompute(Nox.noxComputeContract()).validateDecryptionProof(intent.residualHandle, decryptionProof)
        );
        uint256 already = intent.residualUnwound;
        if (amount == 0 || already + amount > published) {
            revert ResidualExceeded(intentId, published, already + amount);
        }
        intent.residualUnwound = already + amount;

        euint256 publicAmount = Nox.toEuint256(amount);
        (ebool ok, euint256 left) = Nox.safeSub(intent.escrow, publicAmount);
        euint256 moved = Nox.select(ok, publicAmount, Nox.toEuint256(0));
        intent.escrow = _isolateFor(
            Nox.select(ok, left, intent.escrow), ROLE_RESIDUAL, uint256(intentId) ^ already, intent.holder
        );

        _assertReviewedTransientRecipient(address(SOURCE_TOKEN));
        Nox.allowTransient(moved, address(SOURCE_TOKEN));
        SOURCE_TOKEN.confidentialTransfer(intent.holder, moved);

        unwound = intent.residualUnwound;
        emit ResidualUnwound(intentId, intent.holder, amount);

        if (unwound == published) {
            intent.state = IntentState.Completed;
            emit IntentCompleted(intentId);
        }
    }

    // ─────────────────────────────────────────────────────────────────────────────────────────
    // Views — the resume surface
    // ─────────────────────────────────────────────────────────────────────────────────────────

    /**
     * @notice What state an intent is in and what should happen to it next.
     * @dev THE RESUMABILITY SURFACE. A run interrupted between transactions is continued from here
     *      rather than restarted, and a caller never has to infer progress from a receipt it may
     *      never have received. Deltas T-13 and T-14: record each step the moment it lands, and skip
     *      what has already happened rather than retrying it.
     */
    function statusOf(bytes32 intentId)
        external
        view
        returns (
            IntentState state,
            address holder,
            uint32 netCount,
            bytes32 residualHandle,
            uint256 residualUnwound,
            NextAction next
        )
    {
        Intent storage intent = _intents[intentId];
        if (intent.state == IntentState.None) revert UnknownIntent(intentId);

        state = intent.state;
        holder = intent.holder;
        netCount = intent.netCount;
        residualHandle = intent.residualHandle;
        residualUnwound = intent.residualUnwound;

        if (state == IntentState.Completed || state == IntentState.Cancelled) next = NextAction.Nothing;
        else if (state == IntentState.ResidualDeclared) next = NextAction.SettleResidual;
        else if (block.timestamp > intent.expiry) next = NextAction.Cancel;
        else if (intent.netCount == 0) next = NextAction.Net;
        else next = NextAction.DeclareResidual;
    }

    function supplyStatusOf(bytes32 supplyId)
        external
        view
        returns (SupplyState state, address supplier, uint64 expiry, uint32 netCount)
    {
        Supply storage supply = _supplies[supplyId];
        if (supply.state == SupplyState.None) revert UnknownSupply(supplyId);
        return (supply.state, supply.supplier, supply.expiry, supply.netCount);
    }

    /// @notice The intent's unmatched source claim. Only its holder holds a grant to decrypt it.
    function confidentialIntentEscrow(bytes32 intentId) external view returns (euint256) {
        return _intents[intentId].escrow;
    }

    /// @notice The supply's unmatched target inventory. Only its supplier may decrypt it.
    function confidentialSupplyEscrow(bytes32 supplyId) external view returns (euint256) {
        return _supplies[supplyId].escrow;
    }

    function submittedBy(address owner) external view returns (uint256) {
        return _submitted[owner];
    }

    function intentIdFor(address holder, uint256 sequence) public view returns (bytes32) {
        return keccak256(
            abi.encode(
                "kyrve.roll.intent.v1",
                block.chainid,
                address(this),
                DEPLOYMENT_ID,
                SOURCE_SERIES_ID,
                TARGET_SERIES_ID,
                holder,
                sequence
            )
        );
    }

    function supplyIdFor(address supplier, uint256 sequence) public view returns (bytes32) {
        return keccak256(
            abi.encode(
                "kyrve.roll.supply.v1",
                block.chainid,
                address(this),
                DEPLOYMENT_ID,
                SOURCE_SERIES_ID,
                TARGET_SERIES_ID,
                supplier,
                sequence
            )
        );
    }

    /// @notice The public conversion arithmetic, for a caller that wants to reproduce it.
    function quoteRoll(uint256 sourceAmount) external view returns (uint256 targetAmount) {
        return (sourceAmount * conversionWad()) / WAD;
    }

    // ─────────────────────────────────────────────────────────────────────────────────────────
    // Internals
    // ─────────────────────────────────────────────────────────────────────────────────────────

    function _requireLifetime(uint64 expiry) private view {
        if (expiry <= block.timestamp) revert RollExpired(bytes32(0), expiry, block.timestamp);
        if (expiry - block.timestamp > MAX_ROLL_LIFETIME) {
            revert LifetimeTooLong(expiry, uint64(block.timestamp) + MAX_ROLL_LIFETIME);
        }
    }

    function _requireOpenIntent(bytes32 intentId) private view returns (Intent storage intent) {
        intent = _intents[intentId];
        if (intent.state == IntentState.None) revert UnknownIntent(intentId);
        if (intent.state != IntentState.Open) revert IntentNotOpen(intentId, intent.state);
        if (block.timestamp > intent.expiry) revert RollExpired(intentId, intent.expiry, block.timestamp);
    }

    function _requireOpenSupply(bytes32 supplyId) private view returns (Supply storage supply) {
        supply = _supplies[supplyId];
        if (supply.state == SupplyState.None) revert UnknownSupply(supplyId);
        if (supply.state != SupplyState.Open) revert SupplyNotOpen(supplyId, supply.state);
        if (block.timestamp > supply.expiry) revert RollExpired(supplyId, supply.expiry, block.timestamp);
    }

    /**
     * @dev Isolates a quantity, stores nothing, and grants it to exactly one owner.
     *
     *      NOT OPTIONAL. Two holders rolling the same size under one declared conversion compute
     *      identically from identical operands and would be ONE handle with ONE permanent ACL entry
     *      — and `Nox.allow` has no inverse. The domain carries this contract, both series, the
     *      role, the id and the net index, so no two quantities here can ever be one handle.
     *      Invariant 9, and note R-6: the obvious test for this passes with the defence removed,
     *      which is why the suite compares HANDLES.
     */
    function _isolateFor(euint256 value, bytes32 role, uint256 subIndex, address owner) private returns (euint256) {
        // A public handle bypasses every ACL gate in NoxCompute and makes the output depend on a
        // storage counter, so a published residual would stop being reproducible off chain.
        if (euint256.unwrap(value)[6] & 0x01 == 0) revert EscrowIsNotConfidential(euint256.unwrap(value));
        bytes32 domain = keccak256(
            abi.encode(block.chainid, address(this), SOURCE_SERIES_ID, TARGET_SERIES_ID, role, subIndex)
        );
        euint256 isolated = Nox.select(Nox.eq(value, value), value, Nox.toEuint256(uint256(domain)));
        _grantOwnerOnly(isolated, owner);
        return isolated;
    }
}
