/**
 * The plaintext reference model for `NoxCurveEngine`.
 *
 * ════════════════════════════════════════════════════════════════════════════════════════════
 * WHAT THIS IS FOR
 * ════════════════════════════════════════════════════════════════════════════════════════════
 *
 * Demonstration 20 requires that Nox output match a plaintext reference model exactly. That is a
 * strong check precisely because this file is written from the contract's arithmetic rather than
 * from the PRD's prose: if the engine and this model agree, the engine computes what someone
 * reading the engine would say it computes. If they disagree, one of them is wrong and the test
 * says which value diverged.
 *
 * It is NOT a specification and must never become one. Where this file and the contract disagree
 * about what SHOULD happen, the contract is the artefact that runs and the disagreement is a bug
 * report against whichever is wrong — not licence to edit this file until the test goes green.
 *
 * ════════════════════════════════════════════════════════════════════════════════════════════
 * THE FOUR PLACES PLAINTEXT AND CIPHERTEXT COULD SILENTLY DIVERGE
 * ════════════════════════════════════════════════════════════════════════════════════════════
 *
 * Each is modelled explicitly below rather than assumed away, because each is a real Nox behaviour
 * that has no plaintext analogue and would otherwise make this model quietly optimistic:
 *
 *   1. `safeMul` and `safeDiv` return encrypted FALSE and encrypted ZERO on failure while the
 *      transaction succeeds. Modelled by {safeMul} and {safeDiv} returning a flag, and by
 *      threading that flag exactly where the contract threads it.
 *   2. Unsafe `div` SATURATES to the type maximum on divide-by-zero instead of reverting. The
 *      engine never uses unsafe `div`, and this model has no unsafe division either — if one
 *      appears in the contract, this comment is the reminder that it needs an analogue here.
 *   3. `euint16` arithmetic WRAPS at 65,536. The score packing is bounded at 8,183 by construction
 *      ({assertScoreFits} proves it rather than trusting it), and the provider count is bounded by
 *      16, so nothing here can wrap — but the bound is asserted, not assumed.
 *   4. Integer division FLOORS, which is where dust comes from. Modelled by using BigInt division
 *      throughout; `number` is used only for indexes and counts that cannot exceed 2^16.
 */

import {
  CURVE_MATURITY_RANK_STRIDE,
  CURVE_RANK_CEILING,
  CURVE_RATE_RANK_STRIDE,
} from "./constants.js";
import type {
  CachedCell,
  CurveRequest,
  CurveResult,
  LeafResult,
  Provider,
  ProviderOutcome,
  Universe,
  Winner,
} from "./types.js";

export class ReferenceModelError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ReferenceModelError";
  }
}

/** `Nox.safeMul`: on overflow the flag is false AND the result is zero. */
export function safeMul(a: bigint, b: bigint): { ok: boolean; value: bigint } {
  const product = a * b;
  if (product > 2n ** 256n - 1n) return { ok: false, value: 0n };
  return { ok: true, value: product };
}

/** `Nox.safeDiv`: division by zero is a false flag and a zero result, never a revert. */
export function safeDiv(a: bigint, b: bigint): { ok: boolean; value: bigint } {
  if (b === 0n) return { ok: false, value: 0n };
  return { ok: true, value: a / b };
}

/** `Nox.safeSub`: an underflow is a false flag and a zero result. */
export function safeSub(a: bigint, b: bigint): { ok: boolean; value: bigint } {
  if (b > a) return { ok: false, value: 0n };
  return { ok: true, value: a - b };
}

function min(a: bigint, b: bigint): bigint {
  return a <= b ? a : b;
}

/**
 * `CurveUniverseRegistry.publicLeafRank`, reimplemented.
 *
 * Positional so no lower criterion can outrank a higher one:
 *   rank = rateIndex*512 + [maturityDistance*128, added under encryption] + tail(priority, market)
 */
export function publicLeafRank(universe: Universe, leafIndex: number): number {
  const leaf = universe.leaves[leafIndex];
  if (leaf === undefined)
    throw new ReferenceModelError(`leaf ${leafIndex} is not in this universe`);
  const market = universe.markets[leaf.marketIndex];
  if (market === undefined) {
    throw new ReferenceModelError(
      `leaf ${leafIndex} names market ${leaf.marketIndex}, which does not exist`,
    );
  }
  const tail = ((market.publicPriority << 4) | leaf.marketIndex) & 0x7f;
  return leaf.rateIndex * CURVE_RATE_RANK_STRIDE + tail;
}

