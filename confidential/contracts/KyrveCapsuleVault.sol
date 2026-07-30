// SPDX-License-Identifier: GPL-2.0-or-later
pragma solidity 0.8.36;

import {euint256} from "@iexec-nox/nox-protocol-contracts/contracts/sdk/Nox.sol";

import {AggregateSolvencyVerifier} from "./AggregateSolvencyVerifier.sol";
import {KyrveSeriesToken} from "./KyrveSeriesToken.sol";
import {SeriesOwnershipRegistry} from "./SeriesOwnershipRegistry.sol";
import {SeriesResidueAccount} from "./SeriesResidueAccount.sol";
import {IKyrveSeriesVault, IPublicLoanToken} from "./interfaces/ISettlementLayer.sol";

/**
 * @title KyrveCapsuleVault
 * @notice Frozen selective disclosure. One capsule, one recipient, one scope, one snapshot — and
 *         nothing about it can change after it is issued (PRD §13.20, §19.6).
 *
 * ════════════════════════════════════════════════════════════════════════════════════════════
 * WHAT A CAPSULE IS, AND THE ONE THING IT IS NOT
 * ════════════════════════════════════════════════════════════════════════════════════════════
 *
 * A capsule is a **record**, not a viewer. It says: at block N, under deployment D, on chain C, for
 * series S, this recipient was given this scope of this subject's position, and here is the exact
 * handle that carries it. Everything it asserts is public. The only confidential thing anywhere near
 * it is the snapshot handle itself, and this contract never holds an ACL grant on one — it stores
 * `bytes32` and performs no Nox operation at all.
 *
 * It is **not a live admin viewer**, and the design forbids becoming one structurally rather than by
 * policy:
 *
 *   - There is no function here that grants anything to anybody. `Nox.allow` requires the caller to
 *     be an admin on the handle, and this contract deliberately never becomes one.
 *   - The only grant a capsule ever produces is made by {KyrveSeriesToken.issueOwnershipCapsule},
 *     which the HOLDER calls for their OWN balance, and which grants the recipient a handle that is
 *     a frozen `select` output — never the live balance handle.
 *   - There is no rescope, no re-issue, no extend, no upgrade and no owner. A capsule is written once
 *     and every field is read-only from that block onward.
 *
 * ════════════════════════════════════════════════════════════════════════════════════════════
 * EXPIRY IS NOT REVOCATION, AND SAYING OTHERWISE WOULD BE A LIE
 * ════════════════════════════════════════════════════════════════════════════════════════════
 *
 * `Nox.allow` is PERMANENT. `sdk/Nox.sol` version 0.2.4 has no `removeViewer`, no `removeAdmin`, no way
 * to un-set public decryption — only `disallowTransient` exists. So once a recipient holds a grant
 * on a snapshot handle, **they can decrypt it forever**, and no state on this contract changes that.
 *
 * A capsule's `expiry` therefore bounds exactly one thing: how long the capsule **asserts** its
 * scope. After it passes, {assertsValidAt} is false, {requireValid} reverts, and Kyrve Verify reports
 * the capsule as expired — which is what a counterparty relying on the disclosure needs. It does not
 * and cannot end the recipient's access to the snapshot they were already given.
 *
 * The UI must say "live access ended", "future snapshots disabled", or "this historical snapshot
 * remains available". It must never say "access revoked". Carry-over 10 from Phase 4, P6-5 from
 * Phase 5, `.claude/rules/security.md`.
 *
 * ════════════════════════════════════════════════════════════════════════════════════════════
 * THE FIVE REFUSALS
 * ════════════════════════════════════════════════════════════════════════════════════════════
 *
 * Each is a PUBLIC fault about a PUBLIC fact, so each is a public revert. None discloses an amount,
 * a balance, or whether any subject holds anything.
 *
 *   replay        a capsule id admits `None -> Sealed` exactly once, forever. `CapsuleAlreadyIssued`.
 *   substitution  the handle is bound INTO the capsule. A proof for any other handle fails
 *                 {requireHandle} — `WrongHandleForCapsule`.
 *   cross-recipient the recipient is bound in. {requireRecipient} refuses anyone else, and the
 *                 gateway refuses them independently because they hold no grant. `WrongRecipient`.
 *   stale         `expiry` and `snapshotBlock` are both bound in. `CapsuleExpired`.
 *   wrong origin  chain, deployment and series are bound in, so a capsule from another Kyrve
 *                 deployment cannot authenticate here. `WrongOriginForCapsule`.
 *
 * ════════════════════════════════════════════════════════════════════════════════════════════
 * WHY A DECRYPTION PROOF IS NOT ENOUGH ON ITS OWN
 * ════════════════════════════════════════════════════════════════════════════════════════════
 *
 * `validateDecryptionProof` is a pure signature check — no ACL, no nonce, no expiry, no caller
 * binding — so a valid proof is replayable by anyone forever and says nothing about which capsule
 * its value belongs to. Delta R-4 established the same thing for quote results, and the answer is
 * the same: bind the HANDLE to the record. {requireHandle} is that binding, and Kyrve Verify calls
 * it before it will accept any decrypted capsule value.
 *
 * PUBLIC / PRIVATE BOUNDARY. Everything stored here is public: who issued, to whom, over what scope,
 * at which block, under which deployment, and which handle. The VALUE behind an ownership capsule's
 * handle is private and decryptable only by the recipient and the subject. The public-scope capsules
 * freeze numbers that were already public — that is their entire point, and none of them adds a
 * disclosure.
 */
