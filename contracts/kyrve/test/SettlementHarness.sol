// SPDX-License-Identifier: GPL-2.0-or-later
pragma solidity 0.8.34;

import {Test} from "forge-std/Test.sol";

import {IMidnight, Market, Offer} from "midnight/interfaces/IMidnight.sol";
import {TickLib} from "midnight/libraries/TickLib.sol";
import {UtilsLib} from "midnight/libraries/UtilsLib.sol";
import {ORACLE_PRICE_SCALE, WAD} from "midnight/libraries/ConstantsLib.sol";

import {LocalMidnightFixture} from "../../integration/LocalMidnightFixture.sol";
import {KyrvePublicResultVerifier} from "../KyrvePublicResultVerifier.sol";
import {KyrveQuoteExpiryController} from "../KyrveQuoteExpiryController.sol";
import {KyrveQuoteRegistry} from "../KyrveQuoteRegistry.sol";
import {KyrveSeriesFactory} from "../KyrveSeriesFactory.sol";
import {KyrveSeriesVault} from "../KyrveSeriesVault.sol";
import {KyrveSettlementRatifier} from "../KyrveSettlementRatifier.sol";
import {QuoteActivator} from "../QuoteActivator.sol";
import {
    CurveEpoch,
    CurveEpochStage,
    CurveLeaf,
    CurveMarketSpec,
    CurvePublishedHandles,
    CurveQuoteResult,
    ICurveGraphRegistry,
    ICurveResultVerifier,
    ICurveUniverseRegistry,
    INoxCurveEngine,
    IQuoteEpochController
} from "../interfaces/ICurveLayer.sol";
import {CurveLayerStub} from "./CurveLayerStub.sol";

/**
 * @notice The Phase 4 settlement substrate: REAL unmodified Morpho Midnight, real markets, real
 *         `take`, and Kyrve's production settlement contracts wired exactly as they are deployed.
 *
 * The only stand-in is `CurveLayerStub`, and only because the confidential layer compiles at a
 * different solc and needs a live Nox stack Foundry cannot drive. Read its file comment: nothing it
 * returns is evidence about confidentiality. That question is answered in
 * `confidential/test/90-quote-settlement.ts`, against the real stack, on one chain with real
 * Midnight — and the gate reports the two separately so neither can be mistaken for the other.
 */
