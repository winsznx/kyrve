// SPDX-License-Identifier: GPL-2.0-or-later
pragma solidity 0.8.36;

import {Nox, ebool, euint256} from "@iexec-nox/nox-protocol-contracts/contracts/sdk/Nox.sol";

import {KyrveConfidentialBase} from "./KyrveConfidentialBase.sol";
import {KyrveCustodyVault} from "./KyrveCustodyVault.sol";
import {KyrveEmergencyController} from "./KyrveEmergencyController.sol";
import {KyrveSeriesToken} from "./KyrveSeriesToken.sol";
import {SeriesResidueAccount} from "./SeriesResidueAccount.sol";
import {IKyrveSeriesVault, IPublicLoanToken} from "./interfaces/ISettlementLayer.sol";

/**
 * @title AggregateSolvencyVerifier
 * @notice Publicly reconciles one series' confidential claims against its real public position
 *         (PRD §13.21, §19.1, §19.6 — invariant 13).
 *
 * ════════════════════════════════════════════════════════════════════════════════════════════
 * THE INEQUALITY, AND WHY IT IS COMPARED THE WAY IT IS
 * ════════════════════════════════════════════════════════════════════════════════════════════
 *
 * PRD §19.1, term for term:
 *
 *     aggregate confidential active claims          <-- KyrveSeriesToken.confidentialTotalSupply
 *   + pending confidential redemption claims        <-- KyrveSeriesToken.confidentialTotalEntitlement
 *   <= public Midnight credit                       <-- IMidnight.credit(marketId, vault)
 *    + public withdrawable loan assets              <-- the vault's uncommitted loan-token balance
 *    + public settlement reserves                   <-- the residue account's held balance
 *    - protocol fees already accrued                <-- IMidnight.pendingFee(marketId, vault)
 *
 * The LEFT side is encrypted and the RIGHT side is entirely public. So the comparison is one encrypted
 * `le` against a public number wrapped to a handle, and the only thing that crosses the boundary is
 * the **verdict** — a single `ebool`. Nothing about the magnitude of the claims is disclosed.
 *
 * That is a deliberate choice over the obvious alternative. Publishing the claim total and letting a
 * reader do the subtraction would work, and `KyrveSeriesToken.publishAggregateSupply` exists for the
 * proof page that wants exactly that. But publishing is IRREVERSIBLE — Nox has no `removeViewer`, no
 * `removeAdmin` and no un-publish — so a verifier that had to publish the total in order to state the
 * verdict would make every solvency check a permanent disclosure. This one states the verdict without
 * disclosing either side.
 *
 * ════════════════════════════════════════════════════════════════════════════════════════════
 * WHY THE PUBLIC SIDE IS A DELTA-FREE ABSOLUTE, UNLIKE PHASE 4'S ASSERTIONS
 * ════════════════════════════════════════════════════════════════════════════════════════════
 *
 * Delta S-8 established that Midnight's `credit` and `debt` are cumulative MARKET POSITIONS rather
 * than per-quote amounts, and that measuring one settlement means taking a delta across its block —
 * an absolute assertion failed on an entirely correct Sepolia settlement because the borrower already
 * carried 3,000,000 units of Phase 1 debt.
 *
 * That correction does not apply here, and the difference is worth stating so nobody "fixes" this into
 * a delta. Solvency is a statement about the WHOLE series at one block: every claim ever minted
 * against every quote of this series, versus every unit of credit the vault holds. The cumulative
 * position is exactly the right number. It is the per-quote checks in `SeriesAllocator` that need the
 * delta, and they take one.
 *
 * ════════════════════════════════════════════════════════════════════════════════════════════
 * WHAT THIS DOES NOT PROVE, STATED HERE RATHER THAN INFERRED FROM ITS ABSENCE
 * ════════════════════════════════════════════════════════════════════════════════════════════
 *
 * The custody vault's own accounting invariant —
 * `sum(available) + sum(locked) <= asset.confidentialBalanceOf(vault)`, delta Q-6 — is **not** proven
 * on chain and cannot be, because proving it needs an encrypted `sum(available)` and
 * `KyrveCustodyVault` deliberately keeps none: an aggregate accumulated beside a provider's balance is
 * the exact mechanism by which Phase 2 handed its first depositor a permanent admin grant on the
 * protocol total (delta Q-5). Adding two accumulators to make the statement checkable would reintroduce
 * the hazard the Phase 2 vault removed.
 *
 * So Q-6 is maintained by construction — every credit to `_available` is backed by a matching coverage
 * increase, and the vault's `withdraw` docstring carries the argument — and it is checked by decrypting
 * every provider balance against the coverage in a bounded fixture. That is test evidence, not an
 * on-chain proof, and the difference is recorded as delta
 * [T-7](../../docs/phase5/PRD-DELTA.md) rather than left for a reader to notice.
 *
 * {confidentialCoverage} is still read and reported, because the handle being addressable is what lets
 * that fixture exist at all.
 *
 * PUBLIC / PRIVATE BOUNDARY: every input on the right-hand side is public. The left-hand side is two
 * encrypted aggregates, borrowed transiently, never granted onward and never published. The output is
 * one published boolean per snapshot.
 */
