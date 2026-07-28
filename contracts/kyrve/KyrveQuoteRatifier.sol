// SPDX-License-Identifier: GPL-2.0-or-later
// Day 0 validation spike. Not a production contract.
pragma solidity 0.8.34;

import {IRatifier} from "midnight/interfaces/IRatifier.sol";
import {Offer} from "midnight/interfaces/IMidnight.sol";
import {CALLBACK_SUCCESS} from "midnight/libraries/ConstantsLib.sol";
import {IKyrveQuoteRegistry, ActivatedQuote, QuoteStatus} from "./KyrveQuoteRegistry.sol";

/// @dev Authenticates that the offer presented to Midnight is byte-for-byte the offer Kyrve activated,
/// and that the caller taking it is the borrower the quote was bound to.
///
/// It deliberately does NOT attempt to enforce fill size: `isRatified` is a `view` function that never
/// receives `units`. Size is enforced by the series vault's `onBuy` callback. PRD section 2.4.
contract KyrveQuoteRatifier is IRatifier {
    error AlteredOffer();
    error QuoteNotExecutable();
    error QuoteExpired();
    error UnauthorisedTaker();

    address public immutable MIDNIGHT;
    IKyrveQuoteRegistry public immutable REGISTRY;

    constructor(address midnight, address registry) {
        MIDNIGHT = midnight;
        REGISTRY = IKyrveQuoteRegistry(registry);
    }

    /// @dev `offer.group` carries the quote id, which is also the Midnight consumption group.
    function isRatified(Offer memory offer, bytes memory, address taker) external view returns (bytes32) {
        ActivatedQuote memory q = REGISTRY.quote(offer.group);

        require(q.status == QuoteStatus.Executable, QuoteNotExecutable());
        require(keccak256(abi.encode(offer)) == q.offerHash, AlteredOffer());
        require(taker == q.taker, UnauthorisedTaker());
        require(block.timestamp <= q.expiry, QuoteExpired());

        return CALLBACK_SUCCESS;
    }
}
