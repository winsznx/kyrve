// SPDX-License-Identifier: GPL-2.0-or-later
pragma solidity 0.8.36;

import {Nox, ebool, euint16, euint256} from "@iexec-nox/nox-protocol-contracts/contracts/sdk/Nox.sol";

import {KyrveConfidentialBase} from "./KyrveConfidentialBase.sol";
import {KyrveEmergencyController} from "./KyrveEmergencyController.sol";

/**
 * @title KyrveCurveBase
 * @notice Handle isolation — the P3-1 discharge, in one place so it has exactly one implementation.
 *
 * Read `docs/phase3/HANDLE-LINEAGE.md` before changing anything here. The short version, read from
 * `modules/Compute.sol` (nox-protocol-contracts 0.2.4):
 *
 *     handle = keccak256(abi.encode(operator, operands, noxCompute, uniqueSeed, outputIndex))
 *     uniqueSeed = 0                    if ANY operand is confidential   -> DETERMINISTIC
 *                = ++storageCounter     if EVERY operand is public       -> unpredictable
 *
 * So two logically distinct encrypted quantities computed identically from identical operands are
 * **one handle sharing one permanent ACL entry** — and there is no `removeAdmin`. Phase 2 shipped a
 * vault draft that leaked the protocol aggregate to its first depositor exactly this way (delta
 * Q-5), and a test caught it, not a review.
 *
 * The curve engine accumulates across 16 providers and 128 leaves, so coincidence is the common
 * case rather than a corner case: two providers with identical mandates produce identical
 * intermediates all the way down, and every leaf on a disabled market produces the same
 * accumulator.
 *
 * ────────────────────────────────────────────────────────────────────────────────────────────
 * THE RULE
 * ────────────────────────────────────────────────────────────────────────────────────────────
 *
 * It is not "avoid collisions" — that is neither achievable nor necessary. It is:
 *
 *     NEVER GRANT A USER OR THE PUBLIC A HANDLE THAT SOMETHING ELSE COULD EQUAL.
 *
 * Intermediates collide freely and harmlessly because nobody is ever granted one. Every handle that
 * crosses the boundary — a provider's allocation, remaining balance and reservation, and the five
 * published results — is isolated first.
 */