contract AggregateSolvencyVerifier is KyrveConfidentialBase {
    /**
     * @notice One snapshot's public inputs and its verdict handle, kept so the proof page shows the
     *         numbers the verdict was computed from rather than the numbers as they are now.
     */
    struct Snapshot {
        uint64 blockNumber;
        uint64 takenAt;
        uint128 credit;
        uint128 pendingFee;
        uint256 vaultReserves;
        uint256 residueReserves;
        uint256 publicCoverage;
        /// @dev The published `ebool`. Its plaintext is `true` iff the series is solvent.
        bytes32 verdictHandle;
    }

    bytes32 public immutable SERIES_ID;
    bytes32 public immutable MARKET_ID;
    KyrveSeriesToken public immutable TOKEN;
    KyrveCustodyVault public immutable CUSTODY;
    IKyrveSeriesVault public immutable VAULT;
    SeriesResidueAccount public immutable RESIDUE;
    address public immutable LOAN_TOKEN;

    uint32 public snapshotCount;
    mapping(uint32 index => Snapshot) private _snapshots;

    /**
     * @notice IRREVERSIBLE for the verdict handle. The verdict — and only the verdict — becomes
     *         publicly decryptable, permanently.
     */
    event SolvencyProven(
        uint32 indexed index, uint64 blockNumber, uint256 publicCoverage, bytes32 verdictHandle
    );

    error UnknownSnapshot(uint32 index);
    error ZeroAddress(string field);

    constructor(
        bytes32 seriesId,
        bytes32 marketId,
        KyrveSeriesToken token,
        KyrveCustodyVault custody,
        IKyrveSeriesVault vault,
        SeriesResidueAccount residue,
        KyrveEmergencyController controller
    ) KyrveConfidentialBase(controller) {
        if (seriesId == bytes32(0)) revert ZeroAddress("seriesId");
        if (marketId == bytes32(0)) revert ZeroAddress("marketId");
        if (address(token) == address(0)) revert ZeroAddress("token");
        if (address(custody) == address(0)) revert ZeroAddress("custody");
        if (address(vault) == address(0)) revert ZeroAddress("vault");
        if (address(residue) == address(0)) revert ZeroAddress("residue");

        SERIES_ID = seriesId;
        MARKET_ID = marketId;
        TOKEN = token;
        CUSTODY = custody;
        VAULT = vault;
        RESIDUE = residue;
        LOAN_TOKEN = vault.LOAN_TOKEN();
    }

    /**
     * @notice This verifier hands transient handles to nobody.
     * @dev It borrows two aggregates and compares them. It never lends one onward, and returning
     *      `false` unconditionally means `_assertReviewedTransientRecipient` would admit no address at
     *      all — the strongest form of that statement. Transient access carries full persistent-grant
     *      power, so a verifier that could pass one on would be a route to publishing the claim total.
     */
    function isReviewedTransientRecipient(address) public pure override returns (bool) {
        return false;
    }

    /**
     * @notice Takes one solvency snapshot and publishes its verdict.
     *
     * @dev PERMISSIONLESS, deliberately. A solvency proof that only a privileged key could produce is a
     *      solvency proof that can be withheld exactly when it matters. Anyone may call this; the
     *      inputs are all read from chain state and none of them is a parameter, so there is nothing a
     *      caller can bias.
     *
     *      THE ONE THING PUBLISHED IS THE VERDICT. `allowPublicDecryption` is called on the `ebool`
     *      and on nothing else. It is irreversible, and what it makes permanent is a single bit that
     *      the protocol is claiming publicly anyway.
     *
     *      `le` and not `lt`: the inequality in PRD §19.1 is `<=`, and a series whose claims exactly
     *      equal its coverage is solvent. Getting that boundary wrong in the strict direction would
     *      report a fully-funded series as insolvent, which is the failure mode that erodes trust in
     *      the check rather than in the series.
     *
     *      `zeroFloorSub` on the fee rather than a checked subtraction: `pendingFee` can in principle
     *      exceed the credit plus reserves on a market that has accrued fees against a nearly-empty
     *      position, and an underflow revert there would make the verifier unable to report the very
     *      state it exists to report. Flooring at zero reports *no coverage*, which is the truth.
     */
    function proveSolvency() external returns (uint32 index, bytes32 verdictHandle) {
        (uint128 credit,, uint128 pendingFee) = VAULT.positionOf(MARKET_ID);

        // The vault's uncommitted loan tokens. Committed funding belongs to a live quote that has not
        // settled, so it is not coverage for claims that already exist.
        uint256 vaultReserves = VAULT.availableFunding();
        uint256 residueReserves = IPublicLoanToken(LOAN_TOKEN).balanceOf(address(RESIDUE));

        uint256 gross = uint256(credit) + vaultReserves + residueReserves;
        uint256 fee = uint256(pendingFee);
        uint256 coverage = gross > fee ? gross - fee : 0;

        // Borrow both encrypted aggregates for exactly this transaction. The token refuses any caller
        // that is not this bound address, because transient access carries full persistent-grant power.
        TOKEN.lendSupply();
        euint256 claims = Nox.add(TOKEN.confidentialAggregateSupply(), TOKEN.confidentialTotalEntitlement());

        // The sum is an intermediate and is granted to NOBODY. Intermediates may collide freely and
        // harmlessly — `KyrveCurveBase`'s rule is not "avoid collisions", it is "never grant a user or
        // the public a handle that something else could equal". This one is never granted.
        ebool solvent = Nox.le(claims, Nox.toEuint256(coverage));
        Nox.allowThis(solvent);
        Nox.allowPublicDecryption(solvent);

        verdictHandle = ebool.unwrap(solvent);
        index = snapshotCount;
        snapshotCount = index + 1;

        _snapshots[index] = Snapshot({
            blockNumber: uint64(block.number),
            takenAt: uint64(block.timestamp),
            credit: credit,
            pendingFee: pendingFee,
            vaultReserves: vaultReserves,
            residueReserves: residueReserves,
            publicCoverage: coverage,
            verdictHandle: verdictHandle
        });

        emit SolvencyProven(index, uint64(block.number), coverage, verdictHandle);
    }

    // ─────────────────────────────────────────────────────────────────────────────────────────
    // Views
    // ─────────────────────────────────────────────────────────────────────────────────────────

    function snapshotAt(uint32 index) external view returns (Snapshot memory) {
        if (index >= snapshotCount) revert UnknownSnapshot(index);
        return _snapshots[index];
    }

    function latestSnapshot() external view returns (Snapshot memory) {
        if (snapshotCount == 0) revert UnknownSnapshot(0);
        return _snapshots[snapshotCount - 1];
    }

    /**
     * @notice The public right-hand side as it stands right now, without taking a snapshot.
     * @dev A `view`, so the proof page and the terminal can show live coverage without paying for a
     *      publication. It deliberately returns the terms separately as well as the total: a single
     *      number would hide which term moved.
     */
    function publicCoverage()
        external
        view
        returns (uint128 credit, uint128 pendingFee, uint256 vaultReserves, uint256 residueReserves, uint256 total)
    {
        (credit,, pendingFee) = VAULT.positionOf(MARKET_ID);
        vaultReserves = VAULT.availableFunding();
        residueReserves = IPublicLoanToken(LOAN_TOKEN).balanceOf(address(RESIDUE));
        uint256 gross = uint256(credit) + vaultReserves + residueReserves;
        total = gross > uint256(pendingFee) ? gross - uint256(pendingFee) : 0;
    }

    /**
     * @notice The custody vault's confidential coverage handle.
     * @dev Reported, not proven. See the contract docstring and delta T-7: the matching
     *      `sum(available) + sum(locked)` cannot exist on chain without reintroducing the Q-5 hazard,
     *      so this side of Q-6 is checked by decryption in a bounded fixture rather than here.
     */
    function custodyCoverage() external view returns (euint256) {
        return CUSTODY.confidentialCoverage();
    }
}
