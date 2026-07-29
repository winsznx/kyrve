// SPDX-License-Identifier: GPL-2.0-or-later
pragma solidity 0.8.36;

import {Nox, euint16, euint256} from "@iexec-nox/nox-protocol-contracts/contracts/sdk/Nox.sol";

import {KyrveEmergencyController} from "./KyrveEmergencyController.sol";

/**
 * @title KyrveConfidentialBase
 * @notice The rules every Kyrve confidential contract must obey, in one place so none can be
 *         forgotten and each has exactly one implementation.
 *
 * WHAT THIS ENFORCES
 *
 * 1. **Application binding.** `Nox.fromExternal` proves `app == msg.sender` inside NoxCompute, and
 *    because the SDK is a library that `msg.sender` is this contract. A proof minted for one Kyrve
 *    contract can never be spent at another. Proven at runtime, not assumed.
 *
 * 2. **Direct-caller binding.** `fromExternal` proves `owner` equals the address that called this
 *    contract. Kyrve additionally refuses contract callers (PRD §11.1): no paymaster, no Safe
 *    module, no batch router, no server signer sits between a user and their own encrypted input.
 *
 * 3. **One-shot proofs.** VERIFIED AGAINST SOURCE (`modules/Compute.sol::validateInputProof`,
 *    nox-protocol-contracts version 0.2.4): NoxCompute checks the handle's embedded chain id, the TEE type,
 *    the 137-byte proof length, `createdAt + proofExpirationDuration`, `app == msg.sender`, `owner`
 *    and the gateway signature — and **nothing else**. There is no nonce and no consumption marker,
 *    so a proof stays replayable by its own owner against its own app until it expires. Kyrve
 *    supplies the missing half: every input handle is consumed exactly once per contract, and every
 *    submission carries a strictly increasing per-owner nonce. Recorded as delta Q-2.
 *
 * 4. **Exact ACL policy.** Kyrve grants exactly two things for a user's own value: `allowThis`, so
 *    this contract may compute on the handle in a later transaction, and `allow(handle, owner)`, so
 *    the owner — and nobody else — may decrypt it. It never calls `addViewer` on a live handle and
 *    never calls `allowPublicDecryption` on a private value. Both of those are PERMANENT:
 *    `sdk/Nox.sol` (version 0.2.4) has no `removeViewer`, no `removeAdmin` and no way to un-set public
 *    decryption. Only `disallowTransient` exists.
 *
 * 5. **Transient escalation is blocked.** Transient access is not a weaker grant. Within the
 *    transaction the recipient may call `allowPublicDecryption` and publish the value forever, or
 *    `allow` a third party permanently. Kyrve therefore passes transient handles only to reviewed
 *    Kyrve contracts fixed at deployment, and `_assertReviewedTransientRecipient` is the only gate.
 *
 * 6. **Confidential failure is never a public reason.** A private shortfall contributes encrypted
 *    zero and emits the same event as success. Public reverts are reserved for public failures:
 *    invalid proof, expired proof, replayed handle, wrong nonce, stale epoch, paused activity,
 *    unauthorised caller.
 */
abstract contract KyrveConfidentialBase {
    /// @dev Schema version of every encrypted layout this release accepts. Part of every binding.
    uint16 internal constant KYRVE_SCHEMA_VERSION = 1;

    KyrveEmergencyController public immutable emergencyController;

    /// @dev Input handles already spent at this contract. The one-shot half Nox does not provide.
    mapping(bytes32 handle => bool) private _handleConsumed;

    /// @dev Next acceptable submission nonce per owner. Strictly increasing, never reused.
    mapping(address owner => uint256) private _nextNonce;

    event HandleConsumed(address indexed owner, bytes32 indexed handle);

    error RelayedCallerRefused(address caller, address origin);
    error HandleAlreadyConsumed(bytes32 handle);
    error WrongNonce(address owner, uint256 expected, uint256 supplied);
    error UnreviewedTransientRecipient(address recipient);
    error ControllerIsZero();

    constructor(KyrveEmergencyController controller) {
        if (address(controller) == address(0)) revert ControllerIsZero();
        emergencyController = controller;
    }

    /**
     * @dev Refuses any caller that is not an account acting for itself.
     *
     * `Nox.fromExternal` already binds the proof to the calling address, so a contract could only
     * ever spend a proof minted for that contract. This check is the stricter Kyrve rule from PRD
     * §11.1, which forbids the *pattern* rather than only the forgery.
     *
     * TRADE-OFF, stated rather than hidden. This refuses true contract accounts, so a Safe cannot
     * be a Kyrve provider in this release. EOAs with EIP-7702 delegated code are unaffected —
     * `msg.sender` still equals `tx.origin` for them. Gas may be reimbursed after the fact; the
     * direct caller may not change.
     *
     * HONEST LIMIT, recorded as Day 0 delta D-2: this is a Kyrve design choice, not a cryptographic
     * impossibility. `INoxCompute.validateInputProof` takes `owner` as a parameter, so another
     * application could implement metatransactions. Kyrve does not, and says so rather than
     * claiming relaying is impossible.
     */
    function _assertDirectCaller() internal view {
        if (msg.sender != tx.origin) revert RelayedCallerRefused(msg.sender, tx.origin);
    }

    /// @dev Marks one input handle spent. Reverts publicly on replay — a replay is a public fault.
    function _consumeHandle(bytes32 handle) internal {
        if (_handleConsumed[handle]) revert HandleAlreadyConsumed(handle);
        _handleConsumed[handle] = true;
        emit HandleConsumed(msg.sender, handle);
    }

    function isHandleConsumed(bytes32 handle) external view returns (bool) {
        return _handleConsumed[handle];
    }

    /// @dev Consumes the caller's next nonce. Strictly increasing, so no submission repeats.
    function _consumeNonce(uint256 supplied) internal {
        uint256 expected = _nextNonce[msg.sender];
        if (supplied != expected) revert WrongNonce(msg.sender, expected, supplied);
        _nextNonce[msg.sender] = expected + 1;
    }

    function nextNonce(address owner) external view returns (uint256) {
        return _nextNonce[owner];
    }

    /// @dev The only gate for handing a transient handle to another contract.
    function _assertReviewedTransientRecipient(address recipient) internal view {
        if (!isReviewedTransientRecipient(recipient)) {
            revert UnreviewedTransientRecipient(recipient);
        }
    }

    /// @dev Implemented by each contract with its own immutable, deployment-time allowlist.
    function isReviewedTransientRecipient(address recipient) public view virtual returns (bool);

    /// @dev The exact grant Kyrve makes for a `euint256` owned by one account. Nothing more.
    function _grantOwnerOnly(euint256 handle, address owner) internal {
        Nox.allowThis(handle);
        Nox.allow(handle, owner);
    }

    /// @dev The exact grant Kyrve makes for a `euint16` owned by one account. Nothing more.
    function _grantOwnerOnly(euint16 handle, address owner) internal {
        Nox.allowThis(handle);
        Nox.allow(handle, owner);
    }
}