abstract contract KyrveCurveBase is KyrveConfidentialBase {
    /// @dev Bit 0 of a handle's attribute byte. Set by every `_executeOperation` output; cleared by
    ///      `wrapAsPublicHandle`, which is what `Nox.toEuint16/toEuint256/toEbool` compile to.
    bytes1 private constant ATTR_IS_UNIQUE_HANDLE = 0x01;

    // Domain roles. Distinct roles mean distinct tags mean distinct handles.
    bytes32 internal constant ROLE_ALLOCATION = keccak256("kyrve.curve.allocation");
    bytes32 internal constant ROLE_REMAINING = keccak256("kyrve.curve.remaining");
    bytes32 internal constant ROLE_RESERVED = keccak256("kyrve.curve.reserved");
    bytes32 internal constant ROLE_EPOCH_SALT = keccak256("kyrve.curve.epochSalt");
    bytes32 internal constant ROLE_SELECTED_MARKET = keccak256("kyrve.curve.selectedMarketIndex");
    bytes32 internal constant ROLE_SELECTED_RATE = keccak256("kyrve.curve.selectedRateIndex");
    bytes32 internal constant ROLE_PRIVACY_FLOOR = keccak256("kyrve.curve.privacyFloorPassed");
    bytes32 internal constant ROLE_QUOTE_READY = keccak256("kyrve.curve.quoteReady");
    bytes32 internal constant ROLE_AGGREGATE_FILL = keccak256("kyrve.curve.aggregateFillAmount");

    error HandleIsNotConfidential(bytes32 handle);

    constructor(KyrveEmergencyController controller) KyrveConfidentialBase(controller) {}

    /**
     * @notice The domain a handle is isolated under.
     * @dev Every field that could distinguish two logically different quantities is here. Two calls
     *      agree only when the contract, the epoch, the role and the subject all agree.
     */
    function isolationDomain(bytes32 epochId, bytes32 role, uint256 subIndex) public view returns (bytes32) {
        return keccak256(abi.encode(block.chainid, address(this), epochId, role, subIndex));
    }

    /**
     * @dev Rejects a public handle.
     *
     * NOT DECORATION. A public handle bypasses every ACL gate in NoxCompute
     * (`HandleUtils.isPublicHandle`, and the security note above it says so in those words), and an
     * all-public operand set makes the output handle depend on a storage counter and therefore
     * unpredictable off chain. Either would be silent. Reaching this state means a stage ran out of
     * order or an unset slot was read, both of which are public scheduling faults that disclose
     * nothing confidential — so a public revert is the correct signal.
     */
    function _requireConfidential(bytes32 handle) internal pure {
        if (handle[6] & ATTR_IS_UNIQUE_HANDLE == 0) revert HandleIsNotConfidential(handle);
    }

    /**
     * @notice Builds the per-epoch confidential condition that every isolation in this epoch uses.
     * @param anchor any confidential handle belonging to this epoch — in practice the borrower's
     *        `desiredAssets`, which the engine has just proved it holds an ACL grant on.
     *
     * @dev WHY AN EPOCH CONDITION AND NOT JUST `eq(value, value)`. The obvious isolation is
     *      `select(eq(v,v), v, tag)`, and it works for `euint256` where the tag carries a full
     *      256-bit domain hash. It does NOT work for `euint16`: a 16-bit tag has only 65,536
     *      values, so two epochs' `quoteReady` handles could coincide and a decryption proof issued
     *      for one epoch would then bind to the other. Both values are public either way, so
     *      nothing leaks — but the graph binding would be weaker than it claims, which is the kind
     *      of defect this project treats as a defect.
     *
     *      Threading a per-epoch confidential condition instead makes distinctness hold on two
     *      independent axes: the condition separates epochs, the tag separates roles and subjects.
     *      It also makes the seed deterministic regardless of the value's own attributes.
     *
     *      Cost: `toEuint256` 6,256 + `add` 10,377 + `eq` 10,398 = 27,031 gas, once per epoch.
     */
    function _buildEpochCondition(bytes32 epochId, euint256 anchor) internal returns (ebool) {
        _requireConfidential(euint256.unwrap(anchor));
        euint256 salt = Nox.add(anchor, Nox.toEuint256(uint256(isolationDomain(epochId, ROLE_EPOCH_SALT, 0))));
        return Nox.eq(salt, salt);
    }

    /**
     * @notice Returns a handle with the same value and a lineage nothing else can share.
     *
     * @dev `select`'s operands are `[epochCondition, value, tag]`.
     *      - `epochCondition` is encrypted `true` and unique to this epoch, so the result is always
     *        `value` and `tag` is never taken;
     *      - `tag` is `toEuint256(domain)`, deterministic in a domain carrying the role and the
     *        subject, and its plaintext is a hash unrelated to anything private;
     *      - the condition is confidential, so the seed is 0 and the handle is reproducible off
     *        chain — which is what makes the graph binding checkable rather than decorative.
     *
     *      Two provider allocations that are numerically identical therefore remain two handles
     *      with two ACL entries. That is demonstration 17.
     *
     *      Cost: 6,256 + 15,263 = 21,519 gas per granted handle. Never paid per cell.
     */
    function _isolate(euint256 value, ebool epochCondition, bytes32 domain) internal returns (euint256) {
        _requireConfidential(euint256.unwrap(value));
        return Nox.select(epochCondition, value, Nox.toEuint256(uint256(domain)));
    }

    /// @dev The `euint16` form. The tag necessarily truncates to 16 bits, which is exactly why the
    ///      epoch condition carries the epoch separation rather than the tag. 6,256 + 13,300.
    function _isolate16(euint16 value, ebool epochCondition, bytes32 domain) internal returns (euint16) {
        _requireConfidential(euint16.unwrap(value));
        return Nox.select(epochCondition, value, Nox.toEuint16(uint16(uint256(domain))));
    }
}
