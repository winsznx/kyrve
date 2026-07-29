// SPDX-License-Identifier: GPL-2.0-or-later
pragma solidity 0.8.34;

import {ISellCallback} from "midnight/interfaces/ICallbacks.sol";
import {IMidnight, Market, Offer} from "midnight/interfaces/IMidnight.sol";
import {CALLBACK_SUCCESS} from "midnight/libraries/ConstantsLib.sol";

/**
 * @notice A borrower that tries to settle the same quote twice from inside its own callback.
 *
 * On a buy offer the taker is the SELLER, so `takerCallback` receives `onSell` — and Midnight calls
 * it AFTER the loan tokens have already moved (`Midnight.sol` lines 491-497). That is the most
 * dangerous moment available to an attacker: the maker has paid, the position exists, and the
 * transaction has not returned. If the quote were marked consumed anywhere later than it is, this
 * is where a second fill would land.
 *
 * The re-entrant call's success is RECORDED rather than bubbled. A test that only asserted "the
 * outer take reverted" could pass because of the re-entrant revert propagating, which would prove
 * the opposite of what it claims.
 */
contract ReentrantTaker is ISellCallback {
    IMidnight public immutable MIDNIGHT;

    Offer private _offer;
    uint256 private _units;
    bool public reentryAttempted;
    bool public reentrySucceeded;

    constructor(IMidnight midnight) {
        MIDNIGHT = midnight;
    }

    function arm(Offer calldata offer, uint256 units) external {
        _offer = offer;
        _units = units;
    }

    function take(Offer calldata offer, uint256 units) external returns (uint256, uint256) {
        return MIDNIGHT.take(offer, hex"", units, address(this), address(this), address(this), hex"");
    }

    function onSell(bytes32, Market memory, uint256, uint256, uint256, address, address, bytes memory)
        external
        returns (bytes32)
    {
        if (!reentryAttempted && _offer.maker != address(0)) {
            reentryAttempted = true;
            try MIDNIGHT.take(_offer, hex"", _units, address(this), address(this), address(0), hex"") {
                reentrySucceeded = true;
            } catch {
                reentrySucceeded = false;
            }
        }
        return CALLBACK_SUCCESS;
    }
}
