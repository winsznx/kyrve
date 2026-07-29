/**
 * Universe construction and validation, mirroring `CurveUniverseRegistry`.
 *
 * The four grid properties checked here are the same four the contract enforces, and they are
 * checked in both places on purpose. A grid that fails any of them compiles, deploys and then
 * either reverts inside Midnight's `take` or selects the most expensive rate while reporting it as
 * the cheapest — neither of which any downstream test would notice.
 */

import { encodeAbiParameters, keccak256 } from "viem";

import {
  CURVE_COLLATERAL_FAMILY_SLOTS,
  CURVE_MATURITY_BUCKET_SLOTS,
  CURVE_MAX_CELLS_PER_TRANSACTION,
  CURVE_MAX_LEAVES,
  CURVE_MAX_MARKETS,
  CURVE_MAX_PROVIDERS,
  CURVE_MAX_PUBLIC_PRIORITY,
  CURVE_MAX_RATES_PER_MARKET,
  CURVE_MIN_PRIVACY_FLOOR,
} from "./constants.js";
import type { Hex, Leaf, MarketSpec, Universe } from "./types.js";

const WAD = 10n ** 18n;

export class UniverseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UniverseError";
  }
}

export interface MarketGrid {
  readonly spec: MarketSpec;
  /** Ordered so index 0 is the HIGHEST tick, which is the CHEAPEST borrowing. */
  readonly ticks: readonly number[];
  readonly pricesWad: readonly bigint[];
}

export interface UniverseDraft {
  readonly label: string;
  readonly chainId: number;
  readonly registry: Hex;
  readonly maxProviders: number;
  readonly privacyFloor: number;
  readonly minTicketAssets: bigint;
  readonly cellsPerChunk: number;
  readonly markets: readonly MarketGrid[];
}

/** `CurveUniverseRegistry.universeIdFor`, reimplemented. */
export function universeIdFor(chainId: number, registry: Hex, label: string): Hex {
  return keccak256(
    encodeAbiParameters(
      [{ type: "uint256" }, { type: "address" }, { type: "string" }],
      [BigInt(chainId), registry, label],
    ),
  );
}

/** `CurveUniverseRegistry.gridHash`, reimplemented. */
export function gridHash(
  spec: MarketSpec,
  ticks: readonly number[],
  pricesWad: readonly bigint[],
): Hex {
  return keccak256(
    encodeAbiParameters(
      [{ type: "bytes32" }, { type: "int24[]" }, { type: "uint256[]" }],
      [spec.marketId, ticks.map((tick) => tick), pricesWad.map((price) => price)],
    ),
  );
}

/**
 * Validates and assembles a universe.
 *
 * Every check below has a matching `revert` in the registry, and every one of them is reachable —
 * `packages/curve/test/universe.test.ts` exercises each with a fixture that violates exactly one
 * property, because a validator whose branches are never taken proves nothing.
 */
