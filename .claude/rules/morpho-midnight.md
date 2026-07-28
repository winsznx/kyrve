---
description: Verified Midnight protocol facts and integration rules
globs: ["contracts/**", "packages/midnight/**", "packages/quote-math/**"]
---

# Morpho Midnight integration

Pinned: release `2026-07-23`, commit `dbd8d3d5`, in `vendor/midnight` (submodule, never edited).
Use `/morpho-docs` for anything not listed here. Verify against the pinned tag, not `main`.

## Verified facts

- `isRatified(Offer, bytes, address taker) view returns (bytes32)` — **`view`, and receives no
  `units`.** A ratifier can authenticate an offer but can never enforce fill size.
- `onBuy(bytes32 id, Market, uint256 buyerAssets, uint256 units, uint256 pendingFeeIncrease,
  address buyer, bytes data) returns (bytes32)` — this is the only place actual fill size becomes
  visible to maker code. **Exact fill is enforced here.**
- Midnight permits partial fills: `newConsumed <= offer.maxUnits`.
- `onBuy` runs **before** Midnight pulls tokens, and with `offer.callback != 0` the callback address
  becomes the `payer`. The vault must hold the loan tokens and approve Midnight inside `onBuy`.
- Reverting in `onBuy` reverts the entire `take` — group consumption, credit and debt all roll back.
- For a buy offer: `buyerAssets = floor(units * tickToPrice(tick) / WAD)`, **independent of the
  settlement fee**. The fee is deducted from the borrower's proceeds only.
- `tickToPrice` is monotonically non-decreasing, capped at WAD. **Higher tick = higher price =
  cheaper borrowing.** Sort rate indexes accordingly.
- Midnight requires `isAuthorized[offer.maker][offer.ratifier]`; the maker must call
  `setIsAuthorized(ratifier, true, maker)` or `take` reverts `RatifierUnauthorized`.
- `Market` embeds `chainId` and `midnight`, and `IdLib.toId` hashes the whole struct — chain and
  deployment replay protection is native.
- Exactly one of `maxUnits` / `maxAssets` may be non-zero.
- `setConsumed(group, amount, onBehalf)` lets a maker pre-consume a group — a cancellation primitive.
- At maturity `withdraw` pays out `units` 1:1 in loan token, capped by market `withdrawable`.

## Rules

- Never modify anything under `vendor/midnight`. Kyrve contracts are separate extension contracts.
- Derive quote math from the pinned libraries and differential-test it against real `take` returns.
- A universe rate grid must exclude ticks whose price is below the market's settlement fee, or
  `take` reverts on underflow.
- Derive `units` from a target asset amount by rounding **down**, so the maker never owes more than
  providers reserved. Account for the residue as dust.
- Never present the Sepolia replica as an official Morpho deployment, and never use Morpho branding.
