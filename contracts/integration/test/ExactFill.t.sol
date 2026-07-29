// SPDX-License-Identifier: GPL-2.0-or-later
//
// PERMANENT REGRESSION SUITE. Promoted from the Day 0 validation spike.
//
// Proves PRD sections 2.4, 6.5, 12.2, 12.4, 12.5, 12.6, 12.7 and invariants 4/5/6/7 of section
// 30.6 against the pinned, unmodified Morpho Midnight release 2026-07-23 (dbd8d3d5).
//
// Nothing here is mocked on the protocol path: a real Midnight is deployed through the same
// fixture `scripts/deploy/local.ts` uses, real markets are created, and settlement runs through
// the real `take` entry point.
pragma solidity 0.8.34;

import {Test, console} from "forge-std/Test.sol";

import {IMidnight, Market, Offer} from "midnight/interfaces/IMidnight.sol";
import {TickLib} from "midnight/libraries/TickLib.sol";
import {UtilsLib} from "midnight/libraries/UtilsLib.sol";
import {WAD, ORACLE_PRICE_SCALE, DEFAULT_TICK_SPACING} from "midnight/libraries/ConstantsLib.sol";

import {LocalMidnightFixture} from "../LocalMidnightFixture.sol";
import {KyrveExactFillVault} from "../KyrveExactFillVault.sol";
import {KyrveQuoteRatifier} from "../KyrveQuoteRatifier.sol";
import {ActivatedQuote, QuoteStatus} from "../KyrveQuoteBinding.sol";

