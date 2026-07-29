// SPDX-License-Identifier: GPL-2.0-or-later
pragma solidity 0.8.34;

import {IBuyCallback} from "midnight/interfaces/ICallbacks.sol";
import {IMidnight, Market} from "midnight/interfaces/IMidnight.sol";
import {CALLBACK_SUCCESS} from "midnight/libraries/ConstantsLib.sol";

import {KyrveQuoteRegistry} from "./KyrveQuoteRegistry.sol";
import {QuoteExecution, QuoteStatus} from "./KyrveQuoteTypes.sol";

/// @dev Midnight's own `IERC20` carries only `transfer` and `transferFrom`. The maker additionally
///      needs `approve`, `allowance` and `balanceOf`, and needs `approve` to RETURN A BOOL so a
///      token that signals failure by returning false instead of reverting is caught here rather
///      than surfacing as an opaque revert inside Midnight's `transferFrom`.
interface IERC20Funding {
    function approve(address spender, uint256 amount) external returns (bool);
    function allowance(address owner, address spender) external view returns (uint256);
    function balanceOf(address account) external view returns (uint256);
    function transfer(address to, uint256 amount) external returns (bool);
}

/**
 * @title KyrveSeriesVault
 * @notice The Midnight maker and the exact-fill enforcement point for one series (PRD §13.11).
 *
 * ────────────────────────────────────────────────────────────────────────────────────────────
 * WHY THE SIZE CHECK IS HERE AND CAN BE NOWHERE ELSE
 * ────────────────────────────────────────────────────────────────────────────────────────────
 *
 * Midnight permits partial fills — `newConsumed <= offer.maxUnits` — and `IRatifier.isRatified` is
 * `view` and never receives `units`. `onBuy` is the ONLY point on the settlement path where an
 * attempted fill's actual `units` and `buyerAssets` become visible to maker-controlled code.
 * Reverting here reverts the entire `take`: group consumption, vault credit and borrower debt roll
 * back together, because Midnight has already written all three by the time the callback runs
 * (`Midnight.sol` lines 440-485).
 *
 * ────────────────────────────────────────────────────────────────────────────────────────────
 * WHAT THIS VAULT HOLDS, AND WHAT IT DELIBERATELY DOES NOT
 * ────────────────────────────────────────────────────────────────────────────────────────────
 *
 *   HOLDS      public loan-token funding, the public Midnight credit position that settlement
 *              creates, and a running total of funding committed to live quotes.
 *   DOES NOT   hold any encrypted handle, perform any Nox operation, record any provider
 *              allocation, or mint confidential series ownership. Provider allocations exist only
 *              as handles inside `ReservationLedger` and `NoxCurveEngine`; nothing in this contract
 *              can represent one, which is the strongest form of "never exposes them".
 *
 * Confidential series ownership — the ERC-7984 claim each provider holds against this vault's
 * credit — is Phase 5. Phase 4 settles from PUBLIC funding, deliberately and in the open, because
 * making a curve reservation into a real capital lock is its own decision with its own consequences
 * (Phase 3 prerequisite P4-2) and folding it into the settlement commit would bury it.
 *
 * ────────────────────────────────────────────────────────────────────────────────────────────
 * FUNDING ACCOUNTING
 * ────────────────────────────────────────────────────────────────────────────────────────────
 *
 * One vault serves many quotes over its life, so "is it funded?" cannot be answered by balance
 * alone. {committedFunding} is the sum of `expectedBuyerAssets` across every quote of this vault
 * that is still `Executable`. Activation requires `balance >= committed + thisQuote`; settlement
 * and retirement both release the commitment. {recoverFunding} can therefore only ever move
 * UNCOMMITTED tokens, so recovery can never strand a live quote.
 */
