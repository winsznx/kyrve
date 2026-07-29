// SPDX-License-Identifier: GPL-2.0-or-later
pragma solidity 0.8.36;

/**
 * @title KyrveEmergencyController
 * @notice The single pause authority for the Kyrve confidential layer.
 *
 * PRD §13.22 and invariant 20: pausing new activity must never block recovery of assets a user
 * already holds. This contract enforces that structurally rather than by convention — it can only
 * express pauses over the activities in {Activity}, and every one of them is an *entry* into the
 * protocol. There is deliberately no activity for withdrawal, unwrapping, unwrap finalisation,
 * mandate retirement, request cancellation or reservation release, so no configuration of this
 * contract can stop a user taking their own assets back.
 *
 * PUBLIC/PRIVATE BOUNDARY: everything here is public. Pause state, the guardian and every
 * transition are public by construction and carry no confidential value.
 *
 * There is no upgradeability and no arbitrary-call surface. The guardian may pause and unpause;
 * it may not move value, read an encrypted handle, or alter an allocation.
 */
contract KyrveEmergencyController {
    /// @dev Every activity that may be paused. All are entries; none is a recovery path.
    enum Activity {
        WrapUnderlying,
        VaultDeposit,
        MandateSubmission,
        RequestSubmission,
        ReservationOpening
    }

    uint256 private constant ACTIVITY_COUNT = 5;

    address public immutable guardian;

    mapping(Activity => bool) private _paused;

    event ActivityPaused(Activity indexed activity, address indexed by);
    event ActivityUnpaused(Activity indexed activity, address indexed by);

    error NotGuardian(address caller, address expected);
    error ActivityIsPaused(Activity activity);
    error GuardianIsZero();

    constructor(address guardian_) {
        if (guardian_ == address(0)) revert GuardianIsZero();
        guardian = guardian_;
    }

    modifier onlyGuardian() {
        if (msg.sender != guardian) revert NotGuardian(msg.sender, guardian);
        _;
    }

    function pause(Activity activity) external onlyGuardian {
        _paused[activity] = true;
        emit ActivityPaused(activity, msg.sender);
    }

    function unpause(Activity activity) external onlyGuardian {
        _paused[activity] = false;
        emit ActivityUnpaused(activity, msg.sender);
    }

    /// @notice Pauses every entry at once. Recovery paths are unaffected — they have no flag.
    function pauseAll() external onlyGuardian {
        for (uint256 i = 0; i < ACTIVITY_COUNT; ++i) {
            Activity activity = Activity(i);
            _paused[activity] = true;
            emit ActivityPaused(activity, msg.sender);
        }
    }

    function isPaused(Activity activity) external view returns (bool) {
        return _paused[activity];
    }

    /// @dev Reverts publicly. A pause is a public fact, so a public revert is the correct signal.
    function requireNotPaused(Activity activity) external view {
        if (_paused[activity]) revert ActivityIsPaused(activity);
    }
}
