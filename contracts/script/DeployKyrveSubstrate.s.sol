// SPDX-License-Identifier: GPL-2.0-or-later
pragma solidity 0.8.34;

import {Script} from "forge-std/Script.sol";

import {Midnight} from "midnight/Midnight.sol";
import {Market, CollateralParams} from "midnight/interfaces/IMidnight.sol";
import {ORACLE_PRICE_SCALE, CBP} from "midnight/libraries/ConstantsLib.sol";

import {TestERC20} from "../integration/TestERC20.sol";
import {FixedPriceOracle} from "../integration/FixedPriceOracle.sol";
import {KyrveOsakaProbe} from "../registry/KyrveOsakaProbe.sol";
import {KyrveProtocolRegistry} from "../registry/KyrveProtocolRegistry.sol";
import {KyrveDeploymentVerifier} from "../registry/KyrveDeploymentVerifier.sol";

/// @dev Deploys the complete Kyrve public substrate: unmodified Midnight, test assets, oracles,
/// the four launch markets, the Osaka probe, the protocol registry and the deployment verifier.
///
/// LICENCE. The Midnight core deployed here is BUSL-1.1 and the Additional Use Grant is empty
/// (verified 2026-07-28). Every deployment produced by this script is a NON-PRODUCTION TESTNET
/// REPLICA. It is not an official Morpho deployment, is not maintained by Morpho Association, and
/// carries no Morpho branding. See LICENSE and docs/phase1/MIDNIGHT-LICENCE.md.
///
/// DETERMINISM. Maturities derive from `KYRVE_MATURITY_ANCHOR`, never from `block.timestamp`, so
/// the four market structs — and therefore the four market ids — are reproducible across runs and
/// across chains. The reproducibility test asserts this.
///
/// This script deploys the SUBSTRATE only. No confidential vault, mandate book, request book,
/// curve engine, secondary market or roll engine is deployed: those are later phases and shipping
/// placeholders for them would create an upgrade path nobody designed.
contract DeployKyrveSubstrate is Script {
    uint256 internal constant LLTV_WETH = 0.77e18;
    uint256 internal constant LLTV_WSTETH = 0.86e18;
    uint256 internal constant LIQUIDATION_CURSOR = 0.3e18;
    uint32 internal constant CONTINUOUS_FEE = 1000;

    uint256 internal constant MATURITY_SHORT = 30 days;
    uint256 internal constant MATURITY_LONG = 90 days;

    uint16[7] internal settlementFeeCbp = [uint16(14), 14, 98, 400, 1000, 2500, 5000];

    string internal constant OBJ = "kyrve.deployment";

    function run() external {
        uint256 anchor = vm.envUint("KYRVE_MATURITY_ANCHOR");
        string memory outPath = vm.envString("KYRVE_DEPLOYMENT_OUT");

        vm.startBroadcast();

        Midnight midnight = new Midnight();
        midnight.setFeeSetter(msg.sender);
        midnight.setTickSpacingSetter(msg.sender);
        midnight.enableLltv(LLTV_WETH);
        midnight.enableLltv(LLTV_WSTETH);
        midnight.enableLiquidationCursor(LIQUIDATION_CURSOR);

        TestERC20 usdc = new TestERC20("Kyrve Test USDC", "tUSDC", 6);
        TestERC20 weth = new TestERC20("Kyrve Test WETH", "tWETH", 18);
        TestERC20 wsteth = new TestERC20("Kyrve Test wstETH", "twstETH", 18);

        FixedPriceOracle wethOracle = new FixedPriceOracle(ORACLE_PRICE_SCALE);
        FixedPriceOracle wstethOracle = new FixedPriceOracle(ORACLE_PRICE_SCALE);

        for (uint256 i = 0; i < 7; i++) {
            midnight.setDefaultSettlementFee(address(usdc), i, uint256(settlementFeeCbp[i]) * CBP);
        }
        midnight.setDefaultContinuousFee(address(usdc), CONTINUOUS_FEE);

        Market[4] memory markets = _buildMarkets(
            anchor,
            address(midnight),
            address(usdc),
            address(weth),
            address(wsteth),
            address(wethOracle),
            address(wstethOracle)
        );

        bytes32[4] memory ids;
        for (uint256 i = 0; i < 4; i++) {
            ids[i] = midnight.touchMarket(markets[i]);
        }

        KyrveOsakaProbe probe = new KyrveOsakaProbe();
        // Fails the deployment loudly on a chain without Osaka, rather than deploying something
        // that will misbehave at settlement time.
        probe.assertOsaka();

        KyrveProtocolRegistry registry = new KyrveProtocolRegistry(msg.sender);
        KyrveDeploymentVerifier verifier = new KyrveDeploymentVerifier(address(registry));

        vm.stopBroadcast();

        _write(
            outPath,
            address(midnight),
            address(usdc),
            address(weth),
            address(wsteth),
            address(wethOracle),
            address(wstethOracle),
            address(probe),
            address(registry),
            address(verifier),
            ids,
            anchor
        );
    }

    function _buildMarkets(
        uint256 anchor,
        address midnight,
        address usdc,
        address weth,
        address wsteth,
        address wethOracle,
        address wstethOracle
    ) internal view returns (Market[4] memory markets) {
        markets[0] = _market(midnight, usdc, anchor + MATURITY_SHORT, _single(weth, LLTV_WETH, wethOracle));
        markets[1] = _market(midnight, usdc, anchor + MATURITY_LONG, _single(weth, LLTV_WETH, wethOracle));
        markets[2] = _market(midnight, usdc, anchor + MATURITY_SHORT, _single(wsteth, LLTV_WSTETH, wstethOracle));
        markets[3] = _market(midnight, usdc, anchor + MATURITY_LONG, _pair(weth, wethOracle, wsteth, wstethOracle));
    }

    function _market(address midnight, address usdc, uint256 maturity, CollateralParams[] memory cp)
        internal
        view
        returns (Market memory)
    {
        return Market({
            chainId: block.chainid,
            midnight: midnight,
            loanToken: usdc,
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

    /// @dev `touchMarket` requires collateral tokens in strictly ascending address order.
    function _pair(address a, address aOracle, address b, address bOracle)
        internal
        pure
        returns (CollateralParams[] memory)
    {
        CollateralParams memory ca =
            CollateralParams({token: a, lltv: LLTV_WETH, liquidationCursor: LIQUIDATION_CURSOR, oracle: aOracle});
        CollateralParams memory cb =
            CollateralParams({token: b, lltv: LLTV_WSTETH, liquidationCursor: LIQUIDATION_CURSOR, oracle: bOracle});

        CollateralParams[] memory cp = new CollateralParams[](2);
        (cp[0], cp[1]) = a < b ? (ca, cb) : (cb, ca);
        return cp;
    }

    function _write(
        string memory outPath,
        address midnight,
        address usdc,
        address weth,
        address wsteth,
        address wethOracle,
        address wstethOracle,
        address probe,
        address registry,
        address verifier,
        bytes32[4] memory ids,
        uint256 anchor
    ) internal {
        vm.serializeString(OBJ, "midnightRelease", "2026-07-23");
        vm.serializeString(OBJ, "midnightCommit", "dbd8d3d54d324a03df9f06d3c77d50a7bd1e09a0");
        vm.serializeUint(OBJ, "chainId", block.chainid);
        vm.serializeUint(OBJ, "maturityAnchor", anchor);
        vm.serializeAddress(OBJ, "deployer", msg.sender);

        vm.serializeAddress(OBJ, "Midnight", midnight);
        vm.serializeAddress(OBJ, "TestUSDC", usdc);
        vm.serializeAddress(OBJ, "TestWETH", weth);
        vm.serializeAddress(OBJ, "TestWstETH", wsteth);
        vm.serializeAddress(OBJ, "WethOracle", wethOracle);
        vm.serializeAddress(OBJ, "WstethOracle", wstethOracle);
        vm.serializeAddress(OBJ, "KyrveOsakaProbe", probe);
        vm.serializeAddress(OBJ, "KyrveProtocolRegistry", registry);
        vm.serializeAddress(OBJ, "KyrveDeploymentVerifier", verifier);

        vm.serializeBytes32(OBJ, "midnightRuntimeHash", keccak256(midnight.code));

        string[] memory idStrings = new string[](4);
        for (uint256 i = 0; i < 4; i++) {
            idStrings[i] = vm.toString(ids[i]);
        }

        string memory out = vm.serializeString(OBJ, "marketIds", idStrings);
        vm.writeJson(out, outPath);
    }
}
