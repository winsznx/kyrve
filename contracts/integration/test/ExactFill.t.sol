// SPDX-License-Identifier: GPL-2.0-or-later
// Day 0 validation spike.
//
// Proves or disproves PRD sections 2.4, 6.5, 12.2, 12.4, 12.5, 12.7 and invariants 4/5/6/7 of
// section 30.6 against the pinned, unmodified Morpho Midnight release 2026-07-23 (dbd8d3d5).
//
// Nothing here is mocked: a real Midnight is deployed, a real market is created, and settlement
// runs through the real `take` entry point.
pragma solidity 0.8.34;

import {Test, console} from "forge-std/Test.sol";

import {Midnight} from "midnight/Midnight.sol";
import {IMidnight, Market, Offer, CollateralParams} from "midnight/interfaces/IMidnight.sol";
import {TickLib, MAX_TICK} from "midnight/libraries/TickLib.sol";
import {IdLib} from "midnight/libraries/IdLib.sol";
import {UtilsLib} from "midnight/libraries/UtilsLib.sol";
import {WAD, ORACLE_PRICE_SCALE, CBP, DEFAULT_TICK_SPACING} from "midnight/libraries/ConstantsLib.sol";

import {KyrveSeriesVault} from "../../kyrve/KyrveSeriesVault.sol";
import {KyrveQuoteRatifier} from "../../kyrve/KyrveQuoteRatifier.sol";
import {ActivatedQuote, QuoteStatus} from "../../kyrve/KyrveQuoteRegistry.sol";

contract MockERC20 {
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    function mint(address to, uint256 amount) external {
        balanceOf[to] += amount;
    }

    function approve(address spender, uint256 amount) external returns (bool) {
        allowance[msg.sender][spender] = amount;
        return true;
    }

    function transfer(address to, uint256 amount) external returns (bool) {
        balanceOf[msg.sender] -= amount;
        balanceOf[to] += amount;
        return true;
    }

    function transferFrom(address from, address to, uint256 amount) external returns (bool) {
        if (msg.sender != from) allowance[from][msg.sender] -= amount;
        balanceOf[from] -= amount;
        balanceOf[to] += amount;
        return true;
    }
}

contract Oracle {
    uint256 public price = 1e36;
}

