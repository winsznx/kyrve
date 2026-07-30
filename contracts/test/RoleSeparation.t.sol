// SPDX-License-Identifier: GPL-2.0-or-later
//
// Role separation, from two directions.
//
// FIRST: `KyrveRoleRegistry` refuses to exist unless the seven roles are seven addresses. That is
// the structural half — a deployment that collapsed two roles cannot produce this contract, so a
// verifier finding one on chain has already been told the roles are separate.
//
// SECOND: role CONFUSION against the real settlement contracts. Separation is worthless if the
// separated authorities overlap, so every role is pointed at every other role's entry point and
// each refusal asserts the SPECIFIC error. A test that merely observed "it reverted" would pass
// against a contract that reverted for running out of gas.
pragma solidity 0.8.34;

import {Test} from "forge-std/Test.sol";

import {KyrveQuoteExpiryController} from "../kyrve/KyrveQuoteExpiryController.sol";
import {KyrveSeriesFactory} from "../kyrve/KyrveSeriesFactory.sol";
import {KyrveSeriesVault} from "../kyrve/KyrveSeriesVault.sol";
import {QuoteActivator} from "../kyrve/QuoteActivator.sol";
import {KyrveOsakaProbe} from "../registry/KyrveOsakaProbe.sol";
import {KyrveRoleRegistry} from "../registry/KyrveRoleRegistry.sol";
import {SettlementHarness} from "../kyrve/test/SettlementHarness.sol";

