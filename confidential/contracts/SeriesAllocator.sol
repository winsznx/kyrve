// SPDX-License-Identifier: GPL-2.0-or-later
pragma solidity 0.8.36;

import {Nox, euint256} from "@iexec-nox/nox-protocol-contracts/contracts/sdk/Nox.sol";

import {CurveGraphRegistry} from "./CurveGraphRegistry.sol";
import {KyrveConfidentialBase} from "./KyrveConfidentialBase.sol";
import {KyrveCustodyVault} from "./KyrveCustodyVault.sol";
import {KyrveEmergencyController} from "./KyrveEmergencyController.sol";
import {KyrveSeriesToken} from "./KyrveSeriesToken.sol";
import {QuoteEpochController} from "./QuoteEpochController.sol";
import {ReservationLedger} from "./ReservationLedger.sol";
import {SeriesOwnershipRegistry} from "./SeriesOwnershipRegistry.sol";
import {SeriesResidueAccount} from "./SeriesResidueAccount.sol";
import {
    IKyrveQuoteRegistry,
    IKyrveSeriesVault,
    KyrveQuoteStatus,
    SettlementQuoteExecution,
    SettlementQuoteProvenance
} from "./interfaces/ISettlementLayer.sol";

/**
 * @title SeriesAllocator
 * @notice Turns locked confidential capital into public quote funding, and a settled public position
 *         into confidential series ownership (PRD §12.8, §13.14).
 *
 * ════════════════════════════════════════════════════════════════════════════════════════════
 * THE ORDER, AND WHY IT IS THIS ORDER
 * ════════════════════════════════════════════════════════════════════════════════════════════
 *
 *   1  consumeChunk    each provider's lock leaves `locked` and joins the quote's consumed total.
 *   2  unwrapFunding   the total crosses to public loan tokens in the series vault. IRREVERSIBLE.
 *   3  (settlement)    the borrower calls Midnight `take`; `onBuy` enforces exact fill; credit is
 *                      created. Nothing in this contract runs here — Kyrve is the maker, not the
 *                      taker, and the settlement path was Phase 4's.
 *   4  allocateChunk   each provider's series claim is minted from the exact handle their lock
 *                      became, and recorded against the epoch and graph root that computed it.
 *   5  closeQuote      allocation is sealed, the funding residue is accounted, and nothing can be
 *                      appended.
 *
 * Funding must precede settlement because Midnight pulls a public ERC-20 inside `take` and reverts if
 * the maker cannot pay. Allocation must FOLLOW settlement because a claim minted against a quote that
 * then fails to settle is a claim on nothing — PRD §12.8 states the same ordering, and the UI shows a
 * real pending state in between rather than a fake balance.
 *
 * That gap is the price of the ordering and it is bounded on both sides: {unwindChunk} burns the
 * claims and {restoreChunk} returns the capital if the quote is retired instead of settled. The honest
 * limit — that the public tokens must physically come back before custody can be restored, and this
 * contract cannot compel a Phase 4 series vault's operator to send them — is delta
 * [T-4](../../docs/phase5/PRD-DELTA.md).
 *
 * ════════════════════════════════════════════════════════════════════════════════════════════
 * WHAT IS NEVER A MINT QUANTITY
 * ════════════════════════════════════════════════════════════════════════════════════════════
 *
 * Invariants 2 and 3, structurally rather than by review. `KyrveSeriesToken.mintClaim` has no overload
 * that takes a number, and the only `euint256` this contract can hand it is the handle
 * {KyrveCustodyVault.consumeLock} returned for that exact provider. So:
 *
 *   leaf capacity        is private, is never read here, and has no accessor this contract calls.
 *   Midnight units       are read — `execution.exactUnits` — and used ONLY to check that the vault's
 *                        credit actually grew by them. They never reach a mint. Delta T-1.
 *   borrower assets      likewise: read to account the residue, never to size a claim.
 *
 * The result is that total supply equals the published aggregate by construction, and that identity is
 * checkable from the outside against a public ERC-20 transfer — the unwrap's plaintext — rather than
 * against an argument. Invariant 1.
 *
 * ════════════════════════════════════════════════════════════════════════════════════════════
 * PUBLIC / PRIVATE BOUNDARY
 * ════════════════════════════════════════════════════════════════════════════════════════════
 *
 *   PUBLIC     which quote is being funded and allocated, for which epoch, at which graph root; how
 *              many providers; the aggregate; the units; the residue; every state transition.
 *   PRIVATE    every provider's amount, at every step. This contract stores handles and passes them;
 *              it performs no encrypted arithmetic at all, so there is no aggregate here that could
 *              alias a provider's quantity (delta Q-5) and nothing here to isolate.
 */
