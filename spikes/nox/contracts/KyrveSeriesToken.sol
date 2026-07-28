// SPDX-License-Identifier: GPL-2.0-or-later
// Kyrve Day 0 Spike C. Not product code.
pragma solidity ^0.8.35;

import {ERC20ToERC7984Wrapper} from
    "@iexec-nox/nox-confidential-contracts/contracts/token/extensions/ERC20ToERC7984Wrapper.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {Nox} from "@iexec-nox/nox-protocol-contracts/contracts/sdk/Nox.sol";
import "encrypted-types/EncryptedTypes.sol";

contract MockUSDC is ERC20 {
    constructor() ERC20("Mock USDC", "mUSDC") {}

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}

/// @dev Kyrve's confidential series token. Wraps a public ERC-20 so provider
/// beneficial ownership becomes confidential.
///
/// PUBLIC/PRIVATE BOUNDARY:
///   wrap(amount)          amount is PUBLIC - it is a plain uint256 argument
///   confidentialBalanceOf balance is PRIVATE - an encrypted handle
///   unwrap(amount)        marks the burn amount PUBLICLY DECRYPTABLE, permanently
///   finalizeUnwrap        writes the plaintext amount into an event - PUBLIC
contract KyrveSeriesToken is ERC20ToERC7984Wrapper {
    constructor(IERC20 underlying)
        ERC20ToERC7984Wrapper("Kyrve Series", "kSERIES", "", underlying)
    {}

    /// @dev Aggregate encrypted provider reservations. The sum stays encrypted
    /// until the vault deliberately publishes it - PRD invariant 3.
    function aggregateReservations(euint256 a, euint256 b) external returns (euint256) {
        euint256 sum = Nox.add(a, b);
        Nox.allowThis(sum);
        Nox.allow(sum, msg.sender);
        return sum;
    }
}
