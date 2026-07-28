// SPDX-License-Identifier: GPL-2.0-or-later
// Day 0 validation spike. Not a production contract: activation is owner-driven here, whereas the
// product activates from a verified Nox public-decryption proof (PRD section 13.8).
pragma solidity 0.8.34;

import {IBuyCallback} from "midnight/interfaces/ICallbacks.sol";
import {IMidnight, Market} from "midnight/interfaces/IMidnight.sol";
import {CALLBACK_SUCCESS} from "midnight/libraries/ConstantsLib.sol";
import {IKyrveQuoteRegistry, ActivatedQuote, QuoteStatus} from "./KyrveQuoteRegistry.sol";

/// @dev Midnight's own IERC20 omits `approve`; the maker needs it to fund settlement.
interface IERC20Approve {
    function approve(address spender, uint256 amount) external returns (bool);
}

/// @dev The Midnight maker for one Kyrve series, and the second half of the exact-fill defence.
///
/// `onBuy` is the only place in the Midnight settlement path where the actual `units` and
/// `buyerAssets` of an attempted fill become visible to maker-controlled code. Midnight allows
/// partial fills (`newConsumed <= offer.maxUnits`), so exact-fill is enforced here, not in the
/// ratifier. Reverting here reverts the whole `take`, including group consumption and position
/// updates.
contract KyrveSeriesVault is IBuyCallback, IKyrveQuoteRegistry {
    error CallbackCallerNotMidnight();
    error FeeAboveCap();
    error NotActivator();
    error QuoteAlreadyActivated();
    error QuoteNotExecutable();
    error WrongBuyer();
    error WrongBuyerAssets(uint256 expected, uint256 actual);
    error WrongMarket();
    error WrongUnits(uint256 expected, uint256 actual);

    event QuoteActivated(bytes32 indexed quoteId, bytes32 offerHash, uint128 exactUnits);
    event ExactFill(bytes32 indexed quoteId, bytes32 indexed marketId, uint256 units, uint256 buyerAssets);

    address public immutable MIDNIGHT;
    address public immutable ACTIVATOR;

    mapping(bytes32 quoteId => ActivatedQuote) internal _quotes;

    constructor(address midnight, address activator) {
        MIDNIGHT = midnight;
        ACTIVATOR = activator;
    }

    function quote(bytes32 quoteId) external view returns (ActivatedQuote memory) {
        return _quotes[quoteId];
    }

    /// @dev Binds one quote id to one exact offer. In the product this is reached only after a Nox
    /// public-decryption proof has been verified.
    function activateQuote(bytes32 quoteId, ActivatedQuote calldata q) external {
        require(msg.sender == ACTIVATOR, NotActivator());
        require(_quotes[quoteId].status == QuoteStatus.None, QuoteAlreadyActivated());
        _quotes[quoteId] = q;
        emit QuoteActivated(quoteId, q.offerHash, q.exactUnits);
    }

    /// @dev Authorises the ratifier on behalf of this maker. Midnight requires
    /// `isAuthorized[offer.maker][offer.ratifier]` before it will call the ratifier at all.
    function authoriseRatifier(address ratifier, bool authorised) external {
        require(msg.sender == ACTIVATOR, NotActivator());
        IMidnight(MIDNIGHT).setIsAuthorized(ratifier, authorised, address(this));
    }

    function onBuy(
        bytes32 id,
        Market memory market,
        uint256 buyerAssets,
        uint256 units,
        uint256 pendingFeeIncrease,
        address buyer,
        bytes memory data
    ) external returns (bytes32) {
        require(msg.sender == MIDNIGHT, CallbackCallerNotMidnight());

        bytes32 quoteId = abi.decode(data, (bytes32));
        ActivatedQuote storage q = _quotes[quoteId];

        require(q.status == QuoteStatus.Executable, QuoteNotExecutable());
        require(buyer == address(this), WrongBuyer());
        require(id == q.marketId, WrongMarket());
        require(units == q.exactUnits, WrongUnits(q.exactUnits, units));
        require(buyerAssets == q.expectedBuyerAssets, WrongBuyerAssets(q.expectedBuyerAssets, buyerAssets));
        require(pendingFeeIncrease <= q.maxPendingFee, FeeAboveCap());

        // Effects before the interaction below, and before Midnight pulls the assets.
        q.status = QuoteStatus.Consumed;

        IERC20Approve(market.loanToken).approve(MIDNIGHT, buyerAssets);

        emit ExactFill(quoteId, id, units, buyerAssets);
        return CALLBACK_SUCCESS;
    }
}
