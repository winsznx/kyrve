// SPDX-License-Identifier: GPL-2.0-or-later
// Day 0 validation spike. Not a production contract.
pragma solidity 0.8.34;

/// @dev Lifecycle of one activated Kyrve quote. Mirrors PRD section 14.2.
enum QuoteStatus {
    None,
    Executable,
    Consumed,
    Expired
}

/// @dev The single public leaf selected from the private curve (PRD section 7.3).
struct ActivatedQuote {
    bytes32 offerHash;
    bytes32 marketId;
    address taker;
    uint128 exactUnits;
    uint128 expectedBuyerAssets;
    uint128 maxPendingFee;
    uint40 expiry;
    QuoteStatus status;
}

/// @dev Read surface shared by the ratifier and the series vault so both enforce one state.
interface IKyrveQuoteRegistry {
    function quote(bytes32 quoteId) external view returns (ActivatedQuote memory);
}
