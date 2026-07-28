// SPDX-License-Identifier: GPL-2.0-or-later
pragma solidity 0.8.34;

/// @dev A constant-price oracle for the Kyrve test substrate, quoting in `ORACLE_PRICE_SCALE`.
///
/// Deliberately fixed. Phase 1 proves the settlement path — exact fill, rollback, quote math — and
/// a moving price would make those results non-reproducible without proving anything extra.
/// Liquidation behaviour under price movement belongs to a later phase with a real oracle.
contract FixedPriceOracle {
    uint256 public price;

    event PriceSet(uint256 price);

    constructor(uint256 initialPrice) {
        price = initialPrice;
        emit PriceSet(initialPrice);
    }

    /// @dev Test-only. Lets a liquidation test move the price deliberately.
    function setPrice(uint256 newPrice) external {
        price = newPrice;
        emit PriceSet(newPrice);
    }
}
