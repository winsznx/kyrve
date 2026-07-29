// SPDX-License-Identifier: GPL-2.0-or-later
pragma solidity 0.8.34;

import {IRatifier} from "midnight/interfaces/IRatifier.sol";
import {Offer} from "midnight/interfaces/IMidnight.sol";
import {CALLBACK_SUCCESS} from "midnight/libraries/ConstantsLib.sol";

import {IKyrveQuoteBinding, ActivatedQuote, QuoteStatus} from "./KyrveQuoteBinding.sol";

/// @dev Authenticates that the offer presented to Midnight is byte-for-byte the offer Kyrve
/// activated, and that the caller taking it is the borrower the quote was bound to.
///
/// It deliberately does NOT attempt to enforce fill size, and could not if it tried: `isRatified`
/// is a `view` function that never receives `units`. Size is enforced in
/// `KyrveExactFillVault.onBuy`, which is the only place actual fill size reaches maker code
/// (PRD section 2.4).
///
/// The offer hash covers the ENTIRE `Offer` struct, including the embedded `Market`. Mutating any
/// field — tick, expiry, callback, maxUnits, or any market parameter — changes the hash and is
/// rejected here before Midnight moves any value.
contract KyrveQuoteRatifier is IRatifier {
    error AlteredOffer(bytes32 expected, bytes32 actual);
    error QuoteNotExecutable(bytes32 quoteId);
    error QuoteExpired(uint256 expiry, uint256 nowTs);
    error UnauthorisedTaker(address expected, address actual);
    error ZeroAddress(string field);

    address public immutable MIDNIGHT;
    IKyrveQuoteBinding public immutable BINDING;

    constructor(address midnight, address binding) {
        require(midnight != address(0), ZeroAddress("midnight"));
        require(binding != address(0), ZeroAddress("binding"));
        MIDNIGHT = midnight;
        BINDING = IKyrveQuoteBinding(binding);
    }

    /// @dev `offer.group` carries the quote id, which is also the Midnight consumption group. That
    /// identity is what lets `setConsumed(quoteId, ...)` act as a cancellation primitive.
    function isRatified(Offer memory offer, bytes memory, address taker) external view returns (bytes32) {
        ActivatedQuote memory q = BINDING.quote(offer.group);

        require(q.status == QuoteStatus.Executable, QuoteNotExecutable(offer.group));

        bytes32 presented = keccak256(abi.encode(offer));
        require(presented == q.offerHash, AlteredOffer(q.offerHash, presented));

        require(taker == q.taker, UnauthorisedTaker(q.taker, taker));
        require(block.timestamp <= q.expiry, QuoteExpired(q.expiry, block.timestamp));

        return CALLBACK_SUCCESS;
    }
}
