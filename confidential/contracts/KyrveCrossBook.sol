// SPDX-License-Identifier: GPL-2.0-or-later
pragma solidity 0.8.36;

import {INoxCompute} from "@iexec-nox/nox-protocol-contracts/contracts/interfaces/INoxCompute.sol";
import {Nox, ebool, euint256, externalEuint256} from "@iexec-nox/nox-protocol-contracts/contracts/sdk/Nox.sol";

import {DecryptedValue} from "./DecryptedValue.sol";
import {KyrveConfidentialBase} from "./KyrveConfidentialBase.sol";
import {KyrveEmergencyController} from "./KyrveEmergencyController.sol";
import {KyrveSeriesToken} from "./KyrveSeriesToken.sol";
import {KyrveWrappedAsset} from "./KyrveWrappedAsset.sol";
import {IPublicLoanToken} from "./interfaces/ISettlementLayer.sol";

/**
 * @title KyrveCrossBook
 * @notice Confidential secondary transfer of existing series claims: encrypted exit orders meet
 *         encrypted entry orders, and only what private netting cannot absorb becomes public.
 *
 * ════════════════════════════════════════════════════════════════════════════════════════════
 * ONE SERIES, ONE DECLARED PRICE BUCKET — AND THAT IS THE DESIGN, NOT A SHORTCUT
 * ════════════════════════════════════════════════════════════════════════════════════════════
 *
 * `PRICE_WAD` is a PUBLIC immutable fixed at deployment. A book with an encrypted price would need
 * an encrypted comparison per order pair to establish crossing, and Nox has no `min`, no `max` and
 * no encrypted boolean composition — every predicate has to be arithmetised through `select` at one
 * external call per operation (`.claude/rules/nox.md`). A single declared bucket removes the
 * crossing question entirely: every order at this book is at this price, and the only private
 * quantity is HOW MUCH.
 *
 * That is also the honest scope. Generalising to a curve of buckets is a matching problem, not a
 * confidentiality problem, and shipping it half-done would mean a book whose matching order
 * leaks the shape of the demand it matched.
 *
 * ════════════════════════════════════════════════════════════════════════════════════════════
 * WHAT IS PUBLIC HERE, STATED RATHER THAN LEFT TO BE DISCOVERED
 * ════════════════════════════════════════════════════════════════════════════════════════════
 *
 *   PUBLIC   that an address opened an order; which SIDE it is on; when it expires; how many times
 *            it has matched; and the one declared price.
 *   PRIVATE  every quantity. What was escrowed, what matched, what remains, and what any
 *            counterparty received. None of them appears in calldata, storage or an event.
 *
 * The side cannot be hidden and it would be dishonest to imply otherwise: an exit escrows series
 * claims and an entry escrows the wrapped loan token, so the ERC-7984 transfer that funds the order
 * discloses the direction to anyone watching the two tokens. What it does not disclose is size.
 *
 * There is **no public order book** in the sense that matters: no quantity is readable, no depth is
 * derivable, and a failed or unfilled order produces no public reason. A match that fills nothing
 * emits exactly the same event as one that fills everything.
 *
 * ════════════════════════════════════════════════════════════════════════════════════════════
 * THE TWO STRUCTURAL GUARANTEES
 * ════════════════════════════════════════════════════════════════════════════════════════════
 *
 * **A seller cannot offer more than they hold.** Not checked — impossible. Submitting an exit order
 * MOVES the claim into this contract through the official ERC-7984 `transfer` primitive, which
 * credits exactly what the seller actually had and encrypted zero if they were short. The escrow is
 * the handle the token returned, so an order is backed by construction and an over-offer is an
 * order for nothing rather than a rejected transaction. No public reason is produced either way.
 *
 * **A buyer's funding is locked before matching.** Identically, and for the same reason: an entry
 * order escrows the wrapped loan token up front. There is no path here that matches against a
 * promise.
 *
 * ════════════════════════════════════════════════════════════════════════════════════════════
 * CONSERVATION, AND THE DUST POLICY THAT MAKES IT EXACT
 * ════════════════════════════════════════════════════════════════════════════════════════════
 *
 *     series debited from sellers  =  series credited to buyers  +  series sold in public residuals
 *     assets debited from buyers   =  assets credited to sellers  +  declared fees
 *
 * Both hold exactly, and the rounding is what makes them exact rather than approximate:
 *
 *   matched       = min(sellerQty, floor(buyerAssets * WAD / PRICE_WAD))
 *   matchedAssets = floor(matched * PRICE_WAD / WAD)
 *   fee           = floor(matchedAssets * FEE_BPS / 10_000)
 *
 * Every division rounds DOWN, in the direction that leaves the remainder with the party who
 * supplied it. `matchedAssets <= buyerAssets` follows from the two floors composing, so the
 * buyer's escrow can never be over-drawn, and the sub-unit difference stays in the buyer's escrow
 * where cancellation returns it. **Dust is never swept anywhere.** There is no path on this contract
 * that moves a remainder to the protocol, and the fee — the only value that leaves the two
 * counterparties — goes to an `immutable` beneficiary chosen before any order existed.
 *
 * ════════════════════════════════════════════════════════════════════════════════════════════
 * THE PUBLIC RESIDUAL IS A DELIBERATE, IRREVERSIBLE DISCLOSURE BY THE ORDER'S OWNER
 * ════════════════════════════════════════════════════════════════════════════════════════════
 *
 * When private netting cannot absorb an order, its owner may choose to settle the remainder in the
 * open. That requires the remainder to be a public number, and there is exactly one honest way to
 * produce one: the owner publishes their own residual handle, the gateway decrypts it, and the
 * proof is validated on chain against the handle this book recorded.
 *
 * `allowPublicDecryption` is PERMANENT — Nox has no un-publish. So {publishResidual} is callable
 * once per order, by the owner only, and what it discloses is the RESIDUAL alone. The matched
 * quantity stays private, because the original escrow was never public and
 * `matched = escrow - residual` is one equation in two unknowns.
 *
 * `validateDecryptionProof` is a pure signature check with no ACL, no nonce and no caller binding,
 * so a valid proof proves nothing about which order a value belongs to (delta R-4). The handle is
 * therefore bound INTO the order and compared before the proof is looked at.
 *
 * ════════════════════════════════════════════════════════════════════════════════════════════
 * WHAT CANNOT BE PAUSED
 * ════════════════════════════════════════════════════════════════════════════════════════════
 *
 * {submitExit} and {submitEntry} are entries and are gated on `Activity.ReservationOpening`.
 * {cancel}, {publishResidual} and {settleResidualPublicly} are RECOVERY and have no flag in
 * {KyrveEmergencyController} — its enum has no member for any of them and must never gain one
 * (delta Q-6, PRD invariant 20). A holder whose claim is escrowed here can always get it back,
 * whatever the emergency state, and without the keeper's cooperation.
 */