contract KyrveSeriesVault is IBuyCallback {
    error AllowanceResidue(address token, uint256 residue);
    error ApprovalRejected(address token, uint256 amount);
    error CallbackCallerNotMidnight(address caller);
    error FeeAboveCap(uint256 cap, uint256 actual);
    error FundingShortfall(uint256 required, uint256 available);
    error NotActivator(address caller, address expected);
    error NotExpiryController(address caller, address expected);
    error NotOperator(address caller, address expected);
    error NotTerminalStatus(uint8 status);
    error QuoteNotExecutable(bytes32 quoteId, uint8 status);
    error TransferRejected(address token, address to, uint256 amount);
    error WrongBuyer(address expected, address actual);
    error WrongBuyerAssets(uint256 expected, uint256 actual);
    error WrongLoanToken(address expected, address actual);
    error WrongMarket(bytes32 expected, bytes32 actual);
    error WrongUnits(uint256 expected, uint256 actual);
    error WrongVault(bytes32 quoteId, address expected, address actual);
    error ZeroAddress(string field);

    event QuotePrepared(bytes32 indexed quoteId, uint128 expectedBuyerAssets, uint256 committedFunding);
    event ExactFill(bytes32 indexed quoteId, bytes32 indexed marketId, uint256 units, uint256 buyerAssets);
    event QuoteRetired(bytes32 indexed quoteId, QuoteStatus status, uint128 consumedUnits);
    event FundingRecovered(address indexed to, uint256 amount);
    event RatifierAuthorised(address indexed ratifier, bool authorised);

    address public immutable MIDNIGHT;
    KyrveQuoteRegistry public immutable REGISTRY;
    address public immutable ACTIVATOR;
    address public immutable EXPIRY_CONTROLLER;
    /// @dev Every quote this vault makes must be in this loan token. Pinned so funding accounting
    ///      is over one balance and cannot be confused across assets.
    address public immutable LOAN_TOKEN;
    /// @dev The only address that may withdraw uncommitted funding. Not an owner: it can pause
    ///      nothing, cancel nothing and settle nothing.
    address public immutable OPERATOR;
    /// @dev Identifies the series this vault is the maker for. Public and deterministic.
    bytes32 public immutable SERIES_ID;

    /// @notice Loan-token funding committed to quotes that are still `Executable`.
    uint256 public committedFunding;

    constructor(
        address midnight,
        KyrveQuoteRegistry registry,
        address activator,
        address expiryController,
        address loanToken,
        address operator,
        bytes32 seriesId
    ) {
        require(midnight != address(0), ZeroAddress("midnight"));
        require(address(registry) != address(0), ZeroAddress("registry"));
        require(activator != address(0), ZeroAddress("activator"));
        require(expiryController != address(0), ZeroAddress("expiryController"));
        require(loanToken != address(0), ZeroAddress("loanToken"));
        require(operator != address(0), ZeroAddress("operator"));

        MIDNIGHT = midnight;
        REGISTRY = registry;
        ACTIVATOR = activator;
        EXPIRY_CONTROLLER = expiryController;
        LOAN_TOKEN = loanToken;
        OPERATOR = operator;
        SERIES_ID = seriesId;
    }

    modifier onlyActivator() {
        require(msg.sender == ACTIVATOR, NotActivator(msg.sender, ACTIVATOR));
        _;
    }

    // ─────────────────────────────────────────────────────────────────────────────────────────
    // Activation-time preparation
    // ─────────────────────────────────────────────────────────────────────────────────────────

    /**
     * @notice Midnight refuses to consult a ratifier the maker has not authorised.
     * @dev Without this, `take` reverts `RatifierUnauthorized` before Kyrve is reached at all
     *      (PRD v1.1 A-2). Restricted to the activator because authorising an arbitrary ratifier
     *      would let it authenticate offers on this vault's behalf.
     */
    function authoriseRatifier(address ratifier, bool authorised) external onlyActivator {
        IMidnight(MIDNIGHT).setIsAuthorized(ratifier, authorised, address(this));
        emit RatifierAuthorised(ratifier, authorised);
    }

    /**
     * @notice Commits this vault's funding to one already-registered quote.
     * @dev Called by the activator immediately after {KyrveQuoteRegistry.activate}, so the quote is
     *      read back from the registry rather than taken from the caller's word. The funding check
     *      is the reason activation can fail loudly and early instead of failing inside `take`,
     *      where the borrower would pay gas for the maker's shortfall.
     */
    function prepareQuote(bytes32 quoteId) external onlyActivator {
        QuoteExecution memory execution = REGISTRY.executionOf(quoteId);
        require(execution.status == QuoteStatus.Executable, QuoteNotExecutable(quoteId, uint8(execution.status)));
        require(execution.vault == address(this), WrongVault(quoteId, address(this), execution.vault));

        uint256 committed = committedFunding + execution.expectedBuyerAssets;
        uint256 balance = IERC20Funding(LOAN_TOKEN).balanceOf(address(this));
        require(balance >= committed, FundingShortfall(committed, balance));

        committedFunding = committed;
        emit QuotePrepared(quoteId, execution.expectedBuyerAssets, committed);
    }

    // ─────────────────────────────────────────────────────────────────────────────────────────
    // Settlement
    // ─────────────────────────────────────────────────────────────────────────────────────────

    /**
     * @notice The exact-fill enforcement point. Every check below has a paired attack test.
     * @dev `data` is `offer.callbackData`, which is inside the hash the ratifier already compared,
     *      so the quote id it carries cannot be substituted by the taker. It is still decoded and
     *      checked against this vault, because a maker-signed offer for a DIFFERENT vault's quote
     *      would otherwise reach here.
     */
    function onBuy(
        bytes32 id,
        Market memory market,
        uint256 buyerAssets,
        uint256 units,
        uint256 pendingFeeIncrease,
        address buyer,
        bytes memory data
    ) external returns (bytes32) {
        require(msg.sender == MIDNIGHT, CallbackCallerNotMidnight(msg.sender));

        bytes32 quoteId = abi.decode(data, (bytes32));
        QuoteExecution memory execution = REGISTRY.executionOf(quoteId);

        require(execution.status == QuoteStatus.Executable, QuoteNotExecutable(quoteId, uint8(execution.status)));
        require(execution.vault == address(this), WrongVault(quoteId, address(this), execution.vault));
        require(buyer == address(this), WrongBuyer(address(this), buyer));
        require(market.loanToken == LOAN_TOKEN, WrongLoanToken(LOAN_TOKEN, market.loanToken));
        require(id == execution.marketId, WrongMarket(execution.marketId, id));
        require(units == execution.exactUnits, WrongUnits(execution.exactUnits, units));
        require(
            buyerAssets == execution.expectedBuyerAssets, WrongBuyerAssets(execution.expectedBuyerAssets, buyerAssets)
        );
        require(pendingFeeIncrease <= execution.maxPendingFee, FeeAboveCap(execution.maxPendingFee, pendingFeeIncrease));

        uint256 balance = IERC20Funding(LOAN_TOKEN).balanceOf(address(this));
        require(balance >= buyerAssets, FundingShortfall(buyerAssets, balance));

        // CHECKS, THEN EFFECTS, THEN INTERACTIONS, across two contracts. The quote is marked
        // consumed BEFORE the approval below and before Midnight pulls the assets, so a re-entrant
        // `take` — from a malicious taker callback, or from the loan token itself — reaches the
        // ratifier, reads `Consumed`, and is refused.
        committedFunding -= execution.expectedBuyerAssets;
        REGISTRY.markConsumed(quoteId);

        // A leftover allowance would mean a previous settlement did not consume exactly what it
        // approved, which is the only way this vault could over-pay. Fail rather than add to it.
        uint256 residue = IERC20Funding(LOAN_TOKEN).allowance(address(this), MIDNIGHT);
        require(residue == 0, AllowanceResidue(LOAN_TOKEN, residue));

        bool approved = IERC20Funding(LOAN_TOKEN).approve(MIDNIGHT, buyerAssets);
        require(approved, ApprovalRejected(LOAN_TOKEN, buyerAssets));

        emit ExactFill(quoteId, id, units, buyerAssets);
        return CALLBACK_SUCCESS;
    }

    // ─────────────────────────────────────────────────────────────────────────────────────────
    // Retirement and recovery
    // ─────────────────────────────────────────────────────────────────────────────────────────

    /**
     * @notice Ends a live quote and makes it unfillable at the PROTOCOL level, not merely here.
     * @dev Because `offer.group == quoteId`, pre-consuming the group through Midnight's own
     *      `setConsumed` exhausts it: `newConsumed <= offer.maxUnits` can no longer hold for any
     *      units at all (PRD v1.1 A-5). Flipping local status alone would stop this vault honouring
     *      the quote but would leave Midnight's own accounting untouched, and an offer is only
     *      truly dead once the group is consumed.
     *
     *      WHO may retire, and WHEN, is `KyrveQuoteExpiryController`'s decision. This function
     *      enforces only that the decision came from it.
     */
    function retireQuote(bytes32 quoteId, QuoteStatus terminal) external {
        require(msg.sender == EXPIRY_CONTROLLER, NotExpiryController(msg.sender, EXPIRY_CONTROLLER));
        require(
            terminal == QuoteStatus.Cancelled || terminal == QuoteStatus.Expired, NotTerminalStatus(uint8(terminal))
        );

        QuoteExecution memory execution = REGISTRY.executionOf(quoteId);
        require(execution.status == QuoteStatus.Executable, QuoteNotExecutable(quoteId, uint8(execution.status)));
        require(execution.vault == address(this), WrongVault(quoteId, address(this), execution.vault));

        // Effects before the interaction.
        committedFunding -= execution.expectedBuyerAssets;
        REGISTRY.retire(quoteId, terminal);

        IMidnight(MIDNIGHT).setConsumed(quoteId, execution.exactUnits, address(this));
        emit QuoteRetired(quoteId, terminal, execution.exactUnits);
    }

    /**
     * @notice Withdraws funding that no live quote is committed to.
     * @dev The bound is `balance - committedFunding`, so this can never reach into capital a live
     *      quote depends on. It is the recovery half of expiry: retire the quote, then recover.
     */
    function recoverFunding(uint256 amount, address to) external {
        require(msg.sender == OPERATOR, NotOperator(msg.sender, OPERATOR));
        require(to != address(0), ZeroAddress("to"));

        uint256 available = availableFunding();
        require(amount <= available, FundingShortfall(amount, available));

        bool sent = IERC20Funding(LOAN_TOKEN).transfer(to, amount);
        require(sent, TransferRejected(LOAN_TOKEN, to, amount));
        emit FundingRecovered(to, amount);
    }

    // ─────────────────────────────────────────────────────────────────────────────────────────
    // Public position surface
    // ─────────────────────────────────────────────────────────────────────────────────────────

    /// @notice Loan-token balance not committed to any live quote.
    function availableFunding() public view returns (uint256) {
        uint256 balance = IERC20Funding(LOAN_TOKEN).balanceOf(address(this));
        uint256 committed = committedFunding;
        return balance > committed ? balance - committed : 0;
    }

    /**
     * @notice The public Midnight position this vault holds in one market.
     * @dev PUBLIC BY CONSTRUCTION. Midnight's credit ledger is public and Kyrve never claims
     *      otherwise; what stays private is WHO the credit is held for and in what proportions.
     */
    function positionOf(bytes32 marketId) external view returns (uint128 credit, uint128 debt, uint128 pendingFee) {
        IMidnight midnight = IMidnight(MIDNIGHT);
        return (
            midnight.credit(marketId, address(this)),
            midnight.debt(marketId, address(this)),
            midnight.pendingFee(marketId, address(this))
        );
    }

    /// @notice How much of `quoteId`'s group Midnight has recorded as consumed against this vault.
    function consumedUnits(bytes32 quoteId) external view returns (uint128) {
        return IMidnight(MIDNIGHT).consumed(address(this), quoteId);
    }
}
