// SPDX-License-Identifier: GPL-2.0-or-later
pragma solidity 0.8.36;

import {euint256} from "@iexec-nox/nox-protocol-contracts/contracts/sdk/Nox.sol";

import {KyrveConfidentialBase} from "./KyrveConfidentialBase.sol";
import {KyrveEmergencyController} from "./KyrveEmergencyController.sol";

/**
 * @title SeriesOwnershipRegistry
 * @notice Who owns what share of one series, and which computation says so.
 *
 * The series token holds the BALANCES. This holds the PROVENANCE: for each `(quoteId, provider)`,
 * the encrypted amount that was allocated, the custody lock it came from, the epoch that computed
 * it, and the sealed graph root that computation ended at. Separating them is not bookkeeping
 * decoration — it is what makes invariant 12 enforceable. A balance answers "how much"; only a
 * provenance row can answer "on the authority of which epoch, and has that authority already been
 * spent".
 *
 * ════════════════════════════════════════════════════════════════════════════════════════════
 * THE FIVE REFUSALS — invariant 12
 * ════════════════════════════════════════════════════════════════════════════════════════════
 *
 * Each is a PUBLIC fault and therefore a public revert. None of them discloses an amount, a balance
 * or whether any provider was short.
 *
 *   replay          `(quoteId, provider)` admits `None -> Allocated` exactly once, forever.
 *                   `ClaimAlreadyAllocated`.
 *   stale epoch     the first allocation for a quote BINDS its epoch; every later one must match.
 *                   `WrongEpochForQuote`.
 *   wrong graph root the first allocation binds the sealed root too, and a root belongs to exactly
 *                   one completed computation. `WrongGraphRootForQuote`.
 *   wrong provider  a claim is addressed by `(quoteId, provider)` and the lock it cites must be the
 *                   lock that provider's own reservation opened. `WrongLockForProvider`.
 *   wrong series    this registry serves ONE series, fixed at construction, and refuses a quote whose
 *                   vault is not that series' maker. `WrongSeries`.
 *
 * ════════════════════════════════════════════════════════════════════════════════════════════
 * PUBLIC / PRIVATE BOUNDARY
 * ════════════════════════════════════════════════════════════════════════════════════════════
 *
 *   PUBLIC     that a provider holds a claim on a quote; which lock and which epoch it came from;
 *              how many providers a quote allocated to; whether the quote is sealed. Provider
 *              participation is already public from the epoch — this adds no new identity.
 *   PRIVATE    every allocated amount. Each is stored as a handle granted to its owner and to
 *              nobody else, and the registry itself performs no arithmetic on any of them, so there
 *              is no aggregate here that could alias one.
 *
 * ════════════════════════════════════════════════════════════════════════════════════════════
 * WHY THERE IS NO ENCRYPTED TOTAL IN THIS CONTRACT
 * ════════════════════════════════════════════════════════════════════════════════════════════
 *
 * Read delta Q-5 before adding one. An encrypted running total accumulated beside a provider's
 * amount is how Phase 2 handed its first depositor a permanent admin grant on the protocol
 * aggregate: both were the same operation over the same operands, hence ONE handle with ONE
 * PERMANENT ACL entry, and `allow` has no inverse.
 *
 * The total this registry would compute already exists in two better places. `KyrveSeriesToken`'s
 * `confidentialTotalSupply` is maintained by `Nox.mint` at a distinct output index, and
 * `KyrveCustodyVault` unwrapped the same sum into a PUBLIC ERC-20 transfer whose plaintext anyone can
 * read. A third copy would be a third hazard for a number that is already checkable twice.
 */
