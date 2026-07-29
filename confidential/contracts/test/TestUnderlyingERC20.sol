// SPDX-License-Identifier: GPL-2.0-or-later
pragma solidity 0.8.36;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/**
 * @dev The public ERC-20 the confidential layer wraps.
 *
 * A TEST TOKEN with an unrestricted `mint`, deployed only to a local chain or to the labelled
 * Sepolia testnet replica. It carries the same role as `contracts/integration/TestERC20.sol` in the
 * Midnight substrate, but uses OpenZeppelin's `ERC20` because
 * `ERC20ToERC7984WrapperBase._tryGetAssetDecimals` staticcalls `IERC20Metadata.decimals` and
 * `SafeERC20` is used for the transfer legs.
 */
contract TestUnderlyingERC20 is ERC20 {
    uint8 private immutable _decimals;

    constructor(string memory name_, string memory symbol_, uint8 decimals_)
        ERC20(name_, symbol_)
    {
        _decimals = decimals_;
    }

    function decimals() public view override returns (uint8) {
        return _decimals;
    }

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}
