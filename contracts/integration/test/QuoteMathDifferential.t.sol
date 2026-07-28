// SPDX-License-Identifier: GPL-2.0-or-later
//
// PERMANENT REGRESSION SUITE. Promoted from the Day 0 validation spike.
//
// Differential-tests Kyrve's quote math against the pinned Midnight release 2026-07-23 (dbd8d3d5)
// by comparing derived values with the return values of the real `take` entry point.
//
// Targets PRD sections 9.3 (rate-index discipline), 12.3 (quote math), 19.2 (funding invariant),
// 19.8 (dust) and 30.3 (differential tests).
pragma solidity 0.8.34;

import {Test, console} from "forge-std/Test.sol";

import {IMidnight, Market, Offer} from "midnight/interfaces/IMidnight.sol";
import {TickLib, MAX_TICK} from "midnight/libraries/TickLib.sol";
import {UtilsLib} from "midnight/libraries/UtilsLib.sol";
import {WAD, ORACLE_PRICE_SCALE, CBP, DEFAULT_TICK_SPACING} from "midnight/libraries/ConstantsLib.sol";

import {LocalMidnightFixture} from "../LocalMidnightFixture.sol";
import {KyrveExactFillVault} from "../KyrveExactFillVault.sol";
import {KyrveQuoteRatifier} from "../KyrveQuoteRatifier.sol";
import {ActivatedQuote, QuoteStatus} from "../KyrveQuoteBinding.sol";

