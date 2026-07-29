// SPDX-License-Identifier: GPL-2.0-or-later
pragma solidity 0.8.36;

import {
    Nox,
    euint16,
    euint256,
    externalEuint16,
    externalEuint256
} from "@iexec-nox/nox-protocol-contracts/contracts/sdk/Nox.sol";

import {KyrveConfidentialBase} from "./KyrveConfidentialBase.sol";
import {KyrveEmergencyController} from "./KyrveEmergencyController.sol";

/**
 * @title ConfidentialRequestBook
 * @notice The direct borrower entry point for encrypted funding requests (PRD §13.5, §11.4).
 *
 * ────────────────────────────────────────────────────────────────────────────────────────────
 * PUBLIC / PRIVATE BOUNDARY — PRD §11.4 fixes this exactly, and it is not symmetric
 * ────────────────────────────────────────────────────────────────────────────────────────────
 *
 *   PUBLIC FROM SUBMISSION   universe id, borrower address, the request bond (it is ETH and its
 *                            value is visible), submission time, expiry, the exact-fill
 *                            requirement, the public collateral transaction reference, and the
 *                            nonce. These are public because the protocol, the keeper and any
 *                            verifier must all agree on them without decrypting anything.
 *
 *   PRIVATE FOREVER          desired assets, minimum assets, every maximum rate index, every
 *                            enabled flag, and the preferred maturity index. The borrower's price
 *                            limit is the single most valuable thing to leak — knowing it lets a
 *                            provider quote exactly at it — so it never leaves ciphertext.
 *
 * ────────────────────────────────────────────────────────────────────────────────────────────
 * THE BOND, AND WHY IT IS REFUNDED RATHER THAN SEIZED HERE
 * ────────────────────────────────────────────────────────────────────────────────────────────
 *
 * The bond exists to make quote probing expensive (PRD §15). Deciding when it is forfeit requires
 * knowing whether a quote was produced and ignored, which is `QuoteEpochController` and is Phase 3.
 * Until that exists this contract does the only honest thing: it holds the bond, refunds it in
 * full on cancellation or expiry, and has NO path that pays it anywhere else. There is no
 * operator discretion over a bond in this release because there is no operator.
 *
 * ────────────────────────────────────────────────────────────────────────────────────────────
 * CANCELLATION AND EXPIRY ARE RECOVERY, NOT ENTRY
 * ────────────────────────────────────────────────────────────────────────────────────────────
 *
 * `submitRequest` and `topUpBond` are pausable. `cancelUnsealedRequest` and `expireRequest` are
 * not, and have no flag in {KyrveEmergencyController}. A borrower's bond can never be trapped by an
 * emergency pause (PRD invariant 20).
 */