contract SeriesOwnershipRegistry is KyrveConfidentialBase {
    enum ClaimState {
        None,
        Allocated,
        Unwound
    }

    struct Claim {
        ClaimState state;
        address provider;
        bytes32 lockId;
        uint64 allocatedAt;
        uint64 changedAt;
    }

    /// @dev What a quote's allocation is bound to, written by the FIRST claim and never again.
    struct QuoteBinding {
        bool bound;
        bool closed;
        bytes32 epochId;
        bytes32 graphRoot;
        /// @dev The published aggregate the series minted against. Public, and the number invariant 1
        ///      is checked against.
        uint256 aggregateFillAmount;
        uint32 allocatedCount;
        uint32 unwoundCount;
    }

    bytes32 public immutable SERIES_ID;
    address public immutable DEPLOYER;

    /// @notice The only address that may record or unwind a claim. Bound once, never again.
    address public allocator;

    mapping(bytes32 quoteId => mapping(address provider => Claim)) private _claims;
    mapping(bytes32 quoteId => mapping(address provider => euint256)) private _allocated;
    mapping(bytes32 quoteId => QuoteBinding) private _bindings;
    mapping(bytes32 quoteId => address[]) private _providers;

    event AllocatorBound(address indexed allocatorAddress);
    event QuoteBound(bytes32 indexed quoteId, bytes32 indexed epochId, bytes32 graphRoot, uint256 aggregateFillAmount);
    /// @dev No amount, ever. Identical whatever the encrypted allocation turned out to be.
    event ClaimRecorded(bytes32 indexed quoteId, address indexed provider, bytes32 lockId);
    event ClaimUnwound(bytes32 indexed quoteId, address indexed provider);
    event QuoteClosed(bytes32 indexed quoteId, uint32 allocatedCount);

    error AllocatorAlreadyBound(address existing);
    error AllocatorNotBound();
    error ClaimAlreadyAllocated(bytes32 quoteId, address provider);
    error ClaimNotAllocated(bytes32 quoteId, address provider, ClaimState state);
    error NotAllocator(address caller, address expected);
    error NotDeployer(address caller, address expected);
    error QuoteAlreadyClosed(bytes32 quoteId);
    error QuoteNotBound(bytes32 quoteId);
    error WrongEpochForQuote(bytes32 quoteId, bytes32 expected, bytes32 actual);
    error WrongGraphRootForQuote(bytes32 quoteId, bytes32 expected, bytes32 actual);
    error WrongAggregateForQuote(bytes32 quoteId, uint256 expected, uint256 actual);
    error WrongLockForProvider(bytes32 quoteId, address provider, bytes32 expected, bytes32 actual);
    error WrongSeries(bytes32 expected, bytes32 actual);
    error ZeroAddress(string field);

    constructor(bytes32 seriesId, KyrveEmergencyController controller) KyrveConfidentialBase(controller) {
        if (seriesId == bytes32(0)) revert ZeroAddress("seriesId");
        SERIES_ID = seriesId;
        DEPLOYER = msg.sender;
    }

    function bindAllocator(address allocatorAddress) external {
        if (msg.sender != DEPLOYER) revert NotDeployer(msg.sender, DEPLOYER);
        if (allocator != address(0)) revert AllocatorAlreadyBound(allocator);
        if (allocatorAddress == address(0)) revert ZeroAddress("allocator");
        allocator = allocatorAddress;
        emit AllocatorBound(allocatorAddress);
    }

    modifier onlyAllocator() {
        if (allocator == address(0)) revert AllocatorNotBound();
        if (msg.sender != allocator) revert NotAllocator(msg.sender, allocator);
        _;
    }

    /**
     * @notice This registry hands transient handles to nobody.
     * @dev It stores handles and performs no arithmetic, so it never needs to lend one. Returning
     *      `false` unconditionally is the strongest possible form of that statement: there is no
     *      address, reviewed or otherwise, that `_assertReviewedTransientRecipient` would admit.
     */
    function isReviewedTransientRecipient(address) public pure override returns (bool) {
        return false;
    }

    // ─────────────────────────────────────────────────────────────────────────────────────────
    // Recording
    // ─────────────────────────────────────────────────────────────────────────────────────────

    /**
     * @notice Records one provider's confidential claim, binding the quote on the first call.
     *
     * @param seriesId the series the allocator believes it is allocating for. Checked against this
     *        registry's own immutable, so a misrouted allocator call fails here rather than writing a
     *        row into the wrong series' ownership. The wrong-series refusal.
     * @param allocatedHandle the amount the series token actually minted. Stored, granted to the
     *        provider, never operated on.
     *
     * @dev THE BINDING IS WRITTEN ONCE AND CHECKED EVERY TIME AFTER. The first claim for a quote
     *      fixes its epoch, its sealed graph root and its published aggregate; every later claim must
     *      present the same three. That is what makes "stale epoch" and "wrong graph root" mechanical
     *      rather than a matter of the caller's diligence: an allocator that mixed two epochs into one
     *      quote's ownership would fail on the second provider, not silently produce a series whose
     *      claims came from two computations.
     *
     *      THIS CONTRACT MAKES NO ACL GRANT AT ALL, and could not: `Nox.allow` requires the caller to
     *      be an admin on the handle, and this contract deliberately never becomes one. The provider's
     *      grant on their own minted amount is made by `KyrveSeriesToken.mintClaim`, which created the
     *      handle and is therefore the only contract that can. A registry that could grant access to
     *      an amount it merely records would be a second, weaker route to the same permission.
     */
    function recordClaim(
        bytes32 quoteId,
        address provider,
        bytes32 seriesId,
        bytes32 epochId,
        bytes32 graphRoot,
        uint256 aggregateFillAmount,
        bytes32 lockId,
        euint256 allocatedHandle
    ) external onlyAllocator {
        if (seriesId != SERIES_ID) revert WrongSeries(SERIES_ID, seriesId);
        if (provider == address(0)) revert ZeroAddress("provider");

        QuoteBinding storage binding = _bindings[quoteId];
        if (binding.closed) revert QuoteAlreadyClosed(quoteId);

        if (!binding.bound) {
            binding.bound = true;
            binding.epochId = epochId;
            binding.graphRoot = graphRoot;
            binding.aggregateFillAmount = aggregateFillAmount;
            emit QuoteBound(quoteId, epochId, graphRoot, aggregateFillAmount);
        } else {
            if (binding.epochId != epochId) revert WrongEpochForQuote(quoteId, binding.epochId, epochId);
            if (binding.graphRoot != graphRoot) {
                revert WrongGraphRootForQuote(quoteId, binding.graphRoot, graphRoot);
            }
            if (binding.aggregateFillAmount != aggregateFillAmount) {
                revert WrongAggregateForQuote(quoteId, binding.aggregateFillAmount, aggregateFillAmount);
            }
        }

        Claim storage claim = _claims[quoteId][provider];
        if (claim.state != ClaimState.None) revert ClaimAlreadyAllocated(quoteId, provider);

        claim.state = ClaimState.Allocated;
        claim.provider = provider;
        claim.lockId = lockId;
        claim.allocatedAt = uint64(block.timestamp);
        claim.changedAt = uint64(block.timestamp);

        _allocated[quoteId][provider] = allocatedHandle;
        _providers[quoteId].push(provider);
        binding.allocatedCount += 1;

        emit ClaimRecorded(quoteId, provider, lockId);
    }

    /**
     * @notice Marks a quote's allocation complete, so nothing can be appended to it afterwards.
     * @dev Invariant 5's public half. Once closed, `allocatedCount` is final and the sum of the
     *      claims it holds is the series' whole supply for that quote — a later append could not be
     *      matched by a later mint, because the custody vault already unwrapped exactly the aggregate
     *      and there is nothing left to fund one.
     */
    function closeQuote(bytes32 quoteId) external onlyAllocator {
        QuoteBinding storage binding = _bindings[quoteId];
        if (!binding.bound) revert QuoteNotBound(quoteId);
        if (binding.closed) revert QuoteAlreadyClosed(quoteId);
        binding.closed = true;
        emit QuoteClosed(quoteId, binding.allocatedCount);
    }

    /**
     * @notice Marks a claim unwound after the quote it belonged to failed to settle.
     * @dev The row is NOT deleted. A deleted row would make the history unreadable and would let the
     *      same `(quoteId, provider)` be allocated again — the replay this contract exists to refuse.
     *      `Unwound` is terminal and admits nothing.
     */
    function unwindClaim(bytes32 quoteId, address provider, bytes32 lockId) external onlyAllocator {
        Claim storage claim = _claims[quoteId][provider];
        if (claim.state != ClaimState.Allocated) revert ClaimNotAllocated(quoteId, provider, claim.state);
        if (claim.lockId != lockId) revert WrongLockForProvider(quoteId, provider, claim.lockId, lockId);

        claim.state = ClaimState.Unwound;
        claim.changedAt = uint64(block.timestamp);
        _bindings[quoteId].unwoundCount += 1;

        emit ClaimUnwound(quoteId, provider);
    }

    // ─────────────────────────────────────────────────────────────────────────────────────────
    // Views
    // ─────────────────────────────────────────────────────────────────────────────────────────

    /// @notice The provider's allocated amount. Only the provider holds a grant to decrypt it.
    function confidentialAllocatedOf(bytes32 quoteId, address provider) external view returns (euint256) {
        return _allocated[quoteId][provider];
    }

    function claimOf(bytes32 quoteId, address provider) external view returns (Claim memory) {
        return _claims[quoteId][provider];
    }

    function bindingOf(bytes32 quoteId) external view returns (QuoteBinding memory) {
        return _bindings[quoteId];
    }

    /// @notice Every provider holding a claim on this quote, in allocation order. Public.
    function providersOf(bytes32 quoteId) external view returns (address[] memory) {
        return _providers[quoteId];
    }

    function allocatedCountOf(bytes32 quoteId) external view returns (uint32) {
        return _bindings[quoteId].allocatedCount;
    }

    /// @notice True once every recorded claim for the quote has been unwound.
    function isFullyUnwound(bytes32 quoteId) external view returns (bool) {
        QuoteBinding storage binding = _bindings[quoteId];
        return binding.bound && binding.allocatedCount > 0 && binding.unwoundCount == binding.allocatedCount;
    }
}
