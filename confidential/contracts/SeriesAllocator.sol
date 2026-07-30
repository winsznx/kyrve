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
 *   1  consumeChunk    keyed on the EPOCH. Each provider's lock leaves `locked` and joins the
 *                      round's consumed total.
 *   2  unwrapFunding   keyed on the EPOCH. The total crosses to public loan tokens in this series'
 *                      vault, whose address is an `immutable` here rather than a parameter.
 *                      IRREVERSIBLE.
 *   3  (activation)    the keeper activates the quote. `KyrveSeriesVault.prepareQuote` refuses a
 *                      vault that cannot already pay, which is why steps 1 and 2 come first and why
 *                      they cannot be keyed on a quote id that does not exist yet. Delta T-9.
 *   4  (settlement)    the borrower calls Midnight `take`; `onBuy` enforces exact fill; credit is
 *                      created. Nothing in this contract runs here — Kyrve is the maker, not the
 *                      taker, and the settlement path was Phase 4's.
 *   5  allocateChunk   keyed on the QUOTE, which now exists and whose own provenance must name the
 *                      epoch that was funded. Each provider's claim is minted from the exact handle
 *                      their lock became.
 *   6  closeQuote      allocation is sealed, the funding residue is accounted, and nothing can be
 *                      appended.
 *
 * Funding must precede settlement because Midnight pulls a public ERC-20 inside `take` and reverts if
 * the maker cannot pay — and it must precede ACTIVATION for the same reason one step earlier.
 * Allocation must FOLLOW settlement because a claim minted against a quote that then fails to settle
 * is a claim on nothing — PRD §12.8 states the same ordering, and the UI shows a real pending state in
 * between rather than a fake balance.
 *
 * The two keys are not a weakening. Activation is terminal and one quote per epoch: the registry
 * refuses a second quote for an epoch id it has already seen, forever. So the epoch identifies the
 * funding round uniquely, and step 5 refuses any quote whose `provenance.epochId` is not the round it
 * is drawing on.
 *
 * That gap is the price of the ordering and it is bounded on both sides: {unwindChunk} burns the
 * claims and restores the capital if the quote is retired instead of settled. The honest
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
        /// @dev Written at first allocation. Binds this funding round to exactly one quote, so a
        ///      second quote can never draw on capital a first one already consumed.
        bytes32 quoteId;
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
    /**
     * @notice The one series vault this allocator funds and allocates against.
     * @dev An `immutable`, not a parameter. The funding unwrap happens BEFORE a quote exists, so the
     *      recipient cannot be derived from a quote — and deriving it from the factory would duplicate
     *      `QuoteActivator`'s derivation in a second place that could drift. Fixing it here means the
     *      only address confidential capital can ever be unwrapped to was chosen at deployment and is
     *      visible in the verified constructor arguments. Threat T-G.
     */
    IKyrveSeriesVault public immutable VAULT;
    /**
     * @notice The Midnight market this series' credit position lives in.
     * @dev An `immutable` for the same reason {VAULT} is: the credit reading that precedes activation
     *      has no quote to take a market id from, and `KyrveSeriesFactory` derives one series from
     *      exactly one market, so a per-series allocator has exactly one market. `allocateChunk` reads
     *      the market from the QUOTE and would disagree with this one if they were ever mismatched,
     *      which is why the constructor pins both against the vault.
     */
    bytes32 public immutable MARKET_ID;
    /// @notice The only address that may drive an allocation. Immutable: funding a quote commits
    ///         provider capital, so it is not an open endpoint in this release.
    address public immutable KEEPER;
    address public immutable DEPLOYER;

    /// @notice The declared public destination for the funding residue. Bound once, never again.
    SeriesResidueAccount public residueAccount;

    /// @dev Keyed on the EPOCH, because funding precedes the quote id. See the ordering note above.
    mapping(bytes32 epochId => Allocation) private _allocations;
    /// @dev The handle each provider's lock became. Held so a later transaction can mint from the
    ///      exact same value the custody vault consumed, rather than from anything recomputed.
    mapping(bytes32 epochId => mapping(address provider => euint256)) private _consumed;

    event ResidueAccountBound(address indexed account);
    event RoundConsuming(bytes32 indexed epochId, uint32 providerCount);
    event RoundFunded(bytes32 indexed epochId, bytes32 unwrapRequest, uint128 creditAtFunding);
    event SeriesAllocated(bytes32 indexed epochId, bytes32 indexed quoteId, address indexed provider);
    event QuoteAllocationClosed(bytes32 indexed quoteId, uint32 mintedCount, uint256 residue);
    event QuoteUnwound(bytes32 indexed quoteId, uint32 unwoundCount, uint32 restoredCount);

    error AlreadyConsumed(bytes32 epochId, address provider);
    error EpochAlreadyAllocated(bytes32 epochId, bytes32 quoteId);
    error RoundNotFunded(bytes32 epochId, AllocationState state);
    error ChunkOutOfRange(uint32 start, uint32 count, uint32 providerCount);
    error CreditDidNotGrow(bytes32 quoteId, uint128 creditBefore, uint128 creditNow, uint128 required);
    error EpochNotComplete(bytes32 epochId, uint8 stage);
    error GraphNotSealed(bytes32 epochId);
    error NotAllConsumed(bytes32 epochId, uint32 consumed, uint32 providerCount);
    error NotAllMinted(bytes32 quoteId, uint32 minted, uint32 providerCount);
    error NotDeployer(address caller, address expected);
    error NotKeeper(address caller, address expected);
    error NothingConsumedYet(bytes32 epochId);
    error ProviderNotReserved(bytes32 epochId, address provider);
    error QuoteNotRetired(bytes32 quoteId, uint8 status);
    error ResidueAccountAlreadyBound(address existing);
    error ResidueAccountNotBound();
    error ResidueBelowZero(uint256 aggregate, uint256 buyerAssets);
    error WrongAllocationState(bytes32 key, AllocationState expected, AllocationState actual);
    error WrongDeployment(bytes32 expected, bytes32 actual);
    error WrongGraphRoot(bytes32 epochId, bytes32 expected, bytes32 actual);
    error WrongMarket(bytes32 expected, bytes32 actual);
    error WrongVaultForSeries(address expected, address actual);
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
        IKyrveSeriesVault vault,
        bytes32 marketId,
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
        if (address(vault) == address(0)) revert ZeroAddress("vault");
        if (marketId == bytes32(0)) revert ZeroAddress("marketId");
        if (keeper == address(0)) revert ZeroAddress("keeper");
        // Checked at construction rather than trusted. A vault belonging to a different series would
        // make every later series check pass against the wrong maker.
        bytes32 vaultSeries = vault.SERIES_ID();
        if (vaultSeries != seriesId) revert WrongSeries(seriesId, vaultSeries);

        SERIES_ID = seriesId;
        CUSTODY = custody;
        TOKEN = token;
        OWNERSHIP = ownership;
        EPOCHS = epochs;
        GRAPH = graph;
        LEDGER = ledger;
        QUOTES = quotes;
        VAULT = vault;
        MARKET_ID = marketId;
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
    // Step 1 · Consume the locks. Keyed on the EPOCH, before any quote exists.
    // ─────────────────────────────────────────────────────────────────────────────────────────

    /**
     * @notice Consumes one chunk of the epoch's provider locks into this round's funding total.
     *
     * @dev CHUNKED BECAUSE THE OSAKA CAP IS REAL. EIP-7825 caps one transaction at 2^24 = 16,777,216
     *      gas regardless of the block gas limit, and Phase 4 discovered it by watching a completed
     *      256-cell epoch die inside `Midnight.take` with a bare `invalid opcode` (deltas S-1, S-2).
     *      Every Nox primitive is a separate external call and there is no batch entry point, so a
     *      per-provider loop is priced per provider and must be splittable. The caller chooses the
     *      width; `verify:gas-cap` measures what it costs.
     *
     *      THREE THINGS ARE CHECKED BEFORE ANY CAPITAL MOVES, and each has a paired attack test:
     *        - the epoch reached `Complete`, so the winner is proven and the aggregate is published;
     *        - the graph is SEALED, because an unsealed graph means the computation is unfinished;
     *        - this round has not already been allocated to a quote, so capital a settled quote
     *          consumed cannot be consumed again.
     *
     *      The series and the deployment are NOT checked here and do not need to be: the only address
     *      this contract can ever unwrap to is {VAULT}, an `immutable` whose `SERIES_ID` was checked
     *      against this allocator's own at construction. Checking a quote's series at funding time
     *      would be checking a value that does not exist yet.
     */
    function consumeChunk(bytes32 epochId, uint32 start, uint32 count) external onlyKeeper {
        Allocation storage allocation = _allocations[epochId];

        if (allocation.state == AllocationState.None) {
            QuoteEpochController.Epoch memory epoch = _requireCompleteEpoch(epochId);
            allocation.state = AllocationState.Consuming;
            allocation.graphRoot = GRAPH.rootOf(epochId);
            allocation.providerCount = epoch.providerCount;
            emit RoundConsuming(epochId, epoch.providerCount);
        } else if (allocation.state != AllocationState.Consuming) {
            revert WrongAllocationState(epochId, AllocationState.Consuming, allocation.state);
        }

        _requireChunk(start, count, allocation.providerCount);

        uint32 end = start + count;
        for (uint32 slot = start; slot < end; ++slot) {
            address provider = EPOCHS.providerAt(epochId, slot).provider;
            if (euint256.unwrap(_consumed[epochId][provider]) != bytes32(0)) {
                revert AlreadyConsumed(epochId, provider);
            }

            // The lock must be the one THIS provider's own reservation opened in THIS epoch. The
            // ledger recorded it at reserve time; recomputing it here and comparing means a keeper
            // cannot present another provider's lock for this slot. The wrong-provider refusal.
            bytes32 lockId = CUSTODY.lockIdFor(epochId, provider);
            if (LEDGER.lockIdOf(epochId, provider) != lockId) {
                revert ProviderNotReserved(epochId, provider);
            }

            euint256 consumed = CUSTODY.consumeLock(lockId, epochId);

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

            _consumed[epochId][provider] = consumed;
            allocation.consumedCount += 1;
        }
    }

    // ─────────────────────────────────────────────────────────────────────────────────────────
    // Step 2 · Cross to public funding
    // ─────────────────────────────────────────────────────────────────────────────────────────

    /**
     * @notice Unwraps the round's consumed total into public loan tokens for this series' vault.
     *
     * @dev THE IRREVERSIBLE STEP. `KyrveCustodyVault.unwrapQuoteFunding` marks the burn amount
     *      publicly decryptable and Nox has no un-publish. What becomes public is the SUM of the locks
     *      this round consumed — the epoch's published aggregate, which `publishAggregate` already made
     *      public. PRD §19.2 states the identity: *"sum encrypted provider reservations = publicly
     *      unwrapped quote funding"*. Per-provider contributions are not disclosed and cannot be
     *      recovered from the sum.
     *
     *      EVERY LOCK MUST BE CONSUMED FIRST. Unwrapping a partial total would fund the vault for less
     *      than the aggregate; `KyrveSeriesVault.prepareQuote` would then refuse activation as a
     *      shortfall — or worse, would accept it because a previous quote left a balance — and the
     *      series would mint claims against capital that never arrived. The count check is what makes
     *      invariant 1 hold rather than usually hold.
     *
     *      The vault's credit is recorded here, before activation, because credit is a CUMULATIVE
     *      market position. Delta S-8: an absolute assertion on `debt` failed on an entirely correct
     *      Sepolia settlement because the borrower already carried 3,000,000 units of Phase 1 debt.
     *      Only the delta across the settlement describes one fill.
     */
    function unwrapFunding(bytes32 epochId) external onlyKeeper returns (euint256 unwrapRequest) {
        Allocation storage allocation = _allocations[epochId];
        if (allocation.state != AllocationState.Consuming) {
            revert WrongAllocationState(epochId, AllocationState.Consuming, allocation.state);
        }
        if (allocation.consumedCount == 0) revert NothingConsumedYet(epochId);
        if (allocation.consumedCount != allocation.providerCount) {
            revert NotAllConsumed(epochId, allocation.consumedCount, allocation.providerCount);
        }

        (uint128 credit,,) = VAULT.positionOf(MARKET_ID);
        allocation.creditAtFunding = credit;
        allocation.fundedAt = uint64(block.timestamp);
        allocation.state = AllocationState.Funded;

        unwrapRequest = CUSTODY.unwrapQuoteFunding(epochId, address(VAULT));
        emit RoundFunded(epochId, euint256.unwrap(unwrapRequest), credit);
    }

    // ─────────────────────────────────────────────────────────────────────────────────────────
    // Step 5 · Mint confidential ownership. Keyed on the QUOTE, which now exists.
    // ─────────────────────────────────────────────────────────────────────────────────────────

    /**
     * @notice Mints one chunk of providers' confidential series claims against a settled position.
     *
     * @dev THE QUOTE IS WHAT BINDS THE ROUND TO A SETTLEMENT. `provenance.epochId` must be the epoch
     *      whose funding this draws on — read from the quote rather than supplied — so a keeper cannot
     *      allocate one epoch's capital against another epoch's quote. `_requireQuote` additionally
     *      refuses a quote whose vault is not {VAULT} and whose deployment is not this one, and the
     *      first allocation writes the quote id so a second quote can never reuse the round.
     *
     *      THE CREDIT CHECK IS THE POINT OF DOING THIS AFTER SETTLEMENT. A claim is beneficial
     *      ownership of the vault's Midnight credit, so before minting one this contract requires the
     *      credit to have actually grown by the quote's exact units. Measured as a DELTA against
     *      `creditAtFunding` because credit is cumulative across every quote of the series (delta
     *      S-8), which is also why the check is `>=` rather than `==`: another quote of the same series
     *      may have settled in between, and its credit is not this quote's to reject.
     *
     *      `exactUnits` appears here and ONLY here — as the thing credit is checked against. It is
     *      never a mint quantity. Delta T-1, invariants 2 and 3.
     */
    function allocateChunk(bytes32 quoteId, uint32 start, uint32 count) external onlyKeeper {
        (SettlementQuoteExecution memory execution, SettlementQuoteProvenance memory provenance) =
            _requireQuote(quoteId, KyrveQuoteStatus.CONSUMED);

        bytes32 epochId = provenance.epochId;
        Allocation storage allocation = _allocations[epochId];
        if (allocation.state != AllocationState.Funded && allocation.state != AllocationState.Allocating) {
            revert RoundNotFunded(epochId, allocation.state);
        }
        if (allocation.quoteId == bytes32(0)) {
            allocation.quoteId = quoteId;
        } else if (allocation.quoteId != quoteId) {
            revert EpochAlreadyAllocated(epochId, allocation.quoteId);
        }
        if (allocation.graphRoot != provenance.graphRoot) {
            revert WrongGraphRoot(epochId, allocation.graphRoot, provenance.graphRoot);
        }

        // The quote's market and the pinned one must be the same market, or `creditAtFunding` was
        // read from a different position than the one being compared against.
        if (execution.marketId != MARKET_ID) revert WrongMarket(MARKET_ID, execution.marketId);

        (uint128 credit,,) = VAULT.positionOf(MARKET_ID);
        uint128 grew = credit > allocation.creditAtFunding ? credit - allocation.creditAtFunding : 0;
        if (grew < execution.exactUnits) {
            revert CreditDidNotGrow(quoteId, allocation.creditAtFunding, credit, execution.exactUnits);
        }

        allocation.state = AllocationState.Allocating;
        _requireChunk(start, count, allocation.providerCount);

        uint32 end = start + count;
        for (uint32 slot = start; slot < end; ++slot) {
            address provider = EPOCHS.providerAt(epochId, slot).provider;
            euint256 minted = TOKEN.mintClaim(quoteId, provider, _consumed[epochId][provider]);

            OWNERSHIP.recordClaim(
                quoteId,
                provider,
                SERIES_ID,
                epochId,
                allocation.graphRoot,
                provenance.aggregateFillAmount,
                CUSTODY.lockIdFor(epochId, provider),
                minted
            );

            allocation.mintedCount += 1;
            emit SeriesAllocated(epochId, quoteId, provider);
        }
    }

    // ─────────────────────────────────────────────────────────────────────────────────────────
    // Step 6 · Close, and account the residue
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
        (SettlementQuoteExecution memory execution, SettlementQuoteProvenance memory provenance) =
            _requireQuote(quoteId, KyrveQuoteStatus.CONSUMED);

        Allocation storage allocation = _allocations[provenance.epochId];
        if (allocation.state != AllocationState.Allocating) {
            revert WrongAllocationState(quoteId, AllocationState.Allocating, allocation.state);
        }
        if (allocation.mintedCount != allocation.providerCount) {
            revert NotAllMinted(quoteId, allocation.mintedCount, allocation.providerCount);
        }
        SeriesResidueAccount account = residueAccount;
        if (address(account) == address(0)) revert ResidueAccountNotBound();

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
    // The other ending · a funded round whose quote never settled
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
     *      THE LIMIT, STATED RATHER THAN HIDDEN — delta T-4. Step 2 can only pay out once the public
     *      tokens have physically returned to the custody vault and been re-wrapped, and this contract
     *      cannot compel that: `KyrveSeriesVault.recoverFunding` is Phase 4 code, deployed, and
     *      operator-only. If coverage has not returned, the wrapper's own `transfer` primitive moves
     *      encrypted zero rather than reverting, so the restoration would credit a balance that later
     *      pays nothing. `AggregateSolvencyVerifier` is what makes that observable; this function does
     *      not pretend to prevent it.
     *
     *      Not `onlyKeeper`. A retired quote is a public fact and a stalled keeper must not be able to
     *      hold a provider's capital hostage — the same reasoning that makes
     *      `NoxCurveEngine.cancelEpoch` permissionless after the deadline (PRD invariants 12 and 20).
     */
    function unwindChunk(bytes32 epochId, uint32 start, uint32 count) external {
        Allocation storage allocation = _allocations[epochId];
        if (
            allocation.state != AllocationState.Funded && allocation.state != AllocationState.Allocating
                && allocation.state != AllocationState.Unwound
        ) {
            revert RoundNotFunded(epochId, allocation.state);
        }

        bytes32 quoteId = allocation.quoteId;
        if (quoteId != bytes32(0)) {
            SettlementQuoteExecution memory execution = QUOTES.executionOf(quoteId);
            if (execution.status != KyrveQuoteStatus.CANCELLED && execution.status != KyrveQuoteStatus.EXPIRED) {
                revert QuoteNotRetired(quoteId, execution.status);
            }
        }

        allocation.state = AllocationState.Unwound;
        _requireChunk(start, count, allocation.providerCount);

        uint32 end = start + count;
        for (uint32 slot = start; slot < end; ++slot) {
            address provider = EPOCHS.providerAt(epochId, slot).provider;
            bytes32 lockId = CUSTODY.lockIdFor(epochId, provider);

            if (
                quoteId != bytes32(0)
                    && OWNERSHIP.claimOf(quoteId, provider).state == SeriesOwnershipRegistry.ClaimState.Allocated
            ) {
                TOKEN.burnAllocation(quoteId, provider, _consumed[epochId][provider]);
                OWNERSHIP.unwindClaim(quoteId, provider, lockId);
                allocation.unwoundCount += 1;
            }

            if (CUSTODY.lockStateOf(lockId) == KyrveCustodyVault.LockState.Consumed) {
                CUSTODY.restoreLock(lockId, epochId);
                allocation.restoredCount += 1;
            }
        }

        emit QuoteUnwound(quoteId, allocation.unwoundCount, allocation.restoredCount);
    }

    // ─────────────────────────────────────────────────────────────────────────────────────────
    // Views
    // ─────────────────────────────────────────────────────────────────────────────────────────

    /// @notice One funding round's progress. Keyed on the EPOCH — see the ordering note above.
    function allocationOf(bytes32 epochId) external view returns (Allocation memory) {
        return _allocations[epochId];
    }

    /// @notice The handle one provider's lock became. Granted to the provider and the series token.
    function confidentialConsumedOf(bytes32 epochId, address provider) external view returns (euint256) {
        return _consumed[epochId][provider];
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
        // The quote's maker must be THIS series' vault. Compared against the `immutable` rather than
        // against the vault's self-reported series, so a vault that lied about `SERIES_ID` — or a
        // second vault legitimately serving the same series — cannot route a quote here.
        if (execution.vault != address(VAULT)) revert WrongVaultForSeries(address(VAULT), execution.vault);

        bytes32 deployment = QUOTES.DEPLOYMENT_ID();
        if (provenance.deploymentId != deployment) revert WrongDeployment(deployment, provenance.deploymentId);
    }

    /// @dev The epoch must be finished and its graph sealed. There is no quote yet to compare against;
    ///      the root is recorded here and `allocateChunk` refuses a quote that carries a different one.
    function _requireCompleteEpoch(bytes32 epochId) private view returns (QuoteEpochController.Epoch memory epoch) {
        epoch = EPOCHS.epochOf(epochId);
        if (epoch.stage != QuoteEpochController.Stage.Complete) {
            revert EpochNotComplete(epochId, uint8(epoch.stage));
        }
        if (!GRAPH.isSealed(epochId)) revert GraphNotSealed(epochId);
    }



    function _requireChunk(uint32 start, uint32 count, uint32 providerCount) private pure {
        if (count == 0 || start + count > providerCount) {
            revert ChunkOutOfRange(start, count, providerCount);
        }
    }
}