contract ConfidentialRequestBook is KyrveConfidentialBase {
    uint256 public constant MARKET_SLOTS = 8;
    uint256 public constant REQUEST_HANDLE_COUNT = 1 + 1 + 8 + 8 + 1;

    /// @notice The shortest and longest life a request may declare. Bounded so a request cannot be
    /// used to park a bond forever, and cannot expire before a keeper could plausibly serve it.
    uint64 public constant MIN_REQUEST_LIFETIME = 5 minutes;
    uint64 public constant MAX_REQUEST_LIFETIME = 7 days;

    /// @notice The smallest bond that makes probing cost something. Public by construction.
    uint256 public constant MIN_BOND_WEI = 0.001 ether;

    enum RequestState {
        None,
        Submitted,
        Cancelled,
        Expired
    }

    /// @notice The encrypted request exactly as PRD §11.4 specifies it.
    struct EncryptedRequestInput {
        externalEuint256 desiredAssets;
        externalEuint256 minimumAssets;
        externalEuint16[8] maxRateIndexes;
        externalEuint16[8] enabledFlags;
        externalEuint16 preferredMaturityIndex;
    }

    struct RequestHandles {
        euint256 desiredAssets;
        euint256 minimumAssets;
        euint16[8] maxRateIndexes;
        euint16[8] enabledFlags;
        euint16 preferredMaturityIndex;
    }

    /// @notice Everything about a request that is public. Nothing here is derived from ciphertext.
    struct Request {
        address borrower;
        bytes32 universeId;
        uint16 schemaVersion;
        RequestState state;
        bool exactFillRequired;
        uint64 submittedAt;
        uint64 expiresAt;
        uint256 bondWei;
        bytes32 collateralReference;
        bytes32 commitment;
    }

    mapping(bytes32 requestId => Request) private _requests;
    mapping(bytes32 requestId => RequestHandles) private _handles;

    /// @notice At most one live request per borrower per universe (PRD §13.6).
    mapping(address borrower => mapping(bytes32 universeId => bytes32)) public liveRequest;

    event RequestSubmitted(
        bytes32 indexed requestId,
        address indexed borrower,
        bytes32 indexed universeId,
        uint256 bondWei,
        uint64 expiresAt,
        bytes32 commitment
    );
    event BondToppedUp(bytes32 indexed requestId, uint256 addedWei, uint256 totalWei);
    event RequestCancelled(bytes32 indexed requestId, uint256 refundedWei);
    event RequestExpired(bytes32 indexed requestId, uint256 refundedWei);

    error UnknownRequest(bytes32 requestId);
    error NotBorrower(bytes32 requestId, address caller, address borrower);
    error RequestNotLive(bytes32 requestId, RequestState state);
    error RequestAlreadyLive(address borrower, bytes32 universeId, bytes32 existing);
    error BondTooSmall(uint256 supplied, uint256 minimum);
    error LifetimeOutOfRange(uint64 supplied, uint64 minimum, uint64 maximum);
    error RequestNotYetExpired(bytes32 requestId, uint64 expiresAt, uint64 nowTimestamp);
    error RefundFailed(address recipient, uint256 amountWei);
    error UniverseIsZero();
    error WrongProofCount(uint256 expected, uint256 supplied);

    constructor(KyrveEmergencyController controller) KyrveConfidentialBase(controller) {}

    /**
     * @inheritdoc KyrveConfidentialBase
     * @dev Like the mandate book, this contract hands out no transient handles. A borrower's price
     *      limit passed transiently to an unreviewed contract could be published permanently inside
     *      that same transaction.
     */
    function isReviewedTransientRecipient(address) public pure override returns (bool) {
        return false;
    }

    // ─────────────────────────────────────────────────────────────────────────────────────────
    // Entry
    // ─────────────────────────────────────────────────────────────────────────────────────────

    /**
     * @notice Submits an encrypted funding request with a public bond.
     * @param lifetime how long the request stays live. Public — the keeper and every verifier need
     *        it, and it leaks nothing about price or size.
     * @param collateralReference the public transaction reference for collateral already posted.
     *        Public by design: collateral is a public Midnight position.
     */
    function submitRequest(
        bytes32 universeId,
        EncryptedRequestInput calldata input,
        bytes[] calldata proofs,
        uint64 lifetime,
        bool exactFillRequired,
        bytes32 collateralReference,
        uint256 nonce
    ) external payable returns (bytes32 requestId) {
        emergencyController.requireNotPaused(KyrveEmergencyController.Activity.RequestSubmission);
        if (universeId == bytes32(0)) revert UniverseIsZero();
        if (msg.value < MIN_BOND_WEI) revert BondTooSmall(msg.value, MIN_BOND_WEI);
        if (lifetime < MIN_REQUEST_LIFETIME || lifetime > MAX_REQUEST_LIFETIME) {
            revert LifetimeOutOfRange(lifetime, MIN_REQUEST_LIFETIME, MAX_REQUEST_LIFETIME);
        }
        _assertDirectCaller();

        bytes32 existing = liveRequest[msg.sender][universeId];
        if (existing != bytes32(0)) {
            revert RequestAlreadyLive(msg.sender, universeId, existing);
        }

        // The nonce is consumed before anything is stored, and it is part of the identifier, so two
        // identical requests can never collide and no request identifier can ever be reused.
        _consumeNonce(nonce);
        requestId = keccak256(abi.encode(block.chainid, address(this), msg.sender, universeId, nonce));

        bytes32 commitment = _seal(requestId, input, proofs);

        _requests[requestId] = Request({
            borrower: msg.sender,
            universeId: universeId,
            schemaVersion: KYRVE_SCHEMA_VERSION,
            state: RequestState.Submitted,
            exactFillRequired: exactFillRequired,
            submittedAt: uint64(block.timestamp),
            expiresAt: uint64(block.timestamp) + lifetime,
            bondWei: msg.value,
            collateralReference: collateralReference,
            commitment: commitment
        });
        liveRequest[msg.sender][universeId] = requestId;

        emit RequestSubmitted(
            requestId, msg.sender, universeId, msg.value, uint64(block.timestamp) + lifetime, commitment
        );
    }

    /// @notice Adds to a live request's bond. Public amount; the request itself stays encrypted.
    function topUpBond(bytes32 requestId) external payable {
        emergencyController.requireNotPaused(KyrveEmergencyController.Activity.RequestSubmission);
        Request storage request = _requireBorrower(requestId);
        if (request.state != RequestState.Submitted) {
            revert RequestNotLive(requestId, request.state);
        }
        request.bondWei += msg.value;
        emit BondToppedUp(requestId, msg.value, request.bondWei);
    }

    // ─────────────────────────────────────────────────────────────────────────────────────────
    // Recovery. Neither path is pausable.
    // ─────────────────────────────────────────────────────────────────────────────────────────

    /**
     * @notice Withdraws a request that has not been sealed into an epoch, refunding the full bond.
     * @dev "Unsealed" is trivially true in this release because sealing lives in
     *      `QuoteEpochController`, which is Phase 3. When that arrives it will hold a seal flag
     *      that this function must consult; the name says so now so the constraint is not lost.
     */
    function cancelUnsealedRequest(bytes32 requestId) external {
        Request storage request = _requireBorrower(requestId);
        if (request.state != RequestState.Submitted) {
            revert RequestNotLive(requestId, request.state);
        }

        // Checks, effects, then interactions. The state is terminal before any ETH moves.
        uint256 refund = request.bondWei;
        request.bondWei = 0;
        request.state = RequestState.Cancelled;
        delete liveRequest[request.borrower][request.universeId];

        _refund(request.borrower, refund);
        emit RequestCancelled(requestId, refund);
    }

    /**
     * @notice Expires a request past its declared lifetime and refunds the bond to the borrower.
     * @dev Permissionless on purpose: the refund goes to the borrower whoever calls it, so anyone
     *      may clear a stale request and no borrower depends on a keeper's goodwill to get their
     *      bond back.
     */
    function expireRequest(bytes32 requestId) external {
        Request storage request = _requests[requestId];
        if (request.borrower == address(0)) revert UnknownRequest(requestId);
        if (request.state != RequestState.Submitted) {
            revert RequestNotLive(requestId, request.state);
        }
        if (block.timestamp <= request.expiresAt) {
            revert RequestNotYetExpired(requestId, request.expiresAt, uint64(block.timestamp));
        }

        uint256 refund = request.bondWei;
        request.bondWei = 0;
        request.state = RequestState.Expired;
        delete liveRequest[request.borrower][request.universeId];

        _refund(request.borrower, refund);
        emit RequestExpired(requestId, refund);
    }

    // ─────────────────────────────────────────────────────────────────────────────────────────
    // Views
    // ─────────────────────────────────────────────────────────────────────────────────────────

    function requestOf(bytes32 requestId) external view returns (Request memory) {
        return _requests[requestId];
    }

    /// @notice Opaque handle references. Without an ACL grant the gateway refuses to decrypt them.
    function handlesOf(bytes32 requestId) external view returns (RequestHandles memory) {
        return _handles[requestId];
    }

    function requestHandleOrder() external pure returns (string memory) {
        return
        "desiredAssets, minimumAssets, maxRateIndexes[0..7], enabledFlags[0..7], preferredMaturityIndex";
    }

    // ─────────────────────────────────────────────────────────────────────────────────────────
    // Internals
    // ─────────────────────────────────────────────────────────────────────────────────────────

    function _requireBorrower(bytes32 requestId) private view returns (Request storage request) {
        request = _requests[requestId];
        if (request.borrower == address(0)) revert UnknownRequest(requestId);
        if (request.borrower != msg.sender) {
            revert NotBorrower(requestId, msg.sender, request.borrower);
        }
    }

    function _refund(address recipient, uint256 amountWei) private {
        if (amountWei == 0) return;
        (bool sent,) = recipient.call{value: amountWei}("");
        if (!sent) revert RefundFailed(recipient, amountWei);
    }

    function _seal(bytes32 requestId, EncryptedRequestInput calldata input, bytes[] calldata proofs)
        private
        returns (bytes32 commitment)
    {
        if (proofs.length != REQUEST_HANDLE_COUNT) {
            revert WrongProofCount(REQUEST_HANDLE_COUNT, proofs.length);
        }

        RequestHandles storage stored = _handles[requestId];
        bytes32[] memory raw = new bytes32[](REQUEST_HANDLE_COUNT);
        uint256 cursor = 0;

        {
            euint256 desired = Nox.fromExternal(input.desiredAssets, proofs[cursor]);
            stored.desiredAssets = desired;
            raw[cursor] = euint256.unwrap(desired);
            _consumeHandle(raw[cursor]);
            _grantOwnerOnly(desired, msg.sender);
            unchecked {
                ++cursor;
            }
        }

        {
            euint256 minimum = Nox.fromExternal(input.minimumAssets, proofs[cursor]);
            stored.minimumAssets = minimum;
            raw[cursor] = euint256.unwrap(minimum);
            _consumeHandle(raw[cursor]);
            _grantOwnerOnly(minimum, msg.sender);
            unchecked {
                ++cursor;
            }
        }

        for (uint256 i = 0; i < MARKET_SLOTS; ++i) {
            euint16 maxRate = Nox.fromExternal(input.maxRateIndexes[i], proofs[cursor]);
            stored.maxRateIndexes[i] = maxRate;
            raw[cursor] = euint16.unwrap(maxRate);
            _consumeHandle(raw[cursor]);
            _grantOwnerOnly(maxRate, msg.sender);
            unchecked {
                ++cursor;
            }
        }

        for (uint256 i = 0; i < MARKET_SLOTS; ++i) {
            euint16 enabled = Nox.fromExternal(input.enabledFlags[i], proofs[cursor]);
            stored.enabledFlags[i] = enabled;
            raw[cursor] = euint16.unwrap(enabled);
            _consumeHandle(raw[cursor]);
            _grantOwnerOnly(enabled, msg.sender);
            unchecked {
                ++cursor;
            }
        }

        {
            euint16 maturity = Nox.fromExternal(input.preferredMaturityIndex, proofs[cursor]);
            stored.preferredMaturityIndex = maturity;
            raw[cursor] = euint16.unwrap(maturity);
            _consumeHandle(raw[cursor]);
            _grantOwnerOnly(maturity, msg.sender);
            unchecked {
                ++cursor;
            }
        }

        commitment = keccak256(
            abi.encode(block.chainid, address(this), requestId, KYRVE_SCHEMA_VERSION, raw)
        );
    }
}