contract RoleRegistryTest is Test {
    bytes32 internal constant DEPLOYMENT_ID = keccak256("kyrve.deployment.phase6");

    address internal deployerRole = makeAddr("deployer");
    address internal keeperRole = makeAddr("keeper");
    address internal operatorRole = makeAddr("operator");
    address internal curatorRole = makeAddr("curator");
    address internal guardianRole = makeAddr("guardian");
    address internal beneficiaryRole = makeAddr("beneficiary");
    address internal auditorRole = makeAddr("auditor");

    function _holders() internal view returns (address[7] memory holders) {
        holders[uint256(KyrveRoleRegistry.Role.Deployer)] = deployerRole;
        holders[uint256(KyrveRoleRegistry.Role.Keeper)] = keeperRole;
        holders[uint256(KyrveRoleRegistry.Role.Operator)] = operatorRole;
        holders[uint256(KyrveRoleRegistry.Role.Curator)] = curatorRole;
        holders[uint256(KyrveRoleRegistry.Role.EmergencyAuthority)] = guardianRole;
        holders[uint256(KyrveRoleRegistry.Role.ResidueBeneficiary)] = beneficiaryRole;
        holders[uint256(KyrveRoleRegistry.Role.Auditor)] = auditorRole;
    }

    function _deployWith(address[7] memory holders) internal returns (KyrveRoleRegistry) {
        return new KyrveRoleRegistry(DEPLOYMENT_ID, block.chainid, holders);
    }

    function test_separatedRoleSet_deploysAndReportsEveryHolder() public {
        KyrveRoleRegistry registry = _deployWith(_holders());

        assertEq(registry.DEPLOYMENT_ID(), DEPLOYMENT_ID, "deployment id");
        assertEq(registry.CHAIN_ID(), block.chainid, "chain id");
        assertTrue(registry.rolesAreSeparated(), "a registry that exists is a separated role set");

        address[7] memory declared = registry.holders();
        address[7] memory expected = _holders();
        for (uint256 i = 0; i < 7; ++i) {
            assertEq(declared[i], expected[i], "holder order must match the enum");
            assertEq(registry.holderOf(KyrveRoleRegistry.Role(i)), expected[i], "holderOf");
        }
    }

    /// @dev The failure this whole contract exists to make impossible: every role one key. Through
    /// Phase 5 that was the real Sepolia deployment, and nothing on chain said so.
    function test_everyRoleOneAddress_isRefused() public {
        address[7] memory collapsed;
        for (uint256 i = 0; i < 7; ++i) {
            collapsed[i] = deployerRole;
        }
        vm.expectRevert(
            abi.encodeWithSelector(
                KyrveRoleRegistry.DuplicateRoleHolder.selector,
                KyrveRoleRegistry.Role.Deployer,
                KyrveRoleRegistry.Role.Keeper,
                deployerRole
            )
        );
        _deployWith(collapsed);
    }

    /// @dev Every one of the twenty-one pairs, not a sample. A registry that caught only adjacent
    /// collisions would admit `curator == auditor`, which is exactly the collapse Capsule cares
    /// about: an auditor who can also publish the supply snapshot is not an auditor.
    function test_everyPairOfRoles_isRefusedWhenCollapsed() public {
        for (uint256 first = 0; first < 7; ++first) {
            for (uint256 second = first + 1; second < 7; ++second) {
                address[7] memory holders = _holders();
                address survivor = holders[first];
                holders[second] = survivor;

                vm.expectRevert(
                    abi.encodeWithSelector(
                        KyrveRoleRegistry.DuplicateRoleHolder.selector,
                        KyrveRoleRegistry.Role(first),
                        KyrveRoleRegistry.Role(second),
                        survivor
                    )
                );
                _deployWith(holders);
            }
        }
    }

    function test_zeroHolder_isRefusedForEveryRole() public {
        for (uint256 i = 0; i < 7; ++i) {
            address[7] memory holders = _holders();
            holders[i] = address(0);
            vm.expectRevert(
                abi.encodeWithSelector(KyrveRoleRegistry.ZeroRoleHolder.selector, KyrveRoleRegistry.Role(i))
            );
            _deployWith(holders);
        }
    }

    /// @dev A role table read against the wrong chain is a role table that proves nothing. The chain
    /// id is an argument rather than only `block.chainid` so the deployment script's belief about
    /// which network it is on is checked against the network itself.
    function test_wrongChainId_isRefused() public {
        vm.expectRevert(abi.encodeWithSelector(KyrveRoleRegistry.WrongChain.selector, block.chainid, block.chainid + 1));
        new KyrveRoleRegistry(DEPLOYMENT_ID, block.chainid + 1, _holders());
    }

    function test_accountKind_recordsCodePresenceAtDeclaration() public {
        address contractHolder = address(new KyrveOsakaProbe());
        address[7] memory holders = _holders();
        holders[uint256(KyrveRoleRegistry.Role.Operator)] = contractHolder;

        KyrveRoleRegistry registry = _deployWith(holders);

        assertTrue(
            registry.wasContractAtDeclaration(KyrveRoleRegistry.Role.Operator),
            "an operator with code must be recorded as a contract"
        );
        assertFalse(
            registry.wasContractAtDeclaration(KyrveRoleRegistry.Role.Keeper),
            "a bare key must not be recorded as a contract"
        );
        assertTrue(registry.isContractNow(KyrveRoleRegistry.Role.Operator), "live answer agrees at t=0");
    }

    /// @dev The snapshot and the live answer are separate accessors because they can disagree, and
    /// the registry claims only the snapshot. `vm.etch` reproduces the disagreement an EIP-7702
    /// delegation or a pre-computed CREATE2 address produces on a real chain.
    function test_accountKind_snapshotAndLiveAnswerCanDisagree() public {
        KyrveRoleRegistry registry = _deployWith(_holders());
        assertFalse(registry.wasContractAtDeclaration(KyrveRoleRegistry.Role.Auditor), "no code at declaration");

        vm.etch(auditorRole, address(new KyrveOsakaProbe()).code);

        assertFalse(
            registry.wasContractAtDeclaration(KyrveRoleRegistry.Role.Auditor),
            "the snapshot is what was true then, and must not move"
        );
        assertTrue(registry.isContractNow(KyrveRoleRegistry.Role.Auditor), "the live answer is what is true now");
    }

    function test_roleOf_identifiesHoldersAndRefusesStrangers() public {
        KyrveRoleRegistry registry = _deployWith(_holders());

        (bool foundKeeper, KyrveRoleRegistry.Role keeperSlot) = registry.roleOf(keeperRole);
        assertTrue(foundKeeper, "the keeper holds a role");
        assertEq(uint256(keeperSlot), uint256(KyrveRoleRegistry.Role.Keeper), "and it is the keeper's");

        (bool foundStranger,) = registry.roleOf(makeAddr("stranger"));
        assertFalse(foundStranger, "an address holding no role must not be given one");

        (bool foundZero,) = registry.roleOf(address(0));
        assertFalse(foundZero, "the zero address holds no role");
    }
}

