// SPDX-License-Identifier: GPL-2.0-or-later
pragma solidity 0.8.34;

import {Midnight} from "midnight/Midnight.sol";
import {Market, CollateralParams} from "midnight/interfaces/IMidnight.sol";
import {ORACLE_PRICE_SCALE, CBP} from "midnight/libraries/ConstantsLib.sol";

import {TestERC20} from "./TestERC20.sol";
import {FixedPriceOracle} from "./FixedPriceOracle.sol";

/// @dev One deterministic definition of the Kyrve local substrate, used by three consumers so they
/// can never disagree: the permanent integration tests, the quote-math fixture generator, and
/// `scripts/deploy/local.ts`.
///
/// Deterministic means: given the same `maturityAnchor`, every market struct and therefore every
/// market id is identical across runs. Nothing here reads block.timestamp implicitly.
///
/// The four launch markets deliberately span one loan token, two maturities and two collateral
/// families, plus one multi-collateral market, because those are the axes Kyrve's universe
/// construction has to handle.
contract LocalMidnightFixture {
    /// @dev 0.77 WAD against WETH, 0.86 WAD against the more correlated wstETH.
    uint256 public constant LLTV_WETH = 0.77e18;
    uint256 public constant LLTV_WSTETH = 0.86e18;
    uint256 public constant LIQUIDATION_CURSOR = 0.3e18;

    /// @dev Every value is at or below `maxSettlementFee(index)`: 14, 14, 98, 417, 1250, 2500, 5000.
    uint16[7] public settlementFeeCbp = [uint16(14), 14, 98, 400, 1000, 2500, 5000];

    /// @dev Per second. Far below MAX_CONTINUOUS_FEE (317,097,919).
    uint32 public constant CONTINUOUS_FEE = 1000;

    uint256 public constant MATURITY_SHORT = 30 days;
    uint256 public constant MATURITY_LONG = 90 days;

    Midnight public midnight;
    TestERC20 public usdc;
    TestERC20 public weth;
    TestERC20 public wsteth;
    FixedPriceOracle public wethOracle;
    FixedPriceOracle public wstethOracle;

    Market[4] internal _markets;
    bytes32[4] internal _marketIds;
    string[4] public marketKeys = ["usdc-30d-weth", "usdc-90d-weth", "usdc-30d-wsteth", "usdc-90d-multi"];

    /// @dev Deploys the full substrate. `maturityAnchor` is the absolute unix time all maturities
    /// are measured from, passed in rather than read from the block so runs are reproducible.
    function deploy(uint256 maturityAnchor) external {
        midnight = new Midnight();
        midnight.setFeeSetter(address(this));
        midnight.setTickSpacingSetter(address(this));
        midnight.enableLltv(LLTV_WETH);
        midnight.enableLltv(LLTV_WSTETH);
        midnight.enableLiquidationCursor(LIQUIDATION_CURSOR);

        usdc = new TestERC20("Kyrve Test USDC", "tUSDC", 6);
        weth = new TestERC20("Kyrve Test WETH", "tWETH", 18);
        wsteth = new TestERC20("Kyrve Test wstETH", "twstETH", 18);

        // 1:1 in ORACLE_PRICE_SCALE. A fixed oracle keeps the substrate deterministic; Phase 1
        // proves the settlement path, not price discovery.
        wethOracle = new FixedPriceOracle(ORACLE_PRICE_SCALE);
        wstethOracle = new FixedPriceOracle(ORACLE_PRICE_SCALE);

        for (uint256 i = 0; i < 7; i++) {
            midnight.setDefaultSettlementFee(address(usdc), i, uint256(settlementFeeCbp[i]) * CBP);
        }
        midnight.setDefaultContinuousFee(address(usdc), CONTINUOUS_FEE);

        _markets[0] = _market(maturityAnchor + MATURITY_SHORT, _single(address(weth), LLTV_WETH, address(wethOracle)));
        _markets[1] = _market(maturityAnchor + MATURITY_LONG, _single(address(weth), LLTV_WETH, address(wethOracle)));
        _markets[2] =
            _market(maturityAnchor + MATURITY_SHORT, _single(address(wsteth), LLTV_WSTETH, address(wstethOracle)));
        _markets[3] = _market(maturityAnchor + MATURITY_LONG, _sortedPair());

        for (uint256 i = 0; i < 4; i++) {
            _marketIds[i] = midnight.touchMarket(_markets[i]);
        }
    }

    function market(uint256 index) external view returns (Market memory) {
        return _markets[index];
    }

    function marketId(uint256 index) external view returns (bytes32) {
        return _marketIds[index];
    }

    function feeCbp(uint256 index) external view returns (uint16) {
        return settlementFeeCbp[index];
    }

    function _market(uint256 maturity, CollateralParams[] memory cp) internal view returns (Market memory) {
        return Market({
            chainId: block.chainid,
            midnight: address(midnight),
            loanToken: address(usdc),
            collateralParams: cp,
            maturity: maturity,
            rcfThreshold: 0,
            enterGate: address(0),
            liquidatorGate: address(0)
        });
    }

    function _single(address token, uint256 lltv, address oracle) internal pure returns (CollateralParams[] memory) {
        CollateralParams[] memory cp = new CollateralParams[](1);
        cp[0] = CollateralParams({token: token, lltv: lltv, liquidationCursor: LIQUIDATION_CURSOR, oracle: oracle});
        return cp;
    }

    /// @dev `touchMarket` requires collateral tokens in strictly ascending address order, and
    /// deployment addresses are not knowable in advance, so the pair is sorted at construction.
    function _sortedPair() internal view returns (CollateralParams[] memory) {
        CollateralParams memory a = CollateralParams({
            token: address(weth), lltv: LLTV_WETH, liquidationCursor: LIQUIDATION_CURSOR, oracle: address(wethOracle)
        });
        CollateralParams memory b = CollateralParams({
            token: address(wsteth),
            lltv: LLTV_WSTETH,
            liquidationCursor: LIQUIDATION_CURSOR,
            oracle: address(wstethOracle)
        });

        CollateralParams[] memory cp = new CollateralParams[](2);
        (cp[0], cp[1]) = a.token < b.token ? (a, b) : (b, a);
        return cp;
    }
}
