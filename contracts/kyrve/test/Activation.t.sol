// SPDX-License-Identifier: GPL-2.0-or-later
//
// Everything that must PREVENT a quote from being activated, and the two token behaviours that must
// prevent one from settling.
//
// Every check in `KyrvePublicResultVerifier` and `QuoteActivator` has a case here, and each asserts
// the SPECIFIC revert rather than merely that one occurred — a test passing for the wrong reason is
// worse than no test.
pragma solidity 0.8.34;

import {IMidnight, Market, Offer} from "midnight/interfaces/IMidnight.sol";
import {TickLib} from "midnight/libraries/TickLib.sol";

import {KyrvePublicResultVerifier} from "../KyrvePublicResultVerifier.sol";
import {KyrveQuoteRegistry} from "../KyrveQuoteRegistry.sol";
import {KyrveSeriesFactory} from "../KyrveSeriesFactory.sol";
import {KyrveSeriesVault} from "../KyrveSeriesVault.sol";
import {QuoteActivator} from "../QuoteActivator.sol";
import {QuoteExecution, QuoteProvenance, QuoteStatus} from "../KyrveQuoteTypes.sol";
import {
    CurveEpochStage,
    CurveLeaf,
    CurveMarketSpec,
    CurvePublishedHandles,
    CurveQuoteResult
} from "../interfaces/ICurveLayer.sol";
import {CurveLayerStub} from "./CurveLayerStub.sol";
import {FalseApprovingERC20, ReentrantApprovingERC20, SilentApprovingERC20} from "./HostileTokens.sol";
import {SettlementHarness} from "./SettlementHarness.sol";

