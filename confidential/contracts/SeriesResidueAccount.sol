// SPDX-License-Identifier: GPL-2.0-or-later
pragma solidity 0.8.36;

import {IPublicLoanToken} from "./interfaces/ISettlementLayer.sol";

/**
 * @title SeriesResidueAccount
 * @notice The declared public destination for one series' rounding residue (PRD §19.8).
 *
 * ════════════════════════════════════════════════════════════════════════════════════════════
 * WHICH RESIDUE. THERE ARE TWO AND THIS HOLDS EXACTLY ONE
 * ════════════════════════════════════════════════════════════════════════════════════════════
 *
 * Both were 1 in the Phase 4 Sepolia run, which is precisely why they must be named apart — a test
 * asserting "the residue is 1" passes against either and proves nothing about the other. Delta
 * [T-2](../../docs/phase5/PRD-DELTA.md).
 *
 *   FUNDING RESIDUE — `published aggregate - buyer assets`, 299,999,999 - 299,999,998 = 1.
 *     PUBLIC: both terms were already public. It arises from the second floor in
 *     `units -> buyerAssets`, it exists as real loan tokens sitting in the series vault after
 *     settlement, and **this is the one this contract holds.**
 *
 *   UNRESERVED RESIDUE — `leaf capacity - published aggregate`, 300,000,000 - 299,999,999 = 1.
 *     PRIVATE AND MUST STAY PRIVATE. It is `NoxCurveEngine`'s `dustResidue` handle, granted to nobody
 *     and published never, because publishing it would disclose the winning leaf's total capacity by
 *     subtraction. **It never comes here.** No provider has a claim on it, no series unit represents
 *     it, and there is no function on this contract that could accept it — it is a handle, and
 *     everything here is a `uint256`.
 *
 * ════════════════════════════════════════════════════════════════════════════════════════════
 * WHY THE BENEFICIARY IS IMMUTABLE AND `distribute` IS PERMISSIONLESS
 * ════════════════════════════════════════════════════════════════════════════════════════════
 *
 * PRD §19.8: *"Dust cannot be swept to a developer wallet. At series close, residual dust is
 * distributed under a declared policy or donated to a declared public address."*
 *
 * A withdrawal function with a `to` parameter satisfies that in prose and violates it in practice:
 * whoever holds the key chooses the destination at withdrawal time, which is exactly a sweep to a
 * developer wallet with extra steps. So the destination is an `immutable` fixed at deployment and
 * visible in the constructor arguments of the verified source, and `distribute` takes no parameters
 * and no privileges. Anyone may call it; it can only ever send the whole balance to the one address
 * that was declared before any residue existed.
 *
 * There is no other transfer path, no owner, no upgrade and no rescue function. A token sent here by
 * mistake goes to the declared beneficiary, and that is stated rather than mitigated.
 *
 * PUBLIC / PRIVATE BOUNDARY: everything here is public. Every amount, every transfer, the
 * beneficiary and the running total. There is no confidential value in this contract by
 * construction — it performs no Nox operation and holds no handle.
 */
contract SeriesResidueAccount {
    /// @notice The series whose residue this account holds. One account per series.
    bytes32 public immutable SERIES_ID;
    address public immutable LOAN_TOKEN;
    /// @notice The declared destination, fixed before any residue existed. Cannot be changed.
    address public immutable DECLARED_BENEFICIARY;
    /// @notice The only address that may record a residue figure. The series allocator.
    address public immutable RECORDER;

    /// @notice The residue each quote is accounted to have produced. Public, and never a mint.
    mapping(bytes32 quoteId => uint256) public recordedResidue;
    uint256 public totalRecorded;
    uint256 public totalDistributed;

    event ResidueRecorded(bytes32 indexed quoteId, uint256 amount, uint256 totalRecorded);
    event ResidueDistributed(address indexed beneficiary, uint256 amount);

    error AlreadyRecorded(bytes32 quoteId, uint256 existing);
    error NothingToDistribute();
    error NotRecorder(address caller, address expected);
    error TransferRejected(address token, address to, uint256 amount);
    error ZeroAddress(string field);

    constructor(bytes32 seriesId, address loanToken, address declaredBeneficiary, address recorder) {
        if (seriesId == bytes32(0)) revert ZeroAddress("seriesId");
        if (loanToken == address(0)) revert ZeroAddress("loanToken");
        if (declaredBeneficiary == address(0)) revert ZeroAddress("declaredBeneficiary");
        if (recorder == address(0)) revert ZeroAddress("recorder");
        SERIES_ID = seriesId;
        LOAN_TOKEN = loanToken;
        DECLARED_BENEFICIARY = declaredBeneficiary;
        RECORDER = recorder;
    }

    /**
     * @notice Records the funding residue one quote produced.
     * @dev Recording is separate from receiving on purpose. The tokens live in the series vault until
     *      its operator moves them, and this contract cannot compel that — `KyrveSeriesVault` is
     *      Phase 4 code, deployed, and its `recoverFunding` is operator-only. What this makes
     *      impossible is a residue that nobody wrote down: the figure is public, it is derived from
     *      two public numbers, and {unsettledResidue} names the gap until it closes. Delta T-6.
     *
     *      Once written for a quote it cannot be rewritten. A residue that could be revised is a
     *      residue that can be revised downwards.
     */
    function recordResidue(bytes32 quoteId, uint256 amount) external {
        if (msg.sender != RECORDER) revert NotRecorder(msg.sender, RECORDER);
        uint256 existing = recordedResidue[quoteId];
        if (existing != 0) revert AlreadyRecorded(quoteId, existing);

        recordedResidue[quoteId] = amount;
        totalRecorded += amount;
        emit ResidueRecorded(quoteId, amount, totalRecorded);
    }

    /**
     * @notice Sends the entire balance to the declared beneficiary. No parameters, no privileges.
     * @dev Permissionless deliberately. A privileged distribution could be withheld; this one cannot
     *      be, and it cannot be redirected either, because the destination is `immutable`.
     */
    function distribute() external returns (uint256 amount) {
        amount = IPublicLoanToken(LOAN_TOKEN).balanceOf(address(this));
        if (amount == 0) revert NothingToDistribute();

        totalDistributed += amount;
        bool sent = IPublicLoanToken(LOAN_TOKEN).transfer(DECLARED_BENEFICIARY, amount);
        if (!sent) revert TransferRejected(LOAN_TOKEN, DECLARED_BENEFICIARY, amount);

        emit ResidueDistributed(DECLARED_BENEFICIARY, amount);
    }

    /// @notice Loan tokens this account is holding but has not yet distributed.
    function heldBalance() external view returns (uint256) {
        return IPublicLoanToken(LOAN_TOKEN).balanceOf(address(this));
    }

    /**
     * @notice Residue accounted for but not yet delivered to this account.
     * @dev The honest gap. Non-zero means a series vault operator still owes a transfer, and it is
     *      readable by anyone rather than discoverable only by reconciling two contracts by hand.
     */
    function unsettledResidue() external view returns (uint256) {
        uint256 delivered = totalDistributed + IPublicLoanToken(LOAN_TOKEN).balanceOf(address(this));
        return totalRecorded > delivered ? totalRecorded - delivered : 0;
    }
}