contract KyrveCapsuleVault {
    /**
     * @dev The initial scopes. Ordering is part of the ABI — append only, never reorder.
     *
     * ProviderSeriesOwnership is the ONLY scope that carries a confidential handle. Every other one
     * freezes public facts, and freezing a public fact is worth doing precisely because "what did
     * the position look like at block N" stops being answerable once the chain moves on.
     */
    enum Scope {
        ProviderSeriesOwnership,
        AggregateSeriesSupply,
        PublicMidnightCredit,
        SolvencyState,
        SettledQuoteSummary,
        DeclaredResidue,
        AllocationProvenance
    }

    /**
     * @dev The public facts a capsule freezes, read from chain at issuance and never from a caller.
     *
     * A capsule whose numbers came from its issuer would be a signed claim rather than a snapshot.
     * Every field here is read inside {issuePublicCapsule} from the bound contracts, so the curator
     * chooses WHEN a capsule is taken and nothing about WHAT it says.
     */
    struct PublicFacts {
        uint128 midnightCredit;
        uint128 midnightPendingFee;
        uint256 vaultReserves;
        uint256 residueReserves;
        uint256 publicCoverage;
        /// @dev The published aggregate the bound quote minted against. Zero if no quote is bound.
        uint256 aggregateFillAmount;
        uint256 recordedResidue;
        uint256 redemptionFactorWad;
        uint32 allocatedCount;
        bool quoteClosed;
        /// @dev The token's published supply snapshot, or zero if supply was never published.
        bytes32 publishedSupplyHandle;
        /// @dev The latest solvency verdict `ebool`, or zero if no snapshot has been taken.
        bytes32 solvencyVerdictHandle;
    }

    struct Capsule {
        bool issued;
        Scope scope;
        /// @dev Whose position. The zero address for a scope that describes the series as a whole.
        address subject;
        address recipient;
        uint64 issuedAt;
        uint64 expiry;
        uint64 snapshotBlock;
        bytes32 quoteId;
        /**
         * @dev The frozen snapshot handle, for {Scope.ProviderSeriesOwnership} only.
         *
         * It is a `select` output whose value equals the subject's balance at the snapshot block and
         * whose lineage nothing else can share — NOT the live balance handle, which is never granted
         * to anyone but its owner. See {KyrveSeriesToken.issueOwnershipCapsule}.
         */
        bytes32 snapshotHandle;
        /// @dev keccak256 over the frozen public facts, so a verifier can compare one word.
        bytes32 factsDigest;
    }

    /// @notice The longest a capsule may assert its scope. Ninety days.
    /// @dev A capsule that asserted indefinitely would be a standing disclosure with no review
    ///      point, and the recipient's access is permanent regardless — so the only thing an
    ///      unbounded expiry would buy is the illusion that the assertion is still current.
    uint64 public constant MAX_CAPSULE_LIFETIME = 90 days;

    bytes32 public immutable SERIES_ID;
    bytes32 public immutable MARKET_ID;
    /// @notice Binds every capsule to one Kyrve deployment. A capsule from another cannot
    ///         authenticate here, even on the same chain against the same Midnight market.
    bytes32 public immutable DEPLOYMENT_ID;
    uint256 public immutable CHAIN_ID;

    KyrveSeriesToken public immutable TOKEN;
    SeriesOwnershipRegistry public immutable OWNERSHIP;
    AggregateSolvencyVerifier public immutable SOLVENCY;
    SeriesResidueAccount public immutable RESIDUE;
    IKyrveSeriesVault public immutable VAULT;
    address public immutable LOAN_TOKEN;
    /// @notice The only address that may issue a public-scope capsule. Immutable.
    address public immutable CURATOR;

    uint32 public capsuleCount;
    mapping(bytes32 capsuleId => Capsule) private _capsules;
    mapping(bytes32 capsuleId => PublicFacts) private _facts;
    mapping(address recipient => bytes32[]) private _byRecipient;
    mapping(address subject => uint256) private _issuedBySubject;

    /// @dev No amount, ever — one shape whatever the frozen value turned out to be.
    event CapsuleIssued(
        bytes32 indexed capsuleId,
        Scope indexed scope,
        address indexed recipient,
        address subject,
        uint64 expiry,
        uint64 snapshotBlock
    );

    error CapsuleAlreadyIssued(bytes32 capsuleId);
    error CapsuleExpired(bytes32 capsuleId, uint64 expiry, uint256 nowTimestamp);
    error ExpiryInThePast(uint64 expiry, uint256 nowTimestamp);
    error ExpiryTooFar(uint64 expiry, uint64 maximum);
    error NoClaimForSubject(bytes32 quoteId, address subject);
    error NotCurator(address caller, address expected);
    error NotToken(address caller, address expected);
    error ScopeCarriesNoHandle(Scope scope);
    error ScopeRequiresAHandle(Scope scope);
    error UnknownCapsule(bytes32 capsuleId);
    error WrongHandleForCapsule(bytes32 capsuleId, bytes32 expected, bytes32 actual);
    error WrongOriginForCapsule(bytes32 capsuleId, bytes32 expectedDeployment, bytes32 actual);
    error WrongRecipient(bytes32 capsuleId, address expected, address actual);
    error WrongSeriesForCapsule(bytes32 expected, bytes32 actual);
    error ZeroAddress(string field);
    error ZeroValue(string field);

    constructor(
        bytes32 seriesId,
        bytes32 marketId,
        bytes32 deploymentId,
        KyrveSeriesToken token,
        SeriesOwnershipRegistry ownership,
        AggregateSolvencyVerifier solvency,
        SeriesResidueAccount residue,
        IKyrveSeriesVault vault,
        address curator
    ) {
        if (seriesId == bytes32(0)) revert ZeroValue("seriesId");
        if (marketId == bytes32(0)) revert ZeroValue("marketId");
        if (deploymentId == bytes32(0)) revert ZeroValue("deploymentId");
        if (address(token) == address(0)) revert ZeroAddress("token");
        if (address(ownership) == address(0)) revert ZeroAddress("ownership");
        if (address(solvency) == address(0)) revert ZeroAddress("solvency");
        if (address(residue) == address(0)) revert ZeroAddress("residue");
        if (address(vault) == address(0)) revert ZeroAddress("vault");
        if (curator == address(0)) revert ZeroAddress("curator");

        // Every bound contract is checked against THIS series rather than trusted. A capsule vault
        // wired to another series' token would freeze the wrong position under the right name.
        if (token.SERIES_ID() != seriesId) revert WrongSeriesForCapsule(seriesId, token.SERIES_ID());
        if (ownership.SERIES_ID() != seriesId) {
            revert WrongSeriesForCapsule(seriesId, ownership.SERIES_ID());
        }
        if (solvency.SERIES_ID() != seriesId) {
            revert WrongSeriesForCapsule(seriesId, solvency.SERIES_ID());
        }
        if (residue.SERIES_ID() != seriesId) {
            revert WrongSeriesForCapsule(seriesId, residue.SERIES_ID());
        }
        if (vault.SERIES_ID() != seriesId) revert WrongSeriesForCapsule(seriesId, vault.SERIES_ID());

        SERIES_ID = seriesId;
        MARKET_ID = marketId;
        DEPLOYMENT_ID = deploymentId;
        CHAIN_ID = block.chainid;
        TOKEN = token;
        OWNERSHIP = ownership;
        SOLVENCY = solvency;
        RESIDUE = residue;
        VAULT = vault;
        LOAN_TOKEN = vault.LOAN_TOKEN();
        CURATOR = curator;
    }

    // ─────────────────────────────────────────────────────────────────────────────────────────
    // Identity
    // ─────────────────────────────────────────────────────────────────────────────────────────

    /**
     * @notice The deterministic id of one capsule.
     * @dev Every field a verifier must not be able to substitute is folded in: the chain, the
     *      contract, the deployment, the series, the scope, the subject, the recipient, the quote
     *      and a per-subject sequence number. Two capsules over the same scope for the same pair are
     *      therefore different capsules with different ids, and neither can be passed off as the
     *      other.
     */
    function capsuleIdFor(
        Scope scope,
        address subject,
        address recipient,
        bytes32 quoteId,
        uint256 sequence
    ) public view returns (bytes32) {
        return keccak256(
            abi.encode(
                "kyrve.capsule.v1",
                block.chainid,
                address(this),
                DEPLOYMENT_ID,
                SERIES_ID,
                scope,
                subject,
                recipient,
                quoteId,
                sequence
            )
        );
    }

    /// @notice How many capsules this subject has issued. The next one's sequence number.
    function issuedBy(address subject) external view returns (uint256) {
        return _issuedBySubject[subject];
    }

    // ─────────────────────────────────────────────────────────────────────────────────────────
    // Issuance — two doors, both narrow, neither re-openable
    // ─────────────────────────────────────────────────────────────────────────────────────────

    /**
     * @notice Records one provider's frozen ownership capsule. Callable ONLY by the series token.
     *
     * @dev THE AUTHORITY HERE IS THE NARROWEST THING THAT WORKS, AND THE REASON MATTERS. The grant on
     *      the snapshot handle is made by `KyrveSeriesToken`, because `Nox.allow` requires the caller
     *      to be an admin on the handle and the token is the only contract that ever is. This
     *      contract cannot make that grant and must not be able to — so it records, and the token
     *      grants, and the token only ever grants a handle the HOLDER asked it to freeze for
     *      themselves.
     *
     *      The claim is checked against the ownership registry rather than taken on trust: a capsule
     *      naming a quote the subject holds no claim on would be a provenance assertion with no
     *      provenance. `NoClaimForSubject`.
     */
    function recordOwnershipCapsule(
        address subject,
        address recipient,
        bytes32 quoteId,
        uint64 expiry,
        bytes32 snapshotHandle,
        uint256 sequence
    ) external returns (bytes32 capsuleId) {
        if (msg.sender != address(TOKEN)) revert NotToken(msg.sender, address(TOKEN));
        if (subject == address(0)) revert ZeroAddress("subject");
        if (recipient == address(0)) revert ZeroAddress("recipient");
        if (snapshotHandle == bytes32(0)) revert ScopeRequiresAHandle(Scope.ProviderSeriesOwnership);

        SeriesOwnershipRegistry.Claim memory claim = OWNERSHIP.claimOf(quoteId, subject);
        if (claim.state != SeriesOwnershipRegistry.ClaimState.Allocated) {
            revert NoClaimForSubject(quoteId, subject);
        }

        capsuleId = _seal(
            Scope.ProviderSeriesOwnership,
            subject,
            recipient,
            quoteId,
            expiry,
            snapshotHandle,
            sequence,
            // An ownership capsule freezes ONE confidential handle and no public numbers. Its
            // provenance is the claim row, and that is bound through `quoteId`.
            keccak256(abi.encode("kyrve.capsule.ownership.v1", quoteId, claim.lockId, claim.allocatedAt))
        );
        _issuedBySubject[subject] = sequence + 1;
    }

    /**
     * @notice Freezes the public facts of this series under one scope, for one recipient.
     *
     * @dev CURATOR ONLY, and that is a griefing bound rather than a confidentiality one — every
     *      number this writes was already public, and anyone can read all of them right now. What
     *      permissionless issuance would buy an attacker is unbounded storage growth against a
     *      contract other people's capsules live in.
     *
     *      Nothing here is a parameter except the scope, the recipient and the expiry. Every fact is
     *      read from the bound contracts inside this call, so a capsule cannot say something its
     *      issuer preferred it to say.
     */
    function issuePublicCapsule(Scope scope, address recipient, bytes32 quoteId, uint64 expiry)
        external
        returns (bytes32 capsuleId)
    {
        if (msg.sender != CURATOR) revert NotCurator(msg.sender, CURATOR);
        if (scope == Scope.ProviderSeriesOwnership) revert ScopeRequiresAHandle(scope);
        if (recipient == address(0)) revert ZeroAddress("recipient");

        uint256 sequence = _issuedBySubject[address(0)];
        // Read BEFORE sealing, so `_seal` remains the only writer of a capsule and "written once,
        // never modified" stays literally true rather than true within one transaction.
        PublicFacts memory facts = _readPublicFacts(quoteId);
        capsuleId = _seal(
            scope, address(0), recipient, quoteId, expiry, bytes32(0), sequence, keccak256(abi.encode(facts))
        );
        _facts[capsuleId] = facts;
        _issuedBySubject[address(0)] = sequence + 1;
    }

    /**
     * @dev The single write path. Every capsule in this contract passes through it, so "issued once,
     *      never modified" is one function to read rather than a property to check per scope.
     */
    function _seal(
        Scope scope,
        address subject,
        address recipient,
        bytes32 quoteId,
        uint64 expiry,
        bytes32 snapshotHandle,
        uint256 sequence,
        bytes32 factsDigest
    ) private returns (bytes32 capsuleId) {
        if (expiry <= block.timestamp) revert ExpiryInThePast(expiry, block.timestamp);
        if (expiry - block.timestamp > MAX_CAPSULE_LIFETIME) {
            revert ExpiryTooFar(expiry, uint64(block.timestamp) + MAX_CAPSULE_LIFETIME);
        }

        capsuleId = capsuleIdFor(scope, subject, recipient, quoteId, sequence);
        Capsule storage capsule = _capsules[capsuleId];
        if (capsule.issued) revert CapsuleAlreadyIssued(capsuleId);

        capsule.issued = true;
        capsule.scope = scope;
        capsule.subject = subject;
        capsule.recipient = recipient;
        capsule.issuedAt = uint64(block.timestamp);
        capsule.expiry = expiry;
        capsule.snapshotBlock = uint64(block.number);
        capsule.quoteId = quoteId;
        capsule.snapshotHandle = snapshotHandle;
        capsule.factsDigest = factsDigest;

        _byRecipient[recipient].push(capsuleId);
        capsuleCount += 1;

        emit CapsuleIssued(capsuleId, scope, recipient, subject, expiry, uint64(block.number));
    }

    /// @dev Every public term of the series position, at this block, read and never supplied.
    function _readPublicFacts(bytes32 quoteId) private view returns (PublicFacts memory facts) {
        (uint128 credit, uint128 pendingFee, uint256 vaultReserves, uint256 residueReserves, uint256 coverage) =
            SOLVENCY.publicCoverage();

        facts.midnightCredit = credit;
        facts.midnightPendingFee = pendingFee;
        facts.vaultReserves = vaultReserves;
        facts.residueReserves = residueReserves;
        facts.publicCoverage = coverage;
        facts.redemptionFactorWad = TOKEN.redemptionFactorWad();
        // Unwrapped to `bytes32`, not operated on. This contract performs no Nox operation and
        // holds no ACL grant — it imports the type and nothing else.
        facts.publishedSupplyHandle = euint256.unwrap(TOKEN.publishedSupply());

        if (SOLVENCY.snapshotCount() > 0) {
            facts.solvencyVerdictHandle = SOLVENCY.latestSnapshot().verdictHandle;
        }

        if (quoteId != bytes32(0)) {
            SeriesOwnershipRegistry.QuoteBinding memory binding = OWNERSHIP.bindingOf(quoteId);
            facts.aggregateFillAmount = binding.aggregateFillAmount;
            facts.allocatedCount = binding.allocatedCount;
            facts.quoteClosed = binding.closed;
            facts.recordedResidue = RESIDUE.recordedResidue(quoteId);
        }
    }

    // ─────────────────────────────────────────────────────────────────────────────────────────
    // Verification — the public half of a capsule
    // ─────────────────────────────────────────────────────────────────────────────────────────

    function capsuleOf(bytes32 capsuleId) external view returns (Capsule memory) {
        Capsule memory capsule = _capsules[capsuleId];
        if (!capsule.issued) revert UnknownCapsule(capsuleId);
        return capsule;
    }

    function factsOf(bytes32 capsuleId) external view returns (PublicFacts memory) {
        if (!_capsules[capsuleId].issued) revert UnknownCapsule(capsuleId);
        return _facts[capsuleId];
    }

    function capsulesFor(address recipient) external view returns (bytes32[] memory) {
        return _byRecipient[recipient];
    }

    /**
     * @notice Whether the capsule still ASSERTS its scope at `timestamp`.
     * @dev Named `asserts` and not `isValid` on purpose. A recipient's ability to decrypt the
     *      snapshot does not end here and cannot — see the contract docstring.
     */
    function assertsValidAt(bytes32 capsuleId, uint256 timestamp) public view returns (bool) {
        Capsule storage capsule = _capsules[capsuleId];
        return capsule.issued && timestamp <= capsule.expiry;
    }

    /// @notice Reverts unless the capsule exists and has not expired.
    function requireValid(bytes32 capsuleId) public view {
        Capsule storage capsule = _capsules[capsuleId];
        if (!capsule.issued) revert UnknownCapsule(capsuleId);
        if (block.timestamp > capsule.expiry) {
            revert CapsuleExpired(capsuleId, capsule.expiry, block.timestamp);
        }
    }

    /// @notice Reverts unless `who` is the capsule's bound recipient.
    function requireRecipient(bytes32 capsuleId, address who) public view {
        Capsule storage capsule = _capsules[capsuleId];
        if (!capsule.issued) revert UnknownCapsule(capsuleId);
        if (capsule.recipient != who) revert WrongRecipient(capsuleId, capsule.recipient, who);
    }

    /**
     * @notice Reverts unless `handle` is the exact handle this capsule froze.
     * @dev THE SUBSTITUTION DEFENCE. A gateway decryption proof is a pure signature check with no
     *      ACL, no nonce and no caller binding, so "a valid proof exists for this value" says
     *      nothing about which capsule the value belongs to. This is what makes the pairing
     *      checkable.
     */
    function requireHandle(bytes32 capsuleId, bytes32 handle) public view {
        Capsule storage capsule = _capsules[capsuleId];
        if (!capsule.issued) revert UnknownCapsule(capsuleId);
        if (capsule.snapshotHandle == bytes32(0)) revert ScopeCarriesNoHandle(capsule.scope);
        if (capsule.snapshotHandle != handle) {
            revert WrongHandleForCapsule(capsuleId, capsule.snapshotHandle, handle);
        }
    }

    /// @notice Reverts unless the capsule belongs to this chain, deployment and series.
    function requireOrigin(bytes32 capsuleId, uint256 chainId, bytes32 deploymentId, bytes32 seriesId)
        public
        view
    {
        if (!_capsules[capsuleId].issued) revert UnknownCapsule(capsuleId);
        if (seriesId != SERIES_ID) revert WrongSeriesForCapsule(SERIES_ID, seriesId);
        if (deploymentId != DEPLOYMENT_ID || chainId != CHAIN_ID) {
            revert WrongOriginForCapsule(capsuleId, DEPLOYMENT_ID, deploymentId);
        }
    }

    /**
     * @notice Every refusal at once, for a verifier that wants one call and one answer.
     * @dev Reverts with the SPECIFIC reason rather than returning false, because "this capsule is
     *      not acceptable" is useless to a counterparty who needs to know whether it was expired,
     *      addressed to someone else, or carrying a substituted handle.
     */
    function requireDecryptable(bytes32 capsuleId, address reader, bytes32 handle) external view {
        requireOrigin(capsuleId, block.chainid, DEPLOYMENT_ID, SERIES_ID);
        requireValid(capsuleId);
        requireRecipient(capsuleId, reader);
        requireHandle(capsuleId, handle);
    }

    /**
     * @notice The public commitment a capsule makes, as one word.
     * @dev Reproducible off chain from public data alone, which is what makes "this capsule came
     *      from this deployment and says this" checkable without trusting any Kyrve service.
     */
    function originDigest(bytes32 capsuleId) external view returns (bytes32) {
        Capsule memory capsule = _capsules[capsuleId];
        if (!capsule.issued) revert UnknownCapsule(capsuleId);
        return keccak256(
            abi.encode(
                "kyrve.capsule.origin.v1",
                CHAIN_ID,
                address(this),
                DEPLOYMENT_ID,
                SERIES_ID,
                MARKET_ID,
                capsuleId,
                capsule.scope,
                capsule.subject,
                capsule.recipient,
                capsule.quoteId,
                capsule.issuedAt,
                capsule.expiry,
                capsule.snapshotBlock,
                capsule.snapshotHandle,
                capsule.factsDigest
            )
        );
    }
}
