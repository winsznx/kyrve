// SPDX-License-Identifier: GPL-2.0-or-later
pragma solidity 0.8.36;

import {IERC20} from "@openzeppelin/contracts/interfaces/IERC20.sol";
import {IERC7984} from "@iexec-nox/nox-confidential-contracts/contracts/interfaces/IERC7984.sol";
import {ERC7984Base} from "@iexec-nox/nox-confidential-contracts/contracts/token/ERC7984Base.sol";
import {ERC20ToERC7984Wrapper} from
    "@iexec-nox/nox-confidential-contracts/contracts/token/extensions/ERC20ToERC7984Wrapper.sol";
import {euint256} from "@iexec-nox/nox-protocol-contracts/contracts/sdk/Nox.sol";

import {KyrveEmergencyController} from "./KyrveEmergencyController.sol";

/**
 * @title KyrveWrappedAsset
 * @notice A public ERC-20 wrapped into a confidential ERC-7984 balance.
 *
 * This is the OFFICIAL pinned implementation — `ERC20ToERC7984Wrapper` from
 * `nox-confidential-contracts` version 0.2.2, which itself builds on `ERC7984Base` and the
 * optimized Nox `mint` / `burn` / `transfer` primitives. Kyrve does not reimplement ERC-7984 and
 * does not fork it. Everything below is a narrowing: two rules added, nothing loosened.
 *
 * ────────────────────────────────────────────────────────────────────────────────────────────
 * PUBLIC / PRIVATE BOUNDARY — the whole point of this contract, so it is stated exactly
 * ────────────────────────────────────────────────────────────────────────────────────────────
 *
 *   PUBLIC FROM SUBMISSION
 *     `wrap(to, amount)`            `amount` is a plain `uint256` in calldata. Anyone reading the
 *                                   transaction sees exactly how much was wrapped, and by whom.
 *                                   There is no way to make this private: the ERC-20 leg is public.
 *     `underlying().balanceOf(this)` the total wrapped, always public.
 *
 *   PRIVATE NOW AND AFTER SETTLEMENT
 *     `confidentialBalanceOf(a)`    an encrypted handle. Only `a` may decrypt it. Another wallet
 *                                   asking the gateway for it is refused — proven in the suite.
 *     `confidentialTransfer(...)`   amounts never appear in calldata, storage or events.
 *     `confidentialTotalSupply()`   encrypted; only this contract holds an admin grant.
 *
 *   PRIVATE NOW, PUBLIC ON UNWRAP — the confidentiality end point
 *     `unwrap(from, to, amount)`    calls `allowPublicDecryption` on the burn amount. That is
 *                                   IRREVERSIBLE: Nox has no un-publish. From that moment the
 *                                   unwrapped amount is public forever.
 *     `finalizeUnwrap(...)`         writes the plaintext amount into `UnwrapFinalized`. Public.
 *
 * A user interface must name the `unwrap` boundary crossing before the user signs, and must never
 * describe it as reversible.
 *
 * ────────────────────────────────────────────────────────────────────────────────────────────
 * WHAT KYRVE ADDS
 * ────────────────────────────────────────────────────────────────────────────────────────────
 *
 * 1. **Bounded operator expiry.** ERC-7984 operators have NO per-amount allowance — verified
 *    against the ABI, there is no `allowance` and no `confidentialAllowance` function anywhere. An
 *    operator can move a holder's entire confidential balance and, on a wrapper, can unwrap all of
 *    it to any address until `until` passes. An unbounded `until` is therefore an irrevocable gift
 *    of the whole balance. `setOperator` here refuses any window longer than
 *    {MAX_OPERATOR_WINDOW}, and refuses a window already in the past. Setting `until = 0` is always
 *    allowed: that is how a holder ends a grant, and it must never be blocked.
 *
 * 2. **Pause covers entry only.** `wrap` is pausable, because it is an entry. `unwrap`,
 *    `finalizeUnwrap`, `confidentialTransfer` and `setOperator` are NOT pausable and have no flag
 *    in {KyrveEmergencyController} at all, so no pause configuration can trap a holder's assets
 *    (PRD invariant 20).
 */
contract KyrveWrappedAsset is ERC20ToERC7984Wrapper {
    /// @notice The longest operator grant Kyrve will write. Seven days, because the blast radius
    /// is the holder's entire balance and there is no per-amount cap to fall back on.
    uint48 public constant MAX_OPERATOR_WINDOW = 7 days;

    KyrveEmergencyController public immutable emergencyController;

    error OperatorWindowTooLong(uint48 until, uint48 maximum);
    error OperatorWindowInThePast(uint48 until, uint48 nowTimestamp);
    error ControllerIsZero();

    constructor(
        string memory name_,
        string memory symbol_,
        string memory contractURI_,
        IERC20 underlying_,
        KyrveEmergencyController controller
    ) ERC20ToERC7984Wrapper(name_, symbol_, contractURI_, underlying_) {
        if (address(controller) == address(0)) revert ControllerIsZero();
        emergencyController = controller;
    }

    /**
     * @notice Wraps `amount` of the public underlying into a confidential balance for `to`.
     * @dev PUBLIC BOUNDARY: `amount` is public in calldata, permanently. This is unavoidable and
     *      is the honest cost of entering the confidential layer from a public ERC-20.
     */
    function wrap(address to, uint256 amount) public override returns (euint256) {
        emergencyController.requireNotPaused(KyrveEmergencyController.Activity.WrapUnderlying);
        return super.wrap(to, amount);
    }

    /**
     * @notice Grants `operator` the right to move the caller's entire confidential balance until
     *         `until`.
     * @dev There is no per-amount allowance in ERC-7984. This grant is all-or-nothing for its whole
     *      lifetime, which is why the window is capped. Pass `until = 0` to end a grant; that path
     *      is never restricted and never pausable.
     */
    function setOperator(address operator, uint48 until) public override(IERC7984, ERC7984Base) {
        if (until != 0) {
            uint48 nowTimestamp = uint48(block.timestamp);
            if (until <= nowTimestamp) revert OperatorWindowInThePast(until, nowTimestamp);
            if (until - nowTimestamp > MAX_OPERATOR_WINDOW) {
                revert OperatorWindowTooLong(until, nowTimestamp + MAX_OPERATOR_WINDOW);
            }
        }
        super.setOperator(operator, until);
    }
}
