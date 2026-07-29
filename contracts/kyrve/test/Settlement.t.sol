// SPDX-License-Identifier: GPL-2.0-or-later
//
// The Phase 4 settlement lifecycle, against REAL unmodified Morpho Midnight (release 2026-07-23,
// commit dbd8d3d5). Nothing on the protocol path is mocked: a real Midnight is deployed through the
// same fixture `scripts/deploy/local.ts` uses, real markets are created, and every fill runs through
// the real `take` entry point.
//
// Proves PRD sections 2.4, 12.2, 12.4-12.7, 14.1-14.4 and invariants 4, 5, 6 and 7 of section 30.6.
pragma solidity 0.8.34;

import {IMidnight, Market, Offer} from "midnight/interfaces/IMidnight.sol";
import {TickLib} from "midnight/libraries/TickLib.sol";
import {DEFAULT_TICK_SPACING} from "midnight/libraries/ConstantsLib.sol";

import {KyrveQuoteRegistry} from "../KyrveQuoteRegistry.sol";
import {KyrveQuoteExpiryController} from "../KyrveQuoteExpiryController.sol";
import {KyrveSeriesVault} from "../KyrveSeriesVault.sol";
import {KyrveSettlementRatifier} from "../KyrveSettlementRatifier.sol";
import {QuoteActivator} from "../QuoteActivator.sol";
import {QuoteStatus} from "../KyrveQuoteTypes.sol";
import {ReentrantTaker} from "./ReentrantTaker.sol";
import {SettlementHarness} from "./SettlementHarness.sol";