contract QuoteMathDifferentialTest is Test {
    using UtilsLib for uint256;

    LocalMidnightFixture internal fixtureContract;
    IMidnight internal midnight;
    Market internal market;
    bytes32 internal marketId;
    uint256 internal maturityOffset;

    address internal borrower = makeAddr("borrower");
    uint256 internal quoteNonce;

    function setUp() public {
        fixtureContract = new LocalMidnightFixture();
        fixtureContract.deploy(block.timestamp);

        midnight = IMidnight(address(fixtureContract.midnight()));
        market = fixtureContract.market(1); // usdc-90d-weth
        marketId = fixtureContract.marketId(1);
        maturityOffset = fixtureContract.MATURITY_LONG();
    }

    /// @dev Kyrve's candidate quote math, derived from the pinned release: for a buy offer,
    /// buyerAssets = floor(units * tickToPrice(tick) / WAD).
    function kyrveBuyerAssets(uint256 units, uint256 tick) internal pure returns (uint256) {
        return units.mulDivDown(TickLib.tickToPrice(tick), WAD);
    }

    /// @dev Runs one real settlement at `tick` for `units` and returns Midnight's actual amounts.
    ///
    /// The vault's `onBuy` already asserts `buyerAssets == expected`, so a mismatch at any tick
    /// reverts the take. Reaching the assertions at all is itself the proof of equality.
    function realTake(uint256 tick, uint256 units) internal returns (uint256 buyerAssets, uint256 sellerAssets) {
        quoteNonce++;
        bytes32 quoteId = keccak256(abi.encode("kyrve.quote", quoteNonce));

        KyrveExactFillVault vault = new KyrveExactFillVault(address(midnight), address(this));
        KyrveQuoteRatifier ratifier = new KyrveQuoteRatifier(address(midnight), address(vault));
        vault.authoriseRatifier(address(ratifier), true);

        uint128 expected = uint128(kyrveBuyerAssets(units, tick));

        Offer memory offer = Offer({
            market: market,
            buy: true,
            maker: address(vault),
            start: block.timestamp,
            expiry: block.timestamp + 1 hours,
            tick: tick,
            group: quoteId,
            callback: address(vault),
            callbackData: abi.encode(quoteId),
            receiverIfMakerIsSeller: address(0),
            ratifier: address(ratifier),
            reduceOnly: false,
            maxUnits: uint128(units),
            maxAssets: 0,
            continuousFeeCap: type(uint256).max
        });

        vault.activateQuote(
            quoteId,
            ActivatedQuote({
                offerHash: keccak256(abi.encode(offer)),
                marketId: marketId,
                taker: borrower,
                exactUnits: uint128(units),
                expectedBuyerAssets: expected,
                maxPendingFee: type(uint128).max,
                expiry: uint40(block.timestamp + 1 hours),
                status: QuoteStatus.Executable
            })
        );

        fixtureContract.usdc().mint(address(vault), expected);

        uint256 collateral = units.mulDivUp(WAD, fixtureContract.LLTV_WETH()).mulDivUp(
            ORACLE_PRICE_SCALE, fixtureContract.wethOracle().price()
        );
        fixtureContract.weth().mint(borrower, collateral);
        vm.startPrank(borrower);
        fixtureContract.weth().approve(address(midnight), collateral);
        midnight.supplyCollateral(market, 0, collateral, borrower);
        (buyerAssets, sellerAssets) = midnight.take(offer, hex"", units, borrower, borrower, address(0), hex"");
        vm.stopPrank();
    }

    function realTakeExternal(uint256 tick, uint256 units) external returns (uint256, uint256) {
        return realTake(tick, units);
    }

    // --------------------------------------------------------------------------------------------
    // 1. The quote-math identity holds against real settlement, across a real rate grid
    // --------------------------------------------------------------------------------------------

    function test_differential_buyerAssetsAcrossGrid() public {
        uint256 units = 1_000_000e6;
        console.log("tick | tickToPrice(WAD)   | kyrve buyerAssets | real sellerAssets");
        for (uint256 tick = 4400; tick <= 6744; tick += 256) {
            uint256 t = tick - (tick % DEFAULT_TICK_SPACING);
            (uint256 real, uint256 sellerAssets) = realTake(t, units);
            uint256 kyrve = kyrveBuyerAssets(units, t);
            assertEq(real, kyrve, "kyrve quote math must equal Midnight settlement");
            console.log(t, TickLib.tickToPrice(t), kyrve, sellerAssets);
        }
    }

    /// @dev PRD v1.1 A-6: the maker's payment must not drift with the settlement fee. For a buy
    /// offer buyerPrice == offerPrice, so the fee comes out of the borrower's proceeds only.
    function test_differential_buyerAssetsIndependentOfSettlementFee() public {
        uint256 units = 500_000e6;
        uint256 tick = 6000;

        (uint256 buyerLowFee, uint256 sellerLowFee) = realTake(tick, units);

        // Raise both bracketing breakpoints to their protocol maxima. The fixture holds the
        // feeSetter role, so the call must come from it.
        vm.startPrank(address(fixtureContract));
        midnight.setMarketSettlementFee(marketId, 3, 417 * CBP);
        midnight.setMarketSettlementFee(marketId, 4, 1250 * CBP);
        vm.stopPrank();

        (uint256 buyerHighFee, uint256 sellerHighFee) = realTake(tick, units);

        assertEq(buyerHighFee, buyerLowFee, "maker payment must be fee-independent");
        assertLt(sellerHighFee, sellerLowFee, "borrower proceeds must fall as the fee rises");
        console.log("maker pays (low fee) :", buyerLowFee);
        console.log("maker pays (high fee):", buyerHighFee);
        console.log("borrower gets (low)  :", sellerLowFee);
        console.log("borrower gets (high) :", sellerHighFee);
    }

    function testFuzz_quoteMathIdentity(uint128 units, uint16 rawTick) public pure {
        uint256 tick = bound(uint256(rawTick), 0, MAX_TICK);
        tick = tick - (tick % DEFAULT_TICK_SPACING);
        uint256 price = TickLib.tickToPrice(tick);
        assertLe(price, WAD, "tick price must never exceed WAD");
        assertEq(uint256(units).mulDivDown(price, WAD), (uint256(units) * price) / WAD);
    }

    // --------------------------------------------------------------------------------------------
    // 2. Rate-grid discipline (PRD 9.3, v1.1 A-3 and A-7)
    // --------------------------------------------------------------------------------------------

    /// @dev Sorting indexes by increasing borrowing cost is only well-defined if tickToPrice is
    /// monotone. Higher price = more assets per unit of face value = CHEAPER borrowing, so
    /// borrowing cost DECREASES as tick increases.
    function test_rateGrid_priceIsMonotonicInTick() public pure {
        uint256 previous = 0;
        for (uint256 tick = 0; tick <= MAX_TICK; tick += DEFAULT_TICK_SPACING) {
            uint256 price = TickLib.tickToPrice(tick);
            assertGe(price, previous, "tickToPrice must be non-decreasing in tick");
            previous = price;
        }
        assertLe(TickLib.tickToPrice(MAX_TICK), WAD, "max tick price must be <= WAD");
    }

    /// @dev A universe rate grid must exclude ticks priced below the market settlement fee: for a
    /// buy offer Midnight computes `offerPrice - settlementFee`, which reverts on underflow.
    function test_rateGrid_lowTicksUnderflowAgainstSettlementFee() public {
        uint256 fee = midnight.settlementFee(marketId, maturityOffset);
        assertGt(fee, 0, "fee must be non-zero for this test to be meaningful");

        uint256 lowTick = 0;
        assertLt(TickLib.tickToPrice(lowTick), fee, "tick 0 price must be below the fee");

        // vm.expectRevert only binds to an external call, so route through a public wrapper.
        vm.expectRevert();
        this.realTakeExternal(lowTick, 1_000e6);

        console.log("settlement fee at 90d (WAD):", fee);
        console.log("tickToPrice(0)             :", TickLib.tickToPrice(lowTick));
        console.log("minimum safe tick price    :", fee);
    }

    /// @dev The lowest accessible tick that Kyrve may include in a universe for this market.
    /// `packages/quote-math.minimumViableTick` must agree with this.
    function test_rateGrid_minimumViableTickIsAboveTheFee() public view {
        uint256 fee = midnight.settlementFee(marketId, maturityOffset);
        uint256 minimumViable = type(uint256).max;
        for (uint256 tick = 0; tick <= MAX_TICK; tick += DEFAULT_TICK_SPACING) {
            if (TickLib.tickToPrice(tick) >= fee) {
                minimumViable = tick;
                break;
            }
        }
        assertLt(minimumViable, MAX_TICK, "a viable tick must exist");
        assertGe(TickLib.tickToPrice(minimumViable), fee, "viable tick prices at or above the fee");
        if (minimumViable >= DEFAULT_TICK_SPACING) {
            assertLt(
                TickLib.tickToPrice(minimumViable - DEFAULT_TICK_SPACING),
                fee,
                "the tick below it must be genuinely unusable"
            );
        }
        console.log("minimum viable tick at 90d:", minimumViable);
    }

    // --------------------------------------------------------------------------------------------
    // 3. Funding invariant and dust (PRD 19.2 / 19.8, v1.1 A-8)
    // --------------------------------------------------------------------------------------------

    /// @dev Nox produces an aggregate `fillAssets`. Kyrve must choose `units` so the maker never
    /// owes more than the providers reserved. Rounding DOWN guarantees buyerAssets <= fillAssets;
    /// the shortfall is the dust PRD 19.8 must account for. Rounding up would break invariant 19.2.
    function testFuzz_unitsFromTargetAssets_neverOverdraws(uint128 rawTarget, uint16 rawTick) public pure {
        uint256 tick = bound(uint256(rawTick), 4400, MAX_TICK);
        tick = tick - (tick % DEFAULT_TICK_SPACING);
        uint256 price = TickLib.tickToPrice(tick);
        uint256 target = bound(uint256(rawTarget), 1e6, type(uint96).max);

        uint256 units = target.mulDivDown(WAD, price);
        uint256 owed = units.mulDivDown(price, WAD);

        assertLe(owed, target, "maker must never owe more than providers reserved");
        assertLe(target - owed, 2, "dust must be at most 2 wei of the loan token");
    }

    /// @dev PHASE 1 CORRECTION P-2. See docs/phase1/PRD-DELTA.md.
    ///
    /// Day 0 finding D-15, applied as PRD v1.1 A-8, justifies rounding down with the claim that
    /// "rounding up can overdraw and would break section 19.2". That justification is FALSE, and
    /// the Day 0 test named `test_roundingUp_canOverdrawTheReservation` never actually asserted
    /// it — it only checked the round-down case.
    ///
    /// Rounding up cannot overdraw, because tick prices are capped at par. With p <= WAD:
    ///
    ///     unitsUp   = ceil(t * W / p)  <  t * W / p + 1
    ///     owedUp    = floor(unitsUp * p / W)  <  t + p/W  <=  t + 1
    ///     therefore   owedUp <= t,  for every t and every p in (0, WAD].
    ///
    /// This test asserts that property directly. Rounding DOWN remains normative, for the reason
    /// established below rather than the one originally stated: rounding up inflates `units`, so
    /// the borrower takes on face value whose exact price exceeds the assets providers reserved,
    /// and Midnight's own flooring silently hands that fraction to the maker. Rounding down
    /// instead leaves an explicit residue that routes to the section 19.8 dust account.
    function test_roundingDirection_neitherOverdraws_butUpInflatesBorrowerDebt() public pure {
        uint256 overdrawWitnesses;
        uint256 inflationWitnesses;
        uint256 maxDust;

        for (uint256 tick = 4400; tick <= MAX_TICK; tick += DEFAULT_TICK_SPACING) {
            uint256 price = TickLib.tickToPrice(tick);
            if (price == 0) continue;

            for (uint256 k = 0; k < 8; k++) {
                uint256 target = 999_999_999_991 + k;

                uint256 unitsUp = target.mulDivUp(WAD, price);
                uint256 unitsDown = target.mulDivDown(WAD, price);
                uint256 owedUp = unitsUp.mulDivDown(price, WAD);
                uint256 owedDown = unitsDown.mulDivDown(price, WAD);

                assertLe(owedDown, target, "round-down must never overdraw the reservation");
                assertLe(owedUp, target, "round-up does not overdraw either: prices are capped at par");
                assertGe(unitsUp, unitsDown, "round-up never produces fewer units");

                if (owedUp > target) overdrawWitnesses++;
                if (unitsUp > unitsDown) inflationWitnesses++;
                if (target - owedDown > maxDust) maxDust = target - owedDown;
            }
        }

        assertEq(overdrawWitnesses, 0, "no overdraw is reachable in either direction");
        assertGt(inflationWitnesses, 0, "round-up demonstrably inflates units, which is the real hazard");
        assertLe(maxDust, 2, "round-down dust stays within the 2 wei bound Day 0 measured");

        console.log("overdraw witnesses (expect 0):", overdrawWitnesses);
        console.log("unit-inflation witnesses     :", inflationWitnesses);
        console.log("max round-down dust (wei)    :", maxDust);
    }
}
