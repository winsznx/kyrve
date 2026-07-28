// SPDX-License-Identifier: GPL-2.0-or-later
pragma solidity 0.8.34;

import {IBuyCallback} from "midnight/interfaces/ICallbacks.sol";
import {IMidnight, Market} from "midnight/interfaces/IMidnight.sol";
import {CALLBACK_SUCCESS} from "midnight/libraries/ConstantsLib.sol";

import {IKyrveQuoteBinding, ActivatedQuote, QuoteStatus} from "./KyrveQuoteBinding.sol";

/// @dev Midnight's own `IERC20` omits `approve`; the maker needs it to fund settlement.
interface IERC20Approve {
    function approve(address spender, uint256 amount) external returns (bool);
}

/// @dev The permanent exact-fill regression harness: a Midnight maker that enforces exact fill.
///
/// NAMING. This is deliberately NOT called `KyrveSeriesVault`. It is the enforcement half of the
/// settlement path and nothing else — it holds no confidential state, mints no ERC-7984 series
/// token, tracks no provider allocations and performs no Nox operations. The production series
/// vault belongs to a later phase. Naming this contract as though it were the product would make
/// the regression suite appear to cover far more than it does.
///
/// WHY THE CHECK LIVES HERE. Midnight permits partial fills (`newConsumed <= offer.maxUnits`), and
/// `IRatifier.isRatified` is `view` and never receives `units` — so a ratifier can authenticate an
/// offer but is structurally incapable of enforcing its size. `onBuy` is the only point on the
/// settlement path where the actual `units` and `buyerAssets` of an attempted fill become visible
/// to maker-controlled code. Reverting here reverts the entire `take`, rolling back group
/// consumption, vault credit and borrower debt together.
///
/// ACTIVATION. `activateQuote` is driven by a trusted activator here. In the product this is
/// reached only after a Nox public-decryption proof has been verified AND the decrypted handle has
/// been shown to be the handle derived from that request's sealed operation graph — a valid proof
/// alone proves nothing about which quote a value belongs to (PRD v1.1 A-11).
contract KyrveExactFillVault is IBuyCallback, IKyrveQuoteBinding {
    error CallbackCallerNotMidnight(address caller);
    error FeeAboveCap(uint256 cap, uint256 actual);
    error NotActivator(address caller);
    error QuoteAlreadyActivated(bytes32 quoteId);
    error QuoteNotExecutable(bytes32 quoteId);
    error WrongBuyer(address expected, address actual);
    error WrongBuyerAssets(uint256 expected, uint256 actual);
    error WrongMarket(bytes32 expected, bytes32 actual);
    error WrongUnits(uint256 expected, uint256 actual);

    event QuoteActivated(bytes32 indexed quoteId, bytes32 offerHash, uint128 exactUnits);
    event QuoteCancelled(bytes32 indexed quoteId, uint128 consumedAmount);
    event ExactFill(bytes32 indexed quoteId, bytes32 indexed marketId, uint256 units, uint256 buyerAssets);

    address public immutable MIDNIGHT;
    address public immutable ACTIVATOR;

    mapping(bytes32 quoteId => ActivatedQuote) internal _quotes;

    constructor(address midnight, address activator) {
        MIDNIGHT = midnight;
        ACTIVATOR = activator;
    }

    modifier onlyActivator() {
        require(msg.sender == ACTIVATOR, NotActivator(msg.sender));
        _;
    }

    function quote(bytes32 quoteId) external view returns (ActivatedQuote memory) {
        return _quotes[quoteId];
    }

    /// @dev Binds one quote id to one exact offer. A quote id is never reusable, even after the
    /// quote is consumed or cancelled, so a settled quote can never be resurrected.
    function activateQuote(bytes32 quoteId, ActivatedQuote calldata q) external onlyActivator {
        require(_quotes[quoteId].status == QuoteStatus.None, QuoteAlreadyActivated(quoteId));
        _quotes[quoteId] = q;
        emit QuoteActivated(quoteId, q.offerHash, q.exactUnits);
    }

    /// @dev Midnight requires `isAuthorized[offer.maker][offer.ratifier]` before it will call the
    /// ratifier at all; without this, `take` reverts `RatifierUnauthorized` (PRD v1.1 A-2).
    function authoriseRatifier(address ratifier, bool authorised) external onlyActivator {
        IMidnight(MIDNIGHT).setIsAuthorized(ratifier, authorised, address(this));
    }

    /// @dev Retires an activated quote immediately rather than waiting out its expiry window.
    ///
    /// Because `offer.group == quoteId`, pre-consuming the group through Midnight's own
    /// `setConsumed` makes the offer unfillable at the protocol level and releases the reserved
    /// capital at once (PRD v1.1 A-5). Flipping local status alone would not be sufficient: that
    /// stops this vault honouring the quote, but the group is what Midnight itself accounts
    /// against, and an offer is only truly dead once the group is consumed.
    function cancelQuote(bytes32 quoteId) external onlyActivator {
        ActivatedQuote storage q = _quotes[quoteId];
        require(q.status == QuoteStatus.Executable, QuoteNotExecutable(quoteId));

        // Effects before the interaction.
        q.status = QuoteStatus.Expired;
        uint128 amount = q.exactUnits;

        IMidnight(MIDNIGHT).setConsumed(quoteId, amount, address(this));
        emit QuoteCancelled(quoteId, amount);
    }

    /// @dev The exact-fill enforcement point. Every check below has a paired attack test.
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
        ActivatedQuote storage q = _quotes[quoteId];

        require(q.status == QuoteStatus.Executable, QuoteNotExecutable(quoteId));
        require(buyer == address(this), WrongBuyer(address(this), buyer));
        require(id == q.marketId, WrongMarket(q.marketId, id));
        require(units == q.exactUnits, WrongUnits(q.exactUnits, units));
        require(buyerAssets == q.expectedBuyerAssets, WrongBuyerAssets(q.expectedBuyerAssets, buyerAssets));
        require(pendingFeeIncrease <= q.maxPendingFee, FeeAboveCap(q.maxPendingFee, pendingFeeIncrease));

        // Checks, then effects, then interactions. The quote is marked consumed BEFORE the
        // approval below and before Midnight pulls the assets, so a re-entrant take cannot settle
        // the same quote twice.
        q.status = QuoteStatus.Consumed;

        IERC20Approve(market.loanToken).approve(MIDNIGHT, buyerAssets);

        emit ExactFill(quoteId, id, units, buyerAssets);
        return CALLBACK_SUCCESS;
    }
}