/** The encrypted half of the score: `|maturityBucket - preferredMaturityIndex| * 128`. */
export function maturityTerm(universe: Universe, marketIndex: number, preferred: number): number {
  const market = universe.markets[marketIndex];
  if (market === undefined) throw new ReferenceModelError(`market ${marketIndex} does not exist`);
  const distance = Math.abs(market.maturityBucket - preferred);
  return distance * CURVE_MATURITY_RANK_STRIDE;
}

/** Proves the euint16 score packing cannot wrap, rather than assuming it. */
export function assertScoreFits(score: number): void {
  if (!Number.isInteger(score) || score < 0 || score > 0xffff) {
    throw new ReferenceModelError(
      `score ${score} does not fit euint16. The packing is bounded at 15*512 + 3*128 + 119 = 8,183; ` +
        "reaching this means a rank field overflowed into the one above it and the selection " +
        "policy is now silently reordered.",
    );
  }
}

/**
 * Runs the whole epoch in plaintext, stage by stage, in the engine's order.
 *
 * The stage boundaries are preserved even where a shorter expression would give the same answer,
 * because the point of the model is to be comparable to the contract at each stage — a test that
 * only checks the final aggregate would pass while stage D was wrong and stage E compensated.
 */
export function computeCurve(
  universe: Universe,
  providers: readonly Provider[],
  request: CurveRequest,
): CurveResult {
  if (providers.length === 0) throw new ReferenceModelError("an epoch needs at least one provider");
  if (providers.length > universe.maxProviders) {
    throw new ReferenceModelError(
      `${providers.length} providers exceeds the universe ceiling of ${universe.maxProviders}`,
    );
  }
  if (universe.leaves.length === 0)
    throw new ReferenceModelError("an epoch needs at least one leaf");

  const cached = computeCache(universe, providers, request);
  const leaves = computeLeaves(universe, providers, request, cached);
  const winner = selectWinner(leaves);
  const outcomes = allocate(providers, cached, winner);

  const aggregate = outcomes.reduce((sum, outcome) => sum + outcome.reserved, 0n);
  const dustResidue = winner === null ? 0n : winner.fill - aggregate;

  return {
    cached,
    leaves,
    winner,
    providers: outcomes,
    published: {
      // With no winner the engine still publishes the carried indexes, which are the first leaf's,
      // and `quoteReady` is false. Modelled the same way rather than as nulls, because a
      // consumer must never be able to tell "no quote" from "a quote for zero" by shape alone.
      selectedMarketIndex: winner?.marketIndex ?? leaves[0]?.marketIndex ?? 0,
      selectedRateIndex: winner?.rateIndex ?? leaves[0]?.rateIndex ?? 0,
      privacyFloorPassed: winner?.floorPassed ?? leaves[0]?.floorPassed ?? false,
      quoteReady: winner !== null && winner.fill > 0n,
      aggregateFillAmount: aggregate,
    },
    dustResidue,
  };
}

/** Stage B: the five leaf-invariant predicates and the capacity headroom, per (provider, market). */
export function computeCache(
  universe: Universe,
  providers: readonly Provider[],
  request: CurveRequest,
): CachedCell[][] {
  const minTicket = universe.minTicketAssets;
  return providers.map((provider) =>
    universe.markets.map((market, marketIndex) => {
      const mandate = provider.mandate;
      const marketCap = at(mandate.marketCaps, marketIndex, "marketCaps");
      const familyCap = at(
        mandate.collateralFamilyCaps,
        market.collateralFamily,
        "collateralFamilyCaps",
      );
      const bucketCap = at(mandate.maturityBucketCaps, market.maturityBucket, "maturityBucketCaps");

      const predicates = {
        providerEnabled: at(mandate.enabledFlags, marketIndex, "mandate.enabledFlags") === 1,
        borrowerEnabled: at(request.enabledFlags, marketIndex, "request.enabledFlags") === 1,
        marketCapAvailable: marketCap >= minTicket,
        collateralFamilyCapAvailable: familyCap >= minTicket,
        maturityBucketCapAvailable: bucketCap >= minTicket,
        balanceSufficient: provider.balance >= minTicket,
      };

      // Arithmetised on chain because Nox has no encrypted `and`. Six 0/1 indicators multiplied,
      // and the product compared to 1 — which is exactly a conjunction, and is why a failed
      // predicate contributes encrypted zero rather than a distinguishable outcome.
      const eligible = Object.values(predicates).every(Boolean);

      // No `min` exists in Nox either, so each of these is a compare-then-select on chain. The
      // order matters only for gas, not for the result, but it is kept identical to the contract
      // so the two can be compared stage by stage.
      let headroom = min(marketCap, familyCap);
      headroom = min(headroom, bucketCap);
      headroom = min(headroom, mandate.totalBudget);
      headroom = min(headroom, provider.balance);

      return {
        capacity: eligible ? headroom : 0n,
        count: eligible ? 1 : 0,
        predicates,
      };
    }),
  );
}

