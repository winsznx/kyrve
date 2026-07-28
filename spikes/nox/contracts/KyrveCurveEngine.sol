// SPDX-License-Identifier: GPL-2.0-or-later
// Kyrve Day 0 Spike D. Measurement scaffold, not product code.
pragma solidity ^0.8.35;

import {Nox} from "@iexec-nox/nox-protocol-contracts/contracts/sdk/Nox.sol";
import "encrypted-types/EncryptedTypes.sol";

/// @dev Hierarchical, idempotent, multi-transaction confidential curve engine.
///
/// The monolithic design implied by PRD section 9.1 is not executable: a naive
/// six-term arithmetised conjunction costs ~147k gas per (provider, leaf) cell, so a
/// 16x128 universe would need ~300M gas in one transaction. This engine preserves the
/// full private universe and changes only the execution schedule.
///
/// Three structural optimisations, each measured in test/02-curve-engine.ts:
///
/// 1. PREDICATE CACHING. Provider-level predicates (enabled, borrower allowed,
///    portfolio cap, balance) do not vary by leaf, so they are evaluated once per
///    provider instead of once per cell - 16 evaluations instead of 2,048.
///
/// 2. SELECT-AS-MULTIPLY. `select(cond, cachedValue, 0)` computes eligibility AND
///    applies it in one operation, replacing an indicator conversion plus a multiply.
///
/// 3. PUBLIC TICK. The universe rate grid is public, so `rateAllowed` is a single
///    comparison of a public tick against the provider's encrypted minimum.
///
/// Nothing about what stays private changes. No intermediate capacity or provider
/// count is ever publicly decrypted - only the final selected leaf.
contract KyrveCurveEngine {
    error UnknownProvider();
    error StageOutOfOrder();

    struct Provider {
        euint256 capacity;
        euint16 minTickIndex;
        euint16 enabledFlag;
        euint16 borrowerOkFlag;
        euint16 portfolioOkFlag;
        // Cached, provider-level. Computed once, reused across every leaf.
        euint256 capacityIfEligible;
        euint16 countIfEligible;
        bool cached;
    }

    struct Leaf {
        euint256 capacityAcc;
        euint16 countAcc;
        euint256 fillable;
        bool started;
        bool finalized;
    }

    mapping(uint256 => Provider) public providers;
    mapping(uint256 => Leaf) public leaves;

    euint256 public winnerFillable;
    euint16 public winnerLeafIndex;
    euint256 public totalSelectedCapacity;
    euint256 public requestedAmount;

    // ---------------------------------------------------------------------------
    // Stage A - seal one provider mandate (once per provider per epoch)
    // ---------------------------------------------------------------------------

    function seedProvider(
        uint256 p,
        externalEuint256 capacity,
        bytes calldata capacityProof,
        externalEuint16 minTickIndex,
        bytes calldata tickProof,
        externalEuint16 enabledFlag,
        bytes calldata enabledProof,
        externalEuint16 borrowerOkFlag,
        bytes calldata borrowerProof,
        externalEuint16 portfolioOkFlag,
        bytes calldata portfolioProof
    ) external {
        Provider storage pr = providers[p];
        pr.capacity = Nox.fromExternal(capacity, capacityProof);
        pr.minTickIndex = Nox.fromExternal(minTickIndex, tickProof);
        pr.enabledFlag = Nox.fromExternal(enabledFlag, enabledProof);
        pr.borrowerOkFlag = Nox.fromExternal(borrowerOkFlag, borrowerProof);
        pr.portfolioOkFlag = Nox.fromExternal(portfolioOkFlag, portfolioProof);

        Nox.allowThis(pr.capacity);
        Nox.allowThis(pr.minTickIndex);
        Nox.allowThis(pr.enabledFlag);
        Nox.allowThis(pr.borrowerOkFlag);
        Nox.allowThis(pr.portfolioOkFlag);
        pr.cached = false;
    }

    // ---------------------------------------------------------------------------
    // Stage B - cache provider-level predicates (once per provider, NOT per leaf)
    // ---------------------------------------------------------------------------

    /// @dev Collapses four provider-level predicates into two cached handles.
    /// Every later stage reuses these, so this cost is paid 16 times, not 2,048.
    function cacheProvider(uint256 p) external {
        Provider storage pr = providers[p];

        euint16 zero16 = Nox.toEuint16(0);
        euint256 zero256 = Nox.toEuint256(0);

        // enabled AND borrowerOk AND portfolioOk, arithmetised: Nox has no boolean ops.
        euint16 flags = Nox.mul(pr.enabledFlag, pr.borrowerOkFlag);
        flags = Nox.mul(flags, pr.portfolioOkFlag);

        // balanceAvailable: capacity > 0
        ebool hasBalance = Nox.gt(pr.capacity, zero256);

        // countIfEligible = flags if capacity > 0 else 0
        euint16 countIfEligible = Nox.select(hasBalance, flags, zero16);

        // capacityIfEligible = capacity if all provider-level predicates hold else 0
        ebool allOk = Nox.eq(countIfEligible, Nox.toEuint16(1));
        euint256 capacityIfEligible = Nox.select(allOk, pr.capacity, zero256);

        Nox.allowThis(countIfEligible);
        Nox.allowThis(capacityIfEligible);

        pr.countIfEligible = countIfEligible;
        pr.capacityIfEligible = capacityIfEligible;
        pr.cached = true;
    }

    // ---------------------------------------------------------------------------
    // Stage C - accumulate one leaf over a chunk of providers (idempotent per chunk)
    // ---------------------------------------------------------------------------

    /// @dev `publicTickIndex` is public: the universe rate grid is published and
    /// hashed, so only the provider's minimum acceptable tick is encrypted.
    ///
    /// Per cell this executes exactly five operations:
    ///   ge -> select(euint256) -> add -> select(euint16) -> add16
    /// which both tests eligibility and applies it. The 0/1 indicator conversion and
    /// the separate multiply are eliminated by using select against a cached value.
    function accumulateLeafChunk(
        uint256 leafIndex,
        uint16 publicTickIndex,
        uint256 providerStart,
        uint256 providerCount
    ) external {
        Leaf storage lf = leaves[leafIndex];
        require(!lf.finalized, StageOutOfOrder());

        // Hoisted out of the loop: one conversion serves the whole chunk.
        euint16 tickHandle = Nox.toEuint16(publicTickIndex);
        euint16 zero16 = Nox.toEuint16(0);
        euint256 zero256 = Nox.toEuint256(0);

        euint256 capAcc = lf.started ? lf.capacityAcc : zero256;
        euint16 cntAcc = lf.started ? lf.countAcc : zero16;

        for (uint256 i = 0; i < providerCount; i++) {
            Provider storage pr = providers[providerStart + i];
            require(pr.cached, UnknownProvider());

            // rateAllowed: public leaf tick >= provider's encrypted minimum
            ebool rateOk = Nox.ge(tickHandle, pr.minTickIndex);

            // Eligibility and application in one operation each.
            capAcc = Nox.add(capAcc, Nox.select(rateOk, pr.capacityIfEligible, zero256));
            cntAcc = Nox.add(cntAcc, Nox.select(rateOk, pr.countIfEligible, zero16));
        }

        Nox.allowThis(capAcc);
        Nox.allowThis(cntAcc);
        lf.capacityAcc = capAcc;
        lf.countAcc = cntAcc;
        lf.started = true;
    }

    // ---------------------------------------------------------------------------
    // Stage D - privacy floor and fill cap for one leaf
    // ---------------------------------------------------------------------------

    /// @dev A leaf that fails the privacy floor contributes encrypted zero. It does
    /// not revert and emits no public reason - PRD invariant 1.
    function seedRequest(externalEuint256 amount, bytes calldata proof) external {
        requestedAmount = Nox.fromExternal(amount, proof);
        Nox.allowThis(requestedAmount);
    }

    function finalizeLeaf(uint256 leafIndex, uint16 minProviders) external {
        Leaf storage lf = leaves[leafIndex];
        require(lf.started && !lf.finalized, StageOutOfOrder());

        euint256 zero256 = Nox.toEuint256(0);

        ebool floorOk = Nox.ge(lf.countAcc, Nox.toEuint16(minProviders));
        euint256 gated = Nox.select(floorOk, lf.capacityAcc, zero256);

        // min(gated, requested) - Nox has no min, so compare then select.
        ebool capBinds = Nox.lt(gated, requestedAmount);
        euint256 fillable = Nox.select(capBinds, gated, requestedAmount);

        Nox.allowThis(fillable);
        lf.fillable = fillable;
        lf.finalized = true;
    }

    // ---------------------------------------------------------------------------
    // Stage E - reduce leaves to one winner (balanced tree, chunked)
    // ---------------------------------------------------------------------------

    function reduceWinnerChunk(uint256 leafStart, uint256 leafCount, bool first) external {
        euint256 bestFill = first ? Nox.toEuint256(0) : winnerFillable;
        euint16 bestIdx = first ? Nox.toEuint16(0) : winnerLeafIndex;
        euint256 bestCap = first ? Nox.toEuint256(0) : totalSelectedCapacity;

        for (uint256 i = 0; i < leafCount; i++) {
            uint256 idx = leafStart + i;
            Leaf storage lf = leaves[idx];
            require(lf.finalized, StageOutOfOrder());

            ebool better = Nox.gt(lf.fillable, bestFill);
            bestFill = Nox.select(better, lf.fillable, bestFill);
            bestIdx = Nox.select(better, Nox.toEuint16(uint16(idx)), bestIdx);
            bestCap = Nox.select(better, lf.capacityAcc, bestCap);
        }

        Nox.allowThis(bestFill);
        Nox.allowThis(bestIdx);
        Nox.allowThis(bestCap);
        winnerFillable = bestFill;
        winnerLeafIndex = bestIdx;
        totalSelectedCapacity = bestCap;
    }

    // ---------------------------------------------------------------------------
    // Stage E2 - the single public/private boundary crossing
    // ---------------------------------------------------------------------------

    /// PUBLIC/PRIVATE BOUNDARY. This is the only place in the curve engine where a
    /// value leaves the private domain, and it is deliberate: the winning leaf's
    /// index and fill amount become the one publicly decryptable quote. Per-provider
    /// capacity, per-leaf capacity, provider counts, rejected leaves and every
    /// mandate stay encrypted forever.
    ///
    /// `allowPublicDecryption` is IRREVERSIBLE - there is no un-publish in Nox.
    function publishWinner() external {
        Nox.allowPublicDecryption(winnerFillable);
        Nox.allowPublicDecryption(winnerLeafIndex);
    }

    // ---------------------------------------------------------------------------
    // Stage F - pro-rata allocation
    // ---------------------------------------------------------------------------

    /// @dev alloc = fillable * contribution / totalCapacity. Nox has no fused mulDiv,
    /// so this is safeMul then safeDiv, and both encrypted success flags are threaded
    /// through select so a silent encrypted zero can never become an allocation.
    function allocate(uint256 p, uint16 publicTickIndex) external returns (euint256) {
        Provider storage pr = providers[p];
        euint256 zero256 = Nox.toEuint256(0);

        ebool rateOk = Nox.ge(Nox.toEuint16(publicTickIndex), pr.minTickIndex);
        euint256 contribution = Nox.select(rateOk, pr.capacityIfEligible, zero256);

        (ebool mulOk, euint256 numerator) = Nox.safeMul(winnerFillable, contribution);
        (ebool divOk, euint256 quotient) = Nox.safeDiv(numerator, totalSelectedCapacity);

        // Thread both success flags: a failed safe op returns encrypted zero silently.
        euint256 guarded = Nox.select(mulOk, quotient, zero256);
        guarded = Nox.select(divOk, guarded, zero256);

        Nox.allowThis(guarded);
        return guarded;
    }
}
