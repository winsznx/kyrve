// SPDX-License-Identifier: GPL-2.0-or-later
pragma solidity 0.8.36;

/**
 * @title IKyrveCapsuleVault
 * @notice The two functions `KyrveSeriesToken` needs from the capsule vault, and nothing else.
 *
 * DECLARED RATHER THAN IMPORTED, and not because of a compiler pin — both contracts are 0.8.36. The
 * token holds the vault's address as mutable bind-once state and the vault holds the token as an
 * `immutable`, so importing the concrete type in both directions would make each contract's bytecode
 * depend on the other's. This interface is the whole coupling, it is two functions wide, and a change
 * to either signature breaks the build rather than producing a silent selector mismatch.
 */
interface IKyrveCapsuleVault {
    /// @notice How many capsules `subject` has issued. The next one's sequence number.
    function issuedBy(address subject) external view returns (uint256);

    /**
     * @notice Records a frozen ownership capsule. The vault refuses any caller but the series token.
     * @param snapshotHandle the isolated `select` output — never a live balance handle.
     */
    function recordOwnershipCapsule(
        address subject,
        address recipient,
        bytes32 quoteId,
        uint64 expiry,
        bytes32 snapshotHandle,
        uint256 sequence
    ) external returns (bytes32 capsuleId);
}