/** Stages C and D: accumulate per leaf, then apply the rate ceiling, the floor and the size bounds. */
export function computeLeaves(
  universe: Universe,
  providers: readonly Provider[],
  request: CurveRequest,
  cached: readonly (readonly CachedCell[])[],
): LeafResult[] {
  return universe.leaves.map((leaf, leafIndex) => {
    let accumulatedCapacity = 0n;
    let accumulatedCount = 0;

    // Stage C. The sixth predicate — the rate — is the only one that varies by leaf. A lender
    // wants a high rate, so eligibility is `leafRate >= providerMinimum`.
    for (let slot = 0; slot < providers.length; slot += 1) {
      const provider = providers[slot];
      if (provider === undefined) continue;
      const cell = cached[slot]?.[leaf.marketIndex];
      if (cell === undefined) continue;
      const providerMin = at(provider.mandate.minRateIndexes, leaf.marketIndex, "minRateIndexes");
      if (leaf.rateIndex >= providerMin) {
        accumulatedCapacity += cell.capacity;
        accumulatedCount += cell.count;
      }
    }

    // Stage D. The borrower's ceiling is applied to the leaf total rather than per cell, which is
    // arithmetically identical because it depends only on the leaf.
    const borrowerMax = at(request.maxRateIndexes, leaf.marketIndex, "maxRateIndexes");
    const rateAcceptable = borrowerMax >= leaf.rateIndex;
    let capacity = rateAcceptable ? accumulatedCapacity : 0n;
    const count = rateAcceptable ? accumulatedCount : 0;

    // The privacy floor contributes encrypted zero. It never reverts and never produces a reason.
    const floorPassed = count >= universe.privacyFloor;
    if (!floorPassed) capacity = 0n;

    // Cap at the desired size FIRST, then test the borrower's minimum against the capped amount.
    let fill = min(capacity, request.desiredAssets);
    if (fill < request.minimumAssets) fill = 0n;

    const rank = publicLeafRank(universe, leafIndex);
    const score = rank + maturityTerm(universe, leaf.marketIndex, request.preferredMaturityIndex);
    assertScoreFits(score);

    return {
      leafIndex,
      marketIndex: leaf.marketIndex,
      rateIndex: leaf.rateIndex,
      accumulatedCapacity,
      accumulatedCount,
      capacity,
      fill,
      floorPassed,
      publicRank: rank,
      score,
      effectiveScore: fill > 0n ? score : CURVE_RANK_CEILING,
    } satisfies LeafResult;
  });
}

/**
 * Stage E: the lowest effective score wins.
 *
 * Ties go to the LOWEST leaf index because the on-chain fold uses a strict `lt` and walks leaves in
 * index order, so a later leaf never displaces an equal-scoring earlier one. That is the tie-break
 * the policy calls deterministic, and it is a property of the comparison operator — change `lt` to
 * `le` on chain and this model diverges, which is what the test is for.
 */
export function selectWinner(leaves: readonly LeafResult[]): Winner | null {
  let best: LeafResult | undefined;
  for (const leaf of leaves) {
    if (best === undefined || leaf.effectiveScore < best.effectiveScore) best = leaf;
  }
  if (best === undefined || best.fill === 0n) return null;
  return {
    leafIndex: best.leafIndex,
    marketIndex: best.marketIndex,
    rateIndex: best.rateIndex,
    fill: best.fill,
    capacity: best.capacity,
    floorPassed: best.floorPassed,
  };
}