contract KyrveCrossBook is KyrveConfidentialBase {
    enum Side {
        Exit,
        Entry
    }

    enum OrderState {
        None,
        Open,
        Cancelled,
        Settled
    }

    struct Order {
        OrderState state;
        Side side;
        address owner;
        uint64 openedAt;
        uint64 expiry;
        uint32 matchCount;
        /// @dev The unmatched remainder. Isolated on every write, granted to the owner and nobody else.
        euint256 escrow;
        /// @dev The published residual handle, or zero. IRREVERSIBLE once set.
        bytes32 residualHandle;
        /// @dev How much of the published residual has already been settled in public. Plaintext.
        uint256 residualSettled;
    }

    uint256 private constant WAD = 1e18;
    uint256 private constant BPS = 10_000;

    /// @dev Isolation domains. Declared here rather than shared — see {KyrveSeriesToken}.
    bytes32 private constant ROLE_ESCROW = keccak256("kyrve.cross.escrow");
    bytes32 private constant ROLE_RESIDUAL = keccak256("kyrve.cross.residual");

    /// @notice The longest an order may sit open. Escrowed capital with no deadline is capital
    ///         nobody is accountable for; the owner can still cancel at any moment before it.
    uint64 public constant MAX_ORDER_LIFETIME = 30 days;
    /// @notice The most this book will ever take. A cap, checked at construction, so a deployment
    ///         cannot quietly ship a book that keeps a fifth of every trade.
    uint16 public constant MAX_FEE_BPS = 100;

    bytes32 public immutable SERIES_ID;
    bytes32 public immutable DEPLOYMENT_ID;
    KyrveSeriesToken public immutable TOKEN;
    KyrveWrappedAsset public immutable ASSET;
    address public immutable LOAN_TOKEN;
    /// @notice The one declared price, in loan-token units per claim unit, WAD-scaled. Public.
    uint256 public immutable PRICE_WAD;
    uint16 public immutable FEE_BPS;
    /// @notice Where the declared fee goes. `immutable`, so no key can redirect it — the same
    ///         reasoning as {SeriesResidueAccount}'s beneficiary, and for the same PRD §19.8 reason.
    address public immutable FEE_BENEFICIARY;
    /// @notice The only address that may match two orders. It chooses WHICH pair and nothing else.
    address public immutable KEEPER;

    uint32 public orderCount;
    mapping(bytes32 orderId => Order) private _orders;
    mapping(address owner => uint256) private _submitted;

    /// @dev No amount, ever. One shape whatever the encrypted escrow turned out to be.
    event OrderOpened(bytes32 indexed orderId, address indexed owner, Side indexed side, uint64 expiry);
    event OrderCancelled(bytes32 indexed orderId, address indexed owner);
    /// @dev Emitted identically whether the match filled everything or nothing.
    event OrdersMatched(bytes32 indexed exitId, bytes32 indexed entryId, address indexed by, uint32 matchIndex);
    /// @notice IRREVERSIBLE. From here the residual's plaintext is public forever.
    event ResidualPublished(bytes32 indexed orderId, bytes32 residualHandle);
    /// @dev The ONLY event on this contract carrying an amount, and it is public by the owner's
    ///      explicit choice.
    event ResidualSettled(bytes32 indexed orderId, address indexed counterparty, uint256 amount, uint256 proceeds);

    error EscrowIsNotConfidential(bytes32 handle);
    error FeeAboveCap(uint16 supplied, uint16 cap);
    error LifetimeTooLong(uint64 expiry, uint64 maximum);
    error NotKeeper(address caller, address expected);
    error NotOrderOwner(bytes32 orderId, address expected, address actual);
    error OrderExpired(bytes32 orderId, uint64 expiry, uint256 nowTimestamp);
    error OrderNotOpen(bytes32 orderId, OrderState state);
    error ResidualAlreadyPublished(bytes32 orderId, bytes32 handle);
    error ResidualExceeded(bytes32 orderId, uint256 published, uint256 requested);
    error ResidualNotPublished(bytes32 orderId);
    error UnknownOrder(bytes32 orderId);
    error WrongHandleForResidual(bytes32 orderId, bytes32 expected, bytes32 actual);
    error WrongSideForMatch(bytes32 orderId, Side expected, Side actual);
    error ZeroAddress(string field);
    error ZeroValue(string field);

    constructor(
        bytes32 seriesId,
        bytes32 deploymentId,
        KyrveSeriesToken token,
        KyrveWrappedAsset asset,
        uint256 priceWad,
        uint16 feeBps,
        address feeBeneficiary,
        address keeper,
        KyrveEmergencyController controller
    ) KyrveConfidentialBase(controller) {
        if (seriesId == bytes32(0)) revert ZeroValue("seriesId");
        if (deploymentId == bytes32(0)) revert ZeroValue("deploymentId");
        if (address(token) == address(0)) revert ZeroAddress("token");
        if (address(asset) == address(0)) revert ZeroAddress("asset");
        if (priceWad == 0) revert ZeroValue("priceWad");
        if (feeBps > MAX_FEE_BPS) revert FeeAboveCap(feeBps, MAX_FEE_BPS);
        if (feeBeneficiary == address(0)) revert ZeroAddress("feeBeneficiary");
        if (keeper == address(0)) revert ZeroAddress("keeper");
        if (token.SERIES_ID() != seriesId) revert ZeroValue("token.SERIES_ID");
        // The book pays sellers in the SAME asset the series settles in. Delta T-10 is the reason
        // this is checked rather than assumed: three phases tolerated two test tokens because
        // nothing crossed back, and the moment one did, a whole sequence reverted on a shortfall
        // whose message named a number and not a cause.
        if (asset.underlying() != token.LOAN_TOKEN()) revert ZeroAddress("asset.underlying");

        SERIES_ID = seriesId;
        DEPLOYMENT_ID = deploymentId;
        TOKEN = token;
        ASSET = asset;
        LOAN_TOKEN = token.LOAN_TOKEN();
        PRICE_WAD = priceWad;
        FEE_BPS = feeBps;
        FEE_BENEFICIARY = feeBeneficiary;
        KEEPER = keeper;
    }

    /**
     * @notice The two tokens this book moves value through, and nothing else.
     * @dev Transient access carries FULL persistent-grant power, so this set is an immutable pair
     *      fixed at deployment rather than anything a caller can influence. Threat T-J.
     */
    function isReviewedTransientRecipient(address recipient) public view override returns (bool) {
        if (recipient == address(0)) return false;
        return recipient == address(TOKEN) || recipient == address(ASSET);
    }

    modifier onlyKeeper() {
        if (msg.sender != KEEPER) revert NotKeeper(msg.sender, KEEPER);
        _;
    }

    // ─────────────────────────────────────────────────────────────────────────────────────────
    // Submission — the escrow IS the guarantee
    // ─────────────────────────────────────────────────────────────────────────────────────────

    /**
     * @notice Opens an exit order, escrowing the caller's series claim.
     * @dev The caller must first grant this book a short ERC-7984 operator window on
     *      {KyrveSeriesToken}. That grant is all-or-nothing — ERC-7984 has no per-amount allowance —
     *      which is why the token caps it at seven days and why the correct pattern is grant,
     *      submit, set `until = 0`. A user interface must state the blast radius before the grant
     *      is signed.
     *
     *      A caller offering more than they hold escrows encrypted zero. The transaction succeeds,
     *      writes the same slots and emits the same event, because a public revert here would make
     *      this book a balance oracle for every series holder.
     */
    function submitExit(externalEuint256 encryptedAmount, bytes calldata inputProof, uint64 expiry, uint256 nonce)
        external
        returns (bytes32 orderId)
    {
        return _submit(Side.Exit, encryptedAmount, inputProof, expiry, nonce);
    }

    /// @notice Opens an entry order, escrowing the caller's wrapped loan token. Same rules.
    function submitEntry(externalEuint256 encryptedAmount, bytes calldata inputProof, uint64 expiry, uint256 nonce)
        external
        returns (bytes32 orderId)
    {
        return _submit(Side.Entry, encryptedAmount, inputProof, expiry, nonce);
    }

    function _submit(
        Side side,
        externalEuint256 encryptedAmount,
        bytes calldata inputProof,
        uint64 expiry,
        uint256 nonce
    ) private returns (bytes32 orderId) {
        emergencyController.requireNotPaused(KyrveEmergencyController.Activity.ReservationOpening);
        _assertDirectCaller();
        _consumeNonce(nonce);

        if (expiry <= block.timestamp) revert OrderExpired(bytes32(0), expiry, block.timestamp);
        if (expiry - block.timestamp > MAX_ORDER_LIFETIME) {
            revert LifetimeTooLong(expiry, uint64(block.timestamp) + MAX_ORDER_LIFETIME);
        }

        euint256 amount = Nox.fromExternal(encryptedAmount, inputProof);
        // Nox supplies no consumption marker of its own — `validateInputProof` has no nonce and no
        // spent flag, so a proof stays replayable by its owner until it expires. Delta Q-2.
        _consumeHandle(euint256.unwrap(amount));

        uint256 sequence = _submitted[msg.sender];
        orderId = orderIdFor(msg.sender, side, sequence);
        _submitted[msg.sender] = sequence + 1;

        address tokenAddress = side == Side.Exit ? address(TOKEN) : address(ASSET);
        _assertReviewedTransientRecipient(tokenAddress);
        Nox.allowTransient(amount, tokenAddress);

        // THE ESCROW IS WHAT THE TOKEN ACTUALLY MOVED, never what the caller asked for.
        euint256 received = side == Side.Exit
            ? TOKEN.confidentialTransferFrom(msg.sender, address(this), amount)
            : ASSET.confidentialTransferFrom(msg.sender, address(this), amount);

        Order storage order = _orders[orderId];
        order.state = OrderState.Open;
        order.side = side;
        order.owner = msg.sender;
        order.openedAt = uint64(block.timestamp);
        order.expiry = expiry;
        _writeEscrow(order, orderId, received);

        orderCount += 1;
        emit OrderOpened(orderId, msg.sender, side, expiry);
    }

    // ─────────────────────────────────────────────────────────────────────────────────────────
    // Matching — the whole of it is private
    // ─────────────────────────────────────────────────────────────────────────────────────────

    /**
     * @notice Nets one exit against one entry, privately.
     *
     * @dev KEEPER ONLY, and the bound on that authority is the point: the keeper chooses WHICH pair
     *      to net and cannot influence how much nets. The quantity is computed here from two
     *      escrowed handles and one public price, and there is no parameter a keeper could bias.
     *      A keeper that never ran would stall the book and strand nothing — {cancel} is the
     *      owner's, permissionless in the sense that matters, and never pausable.
     *
     *      PARTIAL EXECUTION IS THE NORMAL CASE AND IS EXPLICIT. `matched` is the minimum of what
     *      the seller escrowed and what the buyer's escrow can pay for. Whichever side is larger
     *      keeps its remainder escrowed, stays `Open`, and may match again or cancel. An order is
     *      never closed by a partial fill and `matchCount` records how many times it filled.
     *
     *      Nox has no `min`. It is arithmetised as `select(le(a, b), a, b)` — one comparison and one
     *      selection, both external calls, because every primitive is (`.claude/rules/nox.md`).
     *
     *      EVERY SAFE OPERATION'S FLAG IS THREADED. `safeMul` overflowing or `safeDiv` dividing by
     *      zero returns encrypted `false` AND encrypted zero while the transaction succeeds, so a
     *      silent failure must never be allowed to become a transfer of an implausible amount.
     *      Unsafe `div` is not used anywhere here: it saturates to the type maximum rather than
     *      reverting, which would be catastrophic in this position.
     */
    function matchOrders(bytes32 exitId, bytes32 entryId) external onlyKeeper {
        Order storage exit = _requireOpen(exitId);
        Order storage entry = _requireOpen(entryId);
        if (exit.side != Side.Exit) revert WrongSideForMatch(exitId, Side.Exit, exit.side);
        if (entry.side != Side.Entry) revert WrongSideForMatch(entryId, Side.Entry, entry.side);

        euint256 zero = Nox.toEuint256(0);

        // What the buyer's escrow can pay for, at the one declared price.
        (ebool mulOk, euint256 scaled) = Nox.safeMul(entry.escrow, Nox.toEuint256(WAD));
        (ebool divOk, euint256 capacity) = Nox.safeDiv(scaled, Nox.toEuint256(PRICE_WAD));
        capacity = Nox.select(mulOk, capacity, zero);
        capacity = Nox.select(divOk, capacity, zero);

        // min(sellerQty, capacity).
        euint256 matched = Nox.select(Nox.le(exit.escrow, capacity), exit.escrow, capacity);

        // What that quantity costs, rounded DOWN so the buyer's escrow can never be over-drawn.
        (ebool costMulOk, euint256 costScaled) = Nox.safeMul(matched, Nox.toEuint256(PRICE_WAD));
        (ebool costDivOk, euint256 cost) = Nox.safeDiv(costScaled, Nox.toEuint256(WAD));
        cost = Nox.select(costMulOk, cost, zero);
        cost = Nox.select(costDivOk, cost, zero);

        // The declared fee, rounded DOWN, so the seller is never short-changed by rounding.
        euint256 fee = zero;
        if (FEE_BPS != 0) {
            (ebool feeMulOk, euint256 feeScaled) = Nox.safeMul(cost, Nox.toEuint256(uint256(FEE_BPS)));
            (ebool feeDivOk, euint256 feeAmount) = Nox.safeDiv(feeScaled, Nox.toEuint256(BPS));
            fee = Nox.select(feeMulOk, feeAmount, zero);
            fee = Nox.select(feeDivOk, fee, zero);
        }
        (ebool netOk, euint256 net) = Nox.safeSub(cost, fee);
        net = Nox.select(netOk, net, zero);

        // Debit both escrows by exactly what is about to move. Both subtractions cannot underflow —
        // `matched <= exit.escrow` and `cost <= entry.escrow` follow from the two floors composing —
        // and both flags are threaded anyway, because a proof by construction that is not also
        // enforced is a proof that stops holding the day the construction changes.
        (ebool exitOk, euint256 exitLeft) = Nox.safeSub(exit.escrow, matched);
        (ebool entryOk, euint256 entryLeft) = Nox.safeSub(entry.escrow, cost);
        euint256 movedSeries = Nox.select(exitOk, matched, zero);
        euint256 movedAssets = Nox.select(entryOk, cost, zero);
        _writeEscrow(exit, exitId, Nox.select(exitOk, exitLeft, exit.escrow));
        _writeEscrow(entry, entryId, Nox.select(entryOk, entryLeft, entry.escrow));

        euint256 sellerProceeds = Nox.select(entryOk, net, zero);
        euint256 feeMoved = Nox.select(entryOk, fee, zero);

        // Effects are complete. Only now do the tokens move.
        _assertReviewedTransientRecipient(address(TOKEN));
        Nox.allowTransient(movedSeries, address(TOKEN));
        TOKEN.confidentialTransfer(entry.owner, movedSeries);

        _assertReviewedTransientRecipient(address(ASSET));
        Nox.allowTransient(sellerProceeds, address(ASSET));
        ASSET.confidentialTransfer(exit.owner, sellerProceeds);

        if (FEE_BPS != 0) {
            Nox.allowTransient(feeMoved, address(ASSET));
            ASSET.confidentialTransfer(FEE_BENEFICIARY, feeMoved);
        }
        // `movedAssets` is the buyer's debit and equals `sellerProceeds + feeMoved` by construction.
        // It is kept addressable so the conservation identity has a handle on both sides.
        Nox.allowThis(movedAssets);

        exit.matchCount += 1;
        entry.matchCount += 1;
        emit OrdersMatched(exitId, entryId, msg.sender, exit.matchCount);
    }

    // ─────────────────────────────────────────────────────────────────────────────────────────
    // Recovery — the owner's, and never pausable
    // ─────────────────────────────────────────────────────────────────────────────────────────

    /**
     * @notice Cancels an order and returns its whole remaining escrow to its owner.
     * @dev NO PAUSE FLAG EXISTS FOR THIS PATH AND NONE CAN BE ADDED. `KyrveEmergencyController`'s
     *      enum has no member for cancellation and must never gain one (delta Q-6, PRD invariant
     *      20). Escrowed capital that only a keeper or a guardian could release would be capital
     *      held hostage to their uptime.
     *
     *      Callable after expiry as well as before. An expired order cannot MATCH — {_requireOpen}
     *      refuses it — but it must always be recoverable, and an order that could expire into a
     *      state its owner cannot exit would be the same hostage situation with a timer.
     */
    function cancel(bytes32 orderId) external {
        Order storage order = _orders[orderId];
        if (order.state == OrderState.None) revert UnknownOrder(orderId);
        if (order.state != OrderState.Open) revert OrderNotOpen(orderId, order.state);
        if (order.owner != msg.sender) revert NotOrderOwner(orderId, order.owner, msg.sender);

        euint256 refund = order.escrow;
        order.state = OrderState.Cancelled;
        order.escrow = Nox.toEuint256(0);

        address tokenAddress = order.side == Side.Exit ? address(TOKEN) : address(ASSET);
        _assertReviewedTransientRecipient(tokenAddress);
        Nox.allowTransient(refund, tokenAddress);
        if (order.side == Side.Exit) TOKEN.confidentialTransfer(msg.sender, refund);
        else ASSET.confidentialTransfer(msg.sender, refund);

        emit OrderCancelled(orderId, msg.sender);
    }

    // ─────────────────────────────────────────────────────────────────────────────────────────
    // The public residual — an explicit, irreversible choice by the order's owner
    // ─────────────────────────────────────────────────────────────────────────────────────────

    /**
     * @notice Marks this order's remaining escrow publicly decryptable, once, so it can be settled
     *         in the open.
     *
     * @dev IRREVERSIBLE, AND SAID AT THE POINT OF ACTION. `allowPublicDecryption` cannot be undone —
     *      Nox has no `removeViewer`, no `removeAdmin` and no un-publish. Callable once per order
     *      and reverts thereafter, so a second publication cannot silently pin a later remainder
     *      that a counterparty believed was the first.
     *
     *      WHAT IT DISCLOSES, EXACTLY. The residual, and only the residual. The escrow was never
     *      public and `matched = escrow - residual` is one equation in two unknowns, so the matched
     *      quantity stays private. The residual is isolated under an order-scoped domain first,
     *      because a published handle is the one place where "structurally distinct" is not enough
     *      to rely on silently: two orders that happened to hold the same remainder would otherwise
     *      be ONE handle, and publishing one would publish the other.
     */
    function publishResidual(bytes32 orderId) external returns (bytes32 residualHandle) {
        Order storage order = _orders[orderId];
        if (order.state == OrderState.None) revert UnknownOrder(orderId);
        if (order.state != OrderState.Open) revert OrderNotOpen(orderId, order.state);
        if (order.owner != msg.sender) revert NotOrderOwner(orderId, order.owner, msg.sender);
        if (order.residualHandle != bytes32(0)) {
            revert ResidualAlreadyPublished(orderId, order.residualHandle);
        }

        euint256 isolated = _isolate(order.escrow, ROLE_RESIDUAL, uint256(orderId));
        order.escrow = isolated;
        order.residualHandle = euint256.unwrap(isolated);

        Nox.allowThis(isolated);
        Nox.allow(isolated, msg.sender);
        Nox.allowPublicDecryption(isolated);

        residualHandle = order.residualHandle;
        emit ResidualPublished(orderId, residualHandle);
    }

    /**
     * @notice Settles part or all of a published residual in the open, against a public counterparty.
     *
     * @param amount the PUBLIC quantity being settled. Bounded by the published residual, which the
     *        gateway proof establishes.
     * @param counterparty pays public loan tokens and receives the claim. Must have approved this
     *        book for `proceeds`.
     *
     * @dev WHY THE PROOF IS CHECKED AGAINST THE ORDER'S OWN HANDLE FIRST. `validateDecryptionProof`
     *      is a pure EIP-712 signature check — no ACL, no nonce, no expiry, no caller binding — so a
     *      valid proof establishes only "the gateway attests handle H decrypts to V" and is
     *      replayable by anyone forever. Delta R-4 established this for quote results and it is
     *      identical here: without the binding, a proof for ANY publicly decryptable handle of the
     *      right magnitude would authorise a settlement against this order.
     *
     *      THE PUBLIC LEG IS PUBLIC ON BOTH SIDES. Public series claims out, public loan tokens in,
     *      both at the one declared price, both readable in the event. That is the entire reason it
     *      is called a public residual, and a version that moved the wrapped asset instead would be
     *      confidential machinery over an amount everybody already knows.
     */
    function settleResidualPublicly(bytes32 orderId, uint256 amount, bytes calldata decryptionProof, address counterparty)
        external
        returns (uint256 proceeds)
    {
        Order storage order = _orders[orderId];
        if (order.state == OrderState.None) revert UnknownOrder(orderId);
        if (order.state != OrderState.Open) revert OrderNotOpen(orderId, order.state);
        if (order.owner != msg.sender) revert NotOrderOwner(orderId, order.owner, msg.sender);
        if (order.side != Side.Exit) revert WrongSideForMatch(orderId, Side.Exit, order.side);
        if (order.residualHandle == bytes32(0)) revert ResidualNotPublished(orderId);
        if (counterparty == address(0)) revert ZeroAddress("counterparty");

        // Bind first, then verify. An unbound handle must be refused before its proof is looked at,
        // so a caller can never learn whether an arbitrary proof would have verified.
        bytes32 handle = order.residualHandle;
        uint256 published = DecryptedValue.toUint(
            INoxCompute(Nox.noxComputeContract()).validateDecryptionProof(handle, decryptionProof)
        );

        uint256 alreadySettled = order.residualSettled;
        if (amount == 0 || alreadySettled + amount > published) {
            revert ResidualExceeded(orderId, published, alreadySettled + amount);
        }
        order.residualSettled = alreadySettled + amount;

        // The same rounding as a private match, so a residual leg and a netted leg price identically.
        proceeds = (amount * PRICE_WAD) / WAD;
        uint256 fee = (proceeds * uint256(FEE_BPS)) / BPS;
        uint256 net = proceeds - fee;

        euint256 publicAmount = Nox.toEuint256(amount);
        (ebool ok, euint256 left) = Nox.safeSub(order.escrow, publicAmount);
        // The subtraction cannot fail: `amount` is bounded by the proven residual, which IS this
        // escrow. The flag is threaded regardless.
        _writeEscrow(order, orderId, Nox.select(ok, left, order.escrow));

        _assertReviewedTransientRecipient(address(TOKEN));
        euint256 moved = Nox.select(ok, publicAmount, Nox.toEuint256(0));
        Nox.allowTransient(moved, address(TOKEN));
        TOKEN.confidentialTransfer(counterparty, moved);

        if (!IPublicLoanToken(LOAN_TOKEN).transferFrom(counterparty, order.owner, net)) {
            revert ZeroValue("loanTokenTransfer");
        }
        if (fee != 0 && !IPublicLoanToken(LOAN_TOKEN).transferFrom(counterparty, FEE_BENEFICIARY, fee)) {
            revert ZeroValue("loanTokenFeeTransfer");
        }

        emit ResidualSettled(orderId, counterparty, amount, proceeds);
    }

    // ─────────────────────────────────────────────────────────────────────────────────────────
    // Views
    // ─────────────────────────────────────────────────────────────────────────────────────────

    /// @notice One order's public metadata. Never a quantity.
    function orderOf(bytes32 orderId)
        external
        view
        returns (
            OrderState state,
            Side side,
            address owner,
            uint64 openedAt,
            uint64 expiry,
            uint32 matchCount,
            bytes32 residualHandle,
            uint256 residualSettled
        )
    {
        Order storage order = _orders[orderId];
        if (order.state == OrderState.None) revert UnknownOrder(orderId);
        return (
            order.state,
            order.side,
            order.owner,
            order.openedAt,
            order.expiry,
            order.matchCount,
            order.residualHandle,
            order.residualSettled
        );
    }

    /// @notice The order's remaining escrow. Only its owner holds a grant to decrypt it.
    function confidentialEscrowOf(bytes32 orderId) external view returns (euint256) {
        return _orders[orderId].escrow;
    }

    function submittedBy(address owner) external view returns (uint256) {
        return _submitted[owner];
    }

    /// @notice Deterministic, and folded over the deployment so an order id cannot be replayed
    ///         against another Kyrve deployment of the same series.
    function orderIdFor(address owner, Side side, uint256 sequence) public view returns (bytes32) {
        return keccak256(
            abi.encode("kyrve.cross.v1", block.chainid, address(this), DEPLOYMENT_ID, SERIES_ID, owner, side, sequence)
        );
    }

    /// @notice What `amount` claim units cost at this book's declared price. Public arithmetic.
    function quoteAssets(uint256 amount) external view returns (uint256 proceeds, uint256 fee, uint256 net) {
        proceeds = (amount * PRICE_WAD) / WAD;
        fee = (proceeds * uint256(FEE_BPS)) / BPS;
        net = proceeds - fee;
    }

    // ─────────────────────────────────────────────────────────────────────────────────────────
    // Internals
    // ─────────────────────────────────────────────────────────────────────────────────────────

    function _requireOpen(bytes32 orderId) private view returns (Order storage order) {
        order = _orders[orderId];
        if (order.state == OrderState.None) revert UnknownOrder(orderId);
        if (order.state != OrderState.Open) revert OrderNotOpen(orderId, order.state);
        if (block.timestamp > order.expiry) revert OrderExpired(orderId, order.expiry, block.timestamp);
    }

    /**
     * @dev Isolates the escrow before storing and granting it.
     *
     *      NOT OPTIONAL, AND THE COLLISION IS THE COMMON CASE HERE RATHER THAN A CORNER ONE. A book
     *      with one declared price is a book where round numbers repeat: two sellers offering the
     *      same size, or one seller's remainder equalling another's, compute identically from
     *      identical operands and would be ONE handle with ONE permanent ACL entry. `Nox.allow` has
     *      no inverse. Invariant 9, delta R-6 — and note R-6 also established that the obvious test
     *      for this passes with the defence removed, which is why the suite compares HANDLES.
     */
    function _writeEscrow(Order storage order, bytes32 orderId, euint256 value) private {
        euint256 isolated = _isolate(value, ROLE_ESCROW, uint256(orderId) ^ uint256(order.matchCount));
        order.escrow = isolated;
        _grantOwnerOnly(isolated, order.owner);
    }

    /**
     * @dev The `euint256` isolation for a contract with no epoch to anchor to. Identical in shape
     *      and in reasoning to {KyrveSeriesToken}'s: every isolated quantity here is `euint256`,
     *      where the tag carries a full 256-bit domain hash, so `eq(value, value)` is a sufficient
     *      condition and the domain does the separating. The condition's operand is confidential, so
     *      the handle seed is 0 and the result is reproducible off chain — which is what makes a
     *      published residual checkable rather than decorative.
     */
    function _isolate(euint256 value, bytes32 role, uint256 subIndex) private returns (euint256) {
        // A PUBLIC handle here would be silent and wrong in two ways: it bypasses every ACL gate in
        // NoxCompute, and an all-public operand set makes the output depend on a storage counter and
        // therefore unpredictable off chain — which would make a published residual uncheckable.
        // Reaching this state means an escrow slot was read before it was written, a public
        // scheduling fault that discloses nothing, so a public revert is the correct signal.
        if (euint256.unwrap(value)[6] & 0x01 == 0) revert EscrowIsNotConfidential(euint256.unwrap(value));
        bytes32 domain = keccak256(abi.encode(block.chainid, address(this), SERIES_ID, role, subIndex));
        return Nox.select(Nox.eq(value, value), value, Nox.toEuint256(uint256(domain)));
    }
}