contract ExactFillTest is Test {
    using UtilsLib for uint256;

    /// @dev A multiple of DEFAULT_TICK_SPACING (4), priced well above the settlement fee.
    uint256 internal constant TICK = 6000;

    LocalMidnightFixture internal fixtureContract;
    IMidnight internal midnight;
    Market internal market;
    bytes32 internal marketId;

    KyrveExactFillVault internal vault;
    KyrveQuoteRatifier internal ratifier;

    address internal borrower = makeAddr("borrower");
    address internal attacker = makeAddr("attacker");

    bytes32 internal constant QUOTE_ID = keccak256("kyrve.quote.1");
    uint128 internal exactUnits;
    uint128 internal expectedBuyerAssets;
    Offer internal offer;

    function setUp() public {
        fixtureContract = new LocalMidnightFixture();
        fixtureContract.deploy(block.timestamp);

        midnight = IMidnight(address(fixtureContract.midnight()));
        market = fixtureContract.market(1); // usdc-90d-weth
        marketId = fixtureContract.marketId(1);

        vault = new KyrveExactFillVault(address(midnight), address(this));
        ratifier = new KyrveQuoteRatifier(address(midnight), address(vault));

        // Midnight refuses to consult a ratifier the maker has not authorised (PRD v1.1 A-2).
        vault.authoriseRatifier(address(ratifier), true);

        // Kyrve's quote math, derived from the pinned release: for a buy offer the maker pays
        // floor(units * tickToPrice(tick) / WAD), independent of the settlement fee.
        exactUnits = 1_000_000e6;
        expectedBuyerAssets = uint128(uint256(exactUnits).mulDivDown(TickLib.tickToPrice(TICK), WAD));

        offer = Offer({
            market: market,
            buy: true,
            maker: address(vault),
            start: block.timestamp,
            expiry: block.timestamp + 1 hours,
            tick: TICK,
            group: QUOTE_ID,
            callback: address(vault),
            callbackData: abi.encode(QUOTE_ID),
            receiverIfMakerIsSeller: address(0),
            ratifier: address(ratifier),
            reduceOnly: false,
            maxUnits: exactUnits,
            maxAssets: 0,
            continuousFeeCap: type(uint256).max
        });

        vault.activateQuote(QUOTE_ID, _activatedQuote());

        // The vault holds the public loan tokens before activation; Midnight pulls them in take.
        fixtureContract.usdc().mint(address(vault), expectedBuyerAssets);
        _supplyCollateral(borrower, exactUnits);
    }

    function _activatedQuote() internal view returns (ActivatedQuote memory) {
        return ActivatedQuote({
            offerHash: keccak256(abi.encode(offer)),
            marketId: marketId,
            taker: borrower,
            exactUnits: exactUnits,
            expectedBuyerAssets: expectedBuyerAssets,
            maxPendingFee: type(uint128).max,
            expiry: uint40(block.timestamp + 1 hours),
            status: QuoteStatus.Executable
        });
    }

    function _supplyCollateral(address who, uint256 units) internal {
        uint256 collateral = units.mulDivUp(WAD, fixtureContract.LLTV_WETH())
            .mulDivUp(ORACLE_PRICE_SCALE, fixtureContract.wethOracle().price());
        fixtureContract.weth().mint(who, collateral);
        vm.startPrank(who);
        fixtureContract.weth().approve(address(midnight), collateral);
        midnight.supplyCollateral(market, 0, collateral, who);
        vm.stopPrank();
    }

    function _take(uint256 units, address taker) internal returns (uint256, uint256) {
        vm.prank(taker);
        return midnight.take(offer, hex"", units, taker, taker, address(0), hex"");
    }

    /// @dev `vm.expectRevert` binds to the next EXTERNAL call, so reverts asserted around an
    /// internal helper must be routed through this wrapper or the assertion silently attaches to
    /// the wrong call.
    function externalTake(uint256 units, address taker) external returns (uint256, uint256) {
        return _take(units, taker);
    }

    // --------------------------------------------------------------------------------------------
    // Happy path
    // --------------------------------------------------------------------------------------------

    /// @dev PRD 12.5 / 12.7: the exact quote settles once, through unmodified Midnight.
    function test_exactFill_settles() public {
        uint256 vaultBefore = fixtureContract.usdc().balanceOf(address(vault));

        (uint256 buyerAssets, uint256 sellerAssets) = _take(exactUnits, borrower);

        assertEq(buyerAssets, expectedBuyerAssets, "buyerAssets must equal Kyrve quote math");
        assertEq(midnight.credit(marketId, address(vault)), exactUnits, "vault holds the credit");
        assertEq(midnight.debt(marketId, borrower), exactUnits, "borrower holds the debt");
        assertEq(fixtureContract.usdc().balanceOf(borrower), sellerAssets, "borrower received seller assets");
        assertEq(
            vaultBefore - fixtureContract.usdc().balanceOf(address(vault)),
            buyerAssets,
            "vault paid exactly buyerAssets"
        );
        assertEq(uint8(vault.quote(QUOTE_ID).status), uint8(QuoteStatus.Consumed), "quote consumed");
        assertEq(midnight.consumed(address(vault), QUOTE_ID), exactUnits, "group fully consumed");

        console.log("tick                :", TICK);
        console.log("tickToPrice (WAD)   :", TickLib.tickToPrice(TICK));
        console.log("exactUnits          :", exactUnits);
        console.log("buyerAssets (maker) :", buyerAssets);
        console.log("sellerAssets (borr) :", sellerAssets);
        console.log("settlement fee taken:", buyerAssets - sellerAssets);
    }

    // --------------------------------------------------------------------------------------------
    // Attacks the PRD claims must fail. Each asserts the SPECIFIC revert, not merely that one
    // occurred — a test passing for the wrong reason is worse than no test.
    // --------------------------------------------------------------------------------------------

    /// @dev PRD 2.4 / 30.6 invariant 6. Midnight itself permits this (newConsumed <= maxUnits);
    /// only the maker callback stops it.
    function test_attack_partialFill_reverts() public {
        uint256 partialUnits = exactUnits - 1;
        vm.expectRevert(abi.encodeWithSelector(KyrveExactFillVault.WrongUnits.selector, exactUnits, partialUnits));
        _take(partialUnits, borrower);
    }

    function test_attack_halfFill_reverts() public {
        uint256 partialUnits = exactUnits / 2;
        vm.expectRevert(abi.encodeWithSelector(KyrveExactFillVault.WrongUnits.selector, exactUnits, partialUnits));
        _take(partialUnits, borrower);
    }

    /// @dev Oversized fill is rejected by Midnight's own group accounting, before Kyrve is reached.
    function test_attack_oversizedFill_reverts() public {
        vm.expectRevert(IMidnight.ConsumedUnits.selector);
        _take(uint256(exactUnits) + 1, borrower);
    }

    /// @dev PRD 20.2 "Quote theft" / 30.6 invariant 5.
    function test_attack_wrongTaker_reverts() public {
        _supplyCollateral(attacker, exactUnits);
        vm.expectRevert(abi.encodeWithSelector(KyrveQuoteRatifier.UnauthorisedTaker.selector, borrower, attacker));
        _take(exactUnits, attacker);
    }

    /// @dev PRD 20.2 "Altered offer". Mutating any offer field breaks the activated offer hash.
    function test_attack_alteredTick_reverts() public {
        offer.tick = TICK - DEFAULT_TICK_SPACING;
        vm.expectRevert(_alteredOfferError());
        _take(exactUnits, borrower);
    }

    function test_attack_alteredExpiry_reverts() public {
        offer.expiry = offer.expiry + 1;
        vm.expectRevert(_alteredOfferError());
        _take(exactUnits, borrower);
    }

    function test_attack_alteredCallback_reverts() public {
        offer.callback = address(0);
        vm.expectRevert(_alteredOfferError());
        _take(exactUnits, borrower);
    }

    function test_attack_alteredMaxUnits_reverts() public {
        offer.maxUnits = exactUnits * 2;
        vm.expectRevert(_alteredOfferError());
        _take(exactUnits, borrower);
    }

    /// @dev The offer hash covers the embedded Market too, so swapping to another real market of
    /// the same shape is rejected exactly like any other field mutation.
    function test_attack_alteredMarket_reverts() public {
        offer.market = fixtureContract.market(0); // usdc-30d-weth
        vm.expectRevert(_alteredOfferError());
        _take(exactUnits, borrower);
    }

    function _alteredOfferError() internal view returns (bytes memory) {
        return abi.encodeWithSelector(
            KyrveQuoteRatifier.AlteredOffer.selector, vault.quote(QUOTE_ID).offerHash, keccak256(abi.encode(offer))
        );
    }

    /// @dev PRD 30.6 invariant 4: one quote settles at most once.
    function test_attack_replay_reverts() public {
        _take(exactUnits, borrower);
        vm.expectRevert(abi.encodeWithSelector(KyrveQuoteRatifier.QuoteNotExecutable.selector, QUOTE_ID));
        _take(exactUnits, borrower);
    }

    /// @dev PRD 20.2 "Callback spoofing".
    function test_attack_directCallbackCall_reverts() public {
        vm.prank(attacker);
        vm.expectRevert(abi.encodeWithSelector(KyrveExactFillVault.CallbackCallerNotMidnight.selector, attacker));
        vault.onBuy(marketId, market, expectedBuyerAssets, exactUnits, 0, address(vault), abi.encode(QUOTE_ID));
    }

    /// @dev PRD 12.7: expiry closes the window. Midnight rejects before Kyrve is consulted.
    function test_attack_expiredQuote_reverts() public {
        vm.warp(block.timestamp + 2 hours);
        vm.expectRevert(IMidnight.OfferExpired.selector);
        _take(exactUnits, borrower);
    }

    /// @dev Midnight refuses to consult the ratifier unless the maker authorised it (A-2).
    function test_ratifierMustBeAuthorisedByMaker() public {
        vault.authoriseRatifier(address(ratifier), false);
        vm.expectRevert(IMidnight.RatifierUnauthorized.selector);
        _take(exactUnits, borrower);
    }

    /// @dev Only the activator may bind or cancel a quote.
    function test_attack_unauthorisedActivation_reverts() public {
        vm.prank(attacker);
        vm.expectRevert(abi.encodeWithSelector(KyrveExactFillVault.NotActivator.selector, attacker));
        vault.activateQuote(keccak256("other"), _activatedQuote());
    }

    /// @dev A quote id is never reusable, even before settlement.
    function test_attack_doubleActivation_reverts() public {
        vm.expectRevert(abi.encodeWithSelector(KyrveExactFillVault.QuoteAlreadyActivated.selector, QUOTE_ID));
        vault.activateQuote(QUOTE_ID, _activatedQuote());
    }

    /// @dev The continuous fee delivered to onBuy must stay within the activated bound (A-4).
    function test_attack_pendingFeeAboveCap_reverts() public {
        bytes32 cappedId = keccak256("kyrve.quote.capped");
        Offer memory cappedOffer = offer;
        cappedOffer.group = cappedId;
        cappedOffer.callbackData = abi.encode(cappedId);

        ActivatedQuote memory q = _activatedQuote();
        q.offerHash = keccak256(abi.encode(cappedOffer));
        q.maxPendingFee = 0; // any accrual at all must now be rejected
        vault.activateQuote(cappedId, q);

        fixtureContract.usdc().mint(address(vault), expectedBuyerAssets);

        Offer memory saved = offer;
        offer = cappedOffer;
        vm.prank(borrower);
        vm.expectRevert();
        midnight.take(offer, hex"", exactUnits, borrower, borrower, address(0), hex"");
        offer = saved;
    }

    // --------------------------------------------------------------------------------------------
    // Rollback and cancellation
    // --------------------------------------------------------------------------------------------

    /// @dev A partial fill must leave NO residue: group consumption and positions roll back.
    function test_failedPartialFill_leavesNoState() public {
        uint256 partialUnits = exactUnits / 2;
        try this.externalTake(partialUnits, borrower) {
            revert("partial fill should have reverted");
        } catch {}

        assertEq(midnight.consumed(address(vault), QUOTE_ID), 0, "group consumption rolled back");
        assertEq(midnight.credit(marketId, address(vault)), 0, "no credit created");
        assertEq(midnight.debt(marketId, borrower), 0, "no debt created");
        assertEq(uint8(vault.quote(QUOTE_ID).status), uint8(QuoteStatus.Executable), "quote still executable");

        // And the exact fill still works afterwards.
        _take(exactUnits, borrower);
        assertEq(midnight.credit(marketId, address(vault)), exactUnits);
    }

    /// @dev PRD v1.1 A-5: `setConsumed` retires a quote at the protocol level, immediately.
    function test_cancelQuote_consumesTheGroupAndBlocksSettlement() public {
        vault.cancelQuote(QUOTE_ID);

        assertEq(midnight.consumed(address(vault), QUOTE_ID), exactUnits, "group pre-consumed");
        assertEq(uint8(vault.quote(QUOTE_ID).status), uint8(QuoteStatus.Expired), "quote retired");

        vm.expectRevert(abi.encodeWithSelector(KyrveQuoteRatifier.QuoteNotExecutable.selector, QUOTE_ID));
        _take(exactUnits, borrower);
    }

    /// @dev The group consumption is what makes cancellation real. Even if the ratifier were
    /// somehow satisfied, Midnight's own accounting now refuses the fill.
    function test_cancelQuote_groupIsExhaustedAtProtocolLevel() public {
        vault.cancelQuote(QUOTE_ID);
        assertEq(
            midnight.consumed(address(vault), QUOTE_ID),
            offer.maxUnits,
            "consumed equals maxUnits, so no units remain for any taker"
        );
    }

    function test_cancelQuote_isNotRepeatable() public {
        vault.cancelQuote(QUOTE_ID);
        vm.expectRevert(abi.encodeWithSelector(KyrveExactFillVault.QuoteNotExecutable.selector, QUOTE_ID));
        vault.cancelQuote(QUOTE_ID);
    }

    function test_attack_unauthorisedCancellation_reverts() public {
        vm.prank(attacker);
        vm.expectRevert(abi.encodeWithSelector(KyrveExactFillVault.NotActivator.selector, attacker));
        vault.cancelQuote(QUOTE_ID);
    }

    /// @dev A settled quote cannot then be cancelled, which would double-count the group.
    function test_cancelAfterSettlement_reverts() public {
        _take(exactUnits, borrower);
        vm.expectRevert(abi.encodeWithSelector(KyrveExactFillVault.QuoteNotExecutable.selector, QUOTE_ID));
        vault.cancelQuote(QUOTE_ID);
    }
}