abstract contract SettlementHarness is Test {
    using UtilsLib for uint256;

    /// @dev A multiple of the market's tick spacing (4), priced well above the settlement fee.
    int24 internal constant TICK = 6000;

    /**
     * @dev The published aggregate for the default quote.
     *
     * THE NUMBER IS DELIBERATE. The winning leaf's theoretical capacity in the reference fixture is
     * 300,000,000, but every pro-rata provider share is floored by `safeDiv`, so what was actually
     * RESERVED is 299,999,999. The engine publishes the reservation sum, never the capacity — the
     * capacity is private and, more importantly, reservations that did not sum to the public number
     * would leave the maker owing more than providers committed.
     *
     * Every size assertion in this suite is derived from this value. Nothing anywhere reconstructs
     * a fill from 300,000,000, and `test_aggregate_isNotTheLeafCapacity` pins that.
     */
    uint256 internal constant LEAF_CAPACITY = 300_000_000;
    uint256 internal constant AGGREGATE_FILL = 299_999_999;

    uint256 internal constant QUOTE_LIFETIME = 1 hours;

    LocalMidnightFixture internal fixtureContract;
    IMidnight internal midnight;
    Market internal market;
    bytes32 internal marketId;

    CurveLayerStub internal curve;
    KyrveQuoteRegistry internal registry;
    KyrveSettlementRatifier internal ratifier;
    KyrvePublicResultVerifier internal verifier;
    QuoteActivator internal activator;
    KyrveQuoteExpiryController internal expiryController;
    KyrveSeriesFactory internal factory;
    KyrveSeriesVault internal vault;

    address internal keeper = makeAddr("keeper");
    address internal operator = makeAddr("operator");
    address internal curator = makeAddr("curator");
    address internal borrower = makeAddr("borrower");
    address internal attacker = makeAddr("attacker");

    bytes32 internal universeId = keccak256("kyrve.universe.phase4");
    bytes32 internal universeHash = keccak256("kyrve.universe.phase4.hash");
    bytes32 internal epochId = keccak256("kyrve.epoch.phase4");
    bytes32 internal requestId = keccak256("kyrve.request.phase4");
    bytes32 internal graphRoot = keccak256("kyrve.graph.phase4.sealed");

    bytes internal marketProof = bytes("proof:market");
    bytes internal rateProof = bytes("proof:rate");
    bytes internal floorProof = bytes("proof:floor");
    bytes internal readyProof = bytes("proof:ready");
    bytes internal aggregateProof = bytes("proof:aggregate");

    /// @dev The aggregate the current epoch was configured with. Every derived size in this suite
    ///      comes from it, so a test cannot accidentally size against a different number.
    uint256 internal configuredAggregate;

    bytes32 internal quoteId;
    Offer internal offer;
    uint128 internal exactUnits;
    uint128 internal expectedBuyerAssets;

    // ─────────────────────────────────────────────────────────────────────────────────────────
    // Setup
    // ─────────────────────────────────────────────────────────────────────────────────────────

    function _deploySubstrate() internal {
        fixtureContract = new LocalMidnightFixture();
        fixtureContract.deploy(block.timestamp);
        midnight = IMidnight(address(fixtureContract.midnight()));
        market = fixtureContract.market(1); // usdc-90d-weth
        marketId = fixtureContract.marketId(1);
    }

    function _deploySettlement() internal {
        curve = new CurveLayerStub();

        registry = new KyrveQuoteRegistry(address(midnight));
        ratifier = new KyrveSettlementRatifier(address(midnight), registry);
        verifier = new KyrvePublicResultVerifier(
            ICurveResultVerifier(address(curve)),
            ICurveGraphRegistry(address(curve)),
            INoxCurveEngine(address(curve)),
            IQuoteEpochController(address(curve))
        );
        activator =
            new QuoteActivator(registry, verifier, ICurveUniverseRegistry(address(curve)), address(ratifier), keeper);
        expiryController = new KyrveQuoteExpiryController(registry, operator);

        registry.bindActivator(address(activator));
        registry.bindExpiryController(address(expiryController));

        factory = new KyrveSeriesFactory(registry, address(activator), address(expiryController), curator);
        activator.bindFactory(factory);
    }

    function _createSeries(bytes32 forMarketId, address loanToken) internal returns (KyrveSeriesVault created) {
        vm.prank(curator);
        (, address vaultAddress) = factory.createSeries(forMarketId, loanToken, operator);
        created = KyrveSeriesVault(vaultAddress);
    }

    /// @dev One universe, one market, one leaf — the shape the reference epoch produced.
    function _configureUniverse() internal {
        curve.setUniverse(universeId, true, universeHash);
        curve.addMarket(
            universeId,
            CurveMarketSpec({
                marketId: marketId,
                marketStructHash: keccak256(abi.encode(market)),
                maturity: uint64(market.maturity),
                collateralFamily: 0,
                maturityBucket: 0,
                tickSpacing: 4,
                settlementFeeFloorWad: 0,
                publicPriority: 0
            })
        );
        curve.addLeaf(
            universeId,
            CurveLeaf({marketIndex: 0, rateIndex: 0, tick: TICK, priceWad: TickLib.tickToPrice(uint256(uint24(TICK)))})
        );
    }

    function _configureEpoch(uint256 aggregate) internal {
        configuredAggregate = aggregate;
        curve.setEpoch(
            epochId,
            CurveEpoch({
                universeId: universeId,
                universeHash: universeHash,
                requestId: requestId,
                borrower: borrower,
                providerCount: 3,
                marketCount: 1,
                leafCount: 1,
                stage: CurveEpochStage.COMPLETE,
                openedAt: uint64(block.timestamp),
                sealedAt: uint64(block.timestamp),
                deadline: uint64(block.timestamp + 1 days)
            })
        );
        curve.setSealed(epochId, true, graphRoot);
        curve.setPublished(
            epochId,
            CurvePublishedHandles({
                marketIndex: keccak256("handle:market"),
                rateIndex: keccak256("handle:rate"),
                floorPassed: keccak256("handle:floor"),
                quoteReady: keccak256("handle:ready"),
                aggregateFill: keccak256("handle:aggregate")
            })
        );
        curve.registerResult(epochId, 0, keccak256("handle:market"), keccak256(marketProof));
        curve.registerResult(epochId, 1, keccak256("handle:rate"), keccak256(rateProof));
        curve.registerResult(epochId, 2, keccak256("handle:floor"), keccak256(floorProof));
        curve.registerResult(epochId, 3, keccak256("handle:ready"), keccak256(readyProof));
        curve.registerResult(epochId, 4, keccak256("handle:aggregate"), keccak256(aggregateProof));
        curve.setResult(
            epochId,
            CurveQuoteResult({
                marketIndex: 0,
                rateIndex: 0,
                privacyFloorPassed: true,
                quoteReady: true,
                aggregateFillAmount: aggregate,
                graphRoot: graphRoot
            })
        );
    }

    function _proofs() internal view returns (QuoteActivator.Proofs memory) {
        return QuoteActivator.Proofs({
            marketProof: marketProof,
            rateProof: rateProof,
            floorProof: floorProof,
            readyProof: readyProof,
            aggregateProof: aggregateProof
        });
    }

    /// @dev `maxPendingFee` is capped at the principal by the activator, so the harness asks for
    ///      exactly the principal: the largest bound the contract will accept, which keeps the
    ///      continuous fee out of every test that is not about the continuous fee.
    function _request() internal view returns (QuoteActivator.ActivationRequest memory) {
        (, uint256 buyerAssets) = _expectedSize(configuredAggregate);
        return QuoteActivator.ActivationRequest({
            epochId: epochId,
            expectedGraphRoot: graphRoot,
            expectedRequestId: requestId,
            expectedUniverseId: universeId,
            market: market,
            leafIndex: 0,
            lifetime: QUOTE_LIFETIME,
            maxPendingFee: uint128(buyerAssets)
        });
    }

    /// @dev The size the activator will derive, computed independently here from the same rule so a
    ///      transcription error in either shows up as a failing assertion rather than agreement.
    function _expectedSize(uint256 aggregate) internal pure returns (uint256 units, uint256 buyerAssets) {
        uint256 price = TickLib.tickToPrice(uint256(uint24(TICK)));
        units = aggregate.mulDivDown(WAD, price);
        buyerAssets = units.mulDivDown(price, WAD);
    }

    function _fundVault(KyrveSeriesVault target, uint256 amount) internal {
        fixtureContract.usdc().mint(address(target), amount);
    }

    function _activate() internal {
        vm.prank(keeper);
        (quoteId, offer) = activator.activate(_request(), _proofs());
        exactUnits = registry.executionOf(quoteId).exactUnits;
        expectedBuyerAssets = registry.executionOf(quoteId).expectedBuyerAssets;
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

    /// @dev `vm.expectRevert` binds to the next EXTERNAL call, so a revert asserted around an
    ///      internal helper must be routed through a public wrapper or the assertion silently
    ///      attaches to the wrong call.
    function externalTake(uint256 units, address taker) external returns (uint256, uint256) {
        return _take(units, taker);
    }

    function externalActivate() external returns (bytes32, Offer memory) {
        vm.prank(keeper);
        return activator.activate(_request(), _proofs());
    }

    function externalActivateWithLifetime(uint256 lifetime) external returns (bytes32, Offer memory) {
        QuoteActivator.ActivationRequest memory request = _request();
        request.lifetime = lifetime;
        vm.prank(keeper);
        return activator.activate(request, _proofs());
    }
}
