// SPDX-License-Identifier: GPL-2.0-or-later
pragma solidity 0.8.34;

import {QuoteExecution, QuoteProvenance, QuoteStatus} from "./KyrveQuoteTypes.sol";

/**
 * @title KyrveQuoteRegistry
 * @notice The one place a quote's lifecycle is decided, and the one state both enforcement points
 *         read (PRD §14.2).
 *
 * ────────────────────────────────────────────────────────────────────────────────────────────
 * WHY THE STATE LIVES HERE AND NOT IN THE VAULT
 * ────────────────────────────────────────────────────────────────────────────────────────────
 *
 * Exact-fill enforcement is split across two contracts and cannot be otherwise:
 * `IRatifier.isRatified` is `view` and never receives `units`, so it can authenticate an offer but
 * is structurally incapable of enforcing its size; `IBuyCallback.onBuy` is the only point where an
 * attempted fill's actual `units` reaches maker code. Both must therefore agree on whether the
 * quote is still live — and `KyrveSeriesFactory` deploys one vault per series, so "the vault" is
 * not a single address the ratifier could be pinned to.
 *
 * One registry, one status word, read by both. A quote that is `Consumed` in the registry is
 * refused by the ratifier before Midnight moves any value, and refused again by the callback if
 * anything were ever to reach it.
 *
 * ────────────────────────────────────────────────────────────────────────────────────────────
 * THE THREE WRITERS, AND WHY EACH IS NARROWER THAN AN OWNER
 * ────────────────────────────────────────────────────────────────────────────────────────────
 *
 *   {activate}      the activator, once per quote id and once per epoch id. It is the only address
 *                   that may create state here, and it is bound once and never re-bindable.
 *   {markConsumed}  the quote's OWN vault, and only from `None`-free `Executable`. Not "any
 *                   registered vault": the vault address is written into the quote at activation
 *                   and compared on the way in, so a second series' vault cannot consume a quote it
 *                   was never the maker for.
 *   {retire}        the quote's own vault again, carrying a terminal status decided by the expiry
 *                   controller. The vault is in the path because retirement must also pre-consume
 *                   the Midnight group, and only the maker can do that.
 *
 * There is no owner, no pause, no upgrade and no arbitrary-call surface. A quote id is consumed
 * forever the first time it is used, in every terminal state, so no settled, cancelled or expired
 * quote can be resurrected.
 *
 * ────────────────────────────────────────────────────────────────────────────────────────────
 * PUBLIC / PRIVATE BOUNDARY
 * ────────────────────────────────────────────────────────────────────────────────────────────
 *
 *   PUBLIC ON ACTIVATION   everything stored here. See `KyrveQuoteTypes`.
 *   PRIVATE                nothing is stored here that was ever private, and nothing can be: this
 *                          contract holds no handle, performs no Nox operation and imports no
 *                          confidential type.
 */
