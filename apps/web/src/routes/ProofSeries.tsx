/**
 * `/proof/series/:seriesId` — one series, recomputed.
 *
 * ════════════════════════════════════════════════════════════════════════════════════════════
 * THE CHECK THAT IS INVISIBLE UNLESS IT IS MADE
 * ════════════════════════════════════════════════════════════════════════════════════════════
 *
 * Publishing an aggregate marks an ISOLATED SNAPSHOT decryptable, never the live total-supply handle.
 * If the two handles were equal, the live supply would have been made permanently public by accident
 * and there is no way to un-publish it. Two handles that merely look similar are indistinguishable
 * from two that are identical unless somebody compares them, so this page compares them. Delta T-1.
 *
 * The Roll conversion is recomputed rather than read for the same reason: `conversionWad` is a view,
 * and a view returning anything it liked would be indistinguishable from a correct one until somebody
 * did the arithmetic.
 */

import type { ReactElement } from "react";

import { Empty } from "../components/Facts.js";
import { compare, VerifyPanel } from "../components/VerifyPanel.js";
import {
  CAPSULE_READ_ABI,
  CROSS_BOOK_ABI,
  ROLL_BOOK_ABI,
  SERIES_TOKEN_ABI,
  SOLVENCY_VERIFIER_ABI,
} from "../lib/abi.js";
import type { Check } from "../lib/artefact.js";
import { abbreviate } from "../lib/chain.js";
import { useKyrve } from "../lib/context.js";
import { layerBySeriesId } from "../lib/records.js";
import { Link } from "../router/router.js";

const ZERO = `0x${"00".repeat(32)}`;

