// SPDX-License-Identifier: GPL-2.0-or-later
// Kyrve Day 0 Spike C. Not product code.
pragma solidity ^0.8.35;

import {Nox} from "@iexec-nox/nox-protocol-contracts/contracts/sdk/Nox.sol";
import "encrypted-types/EncryptedTypes.sol";

/// @dev Proves the input-proof binding surface and the ACL lifecycle at runtime.
contract NoxBindingProbe {
    euint256 public stored;

    /// @dev Kyrve's direct-caller policy: msg.sender here is the wallet that
    /// encrypted, because Nox.fromExternal is an internal library call.
    function accept(externalEuint256 v, bytes calldata proof) external {
        euint256 h = Nox.fromExternal(v, proof);
        Nox.allowThis(h);
        Nox.allow(h, msg.sender);
        stored = h;
    }

    function makeViewer(address viewer) external {
        Nox.addViewer(stored, viewer);
    }

    function publish() external {
        Nox.allowPublicDecryption(stored);
    }

    function grantTransient(address who) external {
        Nox.allowTransient(stored, who);
    }

    function isViewerOf(address who) external view returns (bool) {
        return Nox.isViewer(stored, who);
    }

    function isAllowedFor(address who) external view returns (bool) {
        return Nox.isAllowed(stored, who);
    }

    function isPublic() external view returns (bool) {
        return Nox.isPubliclyDecryptable(stored);
    }
}

/// @dev A second contract, used to prove that a proof minted for one application
/// contract is rejected by another.
contract NoxOtherApp {
    euint256 public stored;

    function accept(externalEuint256 v, bytes calldata proof) external {
        euint256 h = Nox.fromExternal(v, proof);
        Nox.allowThis(h);
        stored = h;
    }
}

/// @dev Confidential-failure indistinguishability. Every branch runs the same
/// public code path and emits the same event; only the encrypted contribution
/// differs. A rejected provider must never produce a distinguishable public result.
contract NoxIndistinguishable {
    event Contributed(uint256 indexed slot);

    euint256 public total;

    function seedTotal() external {
        total = Nox.toEuint256(0);
        Nox.allowThis(total);
    }

    function contribute(
        uint256 slot,
        externalEuint256 amount,
        bytes calldata amountProof,
        externalEuint16 eligible,
        bytes calldata eligibleProof
    ) external {
        euint256 amt = Nox.fromExternal(amount, amountProof);
        euint16 elig = Nox.fromExternal(eligible, eligibleProof);

        ebool ok = Nox.eq(elig, Nox.toEuint16(1));
        euint256 contribution = Nox.select(ok, amt, Nox.toEuint256(0));

        euint256 t = Nox.add(total, contribution);
        Nox.allowThis(t);
        total = t;

        emit Contributed(slot);
    }

    function publish() external {
        Nox.allowPublicDecryption(total);
    }
}