export function buildUniverse(draft: UniverseDraft): Universe {
  if (draft.maxProviders < 1 || draft.maxProviders > CURVE_MAX_PROVIDERS) {
    throw new UniverseError(
      `maxProviders ${draft.maxProviders} is outside 1..${CURVE_MAX_PROVIDERS} (PRD §9.1)`,
    );
  }
  if (draft.privacyFloor < CURVE_MIN_PRIVACY_FLOOR) {
    throw new UniverseError(
      `privacy floor ${draft.privacyFloor} is below ${CURVE_MIN_PRIVACY_FLOOR}. A floor of 1 is not ` +
        "a privacy floor: the single filling provider learns the whole aggregate is theirs.",
    );
  }
  if (draft.privacyFloor > draft.maxProviders) {
    throw new UniverseError(
      `privacy floor ${draft.privacyFloor} exceeds the ${draft.maxProviders} provider ceiling, so no ` +
        "leaf could ever be selected",
    );
  }
  if (draft.minTicketAssets <= 0n) throw new UniverseError("minTicketAssets must be positive");
  if (draft.cellsPerChunk < 1 || draft.cellsPerChunk > CURVE_MAX_CELLS_PER_TRANSACTION) {
    throw new UniverseError(
      `cellsPerChunk ${draft.cellsPerChunk} is outside 1..${CURVE_MAX_CELLS_PER_TRANSACTION}, the ` +
        "measured per-transaction budget (docs/day0/OPERATION-BUDGET.md §4)",
    );
  }
  if (draft.markets.length === 0) throw new UniverseError("a universe needs at least one market");
  if (draft.markets.length > CURVE_MAX_MARKETS) {
    throw new UniverseError(
      `${draft.markets.length} markets exceeds the ${CURVE_MAX_MARKETS} slots a mandate has`,
    );
  }

  const leaves: Leaf[] = [];
  const seenMarketIds = new Set<string>();

  draft.markets.forEach((grid, marketIndex) => {
    const { spec, ticks, pricesWad } = grid;
    if (ticks.length === 0) throw new UniverseError(`market ${marketIndex} has an empty rate grid`);
    if (ticks.length > CURVE_MAX_RATES_PER_MARKET) {
      throw new UniverseError(
        `market ${marketIndex} has ${ticks.length} rates, above the ${CURVE_MAX_RATES_PER_MARKET} maximum`,
      );
    }
    if (ticks.length !== pricesWad.length) {
      throw new UniverseError(
        `market ${marketIndex} has ${ticks.length} ticks and ${pricesWad.length} prices`,
      );
    }
    if (spec.tickSpacing <= 0)
      throw new UniverseError(`market ${marketIndex} has a zero tick spacing`);
    if (seenMarketIds.has(spec.marketId.toLowerCase())) {
      throw new UniverseError(`market ${marketIndex} repeats market id ${spec.marketId}`);
    }
    seenMarketIds.add(spec.marketId.toLowerCase());
    if (spec.collateralFamily >= CURVE_COLLATERAL_FAMILY_SLOTS) {
      throw new UniverseError(
        `market ${marketIndex} names collateral family ${spec.collateralFamily}, but a mandate has ` +
          `only ${CURVE_COLLATERAL_FAMILY_SLOTS} slots`,
      );
    }
    if (spec.maturityBucket >= CURVE_MATURITY_BUCKET_SLOTS) {
      throw new UniverseError(
        `market ${marketIndex} names maturity bucket ${spec.maturityBucket}, but a mandate has only ` +
          `${CURVE_MATURITY_BUCKET_SLOTS} slots`,
      );
    }
    if (spec.publicPriority > CURVE_MAX_PUBLIC_PRIORITY) {
      throw new UniverseError(
        `market ${marketIndex} has public priority ${spec.publicPriority}, above ` +
          `${CURVE_MAX_PUBLIC_PRIORITY}. The rank tail is three bits wide, so a higher value would ` +
          "wrap into the market-index bits and silently reorder the universe.",
      );
    }

    ticks.forEach((tick, rateIndex) => {
      const price = pricesWad[rateIndex];
      if (price === undefined)
        throw new UniverseError(`market ${marketIndex} rate ${rateIndex} has no price`);
      if (tick % spec.tickSpacing !== 0) {
        throw new UniverseError(
          `market ${marketIndex} rate ${rateIndex}: tick ${tick} is not on the ${spec.tickSpacing} spacing`,
        );
      }
      if (price > WAD) {
        throw new UniverseError(
          `market ${marketIndex} rate ${rateIndex}: price ${price} is above par, which would mean a ` +
            "maker funding more than face value",
        );
      }
      if (price < spec.settlementFeeFloorWad) {
        throw new UniverseError(
          `market ${marketIndex} rate ${rateIndex}: price ${price} is below the settlement fee floor ` +
            `${spec.settlementFeeFloorWad}, so Midnight's take would revert on fee underflow (A-3)`,
        );
      }
      if (rateIndex > 0) {
        const previousTick = ticks[rateIndex - 1];
        const previousPrice = pricesWad[rateIndex - 1];
        if (previousTick === undefined || previousPrice === undefined) {
          throw new UniverseError(`market ${marketIndex} rate ${rateIndex} has no predecessor`);
        }
        if (previousTick <= tick) {
          throw new UniverseError(
            `market ${marketIndex} rate ${rateIndex}: tick ${tick} does not descend from ${previousTick}. ` +
              "Rate index 0 must be the HIGHEST tick, because a higher tick is a higher price is " +
              "cheaper borrowing — inverting this inverts the whole selection policy.",
          );
        }
        if (previousPrice <= price) {
          throw new UniverseError(
            `market ${marketIndex} rate ${rateIndex}: price ${price} does not descend from ${previousPrice}`,
          );
        }
      }
      leaves.push({ marketIndex, rateIndex, tick, priceWad: price });
    });
  });

  if (leaves.length > CURVE_MAX_LEAVES) {
    throw new UniverseError(`${leaves.length} leaves exceeds the ${CURVE_MAX_LEAVES} maximum`);
  }

  return {
    id: universeIdFor(draft.chainId, draft.registry, draft.label),
    label: draft.label,
    maxProviders: draft.maxProviders,
    privacyFloor: draft.privacyFloor,
    minTicketAssets: draft.minTicketAssets,
    cellsPerChunk: draft.cellsPerChunk,
    markets: draft.markets.map((grid) => grid.spec),
    leaves,
  };
}
