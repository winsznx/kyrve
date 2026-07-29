// SPDX-License-Identifier: GPL-2.0-or-later
pragma solidity 0.8.34;

import {KyrveQuoteRegistry} from "./KyrveQuoteRegistry.sol";
import {KyrveSeriesVault} from "./KyrveSeriesVault.sol";
import {QuoteExecution, QuoteStatus} from "./KyrveQuoteTypes.sol";

/**
 * @title KyrveQuoteExpiryController
 * @notice Decides WHO may end a live quote and WHEN. The vault performs the ending; this contract
 *         is the entire policy (PRD §14.4).
 *
 * ────────────────────────────────────────────────────────────────────────────────────────────
 * TWO WAYS A QUOTE ENDS WITHOUT SETTLING, AND WHY THEY ARE NOT ONE FUNCTION
 * ────────────────────────────────────────────────────────────────────────────────────────────
 *
 *   CANCELLATION   deliberate, by the operator, while the window is still open. The operator has a
 *                  reason the protocol cannot see — a market halt, a mispriced universe, a
 *                  borrower who has gone away. It is permissioned because a permissionless
 *                  cancellation would let any observer grief a live quote.
 *
 *   EXPIRY         mechanical, by anyone, once the window has closed. It is PERMISSIONLESS on
 *                  purpose: an expired quote still holds committed funding in the vault, and
 *                  capital that only an operator can release is capital hostage to that operator's
 *                  uptime. The same reasoning makes `NoxCurveEngine.cancelEpoch` permissionless
 *                  after its deadline (PRD invariants 12 and 20).
 *
 * The boundary is `block.timestamp > expiry`, strictly. The ratifier admits a fill at exactly
 * `expiry` (`block.timestamp <= expiry`), so an expiry that triggered at `== expiry` would create a
 * block in which a quote is simultaneously fillable and recoverable. Off by one here is a race
 * between a borrower and a keeper over the same units.
 *
 * ────────────────────────────────────────────────────────────────────────────────────────────
 * WHAT THIS CONTRACT CANNOT DO
 * ────────────────────────────────────────────────────────────────────────────────────────────
 *
 * It cannot activate a quote, cannot move a token, cannot change a quote's terms and cannot reach
 * any vault function other than {KyrveSeriesVault.retireQuote}. It holds no funds and has no
 * upgrade path. The operator address is immutable — a settable one would be an owner by another
 * name, able to hand cancellation rights to anybody at any time.
 */
contract KyrveQuoteExpiryController {
    error NotOperator(address caller, address expected);
    error NotYetExpired(bytes32 quoteId, uint40 expiry, uint256 nowTimestamp);
    error QuoteNotExecutable(bytes32 quoteId, uint8 status);
    error ZeroAddress(string field);

    event QuoteCancelled(bytes32 indexed quoteId, address indexed vault, address indexed by);
    event QuoteExpired(bytes32 indexed quoteId, address indexed vault, address indexed by, uint40 expiry);

    KyrveQuoteRegistry public immutable REGISTRY;
    /// @notice The only address that may cancel a quote before its expiry. Immutable by design.
    address public immutable OPERATOR;

    constructor(KyrveQuoteRegistry registry, address operator) {
        require(address(registry) != address(0), ZeroAddress("registry"));
        require(operator != address(0), ZeroAddress("operator"));
        REGISTRY = registry;
        OPERATOR = operator;
    }

    /// @notice Retires a live quote before its window closes. Operator only.
    function cancelQuote(bytes32 quoteId) external {
        require(msg.sender == OPERATOR, NotOperator(msg.sender, OPERATOR));
        KyrveSeriesVault vault = _requireLiveVault(quoteId);

        vault.retireQuote(quoteId, QuoteStatus.Cancelled);
        emit QuoteCancelled(quoteId, address(vault), msg.sender);
    }

    /// @notice Retires a quote whose window has closed, and releases the vault's committed funding.
    ///         Permissionless.
    function expireQuote(bytes32 quoteId) external {
        QuoteExecution memory execution = REGISTRY.executionOf(quoteId);
        require(execution.status == QuoteStatus.Executable, QuoteNotExecutable(quoteId, uint8(execution.status)));
        require(block.timestamp > execution.expiry, NotYetExpired(quoteId, execution.expiry, block.timestamp));

        KyrveSeriesVault vault = KyrveSeriesVault(execution.vault);
        vault.retireQuote(quoteId, QuoteStatus.Expired);
        emit QuoteExpired(quoteId, execution.vault, msg.sender, execution.expiry);
    }

    function _requireLiveVault(bytes32 quoteId) private view returns (KyrveSeriesVault) {
        QuoteExecution memory execution = REGISTRY.executionOf(quoteId);
        require(execution.status == QuoteStatus.Executable, QuoteNotExecutable(quoteId, uint8(execution.status)));
        return KyrveSeriesVault(execution.vault);
    }
}
