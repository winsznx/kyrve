/**
 * The offer a borrower must present to `Midnight.take`, byte for byte.
 *
 * `QuoteActivator` builds this on chain and the ratifier compares `keccak256(abi.encode(offer))`
 * against what it stored, so anything the keeper hands a borrower has to agree with it exactly.
 * Rebuilding it here — rather than reading it out of an event — means the terminal can show the
 * offer before it exists, and means a mismatch surfaces as a local assertion instead of as a
 * failed `take` the borrower paid for.
 */

import { type Market, type Offer, offerHash } from "@kyrve/midnight";
import type { Address, Hex } from "viem";

import { quoteIdFor } from "./id.js";
import type { QuoteExecution, QuoteProvenance } from "./types.js";

export interface OfferInputs {
  readonly market: Market;
  readonly vault: Address;
  readonly ratifier: Address;
  readonly tick: bigint;
  readonly exactUnits: bigint;
  readonly start: bigint;
  readonly expiry: bigint;
  /** The market's continuous fee as it stood at activation. Pinned so a later rise fails the take. */
  readonly continuousFeeCap: bigint;
  readonly quoteId: Hex;
}

/**
 * Assembles the offer.
 *
 * `group` and `callbackData` both carry the quote id: the group is what Midnight accounts
 * consumption against and what `setConsumed` retires, and the callback data is what tells `onBuy`
 * which quote it is being asked to settle.
 *
 * `maxUnits` is the exact size and `maxAssets` is zero, because Midnight requires exactly one of
 * the two to be non-zero. Setting `maxUnits` to the exact size does NOT enforce exact fill —
 * Midnight permits `newConsumed <= offer.maxUnits`. Exact fill is `KyrveSeriesVault.onBuy`.
 */
export function buildOffer(inputs: OfferInputs): Offer {
  return {
    market: inputs.market,
    buy: true,
    maker: inputs.vault,
    start: inputs.start,
    expiry: inputs.expiry,
    tick: inputs.tick,
    group: inputs.quoteId,
    callback: inputs.vault,
    callbackData: `0x${inputs.quoteId.slice(2).padStart(64, "0")}` as Hex,
    receiverIfMakerIsSeller: "0x0000000000000000000000000000000000000000",
    ratifier: inputs.ratifier,
    reduceOnly: false,
    maxUnits: inputs.exactUnits,
    maxAssets: 0n,
    continuousFeeCap: inputs.continuousFeeCap,
  };
}

/** The whole activation plan: the id, the offer and the hash the ratifier will compare. */
export interface ActivationPlan {
  readonly quoteId: Hex;
  readonly offer: Offer;
  readonly offerHash: Hex;
}

export function planActivation(
  execution: Omit<QuoteExecution, "offerHash" | "activatedAt" | "status">,
  provenance: QuoteProvenance,
  offerInputs: Omit<OfferInputs, "quoteId">,
): ActivationPlan {
  const quoteId = quoteIdFor(
    {
      ...execution,
      offerHash: "0x0000000000000000000000000000000000000000000000000000000000000000",
      activatedAt: 0n,
      status: 1,
    },
    provenance,
  );
  const offer = buildOffer({ ...offerInputs, quoteId });
  return { quoteId, offer, offerHash: offerHash(offer) };
}
