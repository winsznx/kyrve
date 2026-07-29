// SPDX-License-Identifier: GPL-2.0-or-later
pragma solidity 0.8.34;

import {KyrveProtocolRegistry} from "./KyrveProtocolRegistry.sol";
import {KyrveOsakaProbe} from "./KyrveOsakaProbe.sol";

/// @dev Read-only verification of a live Kyrve deployment against what the registry claims.
///
/// Every function here is `view` and the contract holds no state and no privileges. It exists so
/// that "is this deployment the one we think it is?" can be answered from on chain, by anyone,
/// without trusting an off-chain manifest or an indexer.
///
/// The distinction that matters: the registry records what was INTENDED; this contract reads what
/// is ACTUALLY deployed and compares. A registry entry alone proves nothing, because whoever wrote
/// it could have written anything.
contract KyrveDeploymentVerifier {
    KyrveProtocolRegistry public immutable REGISTRY;

    /// @dev EIP-1967 implementation slot: bytes32(uint256(keccak256("eip1967.proxy.implementation")) - 1).
    bytes32 internal constant EIP1967_IMPLEMENTATION_SLOT =
        0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc;

    constructor(address registry) {
        REGISTRY = KyrveProtocolRegistry(registry);
    }

    /// @dev Every individual check, so a caller sees exactly which one failed rather than a
    /// single opaque boolean.
    struct VerificationReport {
        bool chainMatches;
        bool midnightCodeMatches;
        bool noxComputeHasCode;
        bool noxImplementationMatches;
        bool osakaAvailable;
        bool registryConsistent;
        bool notEmergencyStopped;
        bool allPassed;
    }

    function verify() external view returns (VerificationReport memory report) {
        return verifyVersion(REGISTRY.latestVersion());
    }

    function verifyVersion(uint256 version) public view returns (VerificationReport memory report) {
        KyrveProtocolRegistry.Deployment memory d = REGISTRY.deployment(version);

        report.chainMatches = d.chainId == block.chainid;

        // The recorded Midnight runtime bytecode hash must match what is actually at the address.
        // This is the check that catches a redeployed or substituted protocol core.
        report.midnightCodeMatches =
            d.midnightRuntimeHash != bytes32(0) && _codeHash(d.midnight) == d.midnightRuntimeHash;

        report.noxComputeHasCode = d.noxCompute.code.length > 0;

        // Nox is a UUPS proxy, and an implementation rotation is a total change in behaviour, so
        // the implementation's own code hash is what gets pinned. Note the boundary precisely:
        // a contract CANNOT read another contract's storage, so this does not and cannot prove
        // that `noxImplementation` is currently the one `noxCompute` delegates to. That binding
        // is established off chain by `verify:deployment` reading the EIP-1967 slot with
        // `eth_getStorageAt`. What is proven here is that the pinned implementation still holds
        // the pinned bytecode.
        report.noxImplementationMatches =
            d.noxImplementationHash != bytes32(0) && _codeHash(d.noxImplementation) == d.noxImplementationHash;

        // Executes the probe rather than trusting that one was recorded. A chain without Osaka
        // cannot return true here — the CLZ opcode reverts as undefined.
        report.osakaAvailable = _osakaAvailable(d.osakaProbe);

        report.registryConsistent =
            REGISTRY.isSupportedMidnight(d.midnight) && REGISTRY.isSupportedNoxCompute(d.noxCompute);

        report.notEmergencyStopped = !REGISTRY.emergencyStopped();

        report.allPassed = report.chainMatches && report.midnightCodeMatches && report.noxComputeHasCode
            && report.noxImplementationMatches && report.osakaAvailable && report.registryConsistent
            && report.notEmergencyStopped;
    }

    /// @dev The expected chain for a registered version.
    function expectedChainId(uint256 version) external view returns (uint256) {
        return REGISTRY.deployment(version).chainId;
    }

    function expectedMidnightRuntimeHash(uint256 version) external view returns (bytes32) {
        return REGISTRY.deployment(version).midnightRuntimeHash;
    }

    function expectedRelease(uint256 version) external view returns (bytes32) {
        return REGISTRY.deployment(version).midnightRelease;
    }

    function expectedManifestHash(uint256 version) external view returns (bytes32) {
        return REGISTRY.deployment(version).manifestHash;
    }

    /// @dev Live runtime-bytecode hash at an address. Returns zero for an address with no code,
    /// rather than the keccak of empty bytes, so "no contract here" is unambiguous.
    function runtimeCodeHash(address target) external view returns (bytes32) {
        return _codeHash(target);
    }

    /// @dev The EIP-1967 implementation slot, exposed so off-chain verification reads the same
    /// constant this contract documents rather than a separately transcribed one.
    function eip1967ImplementationSlot() external pure returns (bytes32) {
        return EIP1967_IMPLEMENTATION_SLOT;
    }

    function _codeHash(address target) internal view returns (bytes32) {
        if (target.code.length == 0) return bytes32(0);
        return keccak256(target.code);
    }

    /// @dev Calls the probe rather than trusting that one was recorded. A chain that lacks Osaka
    /// reverts on the undefined CLZ opcode, which the `catch` turns into a clean `false`.
    function _osakaAvailable(address osakaProbe) internal view returns (bool) {
        if (osakaProbe.code.length == 0) return false;
        try KyrveOsakaProbe(osakaProbe).verifyOsaka() returns (bool ok) {
            return ok;
        } catch {
            return false;
        }
    }
}