contract ExactFillTest is Test {
    using UtilsLib for uint256;

    uint256 internal constant LLTV = 0.77e18;
    uint256 internal constant LIQUIDATION_CURSOR = 0.3e18;
    uint256 internal constant TICK = 6000; // multiple of DEFAULT_TICK_SPACING (4)

    Midnight internal midnight;
    MockERC20 internal loanToken;
    MockERC20 internal collateralToken;
    Oracle internal oracle;

    KyrveSeriesVault internal vault;
    KyrveQuoteRatifier internal ratifier;

    Market internal market;
    bytes32 internal marketId;

    address internal borrower = makeAddr("borrower");
    address internal attacker = makeAddr("attacker");
    address internal activator = address(this);

    bytes32 internal constant QUOTE_ID = keccak256("kyrve.quote.1");
    uint128 internal exactUnits;
    uint128 internal expectedBuyerAssets;
    Offer internal offer;

    function setUp() public {
        midnight = new Midnight();
        midnight.setFeeSetter(address(this));
        midnight.setTickSpacingSetter(address(this));
        midnight.enableLltv(LLTV);
        midnight.enableLiquidationCursor(LIQUIDATION_CURSOR);

        loanToken = new MockERC20();
        collateralToken = new MockERC20();
        oracle = new Oracle();

        // Non-zero settlement fee and continuous fee, so the fee paths are genuinely exercised.
        // Fees are WAD-denominated and must be multiples of CBP (1e12) and <= maxSettlementFee(index).
        // A 60-day maturity interpolates between bucket 3 (30d) and bucket 4 (90d).
        midnight.setDefaultSettlementFee(address(loanToken), 3, 400 * CBP); // 0.0004e18, max 0.000417e18
        midnight.setDefaultSettlementFee(address(loanToken), 4, 1000 * CBP); // 0.001e18,  max 0.00125e18
        midnight.setDefaultContinuousFee(address(loanToken), 1000);

        CollateralParams[] memory cp = new CollateralParams[](1);
        cp[0] = CollateralParams({
            token: address(collateralToken),
            lltv: LLTV,
            liquidationCursor: LIQUIDATION_CURSOR,
            oracle: address(oracle)
        });

        market = Market({
            chainId: block.chainid,
            midnight: address(midnight),
            loanToken: address(loanToken),
            collateralParams: cp,
            maturity: block.timestamp + 60 days,
            rcfThreshold: 0,
            enterGate: address(0),
            liquidatorGate: address(0)
        });
        marketId = midnight.touchMarket(market);

        vault = new KyrveSeriesVault(address(midnight), activator);
        ratifier = new KyrveQuoteRatifier(address(midnight), address(vault));

        // Midnight requires isAuthorized[offer.maker][offer.ratifier] before it calls the ratifier.
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

        vault.activateQuote(
            QUOTE_ID,
            ActivatedQuote({
                offerHash: keccak256(abi.encode(offer)),
                marketId: marketId,
                taker: borrower,
                exactUnits: exactUnits,
                expectedBuyerAssets: expectedBuyerAssets,
                maxPendingFee: type(uint128).max,
                expiry: uint40(block.timestamp + 1 hours),
                status: QuoteStatus.Executable
            })
        );

        // The vault holds the public loan tokens before activation; Midnight pulls them during take.
        loanToken.mint(address(vault), expectedBuyerAssets);

        // Borrower posts collateral so it can take on debt.
        uint256 collateral = uint256(exactUnits).mulDivUp(WAD, LLTV).mulDivUp(ORACLE_PRICE_SCALE, oracle.price());
        collateralToken.mint(borrower, collateral);
        vm.startPrank(borrower);
        collateralToken.approve(address(midnight), collateral);
        midnight.supplyCollateral(market, 0, collateral, borrower);
        vm.stopPrank();
    }

    function _take(uint256 units, address taker) internal returns (uint256, uint256) {
        vm.prank(taker);
        return midnight.take(offer, hex"", units, taker, taker, address(0), hex"");
    }

    // --------------------------------------------------------------------------------------------
    // Happy path
    // --------------------------------------------------------------------------------------------

    /// @dev PRD 12.5 / 12.7: the exact quote settles once, through unmodified Midnight.
    function test_exactFill_settles() public {
        uint256 vaultBefore = loanToken.balanceOf(address(vault));

        (uint256 buyerAssets, uint256 sellerAssets) = _take(exactUnits, borrower);

        assertEq(buyerAssets, expectedBuyerAssets, "buyerAssets must equal Kyrve quote math");
        assertEq(midnight.credit(marketId, address(vault)), exactUnits, "vault holds the credit");
        assertEq(midnight.debt(marketId, borrower), exactUnits, "borrower holds the debt");
        assertEq(loanToken.balanceOf(borrower), sellerAssets, "borrower received seller assets");
        assertEq(vaultBefore - loanToken.balanceOf(address(vault)), buyerAssets, "vault paid exactly buyerAssets");
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
    // Attacks the PRD claims must fail
    // --------------------------------------------------------------------------------------------

    /// @dev PRD 2.4 / 30.6 invariant 6. Midnight itself permits this (newConsumed <= maxUnits);
    /// only the maker callback stops it.
    function test_attack_partialFill_reverts() public {
        uint256 partialUnits = exactUnits - 1;
        vm.expectRevert(abi.encodeWithSelector(KyrveSeriesVault.WrongUnits.selector, exactUnits, partialUnits));
        _take(partialUnits, borrower);
    }

    function test_attack_halfFill_reverts() public {
        uint256 partialUnits = exactUnits / 2;
        vm.expectRevert(abi.encodeWithSelector(KyrveSeriesVault.WrongUnits.selector, exactUnits, partialUnits));
        _take(partialUnits, borrower);
    }

    /// @dev Oversized fill is rejected by Midnight's own group accounting, before Kyrve is reached.
    function test_attack_oversizedFill_reverts() public {
        vm.expectRevert(IMidnight.ConsumedUnits.selector);
        _take(uint256(exactUnits) + 1, borrower);
    }

    /// @dev PRD 20.2 "Quote theft" / 30.6 invariant 5.
    function test_attack_wrongTaker_reverts() public {
        uint256 collateral = uint256(exactUnits).mulDivUp(WAD, LLTV).mulDivUp(ORACLE_PRICE_SCALE, oracle.price());
        collateralToken.mint(attacker, collateral);
        vm.startPrank(attacker);
        collateralToken.approve(address(midnight), collateral);
        midnight.supplyCollateral(market, 0, collateral, attacker);
        vm.stopPrank();

        vm.expectRevert(KyrveQuoteRatifier.UnauthorisedTaker.selector);
        _take(exactUnits, attacker);
    }

    /// @dev PRD 20.2 "Altered offer". Mutating any offer field breaks the activated offer hash.
    function test_attack_alteredTick_reverts() public {
        offer.tick = TICK - DEFAULT_TICK_SPACING;
        vm.expectRevert(KyrveQuoteRatifier.AlteredOffer.selector);
        _take(exactUnits, borrower);
    }

    function test_attack_alteredExpiry_reverts() public {
        offer.expiry = offer.expiry + 1;
        vm.expectRevert(KyrveQuoteRatifier.AlteredOffer.selector);
        _take(exactUnits, borrower);
    }

    function test_attack_alteredCallback_reverts() public {
        offer.callback = address(0);
        vm.expectRevert(KyrveQuoteRatifier.AlteredOffer.selector);
        _take(exactUnits, borrower);
    }

    function test_attack_alteredMaxUnits_reverts() public {
        offer.maxUnits = exactUnits * 2;
        vm.expectRevert(KyrveQuoteRatifier.AlteredOffer.selector);
        _take(exactUnits, borrower);
    }

    /// @dev PRD 30.6 invariant 4: one quote settles at most once.
    function test_attack_replay_reverts() public {
        _take(exactUnits, borrower);
        vm.expectRevert(KyrveQuoteRatifier.QuoteNotExecutable.selector);
        _take(exactUnits, borrower);
    }

    /// @dev PRD 20.2 "Callback spoofing".
    function test_attack_directCallbackCall_reverts() public {
        vm.prank(attacker);
        vm.expectRevert(KyrveSeriesVault.CallbackCallerNotMidnight.selector);
        vault.onBuy(marketId, market, expectedBuyerAssets, exactUnits, 0, address(vault), abi.encode(QUOTE_ID));
    }

    /// @dev PRD 12.7: expiry closes the window.
    function test_attack_expiredQuote_reverts() public {
        vm.warp(block.timestamp + 2 hours);
        vm.expectRevert(IMidnight.OfferExpired.selector);
        _take(exactUnits, borrower);
    }

    /// @dev Midnight refuses to consult the ratifier unless the maker authorised it.
    function test_ratifierMustBeAuthorisedByMaker() public {
        vault.authoriseRatifier(address(ratifier), false);
        vm.expectRevert(IMidnight.RatifierUnauthorized.selector);
        _take(exactUnits, borrower);
    }

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

    function externalTake(uint256 units, address taker) external returns (uint256, uint256) {
        return _take(units, taker);
    }
}
