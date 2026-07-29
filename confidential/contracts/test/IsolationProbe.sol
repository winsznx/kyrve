// SPDX-License-Identifier: GPL-2.0-or-later
pragma solidity 0.8.36;

import {Nox, ebool, euint256, externalEuint256} from "@iexec-nox/nox-protocol-contracts/contracts/sdk/Nox.sol";

import {KyrveCurveBase} from "../KyrveCurveBase.sol";
import {KyrveEmergencyController} from "../KyrveEmergencyController.sol";

/**
 * @dev Makes the P3-1 isolation primitive falsifiable, by exercising both halves of it directly.
 *
 * `HandleDeterminismProbe` pins the HAZARD — identical operands produce one handle with one
 * permanent ACL entry. This pins the FIX, and it has to, because the curve engine's own aliasing
 * test is not sufficient on its own: two providers with identical mandates get their handles from
 * separate `encryptInput` calls, and gateway input handles are distinct per encryption. So the
 * engine's terminal handles differ *anyway*, and a test that only checked that would pass with the
 * isolation removed. Recorded as delta R-6.
 *
 * This probe removes the confound by feeding the SAME two operand handles into both branches, so
 * the naive results genuinely collide and only isolation separates them.
 *
 * It asserts three things at once:
 *
 *   naiveA   == naiveB          the hazard is live — same operands, one handle
 *   isolatedA != isolatedB      isolation separates them, on domain alone
 *   isolatedA == isolatedAgain  isolation is DETERMINISTIC, so the handle stays predictable off
 *                               chain — which is what makes the graph binding checkable rather
 *                               than decorative
 *
 * Test-only. Never deployed to any environment manifest.
 */
contract IsolationProbe is KyrveCurveBase {
    euint256 public naiveA;
    euint256 public naiveB;
    euint256 public isolatedA;
    euint256 public isolatedB;
    euint256 public isolatedAgain;

    bytes32 public domainA;
    bytes32 public domainB;
    /// @dev Exposed so the suite can reproduce the isolation off chain and compare it to the real
    ///      handle NoxCompute returned. Without the condition the derivation cannot be checked at
    ///      all, and the graph binding would rest on an unverified formula.
    ebool public epochCondition;

    constructor(KyrveEmergencyController controller) KyrveCurveBase(controller) {}

    /// @dev This probe hands out no transient handles at all.
    function isReviewedTransientRecipient(address) public pure override returns (bool) {
        return false;
    }

    function probe(
        bytes32 epochId,
        externalEuint256 a,
        bytes calldata proofA,
        externalEuint256 b,
        bytes calldata proofB
    ) external {
        euint256 ea = Nox.fromExternal(a, proofA);
        euint256 eb = Nox.fromExternal(b, proofB);

        // Same operator, same operands, same order — twice. These MUST be one handle.
        naiveA = Nox.add(ea, eb);
        naiveB = Nox.add(ea, eb);

        epochCondition = _buildEpochCondition(epochId, ea);
        Nox.allowThis(epochCondition);

        domainA = isolationDomain(epochId, ROLE_ALLOCATION, 0);
        domainB = isolationDomain(epochId, ROLE_ALLOCATION, 1);

        isolatedA = _isolate(naiveA, epochCondition, domainA);
        isolatedB = _isolate(naiveB, epochCondition, domainB);
        // Same value, same condition, same domain: must reproduce `isolatedA` exactly.
        isolatedAgain = _isolate(naiveA, epochCondition, domainA);

        Nox.allowThis(naiveA);
        Nox.allowThis(isolatedA);
        Nox.allowThis(isolatedB);
        Nox.allowThis(isolatedAgain);

        // Granted to the caller so the suite can prove the VALUES are equal while the HANDLES are
        // not — an equality that would be indistinguishable from a collision if it were assumed.
        Nox.allow(isolatedA, msg.sender);
        Nox.allow(isolatedB, msg.sender);
        Nox.allow(naiveA, msg.sender);
    }
}
