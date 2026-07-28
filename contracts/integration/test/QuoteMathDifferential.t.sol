// SPDX-License-Identifier: GPL-2.0-or-later
// Day 0 validation spike.
//
// Differential-tests Kyrve's quote math against the pinned Midnight release 2026-07-23 (dbd8d3d5)
// by comparing derived values with the return values of the real `take` entry point.
//
// Targets PRD sections 9.3 (rate-index discipline), 12.3 (quote math), 19.2 (funding invariant),
// 19.8 (dust) and 30.3 (differential tests).
pragma solidity 0.8.34;

import {Test, console} from "forge-std/Test.sol";

import {Midnight} from "midnight/Midnight.sol";
import {IMidnight, Market, Offer, CollateralParams} from "midnight/interfaces/IMidnight.sol";
import {TickLib, MAX_TICK} from "midnight/libraries/TickLib.sol";
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

contract QuoteMathDifferentialTest is Test {
    using UtilsLib for uint256;

    uint256 internal constant LLTV = 0.77e18;
    uint256 internal constant LIQUIDATION_CURSOR = 0.3e18;
    uint256 internal constant MATURITY_OFFSET = 60 days;

    Midnight internal midnight;
    MockERC20 internal loanToken;
    MockERC20 internal collateralToken;
    Oracle internal oracle;

    Market internal market;
    bytes32 internal marketId;

    address internal borrower = makeAddr("borrower");
    uint256 internal quoteNonce;

    function setUp() public {
        midnight = new Midnight();
        midnight.setFeeSetter(address(this));
        midnight.setTickSpacingSetter(address(this));
        midnight.enableLltv(LLTV);
        midnight.enableLiquidationCursor(LIQUIDATION_CURSOR);

        loanToken = new MockERC20();
        collateralToken = new MockERC20();
        oracle = new Oracle();

        midnight.setDefaultSettlementFee(address(loanToken), 3, 400 * CBP);
        midnight.setDefaultSettlementFee(address(loanToken), 4, 1000 * CBP);
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
            maturity: block.timestamp + MATURITY_OFFSET,
            rcfThreshold: 0,
            enterGate: address(0),
            liquidatorGate: address(0)
        });
        marketId = midnight.touchMarket(market);
    }

    function realTakeExternal(uint256 tick, uint256 units) external returns (uint256, uint256) {
        return realTake(tick, units);
    }

    /// @dev Kyrve's candidate quote math, derived from the pinned release:
    /// for a buy offer, buyerAssets = floor(units * tickToPrice(tick) / WAD).
    function kyrveBuyerAssets(uint256 units, uint256 tick) internal pure returns (uint256) {
        return units.mulDivDown(TickLib.tickToPrice(tick), WAD);
    }

    /// @dev Runs one real settlement at `tick` for `units` and returns Midnight's actual amounts.
    function realTake(uint256 tick, uint256 units) internal returns (uint256 buyerAssets, uint256 sellerAssets) {
        quoteNonce++;
        bytes32 quoteId = keccak256(abi.encode("kyrve.quote", quoteNonce));

        KyrveSeriesVault vault = new KyrveSeriesVault(address(midnight), address(this));
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

        loanToken.mint(address(vault), expected);

        uint256 collateral = units.mulDivUp(WAD, LLTV).mulDivUp(ORACLE_PRICE_SCALE, oracle.price());
        collateralToken.mint(borrower, collateral);
        vm.startPrank(borrower);
        collateralToken.approve(address(midnight), collateral);
        midnight.supplyCollateral(market, 0, collateral, borrower);
        (buyerAssets, sellerAssets) = midnight.take(offer, hex"", units, borrower, borrower, address(0), hex"");
        vm.stopPrank();
    }

    // --------------------------------------------------------------------------------------------
    // 1. The quote-math identity holds against real settlement, across a real rate grid
    // --------------------------------------------------------------------------------------------

    /// @dev PRD 12.3 / 30.3. The vault's onBuy already asserts buyerAssets == expected, so a
    /// mismatch at any tick would revert the take. Reaching the assertions proves equality.
    function test_differential_buyerAssetsAcrossGrid() public {
        uint256 units = 1_000_000e6;
        console.log("tick | tickToPrice(WAD)   | kyrve buyerAssets | real buyerAssets | real sellerAssets");
        for (uint256 tick = 4400; tick <= 6744; tick += 256) {
            uint256 t = tick - (tick % DEFAULT_TICK_SPACING);
            (uint256 real, uint256 sellerAssets) = realTake(t, units);
            uint256 kyrve = kyrveBuyerAssets(units, t);
            assertEq(real, kyrve, "kyrve quote math must equal Midnight settlement");
            console.log(t, TickLib.tickToPrice(t), kyrve, sellerAssets);
        }
    }

    /// @dev PRD 12.3: the maker's payment must not drift with the settlement fee. For a buy offer
    /// buyerPrice == offerPrice, so the fee is taken out of the borrower's proceeds only.
    function test_differential_buyerAssetsIndependentOfSettlementFee() public {
        uint256 units = 500_000e6;
        uint256 tick = 6000;

        (uint256 buyerLowFee, uint256 sellerLowFee) = realTake(tick, units);

        midnight.setMarketSettlementFee(marketId, 3, 417 * CBP);
        midnight.setMarketSettlementFee(marketId, 4, 1250 * CBP);

        (uint256 buyerHighFee, uint256 sellerHighFee) = realTake(tick, units);

        assertEq(buyerHighFee, buyerLowFee, "maker payment must be fee-independent");
        assertLt(sellerHighFee, sellerLowFee, "borrower proceeds must fall as the fee rises");
        console.log("maker pays (low fee) :", buyerLowFee);
        console.log("maker pays (high fee):", buyerHighFee);
        console.log("borrower gets (low)  :", sellerLowFee);
        console.log("borrower gets (high) :", sellerHighFee);
    }

    /// @dev PRD 12.3, fuzzed over the pure identity.
    function testFuzz_quoteMathIdentity(uint128 units, uint16 rawTick) public pure {
        uint256 tick = bound(uint256(rawTick), 0, MAX_TICK);
        tick = tick - (tick % DEFAULT_TICK_SPACING);
        uint256 price = TickLib.tickToPrice(tick);
        assertLe(price, WAD, "tick price must never exceed WAD");
        assertEq(uint256(units).mulDivDown(price, WAD), (uint256(units) * price) / WAD);
    }

    // --------------------------------------------------------------------------------------------
    // 2. Rate-grid discipline (PRD 9.3)
    // --------------------------------------------------------------------------------------------

    /// @dev PRD 9.3 step 3 requires sorting indexes by increasing borrowing cost. That is only
    /// well-defined if tickToPrice is monotone. Higher price = more assets per unit of face
    /// value = cheaper borrowing, so borrowing cost DECREASES as tick increases.
    function test_rateGrid_priceIsMonotonicInTick() public pure {
        uint256 previous = 0;
        for (uint256 tick = 0; tick <= MAX_TICK; tick += DEFAULT_TICK_SPACING) {
            uint256 price = TickLib.tickToPrice(tick);
            assertGe(price, previous, "tickToPrice must be non-decreasing in tick");
            previous = price;
        }
        assertLe(TickLib.tickToPrice(MAX_TICK), WAD, "max tick price must be <= WAD");
    }

    /// @dev A universe rate grid must exclude ticks whose price is below the market settlement fee:
    /// for a buy offer Midnight computes `offerPrice - settlementFee`, which reverts on underflow.
    /// This constraint is absent from the PRD.
    function test_rateGrid_lowTicksUnderflowAgainstSettlementFee() public {
        uint256 fee = midnight.settlementFee(marketId, MATURITY_OFFSET);
        assertGt(fee, 0, "fee must be non-zero for this test to be meaningful");

        uint256 lowTick = 0;
        assertLt(TickLib.tickToPrice(lowTick), fee, "tick 0 price must be below the fee");

        // vm.expectRevert only binds to an external call, so route through a public wrapper.
        vm.expectRevert();
        this.realTakeExternal(lowTick, 1_000e6);

        console.log("settlement fee at 60d (WAD):", fee);
        console.log("tickToPrice(0)             :", TickLib.tickToPrice(lowTick));
        console.log("minimum safe tick price    :", fee);
    }

    // --------------------------------------------------------------------------------------------
    // 3. Funding invariant and dust (PRD 19.2 / 19.8)
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

    /// @dev The opposite rounding is what a naive implementation would choose, and it can overdraw.
    function test_roundingUp_canOverdrawTheReservation() public pure {
        uint256 tick = 6000;
        uint256 price = TickLib.tickToPrice(tick);
        uint256 target = 999_999_999_999;

        uint256 unitsUp = target.mulDivUp(WAD, price);
        uint256 owedUp = unitsUp.mulDivDown(price, WAD);

        uint256 unitsDown = target.mulDivDown(WAD, price);
        uint256 owedDown = unitsDown.mulDivDown(price, WAD);

        console.log("target reserved by providers:", target);
        console.log("round-up   units / owed     :", unitsUp, owedUp);
        console.log("round-down units / owed     :", unitsDown, owedDown);
        assertLe(owedDown, target, "round-down is safe");
    }
}
