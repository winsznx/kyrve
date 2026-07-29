// SPDX-License-Identifier: GPL-2.0-or-later
pragma solidity 0.8.34;

import {QuoteExecution, QuoteProvenance} from "./KyrveQuoteTypes.sol";

/**
 * @title KyrveQuoteId
 * @notice The identifier that makes every binding in PRD §14.1 structural rather than nominal.
 *
 * ────────────────────────────────────────────────────────────────────────────────────────────
 * WHY THE ID IS A FOLD OVER EVERYTHING, AND WHY THAT IS THE WHOLE DESIGN
 * ────────────────────────────────────────────────────────────────────────────────────────────
 *
 * `offer.group` carries the quote id, and `offer` is hashed into `offerHash`, which the ratifier
 * compares byte-for-byte. So the quote id is inside the signed-over offer whether anyone checks it
 * or not. Making it a fold over every provenance and execution term turns that into a real check:
 * the ratifier RE-DERIVES the id from the registry's stored terms and compares it to `offer.group`.
 *
 * The consequence is that a quote cannot be assembled from parts of two different quotes. Change
 * the epoch, the graph root, the request, the universe, the selected market or rate, the aggregate,
 * the tick, the units, the buyer assets, the fee cap, the expiry, the borrower, the vault, the
 * ratifier or the deployment, and the id changes — so `offer.group` changes, so `offerHash`
 * changes, so the ratifier's byte comparison fails before Midnight moves any value.
 *
 * `offerHash` is deliberately NOT folded in: the offer contains the group, which is this id, so
 * including it would be circular.
 *
 * The domain string is versioned. A future settlement revision that changes the fold must change
 * the version too, so an id from one revision can never be mistaken for an id from another.
 */
library KyrveQuoteId {
    string internal constant DOMAIN = "kyrve.quote.v1";

    function compute(QuoteExecution memory execution, QuoteProvenance memory provenance)
        internal
        pure
        returns (bytes32)
    {
        return keccak256(
            abi.encode(
                DOMAIN,
                provenance.deploymentId,
                provenance.epochId,
                provenance.graphRoot,
                provenance.requestId,
                provenance.universeId,
                provenance.marketStructHash,
                provenance.aggregateFillAmount,
                provenance.tick,
                provenance.marketIndex,
                provenance.rateIndex,
                provenance.leafIndex,
                execution.marketId,
                execution.exactUnits,
                execution.expectedBuyerAssets,
                execution.maxPendingFee,
                execution.expiry,
                execution.taker,
                execution.vault,
                execution.ratifier
            )
        );
    }
}