contract KyrveQuoteRegistry {
    error ActivatorAlreadyBound(address existing);
    error ActivatorNotBound();
    error EpochAlreadyQuoted(bytes32 epochId, bytes32 quoteId);
    error ExpiryControllerAlreadyBound(address existing);
    error NotActivator(address caller, address expected);
    error NotDeployer(address caller, address expected);
    error NotQuoteVault(bytes32 quoteId, address caller, address expected);
    error NotTerminalStatus(uint8 status);
    error QuoteAlreadyActivated(bytes32 quoteId, uint8 status);
    error QuoteNotExecutable(bytes32 quoteId, uint8 status);
    error UnknownQuote(bytes32 quoteId);
    error ZeroAddress(string field);
    error ZeroValue(string field);

    event ActivatorBound(address indexed activator);
    event ExpiryControllerBound(address indexed expiryController);
    event QuoteActivated(
        bytes32 indexed quoteId, bytes32 indexed epochId, address indexed vault, bytes32 offerHash, uint128 exactUnits
    );
    event QuoteConsumed(bytes32 indexed quoteId, address indexed vault, uint128 exactUnits);
    event QuoteRetired(bytes32 indexed quoteId, address indexed vault, QuoteStatus status);

    /// @dev Pinned at construction. Every callback and every group consumption is checked against
    ///      it, and it can never come from mutable storage on a hot path.
    address public immutable MIDNIGHT;
    address public immutable DEPLOYER;

    /**
     * @notice Identifies this settlement deployment, and is folded into every quote id.
     * @dev `keccak256(chainId, registry, midnight)`. The registry address is unique per deployment
     *      and the whole settlement wiring is reachable from it, so this is a complete identifier
     *      even though it names only three things. A quote activated against one deployment
     *      presents a quote id that no other deployment's registry knows, which is why "wrong
     *      deployment" fails as `QuoteNotExecutable` rather than as a value mismatch.
     */
    bytes32 public immutable DEPLOYMENT_ID;

    /// @notice Bound once, by the deployer, never re-bindable. Same shape as the curve layer's
    ///         `bindEngine`: the activator needs the registry's address at construction, so one of
    ///         the two references cannot be a constructor argument.
    address public activator;
    address public expiryController;

    mapping(bytes32 quoteId => QuoteExecution) private _execution;
    mapping(bytes32 quoteId => QuoteProvenance) private _provenance;

    /// @notice One epoch produces at most one quote, forever. The check that makes duplicate
    ///         activation impossible even if the activator were called twice with different terms.
    mapping(bytes32 epochId => bytes32 quoteId) public quoteOfEpoch;

    constructor(address midnight) {
        require(midnight != address(0), ZeroAddress("midnight"));
        MIDNIGHT = midnight;
        DEPLOYER = msg.sender;
        DEPLOYMENT_ID = keccak256(abi.encode(block.chainid, address(this), midnight));
    }

    // ─────────────────────────────────────────────────────────────────────────────────────────
    // One-shot wiring
    // ─────────────────────────────────────────────────────────────────────────────────────────

    function bindActivator(address activator_) external {
        require(msg.sender == DEPLOYER, NotDeployer(msg.sender, DEPLOYER));
        require(activator == address(0), ActivatorAlreadyBound(activator));
        require(activator_ != address(0), ZeroAddress("activator"));
        activator = activator_;
        emit ActivatorBound(activator_);
    }

    function bindExpiryController(address expiryController_) external {
        require(msg.sender == DEPLOYER, NotDeployer(msg.sender, DEPLOYER));
        require(expiryController == address(0), ExpiryControllerAlreadyBound(expiryController));
        require(expiryController_ != address(0), ZeroAddress("expiryController"));
        expiryController = expiryController_;
        emit ExpiryControllerBound(expiryController_);
    }

    // ─────────────────────────────────────────────────────────────────────────────────────────
    // Lifecycle
    // ─────────────────────────────────────────────────────────────────────────────────────────

    /**
     * @notice Binds one quote id to one exact offer, one exact fill and one exact borrower.
     * @dev The caller supplies terms; this contract supplies the STATUS. Accepting a status from
     *      the activator would make `Executable` something the activator could assert about an
     *      already-consumed quote, so it is written here and only here.
     */
    function activate(bytes32 quoteId, QuoteExecution calldata execution, QuoteProvenance calldata provenance)
        external
    {
        address bound = activator;
        require(bound != address(0), ActivatorNotBound());
        require(msg.sender == bound, NotActivator(msg.sender, bound));

        QuoteExecution storage stored = _execution[quoteId];
        require(stored.status == QuoteStatus.None, QuoteAlreadyActivated(quoteId, uint8(stored.status)));

        bytes32 existing = quoteOfEpoch[provenance.epochId];
        require(existing == bytes32(0), EpochAlreadyQuoted(provenance.epochId, existing));

        require(execution.vault != address(0), ZeroAddress("vault"));
        require(execution.ratifier != address(0), ZeroAddress("ratifier"));
        require(execution.taker != address(0), ZeroAddress("taker"));
        require(execution.exactUnits != 0, ZeroValue("exactUnits"));
        require(execution.expectedBuyerAssets != 0, ZeroValue("expectedBuyerAssets"));
        require(execution.offerHash != bytes32(0), ZeroValue("offerHash"));

        stored.offerHash = execution.offerHash;
        stored.marketId = execution.marketId;
        stored.exactUnits = execution.exactUnits;
        stored.expectedBuyerAssets = execution.expectedBuyerAssets;
        stored.maxPendingFee = execution.maxPendingFee;
        stored.expiry = execution.expiry;
        stored.activatedAt = uint40(block.timestamp);
        stored.status = QuoteStatus.Executable;
        stored.taker = execution.taker;
        stored.vault = execution.vault;
        stored.ratifier = execution.ratifier;

        _provenance[quoteId] = provenance;
        quoteOfEpoch[provenance.epochId] = quoteId;

        emit QuoteActivated(quoteId, provenance.epochId, execution.vault, execution.offerHash, execution.exactUnits);
    }

    /**
     * @notice Marks the quote settled. Called from inside `onBuy`, BEFORE the vault approves any
     *         token and before Midnight pulls anything.
     * @dev Checks, then effects, then interactions, spanning two contracts. A re-entrant `take`
     *      reaches the ratifier, which reads `Consumed` here and refuses — the reason the ordering
     *      is stated as an invariant rather than left to the caller.
     */
    function markConsumed(bytes32 quoteId) external {
        QuoteExecution storage stored = _requireExecutable(quoteId);
        require(msg.sender == stored.vault, NotQuoteVault(quoteId, msg.sender, stored.vault));

        stored.status = QuoteStatus.Consumed;
        emit QuoteConsumed(quoteId, stored.vault, stored.exactUnits);
    }

    /**
     * @notice Ends an unsettled quote, either by deliberate cancellation or by expiry recovery.
     * @dev Only the quote's own vault, because retirement must also pre-consume the Midnight group
     *      and only the maker can call `setConsumed`. The vault is what enforces WHO asked; this
     *      contract enforces that the resulting status is terminal and that the quote was live.
     */
    function retire(bytes32 quoteId, QuoteStatus terminal) external {
        require(
            terminal == QuoteStatus.Cancelled || terminal == QuoteStatus.Expired, NotTerminalStatus(uint8(terminal))
        );

        QuoteExecution storage stored = _requireExecutable(quoteId);
        require(msg.sender == stored.vault, NotQuoteVault(quoteId, msg.sender, stored.vault));

        stored.status = terminal;
        emit QuoteRetired(quoteId, stored.vault, terminal);
    }

    // ─────────────────────────────────────────────────────────────────────────────────────────
    // Views
    // ─────────────────────────────────────────────────────────────────────────────────────────

    function executionOf(bytes32 quoteId) external view returns (QuoteExecution memory) {
        return _execution[quoteId];
    }

    function provenanceOf(bytes32 quoteId) external view returns (QuoteProvenance memory) {
        return _provenance[quoteId];
    }

    function statusOf(bytes32 quoteId) external view returns (QuoteStatus) {
        return _execution[quoteId].status;
    }

    /// @notice Reverts unless the quote exists. Used by the terminal and by verification scripts,
    ///         which must never read a zeroed struct and report it as a quote.
    function requireKnown(bytes32 quoteId) external view returns (QuoteExecution memory) {
        QuoteExecution memory stored = _execution[quoteId];
        require(stored.status != QuoteStatus.None, UnknownQuote(quoteId));
        return stored;
    }

    function _requireExecutable(bytes32 quoteId) private view returns (QuoteExecution storage stored) {
        stored = _execution[quoteId];
        require(stored.status == QuoteStatus.Executable, QuoteNotExecutable(quoteId, uint8(stored.status)));
    }
}
