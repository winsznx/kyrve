// SPDX-License-Identifier: GPL-2.0-or-later
pragma solidity 0.8.36;

import {Nox, euint256, externalEuint256} from "@iexec-nox/nox-protocol-contracts/contracts/sdk/Nox.sol";

/**
 * @dev Pins delta Q-5: a Nox handle is a pure function of its operation, not a fresh reference.
 *
 * `Compute._executeOperation` derives the result handle from the operator, the operand handles in
 * order, the output index and `_generateHandleUniqueSeed(operands)` — which is itself derived from
 * the operands. Nothing distinguishes two invocations with the same inputs, so they produce ONE
 * handle with ONE permanent ACL entry.
 *
 * That is not a defect in Nox; it is what makes the system deterministic and auditable. It IS a
 * hazard for any contract that keeps two logically distinct encrypted quantities, because a grant
 * on one can silently be a grant on the other. This probe makes the property executable so the
 * constraint on Phase 3's aggregate solvency work cannot quietly lapse.
 *
 * Test-only. Never deployed to any environment manifest.
 */
contract HandleDeterminismProbe {
    euint256 public first;
    euint256 public second;
    euint256 public reversed;

    function addTwice(externalEuint256 a, bytes calldata proofA, externalEuint256 b, bytes calldata proofB) external {
        euint256 ea = Nox.fromExternal(a, proofA);
        euint256 eb = Nox.fromExternal(b, proofB);

        first = Nox.add(ea, eb);
        second = Nox.add(ea, eb); // same operator, same operands, same order
        reversed = Nox.add(eb, ea); // same operator, same operands, DIFFERENT order

        // Grant only `first`. If `first == second` the grant covers both — that is the finding.
        Nox.allowThis(first);
        Nox.allow(first, msg.sender);
        Nox.allowThis(reversed);
    }
}