/// @dev Role CONFUSION against the deployed settlement contracts. Separation without disjoint
/// authority is decoration, so each role is pointed at every other role's entry point.
contract RoleConfusionTest is SettlementHarness {
    /**
     * @dev Read once in `setUp` and never inside an assertion.
     *
     * `vm.expectRevert` binds to the next EXTERNAL call, and `fixtureContract.usdc()` written inline
     * as an argument IS that call — it is evaluated first, returns successfully, and the assertion
     * attaches to it instead of to `createSeries`. Four tests here failed exactly that way before
     * the read was hoisted. `.claude/rules/testing.md` names the rule; this is what it looks like.
     */
    address internal loanToken;

    function setUp() public {
        _deploySubstrate();
        _deploySettlement();
        _configureUniverse();
        _configureEpoch(AGGREGATE_FILL);

        loanToken = address(fixtureContract.usdc());
        vault = _createSeries(marketId, loanToken);
        (, uint256 buyerAssets) = _expectedSize(AGGREGATE_FILL);
        _fundVault(vault, buyerAssets);
    }

    // ─────────────────────────────────────────────────────────────────────────────────────────
    // The keeper advances computation and nothing else
    // ─────────────────────────────────────────────────────────────────────────────────────────

    function test_keeper_cannotCancelAQuote() public {
        _activate();
        vm.prank(keeper);
        vm.expectRevert(abi.encodeWithSelector(KyrveQuoteExpiryController.NotOperator.selector, keeper, operator));
        expiryController.cancelQuote(quoteId);
    }

    function test_keeper_cannotRecoverFunding() public {
        vm.prank(keeper);
        vm.expectRevert(abi.encodeWithSelector(KyrveSeriesVault.NotOperator.selector, keeper, operator));
        vault.recoverFunding(1, keeper);
    }

    function test_keeper_cannotCreateASeries() public {
        vm.prank(keeper);
        vm.expectRevert(abi.encodeWithSelector(KyrveSeriesFactory.NotCurator.selector, keeper, curator));
        factory.createSeries(keccak256("another-market"), loanToken, operator);
    }

    // ─────────────────────────────────────────────────────────────────────────────────────────
    // The operator performs declared operational actions and nothing else
    // ─────────────────────────────────────────────────────────────────────────────────────────

    function test_operator_cannotActivateAQuote() public {
        vm.prank(operator);
        vm.expectRevert(abi.encodeWithSelector(QuoteActivator.NotKeeper.selector, operator, keeper));
        activator.activate(_request(), _proofs());
    }

    function test_operator_cannotCreateASeries() public {
        vm.prank(operator);
        vm.expectRevert(abi.encodeWithSelector(KyrveSeriesFactory.NotCurator.selector, operator, curator));
        factory.createSeries(keccak256("another-market"), loanToken, operator);
    }

    // ─────────────────────────────────────────────────────────────────────────────────────────
    // The curator registers reviewed things and moves no funds
    // ─────────────────────────────────────────────────────────────────────────────────────────

    function test_curator_cannotActivateAQuote() public {
        vm.prank(curator);
        vm.expectRevert(abi.encodeWithSelector(QuoteActivator.NotKeeper.selector, curator, keeper));
        activator.activate(_request(), _proofs());
    }

    function test_curator_cannotRecoverFunding() public {
        vm.prank(curator);
        vm.expectRevert(abi.encodeWithSelector(KyrveSeriesVault.NotOperator.selector, curator, operator));
        vault.recoverFunding(1, curator);
    }

    function test_curator_cannotCancelAQuote() public {
        _activate();
        vm.prank(curator);
        vm.expectRevert(abi.encodeWithSelector(KyrveQuoteExpiryController.NotOperator.selector, curator, operator));
        expiryController.cancelQuote(quoteId);
    }

    // ─────────────────────────────────────────────────────────────────────────────────────────
    // An address holding no role holds no authority at all
    // ─────────────────────────────────────────────────────────────────────────────────────────

    function test_attacker_holdsNoneOfTheThreeAuthorities() public {
        vm.prank(attacker);
        vm.expectRevert(abi.encodeWithSelector(QuoteActivator.NotKeeper.selector, attacker, keeper));
        activator.activate(_request(), _proofs());

        vm.prank(attacker);
        vm.expectRevert(abi.encodeWithSelector(KyrveSeriesVault.NotOperator.selector, attacker, operator));
        vault.recoverFunding(1, attacker);

        vm.prank(attacker);
        vm.expectRevert(abi.encodeWithSelector(KyrveSeriesFactory.NotCurator.selector, attacker, curator));
        factory.createSeries(keccak256("another-market"), loanToken, operator);
    }

    // ─────────────────────────────────────────────────────────────────────────────────────────
    // Residue redirection — the role that is a destination, not an authority
    // ─────────────────────────────────────────────────────────────────────────────────────────

    /**
     * @dev The operator CAN recover uncommitted funding to an address of their choosing, and this
     *      test states that rather than pretending otherwise. What it pins is the boundary: the
     *      amount is capped by {KyrveSeriesVault.availableFunding}, which excludes every token
     *      committed to a live quote — so the operator can never redirect capital a quote is
     *      relying on, and a live quote cannot be starved by a recovery.
     *
     *      The residue's own destination is not reachable from here at all: it is an `immutable` on
     *      `SeriesResidueAccount` and `distribute()` takes no parameters. Delta T-6.
     */
    function test_operatorRecovery_cannotReachCommittedFunding() public {
        _activate();

        uint256 available = vault.availableFunding();
        assertEq(available, 0, "every funded token is committed to the live quote");

        vm.prank(operator);
        vm.expectRevert(abi.encodeWithSelector(KyrveSeriesVault.FundingShortfall.selector, 1, 0));
        vault.recoverFunding(1, operator);
    }

    // ─────────────────────────────────────────────────────────────────────────────────────────
    // Privilege overlap — no single role completes the path
    // ─────────────────────────────────────────────────────────────────────────────────────────

    /**
     * @dev The property the separation is FOR. Creating a series is the curator's, activating
     *      against it is the keeper's, and neither can do the other's step — so bringing a quote
     *      into existence requires two keys even though it is one logical operation.
     */
    function test_noSingleRole_canCreateAndActivate() public {
        bytes32 otherMarketId = _secondMarketId();

        vm.prank(keeper);
        vm.expectRevert(abi.encodeWithSelector(KyrveSeriesFactory.NotCurator.selector, keeper, curator));
        factory.createSeries(otherMarketId, loanToken, operator);

        vm.prank(curator);
        factory.createSeries(otherMarketId, loanToken, operator);

        vm.prank(curator);
        vm.expectRevert(abi.encodeWithSelector(QuoteActivator.NotKeeper.selector, curator, keeper));
        activator.activate(_request(), _proofs());
    }

    function _secondMarketId() internal pure returns (bytes32) {
        return keccak256("kyrve.test.secondMarket");
    }
}