/**
 * Stage F: pro-rata allocation, then the ledger's safe reservation.
 *
 * `allocation = fill * contribution / capacity`, floored. Both safe-operation flags are threaded
 * exactly as the contract threads them, so a `safeMul` overflow or a zero denominator produces
 * zero here for the same reason it produces encrypted zero there.
 */
export function allocate(
  providers: readonly Provider[],
  cached: readonly (readonly CachedCell[])[],
  winner: Winner | null,
): ProviderOutcome[] {
  return providers.map((provider, slot) => {
    const remainingSeed = provider.balance;
    if (winner === null) {
      return {
        slot,
        address: provider.address,
        contribution: 0n,
        allocation: 0n,
        reserved: 0n,
        remaining: remainingSeed,
      } satisfies ProviderOutcome;
    }

    const providerMin = at(provider.mandate.minRateIndexes, winner.marketIndex, "minRateIndexes");
    const cell = cached[slot]?.[winner.marketIndex];
    const contribution = cell !== undefined && winner.rateIndex >= providerMin ? cell.capacity : 0n;

    const scaled = safeMul(winner.fill, contribution);
    const share = safeDiv(scaled.value, winner.capacity);
    let allocation = scaled.ok ? share.value : 0n;
    if (!share.ok) allocation = 0n;

    // The ledger's `safeSub -> select -> select`. A short snapshot reserves encrypted zero and
    // leaves the remaining balance untouched; nothing public distinguishes that from success.
    const subtraction = safeSub(remainingSeed, allocation);
    const reserved = subtraction.ok ? allocation : 0n;
    const remaining = subtraction.ok ? subtraction.value : remainingSeed;

    return {
      slot,
      address: provider.address,
      contribution,
      allocation,
      reserved,
      remaining,
    } satisfies ProviderOutcome;
  });
}

function at<T>(list: readonly T[], index: number, what: string): T {
  const value = list[index];
  if (value === undefined) {
    throw new ReferenceModelError(
      `${what}[${index}] is missing. Every mandate and request field is a FIXED-LENGTH array — ` +
        "a variable-length submission would leak how many markets a provider serves (delta Q-8).",
    );
  }
  return value;
}

/**
 * The conservation invariant the ledger must preserve, checked rather than asserted in prose.
 *
 * `remaining + reserved == seed`, per provider, before and after. The suite decrypts all three on
 * chain and compares them to this.
 */
export function assertConservation(
  providers: readonly Provider[],
  outcomes: readonly ProviderOutcome[],
): void {
  for (const outcome of outcomes) {
    const provider = providers[outcome.slot];
    if (provider === undefined)
      throw new ReferenceModelError(`no provider in slot ${outcome.slot}`);
    if (outcome.remaining + outcome.reserved !== provider.balance) {
      throw new ReferenceModelError(
        `provider ${outcome.slot} does not conserve: remaining ${outcome.remaining} + reserved ` +
          `${outcome.reserved} != seed ${provider.balance}`,
      );
    }
  }
}

/**
 * Dust is exactly the flooring residue, and it is bounded by the number of contributing providers.
 *
 * Each pro-rata share loses less than one unit to `safeDiv`'s flooring, so the residue is strictly
 * less than the count of providers with a non-zero contribution. A residue at or above that bound
 * means the allocation is not pro-rata over the winning leaf's capacity.
 */
export function assertDustBound(result: CurveResult): void {
  if (result.winner === null) {
    if (result.dustResidue !== 0n) {
      throw new ReferenceModelError(`no winner, but dust residue is ${result.dustResidue}`);
    }
    return;
  }
  const contributing = BigInt(
    result.providers.filter((outcome) => outcome.contribution > 0n).length,
  );
  if (result.dustResidue < 0n) {
    throw new ReferenceModelError(
      `dust residue ${result.dustResidue} is negative, so the reservations exceed the fill`,
    );
  }
  if (contributing > 0n && result.dustResidue >= contributing) {
    throw new ReferenceModelError(
      `dust residue ${result.dustResidue} is not below the ${contributing} contributing providers; ` +
        "flooring can lose at most one unit each, so this is not a pro-rata split",
    );
  }
}
