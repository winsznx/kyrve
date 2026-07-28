// SPDX-License-Identifier: GPL-2.0-or-later
// Kyrve Day 0 Spike C. Not product code.
pragma solidity ^0.8.35;

import {Nox} from "@iexec-nox/nox-protocol-contracts/contracts/sdk/Nox.sol";
import "encrypted-types/EncryptedTypes.sol";

/// @dev Smallest possible contract that proves the local Nox stack executes a real
/// encrypted operation end to end: external input -> validated handle -> add -> ACL.
contract NoxSmoke {
    euint256 public sum;

    function addTwo(
        externalEuint256 a,
        bytes calldata proofA,
        externalEuint256 b,
        bytes calldata proofB
    ) external {
        euint256 ea = Nox.fromExternal(a, proofA);
        euint256 eb = Nox.fromExternal(b, proofB);
        euint256 result = Nox.add(ea, eb);
        Nox.allowThis(result);
        Nox.allow(result, msg.sender);
        Nox.allowPublicDecryption(result);
        sum = result;
    }
}