contract SettlementTest is SettlementHarness {
    function setUp() public {
        _deploySubstrate();
        _deploySettlement();
        _configureUniverse();
        _configureEpoch(AGGREGATE_FILL);

        vault = _createSeries(marketId, address(fixtureContract.usdc()));
        (, uint256 buyerAssets) = _expectedSize(AGGREGATE_FILL);
        _fundVault(vault, buyerAssets);

        _activate();
        _supplyCollateral(borrower, exactUnits);
    }

    // ─────────────────────────────────────────────────────────────────────────────────────────
    // Activation: the boundary crossing
    // ─────────────────────────────────────────────────────────────────────────────────────────

    function test_activation_bindsEveryTerm() public view {
        assertEq(uint8(registry.statusOf(quoteId)), uint8(QuoteStatus.Executable), "quote is executable");
        assertEq(registry.quoteOfEpoch(epochId), quoteId, "epoch bound to exactly this quote");

        assertEq(registry.provenanceOf(quoteId).epochId, epochId, "epoch bound");
        assertEq(registry.provenanceOf(quoteId).graphRoot, graphRoot, "graph root bound");
        assertEq(registry.provenanceOf(quoteId).requestId, requestId, "request bound");
        assertEq(registry.provenanceOf(quoteId).universeId, universeId, "universe bound");
        assertEq(registry.provenanceOf(quoteId).deploymentId, registry.DEPLOYMENT_ID(), "deployment bound");
        assertEq(registry.provenanceOf(quoteId).marketStructHash, keccak256(abi.encode(market)), "market struct bound");
        assertEq(registry.provenanceOf(quoteId).aggregateFillAmount, AGGREGATE_FILL, "aggregate bound");
        assertEq(registry.provenanceOf(quoteId).tick, TICK, "tick bound");

        assertEq(registry.executionOf(quoteId).taker, borrower, "the approved borrower is the request's borrower");
        assertEq(registry.executionOf(quoteId).vault, address(vault), "the maker vault is derived, not supplied");
        assertEq(registry.executionOf(quoteId).ratifier, address(ratifier), "ratifier bound");
        assertEq(registry.executionOf(quoteId).marketId, marketId, "Midnight market id bound");
        assertEq(registry.executionOf(quoteId).offerHash, keccak256(abi.encode(offer)), "offer hash bound");

        assertEq(offer.group, quoteId, "the group IS the quote id");
        assertEq(offer.callback, address(vault), "the vault is the callback");
        assertEq(offer.maker, address(vault), "the vault is the maker");
        assertEq(offer.ratifier, address(ratifier), "the ratifier is bound into the offer");
        assertEq(offer.callbackData, abi.encode(quoteId), "callback data carries the quote id");
        assertTrue(offer.buy, "Kyrve is always the buyer of credit");
        assertEq(offer.maxAssets, 0, "exactly one of maxUnits/maxAssets is non-zero");
    }

    /// @dev The rule the whole of Phase 4 is sized against: the fill is the RESERVED sum, and the
    /// maker never owes more than that. Rounding up here would overdraw the reservation.
    function test_aggregate_isNotTheLeafCapacity() public view {
        (uint256 units, uint256 buyerAssets) = _expectedSize(AGGREGATE_FILL);

        assertEq(exactUnits, units, "units derived from the published aggregate");
        assertEq(expectedBuyerAssets, buyerAssets, "buyer assets derived from those units");
        assertLe(buyerAssets, AGGREGATE_FILL, "the maker never owes more than providers reserved");

        (uint256 capacityUnits,) = _expectedSize(LEAF_CAPACITY);
        assertTrue(capacityUnits != units, "the leaf capacity would have produced a different size");
        assertEq(AGGREGATE_FILL, LEAF_CAPACITY - 1, "the reference fixture's dust is exactly one unit");
    }

    /// @dev Identical terms produce an identical quote id, so the id check is what fires. Both
    /// guards exist; `test_activation_isOncePerEpoch_evenWithDifferentTerms` reaches the other.
    function test_activation_isOncePerQuoteId() public {
        _fundVault(vault, uint256(expectedBuyerAssets));
        vm.expectRevert(
            abi.encodeWithSelector(
                KyrveQuoteRegistry.QuoteAlreadyActivated.selector, quoteId, uint8(QuoteStatus.Executable)
            )
        );
        this.externalActivate();
    }

    /// @dev Different terms mean a different quote id, so only the epoch guard can stop it — and it
    /// must, or one confidential result would become two public quotes.
    function test_activation_isOncePerEpoch_evenWithDifferentTerms() public {
        _fundVault(vault, uint256(expectedBuyerAssets));
        vm.expectRevert(abi.encodeWithSelector(KyrveQuoteRegistry.EpochAlreadyQuoted.selector, epochId, quoteId));
        this.externalActivateWithLifetime(QUOTE_LIFETIME + 1);
    }

    function test_activation_isKeeperOnly() public {
        vm.prank(attacker);
        vm.expectRevert(abi.encodeWithSelector(QuoteActivator.NotKeeper.selector, attacker, keeper));
        activator.activate(_request(), _proofs());
    }

    // ─────────────────────────────────────────────────────────────────────────────────────────
    // The exact fill
    // ─────────────────────────────────────────────────────────────────────────────────────────

    function test_exactFill_settlesThroughUnmodifiedMidnight() public {
        uint256 vaultBefore = fixtureContract.usdc().balanceOf(address(vault));

        (uint256 buyerAssets, uint256 sellerAssets) = _take(exactUnits, borrower);

        assertEq(buyerAssets, expectedBuyerAssets, "buyerAssets equals Kyrve's quote math");
        assertEq(midnight.credit(marketId, address(vault)), exactUnits, "the vault holds the public credit");
        assertEq(midnight.debt(marketId, borrower), exactUnits, "the borrower holds the public debt");
        assertEq(fixtureContract.usdc().balanceOf(borrower), sellerAssets, "the borrower received seller assets");
        assertEq(vaultBefore - fixtureContract.usdc().balanceOf(address(vault)), buyerAssets, "the vault paid exactly");
        assertEq(uint8(registry.statusOf(quoteId)), uint8(QuoteStatus.Consumed), "the quote is consumed");
        assertEq(midnight.consumed(address(vault), quoteId), exactUnits, "the group is fully consumed");
        assertEq(vault.committedFunding(), 0, "the funding commitment is released on settlement");

        (uint128 credit, uint128 debt,) = vault.positionOf(marketId);
        assertEq(credit, exactUnits, "the vault exposes its public credit position");
        assertEq(debt, 0, "the maker takes no debt");
    }

    /// @dev PRD 20.2 "approval residue". Midnight pulls exactly `buyerAssets` in two transfers that
    /// sum to it, so a correct settlement leaves no allowance behind for anyone to spend later.
    function test_exactFill_leavesNoAllowanceResidue() public {
        _take(exactUnits, borrower);
        assertEq(
            fixtureContract.usdc().allowance(address(vault), address(midnight)),
            0,
            "the settlement consumed exactly the allowance it granted"
        );
    }

    // ─────────────────────────────────────────────────────────────────────────────────────────
    // Fill size. Midnight itself permits partial fills; only the callback stops them.
    // ─────────────────────────────────────────────────────────────────────────────────────────

    function test_attack_partialFill_reverts() public {
        uint256 partialUnits = uint256(exactUnits) - 1;
        vm.expectRevert(abi.encodeWithSelector(KyrveSeriesVault.WrongUnits.selector, exactUnits, partialUnits));
        _take(partialUnits, borrower);
    }

    function test_attack_halfFill_reverts() public {
        uint256 partialUnits = uint256(exactUnits) / 2;
        vm.expectRevert(abi.encodeWithSelector(KyrveSeriesVault.WrongUnits.selector, exactUnits, partialUnits));
        _take(partialUnits, borrower);
    }

    /// @dev Oversize is refused by Midnight's own group accounting, before Kyrve is reached.
    function test_attack_oversizedFill_reverts() public {
        vm.expectRevert(IMidnight.ConsumedUnits.selector);
        _take(uint256(exactUnits) + 1, borrower);
    }

    /// @dev The rollback proof: a rejected partial fill must leave NOTHING behind — not consumption,
    /// not credit, not debt, not a status change — and the exact fill must still work afterwards.
    function test_failedPartialFill_rollsBackEverything() public {
        uint256 vaultBefore = fixtureContract.usdc().balanceOf(address(vault));
        uint256 committedBefore = vault.committedFunding();

        try this.externalTake(uint256(exactUnits) / 2, borrower) {
            revert("a partial fill must not settle");
        } catch {}

        assertEq(midnight.consumed(address(vault), quoteId), 0, "group consumption rolled back");
        assertEq(midnight.credit(marketId, address(vault)), 0, "no credit created");
        assertEq(midnight.debt(marketId, borrower), 0, "no debt created");
        assertEq(uint8(registry.statusOf(quoteId)), uint8(QuoteStatus.Executable), "the quote is still live");
        assertEq(fixtureContract.usdc().balanceOf(address(vault)), vaultBefore, "no tokens moved");
        assertEq(vault.committedFunding(), committedBefore, "the funding commitment is intact");
        assertEq(
            fixtureContract.usdc().allowance(address(vault), address(midnight)), 0, "no allowance survived the revert"
        );

        _take(exactUnits, borrower);
        assertEq(midnight.credit(marketId, address(vault)), exactUnits, "the exact fill still settles");
    }

    // ─────────────────────────────────────────────────────────────────────────────────────────
    // Offer, taker and identity
    // ─────────────────────────────────────────────────────────────────────────────────────────

    function test_attack_wrongTaker_reverts() public {
        _supplyCollateral(attacker, exactUnits);
        vm.expectRevert(abi.encodeWithSelector(KyrveSettlementRatifier.UnauthorisedTaker.selector, borrower, attacker));
        _take(exactUnits, attacker);
    }

    function test_attack_alteredTick_reverts() public {
        offer.tick = uint256(uint24(TICK)) - DEFAULT_TICK_SPACING;
        vm.expectRevert(_alteredOffer());
        _take(exactUnits, borrower);
    }

    function test_attack_alteredMarket_reverts() public {
        offer.market = fixtureContract.market(0);
        vm.expectRevert(_alteredOffer());
        _take(exactUnits, borrower);
    }

    function test_attack_alteredCallback_reverts() public {
        offer.callback = address(0);
        vm.expectRevert(_alteredOffer());
        _take(exactUnits, borrower);
    }

    function test_attack_alteredMaxUnits_reverts() public {
        offer.maxUnits = exactUnits * 2;
        vm.expectRevert(_alteredOffer());
        _take(exactUnits, borrower);
    }

    /// @dev Ratifier spoofing. Authorising a ratifier on the maker's behalf is what would make a
    /// hostile one reachable at all, so only the activator may do it.
    function test_attack_authoriseForeignRatifier_reverts() public {
        KyrveSettlementRatifier other = new KyrveSettlementRatifier(address(midnight), registry);
        vm.prank(attacker);
        vm.expectRevert(abi.encodeWithSelector(KyrveSeriesVault.NotActivator.selector, attacker, address(activator)));
        vault.authoriseRatifier(address(other), true);
    }

    /// @dev Changing the group changes the offer, and the group is also the registry key: the
    /// substituted group has no quote at all.
    function test_attack_alteredGroup_reverts() public {
        offer.group = keccak256("kyrve.quote.someone-elses");
        vm.expectRevert(
            abi.encodeWithSelector(KyrveSettlementRatifier.QuoteNotExecutable.selector, offer.group, uint8(0))
        );
        _take(exactUnits, borrower);
    }

    /// @dev A whole second Kyrve deployment against the same Midnight, and both doors it could come
    /// through. First Midnight itself refuses, because the maker never authorised that ratifier.
    /// Then, even with the maker's authorisation granted, the other deployment's registry has never
    /// heard of this quote — which is what "wrong deployment" means at the settlement layer.
    function test_attack_wrongDeployment_reverts() public {
        KyrveQuoteRegistry otherRegistry = new KyrveQuoteRegistry(address(midnight));
        KyrveSettlementRatifier otherRatifier = new KyrveSettlementRatifier(address(midnight), otherRegistry);
        assertTrue(otherRegistry.DEPLOYMENT_ID() != registry.DEPLOYMENT_ID(), "two deployments, two identities");

        offer.ratifier = address(otherRatifier);
        vm.expectRevert(IMidnight.RatifierUnauthorized.selector);
        _take(exactUnits, borrower);

        vm.prank(address(activator));
        vault.authoriseRatifier(address(otherRatifier), true);
        vm.expectRevert(abi.encodeWithSelector(KyrveSettlementRatifier.QuoteNotExecutable.selector, quoteId, uint8(0)));
        _take(exactUnits, borrower);
    }

    function test_attack_replay_reverts() public {
        _take(exactUnits, borrower);
        vm.expectRevert(
            abi.encodeWithSelector(
                KyrveSettlementRatifier.QuoteNotExecutable.selector, quoteId, uint8(QuoteStatus.Consumed)
            )
        );
        _take(exactUnits, borrower);
    }

    function test_attack_directCallbackCall_reverts() public {
        vm.prank(attacker);
        vm.expectRevert(abi.encodeWithSelector(KyrveSeriesVault.CallbackCallerNotMidnight.selector, attacker));
        vault.onBuy(marketId, market, expectedBuyerAssets, exactUnits, 0, address(vault), abi.encode(quoteId));
    }

    /// @dev Callback spoofing with the RIGHT caller and the WRONG numbers. Even Midnight itself
    /// cannot make this vault accept a size the quote was not activated at.
    function test_attack_spoofedCallbackValues_reverts() public {
        vm.prank(address(midnight));
        vm.expectRevert(
            abi.encodeWithSelector(KyrveSeriesVault.WrongUnits.selector, exactUnits, uint256(exactUnits) - 1)
        );
        vault.onBuy(
            marketId, market, expectedBuyerAssets, uint256(exactUnits) - 1, 0, address(vault), abi.encode(quoteId)
        );
    }

    /// @dev Malicious callback data: a quote id this vault is not the maker for.
    function test_attack_maliciousCallbackData_reverts() public {
        bytes32 unknown = keccak256("kyrve.quote.unknown");
        vm.prank(address(midnight));
        vm.expectRevert(abi.encodeWithSelector(KyrveSeriesVault.QuoteNotExecutable.selector, unknown, uint8(0)));
        vault.onBuy(marketId, market, expectedBuyerAssets, exactUnits, 0, address(vault), abi.encode(unknown));
    }

    function test_attack_pendingFeeAboveCap_reverts() public {
        // The activated cap is enormous, so drive the check directly with a fee one above it.
        uint256 cap = registry.executionOf(quoteId).maxPendingFee;
        vm.prank(address(midnight));
        vm.expectRevert(abi.encodeWithSelector(KyrveSeriesVault.FeeAboveCap.selector, cap, cap + 1));
        vault.onBuy(marketId, market, expectedBuyerAssets, exactUnits, cap + 1, address(vault), abi.encode(quoteId));
    }

    function test_ratifierMustBeAuthorisedByTheMaker() public {
        vm.prank(address(activator));
        vault.authoriseRatifier(address(ratifier), false);
        vm.expectRevert(IMidnight.RatifierUnauthorized.selector);
        _take(exactUnits, borrower);
    }

    // ─────────────────────────────────────────────────────────────────────────────────────────
    // Re-entrancy
    // ─────────────────────────────────────────────────────────────────────────────────────────

    /// @dev The taker's own callback runs AFTER the tokens have moved, which is the most dangerous
    /// moment available. The quote is already `Consumed`, so the second fill is refused — and the
    /// assertion is that the RE-ENTRANT call failed, not merely that something reverted.
    function test_attack_reentrantTakerCallback_cannotSettleTwice() public {
        ReentrantTaker hostile = new ReentrantTaker(midnight);
        _supplyCollateral(address(hostile), exactUnits);

        // Re-point the quote at the hostile taker by activating a fresh epoch for it.
        _reactivateFor(address(hostile));
        hostile.arm(offer, exactUnits);

        hostile.take(offer, exactUnits);

        assertTrue(hostile.reentryAttempted(), "the re-entrant path was actually exercised");
        assertFalse(hostile.reentrySucceeded(), "the second settlement was refused");
        assertEq(midnight.consumed(address(vault), quoteId), exactUnits, "the group was consumed exactly once");
        assertEq(midnight.credit(marketId, address(vault)), exactUnits, "credit created exactly once");
    }

    // ─────────────────────────────────────────────────────────────────────────────────────────
    // Cancellation and expiry
    // ─────────────────────────────────────────────────────────────────────────────────────────

    function test_cancel_retiresTheQuoteAtTheProtocolLevel() public {
        vm.prank(operator);
        expiryController.cancelQuote(quoteId);

        assertEq(uint8(registry.statusOf(quoteId)), uint8(QuoteStatus.Cancelled), "cancelled");
        assertEq(midnight.consumed(address(vault), quoteId), exactUnits, "the group is pre-consumed");
        assertEq(vault.committedFunding(), 0, "the funding commitment is released");

        vm.expectRevert(
            abi.encodeWithSelector(
                KyrveSettlementRatifier.QuoteNotExecutable.selector, quoteId, uint8(QuoteStatus.Cancelled)
            )
        );
        _take(exactUnits, borrower);
    }

    function test_cancel_isOperatorOnly() public {
        vm.prank(attacker);
        vm.expectRevert(abi.encodeWithSelector(KyrveQuoteExpiryController.NotOperator.selector, attacker, operator));
        expiryController.cancelQuote(quoteId);
    }

    function test_cancel_isNotRepeatable() public {
        vm.startPrank(operator);
        expiryController.cancelQuote(quoteId);
        vm.expectRevert(
            abi.encodeWithSelector(
                KyrveQuoteExpiryController.QuoteNotExecutable.selector, quoteId, uint8(QuoteStatus.Cancelled)
            )
        );
        expiryController.cancelQuote(quoteId);
        vm.stopPrank();
    }

    /// @dev The cancellation race, both ways round. Whichever lands first wins; the other is
    /// refused by name. There is no ordering in which both succeed.
    function test_cancellationRace_settlementFirst() public {
        _take(exactUnits, borrower);
        vm.prank(operator);
        vm.expectRevert(
            abi.encodeWithSelector(
                KyrveQuoteExpiryController.QuoteNotExecutable.selector, quoteId, uint8(QuoteStatus.Consumed)
            )
        );
        expiryController.cancelQuote(quoteId);
    }

    function test_cancellationRace_cancellationFirst() public {
        vm.prank(operator);
        expiryController.cancelQuote(quoteId);
        vm.expectRevert(
            abi.encodeWithSelector(
                KyrveSettlementRatifier.QuoteNotExecutable.selector, quoteId, uint8(QuoteStatus.Cancelled)
            )
        );
        _take(exactUnits, borrower);
    }

    /// @dev The boundary. At exactly `expiry` the quote is still fillable and NOT yet recoverable;
    /// one second later the reverse. A quote that were both at once is a race over the same units.
    function test_expiry_boundaryIsExact() public {
        uint40 expiry = registry.executionOf(quoteId).expiry;

        vm.warp(expiry);
        vm.expectRevert(
            abi.encodeWithSelector(KyrveQuoteExpiryController.NotYetExpired.selector, quoteId, expiry, uint256(expiry))
        );
        expiryController.expireQuote(quoteId);

        // And at that same instant the fill is still admitted.
        uint256 snapshot = vm.snapshotState();
        _take(exactUnits, borrower);
        assertEq(midnight.credit(marketId, address(vault)), exactUnits, "fillable at exactly expiry");
        vm.revertToState(snapshot);

        vm.warp(uint256(expiry) + 1);
        expiryController.expireQuote(quoteId);
        assertEq(uint8(registry.statusOf(quoteId)), uint8(QuoteStatus.Expired), "expired one second later");
    }

    /// @dev Expiry is permissionless on purpose: committed funding must never be hostage to an
    /// operator's uptime.
    function test_expiry_isPermissionless_andRecoversFunding() public {
        uint40 expiry = registry.executionOf(quoteId).expiry;
        vm.warp(uint256(expiry) + 1);

        vm.prank(attacker);
        expiryController.expireQuote(quoteId);

        assertEq(uint8(registry.statusOf(quoteId)), uint8(QuoteStatus.Expired), "anyone may expire");
        assertEq(midnight.consumed(address(vault), quoteId), exactUnits, "the group is pre-consumed");
        assertEq(vault.committedFunding(), 0, "the commitment is released");

        uint256 recoverable = vault.availableFunding();
        assertEq(recoverable, expectedBuyerAssets, "the whole funding is recoverable");

        vm.prank(operator);
        vault.recoverFunding(recoverable, operator);
        assertEq(fixtureContract.usdc().balanceOf(operator), recoverable, "the operator recovered it");
        assertEq(vault.availableFunding(), 0, "nothing left behind");
    }

    /// @dev Recovery must never reach capital a live quote depends on.
    function test_recovery_cannotTouchCommittedFunding() public {
        assertEq(vault.availableFunding(), 0, "everything is committed to the live quote");
        vm.prank(operator);
        vm.expectRevert(abi.encodeWithSelector(KyrveSeriesVault.FundingShortfall.selector, uint256(1), uint256(0)));
        vault.recoverFunding(1, operator);
    }

    function test_recovery_isOperatorOnly() public {
        vm.prank(attacker);
        vm.expectRevert(abi.encodeWithSelector(KyrveSeriesVault.NotOperator.selector, attacker, operator));
        vault.recoverFunding(0, attacker);
    }

    function test_retireQuote_isExpiryControllerOnly() public {
        vm.prank(attacker);
        vm.expectRevert(
            abi.encodeWithSelector(KyrveSeriesVault.NotExpiryController.selector, attacker, address(expiryController))
        );
        vault.retireQuote(quoteId, QuoteStatus.Cancelled);
    }

    function test_registry_markConsumedIsVaultOnly() public {
        vm.prank(attacker);
        vm.expectRevert(
            abi.encodeWithSelector(KyrveQuoteRegistry.NotQuoteVault.selector, quoteId, attacker, address(vault))
        );
        registry.markConsumed(quoteId);
    }

    // ─────────────────────────────────────────────────────────────────────────────────────────
    // Helpers
    // ─────────────────────────────────────────────────────────────────────────────────────────

    function _alteredOffer() internal view returns (bytes memory) {
        return abi.encodeWithSelector(
            KyrveSettlementRatifier.AlteredOffer.selector,
            registry.executionOf(offer.group).offerHash,
            keccak256(abi.encode(offer))
        );
    }

    /// @dev Activates a second quote, for a different borrower, from a fresh epoch.
    function _reactivateFor(address newBorrower) internal {
        epochId = keccak256(abi.encode(epochId, newBorrower));
        requestId = keccak256(abi.encode(requestId, newBorrower));
        graphRoot = keccak256(abi.encode(graphRoot, newBorrower));
        borrower = newBorrower;

        _configureEpoch(AGGREGATE_FILL);
        (, uint256 buyerAssets) = _expectedSize(AGGREGATE_FILL);
        _fundVault(vault, buyerAssets);
        _activate();
    }
}
