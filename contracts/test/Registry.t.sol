// SPDX-License-Identifier: GPL-2.0-or-later
pragma solidity 0.8.34;

import {Test} from "forge-std/Test.sol";

import {KyrveProtocolRegistry} from "../registry/KyrveProtocolRegistry.sol";
import {KyrveDeploymentVerifier} from "../registry/KyrveDeploymentVerifier.sol";
import {KyrveOsakaProbe} from "../registry/KyrveOsakaProbe.sol";
import {LocalMidnightFixture} from "../integration/LocalMidnightFixture.sol";

contract RegistryTest is Test {
    KyrveProtocolRegistry internal registry;
    KyrveDeploymentVerifier internal verifier;
    KyrveOsakaProbe internal probe;
    LocalMidnightFixture internal fixtureContract;

    address internal admin = address(this);
    address internal outsider = makeAddr("outsider");
    address internal noxCompute = makeAddr("noxCompute");
    address internal noxImplementation;

    function setUp() public {
        fixtureContract = new LocalMidnightFixture();
        fixtureContract.deploy(block.timestamp);

        probe = new KyrveOsakaProbe();
        registry = new KyrveProtocolRegistry(admin);
        verifier = new KyrveDeploymentVerifier(address(registry));

        // Stand in for the Nox proxy and implementation with real code, so code-hash checks are
        // exercised against something rather than skipped.
        noxImplementation = address(new KyrveOsakaProbe());
        vm.etch(noxCompute, address(probe).code);

        registry.registerDeployment(1, _deployment());
    }

    function _deployment() internal view returns (KyrveProtocolRegistry.Deployment memory) {
        return KyrveProtocolRegistry.Deployment({
            chainId: block.chainid,
            midnight: address(fixtureContract.midnight()),
            midnightRelease: keccak256("2026-07-23"),
            midnightRuntimeHash: keccak256(address(fixtureContract.midnight()).code),
            noxCompute: noxCompute,
            noxImplementation: noxImplementation,
            noxImplementationHash: keccak256(noxImplementation.code),
            kyrveVersion: keccak256("phase/01-foundations"),
            manifestHash: keccak256("manifest"),
            licenceDisclosureHash: keccak256("LICENSE"),
            osakaProbe: address(probe),
            registeredAt: 0,
            exists: false
        });
    }

    // -------------------------------------------------------------------------------------
    // Osaka probe
    // -------------------------------------------------------------------------------------

    /// @dev The exact three inputs Day 0 verified against live Sepolia, plus the zero case.
    function test_osakaProbe_returnsCorrectClzResults() public view {
        assertEq(probe.clz(1), 255, "clz(1)");
        assertEq(probe.clz(1 << 255), 0, "clz(1<<255)");
        assertEq(probe.clz(1 << 128), 127, "clz(1<<128)");
        assertEq(probe.clz(0), 256, "clz(0)");
    }

    function test_osakaProbe_verifiesAndAsserts() public view {
        assertTrue(probe.verifyOsaka(), "Osaka must be available under evm_version = osaka");
        probe.assertOsaka();
        assertEq(probe.chainId(), block.chainid);
    }

    /// @dev CLZ is mathematically correct across the whole width, not just at the sampled points.
    function testFuzz_osakaProbe_clzMatchesReference(uint256 x) public view {
        uint256 expected = 256;
        for (uint256 bit = 256; bit > 0; bit--) {
            if (x >> (bit - 1) & 1 == 1) {
                expected = 256 - bit;
                break;
            }
        }
        assertEq(probe.clz(x), expected);
    }

    // -------------------------------------------------------------------------------------
    // Registration
    // -------------------------------------------------------------------------------------

    function test_registry_recordsAndReadsBack() public view {
        KyrveProtocolRegistry.Deployment memory d = registry.currentDeployment();
        assertEq(d.chainId, block.chainid);
        assertEq(d.midnight, address(fixtureContract.midnight()));
        assertEq(d.midnightRelease, keccak256("2026-07-23"));
        assertTrue(d.exists);
        assertEq(registry.latestVersion(), 1);
    }

    function test_registry_answersSupportedFlatly() public view {
        assertTrue(registry.isSupportedMidnight(address(fixtureContract.midnight())));
        assertTrue(registry.isSupportedNoxCompute(noxCompute));
    }

    /// @dev The registry must never claim a mismatched address is supported.
    function test_registry_refusesUnknownAddresses() public view {
        assertFalse(registry.isSupportedMidnight(outsider), "unknown midnight");
        assertFalse(registry.isSupportedNoxCompute(outsider), "unknown nox");
        assertFalse(registry.isSupportedMidnight(address(0)), "zero address is never supported");
        assertFalse(registry.isSupportedNoxCompute(address(0)), "zero address is never supported");
    }

    function test_registry_versionIsWriteOnce() public {
        // Built BEFORE expectRevert: _deployment() reads the fixture over external calls, and
        // vm.expectRevert binds to the next EXTERNAL call, not the next statement.
        KyrveProtocolRegistry.Deployment memory d = _deployment();
        vm.expectRevert(abi.encodeWithSelector(KyrveProtocolRegistry.AlreadyRegistered.selector, 1));
        registry.registerDeployment(1, d);
    }

    function test_registry_rejectsWrongChain() public {
        KyrveProtocolRegistry.Deployment memory d = _deployment();
        d.chainId = block.chainid + 1;
        vm.expectRevert(abi.encodeWithSelector(KyrveProtocolRegistry.WrongChain.selector, block.chainid, d.chainId));
        registry.registerDeployment(2, d);
    }

    function test_registry_rejectsZeroAddresses() public {
        KyrveProtocolRegistry.Deployment memory d = _deployment();
        d.midnight = address(0);
        vm.expectRevert(abi.encodeWithSelector(KyrveProtocolRegistry.ZeroAddress.selector, "midnight"));
        registry.registerDeployment(2, d);
    }

    function test_registry_rejectsNonAdmin() public {
        KyrveProtocolRegistry.Deployment memory d = _deployment();
        vm.prank(outsider);
        vm.expectRevert(abi.encodeWithSelector(KyrveProtocolRegistry.NotAdmin.selector, outsider));
        registry.registerDeployment(2, d);
    }

    function test_registry_unknownVersionReverts() public {
        vm.expectRevert(abi.encodeWithSelector(KyrveProtocolRegistry.UnknownVersion.selector, 99));
        registry.deployment(99);
    }

    // -------------------------------------------------------------------------------------
    // Admin transfer is two-step
    // -------------------------------------------------------------------------------------

    function test_adminTransfer_requiresAcceptance() public {
        registry.beginAdminTransfer(outsider);
        assertEq(registry.admin(), admin, "admin unchanged until accepted");

        vm.prank(outsider);
        registry.acceptAdminTransfer();
        assertEq(registry.admin(), outsider);
        assertEq(registry.pendingAdmin(), address(0));
    }

    function test_adminTransfer_onlyPendingMayAccept() public {
        registry.beginAdminTransfer(outsider);
        address stranger = makeAddr("stranger");
        vm.prank(stranger);
        vm.expectRevert(abi.encodeWithSelector(KyrveProtocolRegistry.NotPendingAdmin.selector, stranger));
        registry.acceptAdminTransfer();
    }

    // -------------------------------------------------------------------------------------
    // Verification
    // -------------------------------------------------------------------------------------

    function test_verifier_passesOnAConsistentDeployment() public view {
        KyrveDeploymentVerifier.VerificationReport memory r = verifier.verify();
        assertTrue(r.chainMatches, "chain");
        assertTrue(r.midnightCodeMatches, "midnight bytecode");
        assertTrue(r.noxComputeHasCode, "nox has code");
        assertTrue(r.noxImplementationMatches, "nox implementation bytecode");
        assertTrue(r.osakaAvailable, "osaka");
        assertTrue(r.registryConsistent, "registry consistent");
        assertTrue(r.notEmergencyStopped, "not stopped");
        assertTrue(r.allPassed, "all");
    }

    /// @dev The check that catches a substituted protocol core. Without this, a registry entry
    /// would prove only that somebody wrote an address down.
    function test_verifier_detectsSubstitutedMidnightBytecode() public {
        vm.etch(address(fixtureContract.midnight()), hex"600160005500");
        KyrveDeploymentVerifier.VerificationReport memory r = verifier.verify();
        assertFalse(r.midnightCodeMatches, "substituted core must be detected");
        assertFalse(r.allPassed);
    }

    /// @dev A UUPS implementation rotation is a total change in behaviour and must be detected.
    function test_verifier_detectsRotatedNoxImplementation() public {
        vm.etch(noxImplementation, hex"600160005500");
        KyrveDeploymentVerifier.VerificationReport memory r = verifier.verify();
        assertFalse(r.noxImplementationMatches, "rotated implementation must be detected");
        assertFalse(r.allPassed);
    }

    function test_verifier_reportsEmergencyStop() public {
        registry.setEmergencyStopped(true);
        KyrveDeploymentVerifier.VerificationReport memory r = verifier.verify();
        assertFalse(r.notEmergencyStopped);
        assertFalse(r.allPassed);
    }

    function test_verifier_exposesExpectedValues() public view {
        assertEq(verifier.expectedChainId(1), block.chainid);
        assertEq(verifier.expectedRelease(1), keccak256("2026-07-23"));
        assertEq(verifier.expectedManifestHash(1), keccak256("manifest"));
        assertEq(verifier.expectedMidnightRuntimeHash(1), keccak256(address(fixtureContract.midnight()).code));
    }

    /// @dev An address with no code hashes to zero, not to keccak(""), so "nothing deployed here"
    /// is unambiguous rather than colliding with a real hash.
    function test_verifier_runtimeCodeHashOfEmptyAddressIsZero() public {
        assertEq(verifier.runtimeCodeHash(makeAddr("nothing")), bytes32(0));
        assertGt(uint256(verifier.runtimeCodeHash(address(probe))), 0);
    }

    /// @dev The EIP-1967 slot is exposed so off-chain verification uses this constant rather than
    /// a separately transcribed one. Value: keccak256("eip1967.proxy.implementation") - 1.
    function test_verifier_exposesEip1967Slot() public view {
        assertEq(verifier.eip1967ImplementationSlot(), bytes32(uint256(keccak256("eip1967.proxy.implementation")) - 1));
    }

    function test_wrapperRegistry_setAndRead() public {
        address underlying = makeAddr("usdc");
        address wrapper = makeAddr("kUSDC");
        registry.setConfidentialWrapper(underlying, wrapper);
        assertEq(registry.confidentialWrapper(underlying), wrapper);
    }

    function test_wrapperRegistry_rejectsNonAdmin() public {
        vm.prank(outsider);
        vm.expectRevert(abi.encodeWithSelector(KyrveProtocolRegistry.NotAdmin.selector, outsider));
        registry.setConfidentialWrapper(makeAddr("a"), makeAddr("b"));
    }
}