contract ActivationTest is SettlementHarness {
    function setUp() public {
        _deploySubstrate();
        _deploySettlement();
        _configureUniverse();
        _configureEpoch(AGGREGATE_FILL);

        vault = _createSeries(marketId, address(fixtureContract.usdc()));
        (, uint256 buyerAssets) = _expectedSize(AGGREGATE_FILL);
        _fundVault(vault, buyerAssets);
    }

    // ─────────────────────────────────────────────────────────────────────────────────────────
    // Delta R-14 — the partial handle set
    // ─────────────────────────────────────────────────────────────────────────────────────────

    /**
     * @dev The exact shape of the Phase 3 failure, reproduced.
     *
     * `publishWinner` sets four handles; `publishAggregate` sets the fifth. Read the set in between
     * and four are valid while the fifth is the undefined handle — whose embedded chain id is 0, so
     * the gateway answers `unknown_chain: chain_id 0 not configured`, a message that names neither
     * the handle nor the mistake.
     *
     * Activation must fail HERE, on chain, for free, naming the role — before any proof reaches any
     * gateway.
     */
    function test_r14_partialHandleSet_isRefusedBeforeAnyProof() public {
        CurvePublishedHandles memory partialSet = CurvePublishedHandles({
            marketIndex: keccak256("handle:market"),
            rateIndex: keccak256("handle:rate"),
            floorPassed: keccak256("handle:floor"),
            quoteReady: keccak256("handle:ready"),
            aggregateFill: bytes32(0) // never written: `publishAggregate` has not run
        });
        curve.setPublished(epochId, partialSet);

        vm.expectRevert(
            abi.encodeWithSelector(KyrvePublicResultVerifier.PublishedHandleMissing.selector, epochId, uint8(4))
        );
        this.externalActivate();
    }

    /// @dev The same failure one step earlier: the role was never registered at all, so the graph
    /// registry itself refuses the read. `CurveGraphRegistry.expectedResultHandle` reverts rather
    /// than returning zero, precisely so a zero cannot compare equal to an uninitialised expectation.
    function test_r14_unregisteredRole_isRefused() public {
        curve.unregisterResult(epochId, 4);
        vm.expectRevert(abi.encodeWithSelector(CurveLayerStub.ResultNotRegistered.selector, epochId, uint8(4)));
        this.externalActivate();
    }

    /// @dev A handle that is real, but belongs to a different epoch. The set is complete and every
    /// entry is non-zero, so only the per-role binding catches it.
    function test_r14_handleFromAnotherEpoch_isRefused() public {
        bytes32 foreign = keccak256("handle:aggregate:some-other-epoch");
        CurvePublishedHandles memory swapped = CurvePublishedHandles({
            marketIndex: keccak256("handle:market"),
            rateIndex: keccak256("handle:rate"),
            floorPassed: keccak256("handle:floor"),
            quoteReady: keccak256("handle:ready"),
            aggregateFill: foreign
        });
        curve.setPublished(epochId, swapped);

        vm.expectRevert(
            abi.encodeWithSelector(
                KyrvePublicResultVerifier.PublishedHandleUnregistered.selector,
                epochId,
                uint8(4),
                keccak256("handle:aggregate"),
                foreign
            )
        );
        this.externalActivate();
    }

    function test_isActivatable_reportsThePartialSetAsNotReady() public {
        assertTrue(verifier.isActivatable(epochId), "the complete set is activatable");
        curve.setPublished(
            epochId,
            CurvePublishedHandles({
                marketIndex: keccak256("handle:market"),
                rateIndex: keccak256("handle:rate"),
                floorPassed: keccak256("handle:floor"),
                quoteReady: keccak256("handle:ready"),
                aggregateFill: bytes32(0)
            })
        );
        assertFalse(verifier.isActivatable(epochId), "the partial set is not");
    }

    // ─────────────────────────────────────────────────────────────────────────────────────────
    // Proof and identity binding
    // ─────────────────────────────────────────────────────────────────────────────────────────

    /// @dev A tampered proof. The cryptographic rejection is the gateway's job and is proven against
    /// the real stack; what is proven here is that the settlement layer surfaces it as a refusal
    /// rather than proceeding with an unverified number.
    function test_attack_tamperedProof_reverts() public {
        aggregateProof = bytes("proof:aggregate:tampered");
        vm.expectRevert(abi.encodeWithSelector(CurveLayerStub.StubProofRejected.selector, epochId, uint8(4)));
        this.externalActivate();
    }

    function test_attack_wrongGraphRoot_reverts() public {
        bytes32 stale = keccak256("kyrve.graph.phase4.stale");
        vm.expectRevert(
            abi.encodeWithSelector(KyrvePublicResultVerifier.GraphRootMismatch.selector, epochId, stale, graphRoot)
        );
        this.externalActivateExpecting(stale, requestId, universeId);
    }

    function test_attack_wrongRequest_reverts() public {
        bytes32 other = keccak256("kyrve.request.someone-elses");
        vm.expectRevert(
            abi.encodeWithSelector(KyrvePublicResultVerifier.RequestMismatch.selector, epochId, other, requestId)
        );
        this.externalActivateExpecting(graphRoot, other, universeId);
    }

    function test_attack_wrongUniverse_reverts() public {
        bytes32 other = keccak256("kyrve.universe.someone-elses");
        vm.expectRevert(
            abi.encodeWithSelector(KyrvePublicResultVerifier.UniverseMismatch.selector, epochId, other, universeId)
        );
        this.externalActivateExpecting(graphRoot, requestId, other);
    }

    /// @dev A stale epoch: one that has not finished. A quote over a partially computed universe is
    /// a quote over part of the curve.
    function test_attack_staleEpoch_reverts() public {
        curve.setStage(epochId, CurveEpochStage.ALLOCATE);
        vm.expectRevert(
            abi.encodeWithSelector(
                KyrvePublicResultVerifier.EpochNotComplete.selector, epochId, CurveEpochStage.ALLOCATE
            )
        );
        this.externalActivate();
    }

    function test_attack_unsealedGraph_reverts() public {
        curve.setSealed(epochId, false, graphRoot);
        vm.expectRevert(abi.encodeWithSelector(KyrvePublicResultVerifier.GraphNotSealed.selector, epochId));
        this.externalActivate();
    }

    // ─────────────────────────────────────────────────────────────────────────────────────────
    // The result itself
    // ─────────────────────────────────────────────────────────────────────────────────────────

    function test_noQuote_isNotActivatable() public {
        _setResult(0, 0, true, false, AGGREGATE_FILL);
        vm.expectRevert(abi.encodeWithSelector(KyrvePublicResultVerifier.QuoteNotReady.selector, epochId));
        this.externalActivate();
    }

    /// @dev A leaf below the privacy floor can never win, so this state should be unreachable — and
    /// it is refused rather than trusted, because "unreachable" is a property of code that changes.
    function test_privacyFloorNotMet_isNotActivatable() public {
        _setResult(0, 0, false, true, AGGREGATE_FILL);
        vm.expectRevert(abi.encodeWithSelector(KyrvePublicResultVerifier.PrivacyFloorNotMet.selector, epochId));
        this.externalActivate();
    }

    function test_zeroAggregate_isNotActivatable() public {
        _setResult(0, 0, true, true, 0);
        vm.expectRevert(abi.encodeWithSelector(KyrvePublicResultVerifier.AggregateIsZero.selector, epochId));
        this.externalActivate();
    }

    // ─────────────────────────────────────────────────────────────────────────────────────────
    // Leaf and market resolution
    // ─────────────────────────────────────────────────────────────────────────────────────────

    /// @dev The leaf index is a hint. A wrong hint must be refused, never silently corrected.
    function test_attack_leafIndexDoesNotCarryTheSelectedPair_reverts() public {
        curve.addLeaf(
            universeId,
            CurveLeaf({
                marketIndex: 0, rateIndex: 1, tick: TICK - 4, priceWad: TickLib.tickToPrice(uint256(uint24(TICK - 4)))
            })
        );
        vm.expectRevert(abi.encodeWithSelector(QuoteActivator.UnselectedLeaf.selector, uint256(1), uint8(0), uint8(1)));
        this.externalActivateWithLeaf(1);
    }

    function test_attack_leafIndexOutOfRange_reverts() public {
        vm.expectRevert(abi.encodeWithSelector(QuoteActivator.LeafIndexOutOfRange.selector, uint256(7), uint256(1)));
        this.externalActivateWithLeaf(7);
    }

    /// @dev A different real market, presented for a quote the curve computed over another one.
    function test_attack_substitutedMarketStruct_reverts() public {
        Market memory other = fixtureContract.market(0);
        vm.expectRevert(
            abi.encodeWithSelector(
                QuoteActivator.MarketStructMismatch.selector,
                keccak256(abi.encode(market)),
                keccak256(abi.encode(other))
            )
        );
        this.externalActivateWithMarket(other);
    }

    /// @dev The struct hash agrees but Midnight's own id derivation does not. `IdLib.toId` is a
    /// CREATE2 hash, not `keccak256(market)`, so the two are independent bindings and both are made.
    function test_attack_marketIdDisagreesWithTheStruct_reverts() public {
        Market memory other = fixtureContract.market(0);
        bytes32 otherId = fixtureContract.marketId(0);

        CurveMarketSpec memory spec = CurveMarketSpec({
            marketId: marketId, // still claims market 1
            marketStructHash: keccak256(abi.encode(other)), // but the struct is market 0
            maturity: uint64(other.maturity),
            collateralFamily: 0,
            maturityBucket: 0,
            tickSpacing: 4,
            settlementFeeFloorWad: 0,
            publicPriority: 0
        });
        curve.setMarket(universeId, 0, spec);

        vm.expectRevert(abi.encodeWithSelector(QuoteActivator.MarketIdMismatch.selector, marketId, otherId));
        this.externalActivateWithMarket(other);
    }

    /// @dev A universe grid price that disagrees with the pinned `TickLib`. The activator prices
    /// from the library and checks the grid against it, so neither source can drift unnoticed.
    function test_attack_leafPriceDisagreesWithTickLib_reverts() public {
        uint256 truePrice = TickLib.tickToPrice(uint256(uint24(TICK)));
        curve.setLeaf(universeId, 0, CurveLeaf({marketIndex: 0, rateIndex: 0, tick: TICK, priceWad: truePrice - 1}));
        vm.expectRevert(abi.encodeWithSelector(QuoteActivator.LeafPriceMismatch.selector, truePrice - 1, truePrice));
        this.externalActivate();
    }

    function test_attack_negativeTick_reverts() public {
        curve.setLeaf(universeId, 0, CurveLeaf({marketIndex: 0, rateIndex: 0, tick: -4, priceWad: 1}));
        vm.expectRevert(abi.encodeWithSelector(QuoteActivator.NegativeTick.selector, int24(-4)));
        this.externalActivate();
    }

    // ─────────────────────────────────────────────────────────────────────────────────────────
    // Bounds, funding and wiring
    // ─────────────────────────────────────────────────────────────────────────────────────────

    function test_lifetimeBounds_areEnforcedAtBothEnds() public {
        vm.expectRevert(
            abi.encodeWithSelector(
                QuoteActivator.LifetimeOutOfRange.selector,
                uint256(1 minutes),
                activator.MIN_QUOTE_LIFETIME(),
                activator.MAX_QUOTE_LIFETIME()
            )
        );
        this.externalActivateWithLifetime(1 minutes);

        vm.expectRevert(
            abi.encodeWithSelector(
                QuoteActivator.LifetimeOutOfRange.selector,
                uint256(2 days),
                activator.MIN_QUOTE_LIFETIME(),
                activator.MAX_QUOTE_LIFETIME()
            )
        );
        this.externalActivateWithLifetime(2 days);
    }

    /// @dev Activation must fail loudly here rather than inside `take`, where the borrower would pay
    /// gas for the maker's shortfall.
    function test_underfundedVault_cannotActivate() public {
        KyrveSeriesVault empty = _createSeries(fixtureContract.marketId(0), address(fixtureContract.usdc()));
        empty; // the vault under test is the funded one; drain it instead

        (, uint256 buyerAssets) = _expectedSize(AGGREGATE_FILL);
        vm.prank(operator);
        vault.recoverFunding(buyerAssets, operator);

        vm.expectRevert(abi.encodeWithSelector(KyrveSeriesVault.FundingShortfall.selector, buyerAssets, uint256(0)));
        this.externalActivate();
    }

    function test_seriesMustExistBeforeAQuoteCanBind() public {
        // A fresh deployment with no series at all.
        _deploySettlement();
        _configureUniverse();
        _configureEpoch(AGGREGATE_FILL);

        bytes32 seriesId = factory.seriesIdFor(marketId);
        vm.expectRevert(abi.encodeWithSelector(KyrveSeriesFactory.UnknownSeries.selector, seriesId));
        this.externalActivate();
    }

    function test_factory_createSeriesIsCuratorOnly() public {
        // Hoisted: `vm.expectRevert` binds to the next EXTERNAL call, and an argument that is itself
        // an external call would silently claim the assertion.
        bytes32 otherMarketId = fixtureContract.marketId(0);
        address usdc = address(fixtureContract.usdc());

        vm.prank(attacker);
        vm.expectRevert(abi.encodeWithSelector(KyrveSeriesFactory.NotCurator.selector, attacker, curator));
        factory.createSeries(otherMarketId, usdc, operator);
    }

    function test_factory_oneSeriesPerMarket() public {
        bytes32 seriesId = factory.seriesIdFor(marketId);
        address usdc = address(fixtureContract.usdc());

        vm.prank(curator);
        vm.expectRevert(abi.encodeWithSelector(KyrveSeriesFactory.SeriesExists.selector, seriesId, address(vault)));
        factory.createSeries(marketId, usdc, operator);
    }

    function test_factory_vaultAddressIsDeterministicAndRegistered() public view {
        assertEq(factory.vaultOf(factory.seriesIdFor(marketId)), address(vault), "registered under its series");
        assertEq(factory.seriesOf(address(vault)), factory.seriesIdFor(marketId), "and back again");
        assertTrue(factory.isVault(address(vault)), "the factory vouches for its own vaults");
        assertFalse(factory.isVault(attacker), "and for nothing else");
        assertEq(vault.SERIES_ID(), factory.seriesIdFor(marketId), "the vault knows its series");
    }

    function test_bindings_areOneShot() public {
        vm.expectRevert(abi.encodeWithSelector(KyrveQuoteRegistry.ActivatorAlreadyBound.selector, address(activator)));
        registry.bindActivator(attacker);

        vm.expectRevert(
            abi.encodeWithSelector(KyrveQuoteRegistry.ExpiryControllerAlreadyBound.selector, address(expiryController))
        );
        registry.bindExpiryController(attacker);

        vm.expectRevert(abi.encodeWithSelector(QuoteActivator.FactoryAlreadyBound.selector, address(factory)));
        activator.bindFactory(KyrveSeriesFactory(attacker));
    }

    function test_bindings_areDeployerOnly() public {
        KyrveQuoteRegistry fresh = new KyrveQuoteRegistry(address(midnight));
        vm.prank(attacker);
        vm.expectRevert(abi.encodeWithSelector(KyrveQuoteRegistry.NotDeployer.selector, attacker, address(this)));
        fresh.bindActivator(attacker);
    }

    function test_registry_activateIsActivatorOnly() public {
        QuoteExecution memory execution = registry.executionOf(bytes32("q"));
        QuoteProvenance memory provenance = registry.provenanceOf(bytes32("q"));

        vm.prank(attacker);
        vm.expectRevert(abi.encodeWithSelector(KyrveQuoteRegistry.NotActivator.selector, attacker, address(activator)));
        registry.activate(bytes32("q"), execution, provenance);
    }

    // ─────────────────────────────────────────────────────────────────────────────────────────
    // Hostile loan tokens
    // ─────────────────────────────────────────────────────────────────────────────────────────

    /// @dev A token that signals approval failure by RETURNING FALSE. Discarding that return would
    /// leave the allowance unset and surface as an opaque revert inside Midnight's `transferFrom`.
    function test_falseReturningApprove_revertsInsideTheCallback() public {
        FalseApprovingERC20 token = new FalseApprovingERC20("Hostile USD", "hUSD", 6);
        (bytes32 badQuoteId,, KyrveSeriesVault badVault, uint256 units, uint256 buyerAssets) =
            _activateOnLoanToken(address(token));

        bytes32 hostileMarketId = registry.executionOf(badQuoteId).marketId;
        Market memory hostileMarket = _marketOn(address(token));
        bytes memory data = abi.encode(badQuoteId);

        vm.prank(address(midnight));
        vm.expectRevert(abi.encodeWithSelector(KyrveSeriesVault.ApprovalRejected.selector, address(token), buyerAssets));
        badVault.onBuy(hostileMarketId, hostileMarket, buyerAssets, units, 0, address(badVault), data);
    }

    /// @dev A token that returns NOTHING. The ABI decoder rejects the empty return value, so the
    /// call reverts inside the vault. Failing closed is the correct outcome and is asserted here
    /// rather than assumed.
    function test_silentApprove_failsClosed() public {
        SilentApprovingERC20 token = new SilentApprovingERC20("Silent USD", "sUSD", 6);
        (bytes32 badQuoteId,, KyrveSeriesVault badVault, uint256 units, uint256 buyerAssets) =
            _activateOnLoanToken(address(token));

        bytes32 hostileMarketId = registry.executionOf(badQuoteId).marketId;
        Market memory hostileMarket = _marketOn(address(token));
        bytes memory data = abi.encode(badQuoteId);

        vm.prank(address(midnight));
        vm.expectRevert();
        badVault.onBuy(hostileMarketId, hostileMarket, buyerAssets, units, 0, address(badVault), data);
    }

    /// @dev The only external call the vault makes while a settlement is in flight is `approve`.
    /// A token that re-enters from inside it finds the quote already `Consumed`.
    function test_reentrantApprove_cannotSettleTwice() public {
        ReentrantApprovingERC20 token = new ReentrantApprovingERC20("Reentrant USD", "rUSD", 6);
        (bytes32 badQuoteId,, KyrveSeriesVault badVault, uint256 units, uint256 buyerAssets) =
            _activateOnLoanToken(address(token));

        bytes32 hostileMarketId = registry.executionOf(badQuoteId).marketId;
        Market memory hostileMarket = _marketOn(address(token));
        bytes memory data = abi.encode(badQuoteId);

        // The re-entrant call impersonates Midnight as far as it is able to, which is not at all:
        // it arrives with the token as `msg.sender`. Both refusals are asserted — the caller check
        // AND the fact that the quote was consumed exactly once.
        token.arm(
            address(badVault),
            abi.encodeCall(
                KyrveSeriesVault.onBuy, (hostileMarketId, hostileMarket, buyerAssets, units, 0, address(badVault), data)
            )
        );

        vm.prank(address(midnight));
        badVault.onBuy(hostileMarketId, hostileMarket, buyerAssets, units, 0, address(badVault), data);

        assertTrue(token.reentryAttempted(), "the re-entrant path was actually exercised");
        assertFalse(token.reentrySucceeded(), "and it was refused");
        assertEq(uint8(registry.statusOf(badQuoteId)), uint8(QuoteStatus.Consumed), "the quote settled exactly once");
    }

    // ─────────────────────────────────────────────────────────────────────────────────────────
    // Helpers
    // ─────────────────────────────────────────────────────────────────────────────────────────

    function _setResult(uint256 marketIndex, uint256 rateIndex, bool floorPassed, bool ready, uint256 aggregate)
        private
    {
        curve.setResult(
            epochId,
            CurveQuoteResult({
                marketIndex: marketIndex,
                rateIndex: rateIndex,
                privacyFloorPassed: floorPassed,
                quoteReady: ready,
                aggregateFillAmount: aggregate,
                graphRoot: graphRoot
            })
        );
    }

    /// @dev The fixture's 90-day WETH market, re-denominated in another loan token. Same collateral
    /// parameters, so `touchMarket` accepts it; a different loan token, so it is a different market.
    function _marketOn(address loanToken) private view returns (Market memory) {
        Market memory copy = fixtureContract.market(1);
        copy.loanToken = loanToken;
        return copy;
    }

    /// @dev Builds a whole second series on an arbitrary loan token and activates a quote on it.
    function _activateOnLoanToken(address loanToken)
        private
        returns (
            bytes32 newQuoteId,
            Offer memory newOffer,
            KyrveSeriesVault newVault,
            uint256 units,
            uint256 buyerAssets
        )
    {
        Market memory hostileMarket = _marketOn(loanToken);
        bytes32 hostileMarketId = midnight.touchMarket(hostileMarket);

        curve.addMarket(
            universeId,
            CurveMarketSpec({
                marketId: hostileMarketId,
                marketStructHash: keccak256(abi.encode(hostileMarket)),
                maturity: uint64(hostileMarket.maturity),
                collateralFamily: 0,
                maturityBucket: 0,
                tickSpacing: 4,
                settlementFeeFloorWad: 0,
                publicPriority: 0
            })
        );
        curve.addLeaf(
            universeId,
            CurveLeaf({marketIndex: 1, rateIndex: 0, tick: TICK, priceWad: TickLib.tickToPrice(uint256(uint24(TICK)))})
        );

        epochId = keccak256(abi.encode("hostile", loanToken));
        requestId = keccak256(abi.encode("hostile-request", loanToken));
        graphRoot = keccak256(abi.encode("hostile-root", loanToken));
        _configureEpoch(AGGREGATE_FILL);
        _setResult(1, 0, true, true, AGGREGATE_FILL);

        newVault = _createSeries(hostileMarketId, loanToken);
        (units, buyerAssets) = _expectedSize(AGGREGATE_FILL);
        FalseApprovingERC20(loanToken).mint(address(newVault), buyerAssets);

        QuoteActivator.ActivationRequest memory request = _request();
        request.market = hostileMarket;
        request.leafIndex = 1;
        vm.prank(keeper);
        (newQuoteId, newOffer) = activator.activate(request, _proofs());
    }

    // ── External wrappers, so `vm.expectRevert` binds to the intended call
    // ────────────────────

    function externalActivateExpecting(bytes32 root, bytes32 request_, bytes32 universe)
        external
        returns (bytes32, Offer memory)
    {
        QuoteActivator.ActivationRequest memory request = _request();
        request.expectedGraphRoot = root;
        request.expectedRequestId = request_;
        request.expectedUniverseId = universe;
        vm.prank(keeper);
        return activator.activate(request, _proofs());
    }

    function externalActivateWithLeaf(uint256 leafIndex) external returns (bytes32, Offer memory) {
        QuoteActivator.ActivationRequest memory request = _request();
        request.leafIndex = leafIndex;
        vm.prank(keeper);
        return activator.activate(request, _proofs());
    }

    function externalActivateWithMarket(Market memory replacement) external returns (bytes32, Offer memory) {
        QuoteActivator.ActivationRequest memory request = _request();
        request.market = replacement;
        vm.prank(keeper);
        return activator.activate(request, _proofs());
    }
}
