// SPDX-License-Identifier: GPL-2.0-or-later
pragma solidity 0.8.34;

import {IRatifier} from "midnight/interfaces/IRatifier.sol";
import {Offer} from "midnight/interfaces/IMidnight.sol";
import {CALLBACK_SUCCESS} from "midnight/libraries/ConstantsLib.sol";

import {KyrveQuoteId} from "./KyrveQuoteId.sol";
import {KyrveQuoteRegistry} from "./KyrveQuoteRegistry.sol";
import {QuoteExecution, QuoteProvenance, QuoteStatus} from "./KyrveQuoteTypes.sol";

/**
 * @title KyrveSettlementRatifier
 * @notice Half of the exact-fill composition: authenticates WHICH offer and WHOSE fill, never HOW
 *         MUCH (PRD §13.10).
 *
 * ────────────────────────────────────────────────────────────────────────────────────────────
 * WHAT THIS CAN AND CANNOT DO, STATED SO NOBODY LATER ASSUMES OTHERWISE
 * ────────────────────────────────────────────────────────────────────────────────────────────
 *
 * `IRatifier.isRatified(Offer, bytes, address taker) view returns (bytes32)` receives NO `units`.
 * It is not that Kyrve chose not to check fill size here — it is that fill size is not in scope and
 * a `view` function could not act on it if it were. Midnight permits partial fills
 * (`newConsumed <= offer.maxUnits`), so without a second enforcement point every quote would be
 * fillable at any size up to its maximum. That point is `KyrveSeriesVault.onBuy`, and the two are
 * not redundant. Weakening either makes partial fill possible.
 *
 * ────────────────────────────────────────────────────────────────────────────────────────────
 * THE FIVE CHECKS, AND WHY THE FIRST TWO ARE NOT THE SAME CHECK
 * ────────────────────────────────────────────────────────────────────────────────────────────
 *
 *   1. `keccak256(abi.encode(offer)) == offerHash`. Covers the ENTIRE offer including the embedded
 *      `Market`, so tick, expiry, callback, maxUnits, ratifier, group and every market parameter
 *      are pinned. This is what makes "altered offer" a public revert.
 *   2. `KyrveQuoteId.compute(execution, provenance) == offer.group`. Check 1 proves the offer is
 *      the one whose hash was stored; check 2 proves the STORED TERMS are the terms that quote id
 *      commits to. Without it, a registry entry whose provenance disagreed with its execution would
 *      still ratify, and the graph root, request, universe, epoch and deployment bindings would be
 *      labels rather than constraints. With it, they are folded into the id, which is inside the
 *      hashed offer.
 *   3. The caller is the one approved borrower.
 *   4. The quote is `Executable` — not consumed, not cancelled, not expired, not unknown.
 *   5. Kyrve's own expiry has not passed, and the offer is for THIS chain and THIS Midnight.
 *      Midnight enforces `offer.expiry` itself; Kyrve's expiry is a separate, never-later bound
 *      that the expiry controller acts on, so both are checked.
 *
 * Every failure here is a PUBLIC fault — an unauthorised taker, an altered offer, a replayed quote.
 * No confidential outcome is reachable from this contract, so no revert it can emit is an oracle
 * for anything private (`.claude/rules/security.md`).
 */
contract KyrveSettlementRatifier is IRatifier {
    error AlteredOffer(bytes32 expected, bytes32 actual);
    error QuoteNotExecutable(bytes32 quoteId, uint8 status);
    error QuoteExpired(uint256 expiry, uint256 nowTimestamp);
    error UnauthorisedTaker(address expected, address actual);
    error UnboundQuoteTerms(bytes32 group, bytes32 derived);
    error WrongChain(uint256 expected, uint256 actual);
    error WrongMidnight(address expected, address actual);
    error WrongRatifier(address expected, address actual);
    error ZeroAddress(string field);

    address public immutable MIDNIGHT;
    KyrveQuoteRegistry public immutable REGISTRY;
    /// @dev Read from the registry at construction so a ratifier can never be pointed at a registry
    ///      belonging to a different deployment without the mismatch being visible on chain.
    bytes32 public immutable DEPLOYMENT_ID;

    constructor(address midnight, KyrveQuoteRegistry registry) {
        require(midnight != address(0), ZeroAddress("midnight"));
        require(address(registry) != address(0), ZeroAddress("registry"));
        require(registry.MIDNIGHT() == midnight, WrongMidnight(registry.MIDNIGHT(), midnight));
        MIDNIGHT = midnight;
        REGISTRY = registry;
        DEPLOYMENT_ID = registry.DEPLOYMENT_ID();
    }

    /**
     * @dev `offer.group` IS the quote id. That identity is what lets `setConsumed(quoteId, ...)`
     *      act as a cancellation primitive at the protocol level, and it is what makes check 2
     *      above possible at all.
     */
    function isRatified(Offer memory offer, bytes memory, address taker) external view returns (bytes32) {
        bytes32 quoteId = offer.group;

        QuoteExecution memory execution = REGISTRY.executionOf(quoteId);
        require(execution.status == QuoteStatus.Executable, QuoteNotExecutable(quoteId, uint8(execution.status)));

        bytes32 presented = keccak256(abi.encode(offer));
        require(presented == execution.offerHash, AlteredOffer(execution.offerHash, presented));

        QuoteProvenance memory provenance = REGISTRY.provenanceOf(quoteId);
        require(provenance.deploymentId == DEPLOYMENT_ID, UnboundQuoteTerms(quoteId, provenance.deploymentId));

        bytes32 derived = KyrveQuoteId.compute(execution, provenance);
        require(derived == quoteId, UnboundQuoteTerms(quoteId, derived));

        require(taker == execution.taker, UnauthorisedTaker(execution.taker, taker));
        require(execution.ratifier == address(this), WrongRatifier(address(this), execution.ratifier));
        require(block.timestamp <= execution.expiry, QuoteExpired(execution.expiry, block.timestamp));

        require(offer.market.chainId == block.chainid, WrongChain(block.chainid, offer.market.chainId));
        require(offer.market.midnight == MIDNIGHT, WrongMidnight(MIDNIGHT, offer.market.midnight));

        return CALLBACK_SUCCESS;
    }
}
