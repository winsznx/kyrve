// SPDX-License-Identifier: GPL-2.0-or-later
pragma solidity 0.8.34;

/// @dev Lifecycle of one activated Kyrve quote. Mirrors PRD section 14.2.
enum QuoteStatus {
    None,
    Executable,
    Consumed,
    Expired
}

/// @dev The single public leaf selected from the private curve (PRD section 7.3).
///
/// PUBLIC/PRIVATE BOUNDARY. Every field here becomes PUBLIC the moment a quote is activated. The
/// full yield curve, per-provider capacities and allocations, provider counts, rejected leaves and
/// beneficial ownership all stay encrypted and are never represented in this struct.
///
/// `maxPendingFee` exists because `onBuy` receives `pendingFeeIncrease` — the continuous fee
/// accruing on new credit — which is the maker's real fee exposure (PRD v1.1 A-4). The settlement
/// fee is deliberately absent: for a buy offer the maker's payment is exactly independent of it
/// (A-6), so binding it would defend the wrong threat.
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

/// @dev Read surface shared by the ratifier and the vault so both enforce exactly one state.
///
/// The split is not redundancy. `isRatified` is `view` and never receives `units`, so it can
/// authenticate an offer but can never enforce fill size; `onBuy` is the only place actual fill
/// size reaches maker code. Both must therefore read the same activated quote.
interface IKyrveQuoteBinding {
    function quote(bytes32 quoteId) external view returns (ActivatedQuote memory);
}
