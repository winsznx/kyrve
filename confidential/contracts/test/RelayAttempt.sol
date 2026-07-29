// SPDX-License-Identifier: GPL-2.0-or-later
pragma solidity 0.8.36;

import {EncryptedMandateBook} from "../EncryptedMandateBook.sol";

/**
 * @dev Stands in for every relayed path PRD §11.1 forbids: a paymaster, a Safe module, a batch
 *      router, a server signer.
 *
 * It calls `submitMandate` with an empty submission. That is enough, and it is deliberate: the
 * direct-caller check runs BEFORE any proof is validated, so the refusal cannot be confused with a
 * proof failure. If `_assertDirectCaller` were ever removed, this call would get past the guard and
 * fail on the proof count instead — a different error, which the test asserts on by name.
 *
 * Test-only. Never deployed to any environment manifest.
 */
contract RelayAttempt {
    function forwardMandate(EncryptedMandateBook book) external {
        EncryptedMandateBook.EncryptedMandateInput memory empty;
        bytes[] memory noProofs = new bytes[](0);
        book.submitMandate(bytes32(uint256(1)), empty, noProofs, 0);
    }
}