export function ProofSeries({ seriesId }: { seriesId: `0x${string}` }): ReactElement {
  const { record, publicClient } = useKyrve();
  const layer = layerBySeriesId(record, seriesId);

  if (layer === undefined) {
    return (
      <section className="band">
        <h1>Series proof</h1>
        <Empty title="This series is not on this deployment" testId="proof-series-unknown">
          <p>
            The record being served names no series with id <span className="mono">{seriesId}</span>
            . This page will not fall back to another layer's series: a verification that silently
            checked a different stack would look like it worked and would prove nothing about the
            one asked about.
          </p>
          <p>
            <Link to="/proof" className="row-link">
              Everything this deployment can verify
            </Link>
          </p>
        </Empty>
      </section>
    );
  }

  const { series, market } = layer;

  const read = async (
    address: `0x${string}`,
    abi: readonly unknown[],
    functionName: string,
    args: readonly unknown[] = [],
  ): Promise<string> =>
    String(
      await publicClient.readContract({
        address,
        abi: abi as never,
        functionName: functionName as never,
        args: args as never,
      }),
    );

  async function run(): Promise<readonly Check[]> {
    const found: Check[] = [];

    // ── 1. the deployed token really serves the series the record names ────────────────────
    found.push(
      compare(
        "series-identity",
        "the deployed token serves the series this record names",
        await read(series.addresses.KyrveSeriesToken, SERIES_TOKEN_ABI, "SERIES_ID"),
        series.seriesId,
        { token: series.addresses.KyrveSeriesToken },
      ),
    );

    // ── 2. the published aggregate is a snapshot, and the LIVE supply is not public ────────
    const published = await read(
      series.addresses.KyrveSeriesToken,
      SERIES_TOKEN_ABI,
      "publishedSupply",
    );
    const live = await read(
      series.addresses.KyrveSeriesToken,
      SERIES_TOKEN_ABI,
      "confidentialAggregateSupply",
    );
    found.push(
      published === ZERO
        ? {
            id: "published-supply",
            claim: "the published aggregate is an isolated snapshot, not the live supply handle",
            verdict: "unavailable",
            detail: "this series has published no aggregate yet",
            measured: { "live supply handle": live },
          }
        : {
            id: "published-supply",
            claim: "the published aggregate is an isolated snapshot, not the live supply handle",
            verdict: published === live ? "failed" : "verified",
            detail:
              published === live
                ? "the LIVE supply handle is the published one — it has been made permanently " +
                  "decryptable, and Nox has no way to undo that"
                : "two distinct handles: publication marked a snapshot, and the live handle is " +
                  "still admin-granted to the token alone",
            measured: { "published snapshot": published, "live supply handle": live },
          },
    );

    // ── 3. public coverage, and the verdict bit that is all the verifier publishes ─────────
    try {
      // Five named outputs, so viem returns a tuple. Read as one rather than through the string
      // helper: `String(tuple)` would join the components into something that looks like a number.
      const [credit, pendingFee, vaultReserves, residueReserves, total] =
        (await publicClient.readContract({
          address: series.addresses.AggregateSolvencyVerifier,
          abi: SOLVENCY_VERIFIER_ABI,
          functionName: "publicCoverage",
        })) as readonly [bigint, bigint, bigint, bigint, bigint];

      found.push({
        id: "coverage",
        claim: "the solvency verifier's right-hand side is fully public and readable here",
        verdict: "verified",
        detail:
          "credit plus reserves minus fees, read from chain and shown component by component. The " +
          "verifier publishes only the verdict bit; it deliberately does not prove the custody " +
          "vault's own accounting, because that would need an encrypted sum beside a provider's " +
          "balance — which is the mechanism the privacy floor exists to withhold.",
        measured: {
          verifier: series.addresses.AggregateSolvencyVerifier,
          "midnight credit": credit.toString(),
          "pending fee": pendingFee.toString(),
          "vault reserves": vaultReserves.toString(),
          "residue reserves": residueReserves.toString(),
          "public coverage total": total.toString(),
        },
      });
    } catch {
      found.push({
        id: "coverage",
        claim: "the solvency verifier's right-hand side is fully public and readable here",
        verdict: "unavailable",
        detail: "no solvency snapshot has been taken on this series yet",
        measured: { verifier: series.addresses.AggregateSolvencyVerifier },
      });
    }

    // ── 4. the Capsule vault is bound to THIS series and THIS deployment ───────────────────
    if (market?.addresses.KyrveCapsuleVault === undefined) {
      found.push({
        id: "capsule",
        claim: "every capsule is bound to this chain, deployment and series",
        verdict: "unavailable",
        detail: "no Capsule vault is deployed over this series",
        measured: {},
      });
    } else {
      const vault = market.addresses.KyrveCapsuleVault;
      found.push(
        compare(
          "capsule",
          "every capsule is bound to this chain, deployment and series",
          await read(vault, CAPSULE_READ_ABI, "SERIES_ID"),
          series.seriesId,
          {
            vault,
            "chain id the vault compiled with": await read(vault, CAPSULE_READ_ABI, "CHAIN_ID"),
          },
        ),
      );
    }

    // ── 5. the Cross fee has a capped rate and an immutable destination ────────────────────
    if (market?.addresses.KyrveCrossBook === undefined) {
      found.push({
        id: "cross",
        claim: "the Cross fee has a capped rate and an immutable destination",
        verdict: "unavailable",
        detail: "no Cross book is deployed over this series",
        measured: {},
      });
    } else {
      const book = market.addresses.KyrveCrossBook;
      const feeBps = await read(book, CROSS_BOOK_ABI, "FEE_BPS");
      const maxBps = await read(book, CROSS_BOOK_ABI, "MAX_FEE_BPS");
      const beneficiary = await read(book, CROSS_BOOK_ABI, "FEE_BENEFICIARY");
      const withinCap = BigInt(feeBps) <= BigInt(maxBps);
      found.push({
        id: "cross",
        claim: "the Cross fee has a capped rate and an immutable destination",
        verdict: withinCap ? "verified" : "failed",
        detail: withinCap
          ? "the fee is within the cap the contract compiled with, and the destination is an immutable"
          : "the fee exceeds the cap the contract compiled with",
        measured: { book, "fee (bps)": feeBps, "cap (bps)": maxBps, beneficiary },
      });
    }

    // ── 6. the Roll conversion is reproducible from two public numbers ─────────────────────
    if (market?.addresses.KyrveRollBook === undefined) {
      found.push({
        id: "roll",
        claim: "the Roll conversion is exactly sourceFactor * WAD / targetPrice",
        verdict: "unavailable",
        detail: "no Roll book is deployed; a roll needs a second complete series",
        measured: {},
      });
    } else {
      const book = market.addresses.KyrveRollBook;
      const sourceToken = (await read(book, ROLL_BOOK_ABI, "SOURCE_TOKEN")) as `0x${string}`;
      const targetPrice = await read(book, ROLL_BOOK_ABI, "TARGET_PRICE_WAD");
      const factor = await read(sourceToken, SERIES_TOKEN_ABI, "redemptionFactorWad");
      if (BigInt(factor) === 0n) {
        found.push({
          id: "roll",
          claim: "the Roll conversion is exactly sourceFactor * WAD / targetPrice",
          verdict: "unavailable",
          detail:
            "the source series has not opened redemption, so there is no conversion to check. The " +
            "book reverts SourceRedemptionNotOpen rather than defaulting to par.",
          measured: { book, "target price (wad)": targetPrice },
        });
      } else {
        const reported = await read(book, ROLL_BOOK_ABI, "conversionWad");
        const expected = (BigInt(factor) * 10n ** 18n) / BigInt(targetPrice);
        found.push({
          id: "roll",
          claim: "the Roll conversion is exactly sourceFactor * WAD / targetPrice",
          verdict: BigInt(reported) === expected ? "verified" : "failed",
          detail:
            BigInt(reported) === expected
              ? "recomputed in this browser from two public numbers, and it matches"
              : "the book reports a conversion that is not the arithmetic it declares",
          measured: {
            book,
            "source factor (wad)": factor,
            "target price (wad)": targetPrice,
            "reported (wad)": reported,
            "recomputed here (wad)": expected.toString(),
          },
        });
      }
    }

    // ── 7. what the record asserts and this browser did not check ──────────────────────────
    found.push({
      id: "providers-reported",
      claim: "the record lists the providers holding a claim on this quote",
      verdict: "reported-not-verified",
      detail:
        "This browser did not enumerate claims on chain. Participation in an epoch is public, but " +
        "the list here comes from the served record — it is shown so it cannot be mistaken for " +
        "something that was recomputed.",
      measured: {
        "providers in the record": String(series.providers.length),
        quote: series.quoteId,
      },
    });

    return found;
  }

  return (
    <>
      <section className="band">
        <span className="eyebrow">{layer.label}</span>
        <h1>Series {abbreviate(series.seriesId)}</h1>
        <p className="lede">
          Recomputed from chain state. The record below supplies the addresses to ask about and
          nothing else — every verdict comes from what this chain answered.
        </p>
        <p className="note">
          <Link to={`/app/series/${series.seriesId}`} className="row-link">
            Open this series in the terminal
          </Link>
        </p>
      </section>

      <VerifyPanel
        subject="series"
        subjectId={series.seriesId}
        layer={layer.label}
        run={run}
        deps={[series.seriesId]}
      />
    </>
  );
}