contract SeriesAllocator is KyrveConfidentialBase {
    /// @dev One quote's progress through the five steps. Every transition is forward-only.
    enum AllocationState {
        None,
        Consuming,
        Funded,
        Allocating,
        Closed,
        Unwound
    }

    struct Allocation {
        AllocationState state;
        bytes32 epochId;
        bytes32 graphRoot;
        uint32 providerCount;
        uint32 consumedCount;
        uint32 mintedCount;
        uint32 unwoundCount;
        uint32 restoredCount;
        /// @dev The vault's Midnight credit BEFORE settlement. Phase 4 delta S-8: credit is a
        ///      cumulative market position, not a per-quote amount, so only the delta describes one
        ///      settlement. An absolute assertion failed on a correct settlement once already.
        uint128 creditAtFunding;
        uint64 fundedAt;
    }

    bytes32 public immutable SERIES_ID;
    KyrveCustodyVault public immutable CUSTODY;
    KyrveSeriesToken public immutable TOKEN;
    SeriesOwnershipRegistry public immutable OWNERSHIP;
    QuoteEpochController public immutable EPOCHS;
    CurveGraphRegistry public immutable GRAPH;
    ReservationLedger public immutable LEDGER;
    IKyrveQuoteRegistry public immutable QUOTES;
    /// @notice The only address that may drive an allocation. Immutable: funding a quote commits
    ///         provider capital, so it is not an open endpoint in this release.
    address public immutable KEEPER;
    address public immutable DEPLOYER;

    /// @notice The declared public destination for the funding residue. Bound once, never again.
    SeriesResidueAccount public residueAccount;

    mapping(bytes32 quoteId => Allocation) private _allocations;
    /// @dev The handle each provider's lock became. Held so a later transaction can mint from the
    ///      exact same value the custody vault consumed, rather than from anything recomputed.
    mapping(bytes32 quoteId => mapping(address provider => euint256)) private _consumed;

    event ResidueAccountBound(address indexed account);
    event QuoteConsuming(bytes32 indexed quoteId, bytes32 indexed epochId, uint32 providerCount);
    event QuoteFunded(bytes32 indexed quoteId, bytes32 unwrapRequest, uint128 creditAtFunding);
    event SeriesAllocated(bytes32 indexed quoteId, address indexed provider);
    event QuoteAllocationClosed(bytes32 indexed quoteId, uint32 mintedCount, uint256 residue);
    event QuoteUnwound(bytes32 indexed quoteId, uint32 unwoundCount, uint32 restoredCount);

    error AlreadyConsumed(bytes32 quoteId, address provider);
    error ChunkOutOfRange(uint32 start, uint32 count, uint32 providerCount);
    error CreditDidNotGrow(bytes32 quoteId, uint128 before, uint128 nowCredit, uint128 required);
    error EpochNotComplete(bytes32 quoteId, bytes32 epochId, uint8 stage);
    error GraphNotSealed(bytes32 epochId);
    error NotAllConsumed(bytes32 quoteId, uint32 consumed, uint32 providerCount);
    error NotAllMinted(bytes32 quoteId, uint32 minted, uint32 providerCount);
    error NotDeployer(address caller, address expected);
    error NotKeeper(address caller, address expected);
    error NothingConsumedYet(bytes32 quoteId);
    error ProviderNotReserved(bytes32 epochId, address provider);
    error QuoteNotRetired(bytes32 quoteId, uint8 status);
    error ResidueAccountAlreadyBound(address existing);
    error ResidueAccountNotBound();
    error ResidueBelowZero(uint256 aggregate, uint256 buyerAssets);
    error WrongAllocationState(bytes32 quoteId, AllocationState expected, AllocationState actual);
    error WrongDeployment(bytes32 expected, bytes32 actual);
    error WrongGraphRoot(bytes32 epochId, bytes32 expected, bytes32 actual);
    error WrongQuoteStatus(bytes32 quoteId, uint8 expected, uint8 actual);
    error WrongSeries(bytes32 expected, bytes32 actual);
    error ZeroAddress(string field);

    constructor(
        bytes32 seriesId,
        KyrveCustodyVault custody,
        KyrveSeriesToken token,
        SeriesOwnershipRegistry ownership,
        QuoteEpochController epochs,
        CurveGraphRegistry graph,
        ReservationLedger ledger,
        IKyrveQuoteRegistry quotes,
        address keeper,
        KyrveEmergencyController controller
    ) KyrveConfidentialBase(controller) {
        if (seriesId == bytes32(0)) revert ZeroAddress("seriesId");
        if (address(custody) == address(0)) revert ZeroAddress("custody");
        if (address(token) == address(0)) revert ZeroAddress("token");
        if (address(ownership) == address(0)) revert ZeroAddress("ownership");
        if (address(epochs) == address(0)) revert ZeroAddress("epochs");
        if (address(graph) == address(0)) revert ZeroAddress("graph");
        if (address(ledger) == address(0)) revert ZeroAddress("ledger");
        if (address(quotes) == address(0)) revert ZeroAddress("quotes");
        if (keeper == address(0)) revert ZeroAddress("keeper");

        SERIES_ID = seriesId;
        CUSTODY = custody;
        TOKEN = token;
        OWNERSHIP = ownership;
        EPOCHS = epochs;
        GRAPH = graph;
        LEDGER = ledger;
        QUOTES = quotes;
        KEEPER = keeper;
        DEPLOYER = msg.sender;
    }

    function bindResidueAccount(SeriesResidueAccount account) external {
        if (msg.sender != DEPLOYER) revert NotDeployer(msg.sender, DEPLOYER);
        if (address(residueAccount) != address(0)) revert ResidueAccountAlreadyBound(address(residueAccount));
        if (address(account) == address(0)) revert ZeroAddress("residueAccount");
        residueAccount = account;
        emit ResidueAccountBound(address(account));
    }

    modifier onlyKeeper() {
        if (msg.sender != KEEPER) revert NotKeeper(msg.sender, KEEPER);
        _;
    }

    /**
     * @notice The allocator's immutable transient-handle allowlist.
     * @dev Exactly one: the series token, fixed at construction. It is the only contract that ever
     *      receives a handle from here, and what it receives it needs in order to mint.
     *
     *      Transient access carries FULL persistent-grant power, and this contract deliberately uses
     *      that power ONCE, in {consumeChunk}, to give the token the persistent grant a later
     *      transaction's mint requires — see the note there. That is the single place a permanent grant
     *      is made by this contract, it is made to one immutable address, and it is made on a
     *      provider's own amount rather than on any aggregate.
     */
    function isReviewedTransientRecipient(address recipient) public view override returns (bool) {
        return recipient == address(TOKEN);
    }

    // ─────────────────────────────────────────────────────────────────────────────────────────
    // Step 1 · Consume the locks
    // ─────────────────────────────────────────────────────────────────────────────────────────

    /**
     * @notice Consumes one chunk of the epoch's provider locks into this quote's funding total.
     *
     * @dev CHUNKED BECAUSE THE OSAKA CAP IS REAL. EIP-7825 caps one transaction at 2^24 = 16,777,216
     *      gas regardless of the block gas limit, and Phase 4 discovered it by watching a completed
     *      256-cell epoch die inside `Midnight.take` with a bare `invalid opcode` (deltas S-1, S-2).
     *      Every Nox primitive is a separate external call and there is no batch entry point, so a
     *      per-provider loop is priced per provider and must be splittable. The caller chooses the
     *      width; `verify:gas-cap` measures what it costs.
     *
     *      FIVE THINGS ARE CHECKED BEFORE ANY CAPITAL MOVES, and each has a paired attack test:
     *        - the epoch reached `Complete`, so the winner is proven and the aggregate is published;
     *        - the graph is SEALED and its root equals the one the quote was activated against, which
     *          is what stops a quote being funded from a different computation;
     *        - the quote is still `Executable`, so a consumed, cancelled or expired quote cannot be
     *          re-funded;
     *        - the quote's vault is the maker for THIS series;
     *        - the quote came from this settlement deployment.
     */
    function consumeChunk(bytes32 quoteId, uint32 start, uint32 count) external onlyKeeper {
        Allocation storage allocation = _allocations[quoteId];
        // The returned execution is not needed here; `_requireQuote` performs the status, series and
        // deployment refusals internally, which is the whole reason it is a single helper.
        (, SettlementQuoteProvenance memory provenance) = _requireQuote(quoteId, KyrveQuoteStatus.EXECUTABLE);

        if (allocation.state == AllocationState.None) {
            QuoteEpochController.Epoch memory epoch = _requireCompleteEpoch(quoteId, provenance);
            allocation.state = AllocationState.Consuming;
            allocation.epochId = provenance.epochId;
            allocation.graphRoot = provenance.graphRoot;
            allocation.providerCount = epoch.providerCount;
            emit QuoteConsuming(quoteId, provenance.epochId, epoch.providerCount);
        } else if (allocation.state != AllocationState.Consuming) {
            revert WrongAllocationState(quoteId, AllocationState.Consuming, allocation.state);
        }

        _requireChunk(start, count, allocation.providerCount);

        uint32 end = start + count;
        for (uint32 slot = start; slot < end; ++slot) {
            address provider = EPOCHS.providerAt(allocation.epochId, slot).provider;
            if (euint256.unwrap(_consumed[quoteId][provider]) != bytes32(0)) {
                revert AlreadyConsumed(quoteId, provider);
            }

            // The lock must be the one THIS provider's own reservation opened in THIS epoch. The
            // ledger recorded it at reserve time; recomputing it here and comparing means a keeper
            // cannot present another provider's lock for this slot. The wrong-provider refusal.
            bytes32 lockId = CUSTODY.lockIdFor(allocation.epochId, provider);
            if (LEDGER.lockIdOf(allocation.epochId, provider) != lockId) {
                revert ProviderNotReserved(allocation.epochId, provider);
            }

            euint256 consumed = CUSTODY.consumeLock(lockId, quoteId);

            /**
             * THE ONE PERMANENT GRANT THIS CONTRACT MAKES, and it is deliberate.
             *
             * `Nox.mint` is executed BY the series token, so NoxCompute requires the TOKEN to hold
             * access to every operand — including this amount. The mint happens in a later
             * transaction, after settlement, and transient access does not survive a transaction. So
             * the token needs a persistent grant, and this is the only moment a contract holding
             * access to this handle can make one: the custody vault granted us transient access, and
             * transient access carries full persistent-grant power.
             *
             * The recipient is `TOKEN`, an `immutable`, checked against the allowlist rather than
             * trusted. The subject is one provider's own amount — never an aggregate, never another
             * provider's. And the grant is PERMANENT: Nox has no `removeAdmin`. The token is reviewed
             * code with no path that publishes a provider amount, which is a property of the code and
             * not of the ACL, and this comment says so rather than implying the ACL protects it.
             */
            _assertReviewedTransientRecipient(address(TOKEN));
            Nox.allow(consumed, address(TOKEN));

            _consumed[quoteId][provider] = consumed;
            allocation.consumedCount += 1;
        }
    }

    // ─────────────────────────────────────────────────────────────────────────────────────────
    // Step 2 · Cross to public funding
    // ─────────────────────────────────────────────────────────────────────────────────────────

    /**
     * @notice Unwraps the consumed total into public loan tokens for the series vault.
     *
     * @dev THE IRREVERSIBLE STEP. `KyrveCustodyVault.unwrapQuoteFunding` marks the burn amount
     *      publicly decryptable and Nox has no un-publish. What becomes public is the SUM of the locks
     *      this quote consumed — the epoch's published aggregate, which `publishAggregate` already made
     *      public. PRD §19.2 states the identity: *"sum encrypted provider reservations = publicly
     *      unwrapped quote funding"*. Per-provider contributions are not disclosed and cannot be
     *      recovered from the sum.
     *
     *      EVERY LOCK MUST BE CONSUMED FIRST. Unwrapping a partial total would fund the quote for less
     *      than the aggregate, `KyrveSeriesVault.prepareQuote` would refuse it as a shortfall — or
     *      worse, would accept it because a previous quote left a balance — and the series would then
     *      mint claims against capital that never arrived. The count check is what makes invariant 1
     *      hold rather than usually hold.
     *
     *      The vault's credit is recorded here, before settlement, because credit is a CUMULATIVE
     *      market position. Delta S-8: an absolute assertion on `debt` failed on an entirely correct
     *      Sepolia settlement because the borrower already carried 3,000,000 units of Phase 1 debt.
     *      Only the delta across the settlement block describes one fill.
     */
    function unwrapFunding(bytes32 quoteId) external onlyKeeper returns (euint256 unwrapRequest) {
        Allocation storage allocation = _allocations[quoteId];
        if (allocation.state != AllocationState.Consuming) {
            revert WrongAllocationState(quoteId, AllocationState.Consuming, allocation.state);
        }
        if (allocation.consumedCount == 0) revert NothingConsumedYet(quoteId);
        if (allocation.consumedCount != allocation.providerCount) {
            revert NotAllConsumed(quoteId, allocation.consumedCount, allocation.providerCount);
        }

        (SettlementQuoteExecution memory execution,) = _requireQuote(quoteId, KyrveQuoteStatus.EXECUTABLE);

        (uint128 credit,,) = IKyrveSeriesVault(execution.vault).positionOf(execution.marketId);
        allocation.creditAtFunding = credit;
        allocation.fundedAt = uint64(block.timestamp);
        allocation.state = AllocationState.Funded;

        unwrapRequest = CUSTODY.unwrapQuoteFunding(quoteId, execution.vault);
        emit QuoteFunded(quoteId, euint256.unwrap(unwrapRequest), credit);
    }

    // ─────────────────────────────────────────────────────────────────────────────────────────
    // Step 4 · Mint confidential ownership
    // ─────────────────────────────────────────────────────────────────────────────────────────

    /**
     * @notice Mints one chunk of providers' confidential series claims against a settled position.
     *
     * @dev THE CREDIT CHECK IS THE POINT OF DOING THIS AFTER SETTLEMENT. A claim is beneficial
     *      ownership of the vault's Midnight credit, so before minting one this contract requires the
     *      credit to have actually grown by the quote's exact units. Measured as a DELTA against
     *      `creditAtFunding` because credit is cumulative across every quote of the series (delta
     *      S-8), which is also why the check is `>=` rather than `==`: another quote of the same series
     *      may have settled in between, and its credit is not this quote's to reject.
     *
     *      `exactUnits` appears here and ONLY here — as the thing credit is checked against. It is
     *      never a mint quantity. Delta T-1, invariant 3.
     */
    function allocateChunk(bytes32 quoteId, uint32 start, uint32 count) external onlyKeeper {
        Allocation storage allocation = _allocations[quoteId];
        if (allocation.state != AllocationState.Funded && allocation.state != AllocationState.Allocating) {
            revert WrongAllocationState(quoteId, AllocationState.Funded, allocation.state);
        }

        (SettlementQuoteExecution memory execution, SettlementQuoteProvenance memory provenance) =
            _requireQuote(quoteId, KyrveQuoteStatus.CONSUMED);

        (uint128 credit,,) = IKyrveSeriesVault(execution.vault).positionOf(execution.marketId);
        uint128 grew = credit > allocation.creditAtFunding ? credit - allocation.creditAtFunding : 0;
        if (grew < execution.exactUnits) {
            revert CreditDidNotGrow(quoteId, allocation.creditAtFunding, credit, execution.exactUnits);
        }

        allocation.state = AllocationState.Allocating;
        _requireChunk(start, count, allocation.providerCount);

        uint32 end = start + count;
        for (uint32 slot = start; slot < end; ++slot) {
            address provider = EPOCHS.providerAt(allocation.epochId, slot).provider;
            euint256 consumed = _consumed[quoteId][provider];

            euint256 minted = TOKEN.mintClaim(quoteId, provider, consumed);

            OWNERSHIP.recordClaim(
                quoteId,
                provider,
                SERIES_ID,
                allocation.epochId,
                allocation.graphRoot,
                provenance.aggregateFillAmount,
                CUSTODY.lockIdFor(allocation.epochId, provider),
                minted
            );

            allocation.mintedCount += 1;
            emit SeriesAllocated(quoteId, provider);
        }
    }

    // ─────────────────────────────────────────────────────────────────────────────────────────
    // Step 5 · Close, and account the residue
    // ─────────────────────────────────────────────────────────────────────────────────────────

    /**
     * @notice Seals the allocation and records the funding residue against the declared account.
     *
     * @dev THE RESIDUE IS `aggregate - buyerAssets`, and it is the PUBLIC one of the two. Both were 1
     *      in the Phase 4 Sepolia run, which is exactly why they are named apart — delta T-2:
     *
     *        funding residue     299,999,999 - 299,999,998 = 1   public, real loan tokens, accounted
     *                                                            here, destination declared and
     *                                                            immutable
     *        unreserved residue  300,000,000 - 299,999,999 = 1   PRIVATE, the engine's `dustResidue`
     *                                                            handle, granted to nobody and
     *                                                            published never, because publishing
     *                                                            it discloses leaf capacity by
     *                                                            subtraction. It is not representable
     *                                                            here and never arrives.
     *
     *      Both floors round DOWN, so `buyerAssets <= aggregate` is structural — `QuoteActivator`
     *      asserts it too. It is asserted again here because a violation would mean the maker owed
     *      more than providers committed, and a residue computed by underflow would be enormous rather
     *      than negative. Invariant 15: the residue is never silently minted, because supply is the
     *      aggregate and nothing here can add to supply.
     */
    function closeQuote(bytes32 quoteId) external onlyKeeper returns (uint256 residue) {
        Allocation storage allocation = _allocations[quoteId];
        if (allocation.state != AllocationState.Allocating) {
            revert WrongAllocationState(quoteId, AllocationState.Allocating, allocation.state);
        }
        if (allocation.mintedCount != allocation.providerCount) {
            revert NotAllMinted(quoteId, allocation.mintedCount, allocation.providerCount);
        }
        SeriesResidueAccount account = residueAccount;
        if (address(account) == address(0)) revert ResidueAccountNotBound();

        (SettlementQuoteExecution memory execution, SettlementQuoteProvenance memory provenance) =
            _requireQuote(quoteId, KyrveQuoteStatus.CONSUMED);

        uint256 aggregate = provenance.aggregateFillAmount;
        uint256 buyerAssets = uint256(execution.expectedBuyerAssets);
        if (buyerAssets > aggregate) revert ResidueBelowZero(aggregate, buyerAssets);
        residue = aggregate - buyerAssets;

        allocation.state = AllocationState.Closed;
        OWNERSHIP.closeQuote(quoteId);
        account.recordResidue(quoteId, residue);

        emit QuoteAllocationClosed(quoteId, allocation.mintedCount, residue);
    }

    // ─────────────────────────────────────────────────────────────────────────────────────────
    // The other ending · a funded quote that never settled
    // ─────────────────────────────────────────────────────────────────────────────────────────

    /**
     * @notice Burns the claims and restores the capital for a quote that was retired, not settled.
     *
     * @dev Invariant 10's post-funding half. Two effects per provider and they must both happen or the
     *      provider holds a claim AND their capital, or neither:
     *
     *        1. if a claim was minted, burn it — otherwise a claim on a position that does not exist
     *           survives and the solvency comparison is against nothing;
     *        2. restore the lock to `available`, which is capital the provider can withdraw again.
     *
     *      THE LIMIT, STATED RATHER THAN HIDDEN — delta T-4. Step 2 can only succeed once the public
     *      tokens have physically returned to the custody vault and been re-wrapped, and this contract
     *      cannot compel that: `KyrveSeriesVault.recoverFunding` is Phase 4 code, deployed, and
     *      operator-only. If coverage has not returned, the wrapper's own `transfer` primitive moves
     *      encrypted zero rather than reverting, so the restoration would credit a balance that later
     *      pays nothing. `AggregateSolvencyVerifier` is what makes that observable; this function does
     *      not pretend to prevent it.
     *
     *      Not `onlyKeeper`. A retired quote is a public fact and a stalled keeper must not be able to
     *      hold a provider's capital hostage — the same reasoning that makes `NoxCurveEngine.cancelEpoch`
     *      permissionless after the deadline (PRD invariants 12 and 20).
     */
    function unwindChunk(bytes32 quoteId, uint32 start, uint32 count) external {
        Allocation storage allocation = _allocations[quoteId];
        if (
            allocation.state != AllocationState.Funded && allocation.state != AllocationState.Allocating
                && allocation.state != AllocationState.Unwound
        ) {
            revert WrongAllocationState(quoteId, AllocationState.Funded, allocation.state);
        }

        SettlementQuoteExecution memory execution = QUOTES.executionOf(quoteId);
        if (execution.status != KyrveQuoteStatus.CANCELLED && execution.status != KyrveQuoteStatus.EXPIRED) {
            revert QuoteNotRetired(quoteId, execution.status);
        }

        allocation.state = AllocationState.Unwound;
        _requireChunk(start, count, allocation.providerCount);

        uint32 end = start + count;
        for (uint32 slot = start; slot < end; ++slot) {
            address provider = EPOCHS.providerAt(allocation.epochId, slot).provider;
            bytes32 lockId = CUSTODY.lockIdFor(allocation.epochId, provider);

            if (OWNERSHIP.claimOf(quoteId, provider).state == SeriesOwnershipRegistry.ClaimState.Allocated) {
                TOKEN.burnAllocation(quoteId, provider, _consumed[quoteId][provider]);
                OWNERSHIP.unwindClaim(quoteId, provider, lockId);
                allocation.unwoundCount += 1;
            }

            if (CUSTODY.lockStateOf(lockId) == KyrveCustodyVault.LockState.Consumed) {
                CUSTODY.restoreLock(lockId, quoteId);
                allocation.restoredCount += 1;
            }
        }

        emit QuoteUnwound(quoteId, allocation.unwoundCount, allocation.restoredCount);
    }

    // ─────────────────────────────────────────────────────────────────────────────────────────
    // Views
    // ─────────────────────────────────────────────────────────────────────────────────────────

    function allocationOf(bytes32 quoteId) external view returns (Allocation memory) {
        return _allocations[quoteId];
    }

    /// @notice The handle one provider's lock became. Granted to the provider and the series token.
    function confidentialConsumedOf(bytes32 quoteId, address provider) external view returns (euint256) {
        return _consumed[quoteId][provider];
    }

    // ─────────────────────────────────────────────────────────────────────────────────────────
    // Internals
    // ─────────────────────────────────────────────────────────────────────────────────────────

    /**
     * @dev Reads the quote and refuses everything that is not this series, this deployment and this
     *      expected status. Three refusals in one place so no entry point can be written without them.
     */
    function _requireQuote(bytes32 quoteId, uint8 expectedStatus)
        private
        view
        returns (SettlementQuoteExecution memory execution, SettlementQuoteProvenance memory provenance)
    {
        execution = QUOTES.executionOf(quoteId);
        provenance = QUOTES.provenanceOf(quoteId);

        if (execution.status != expectedStatus) {
            revert WrongQuoteStatus(quoteId, expectedStatus, execution.status);
        }
        bytes32 vaultSeries = IKyrveSeriesVault(execution.vault).SERIES_ID();
        if (vaultSeries != SERIES_ID) revert WrongSeries(SERIES_ID, vaultSeries);

        bytes32 deployment = QUOTES.DEPLOYMENT_ID();
        if (provenance.deploymentId != deployment) revert WrongDeployment(deployment, provenance.deploymentId);
    }

    /// @dev The epoch must be finished and its graph sealed at exactly the root the quote carries.
    function _requireCompleteEpoch(bytes32 quoteId, SettlementQuoteProvenance memory provenance)
        private
        view
        returns (QuoteEpochController.Epoch memory epoch)
    {
        epoch = EPOCHS.epochOf(provenance.epochId);
        if (epoch.stage != QuoteEpochController.Stage.Complete) {
            revert EpochNotComplete(quoteId, provenance.epochId, uint8(epoch.stage));
        }
        if (!GRAPH.isSealed(provenance.epochId)) revert GraphNotSealed(provenance.epochId);

        bytes32 root = GRAPH.rootOf(provenance.epochId);
        if (root != provenance.graphRoot) revert WrongGraphRoot(provenance.epochId, provenance.graphRoot, root);
    }

    function _requireChunk(uint32 start, uint32 count, uint32 providerCount) private pure {
        if (count == 0 || start + count > providerCount) {
            revert ChunkOutOfRange(start, count, providerCount);
        }
    }
}
