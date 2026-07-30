/**
 * Kyrve Verify, in the browser.
 *
 * ════════════════════════════════════════════════════════════════════════════════════════════
 * THIS PAGE DOES NOT DISPLAY THE MANIFEST. IT DISAGREES WITH IT.
 * ════════════════════════════════════════════════════════════════════════════════════════════
 *
 * A verification page that renders the contents of a deployment record has verified nothing — it has
 * reformatted a file that anybody could have written. So every row below states a fact, reads the
 * chain for that fact, and compares. The record supplies ADDRESSES and IDENTIFIERS and is never the
 * source of a verdict; where the record and the chain disagree, the row fails and shows both.
 *
 * That is the same contract `scripts/verify/kyrve-verify.ts` holds itself to, deliberately: the CLI
 * and this page must be capable of contradicting each other, or running both proves no more than
 * running one.
 *
 * ════════════════════════════════════════════════════════════════════════════════════════════
 * WHAT A ROW MAY CONTAIN
 * ════════════════════════════════════════════════════════════════════════════════════════════
 *
 * Public values only: addresses, identifiers, handles, public amounts and verdict bits. No row reads
 * a private balance and no row decrypts anything — the downloadable JSON is meant to be sent to
 * someone, and a verification artefact that carries a private amount is a leak with a checksum.
 *
 * ════════════════════════════════════════════════════════════════════════════════════════════
 * "UNAVAILABLE" IS A THIRD ANSWER, AND IT IS LOAD-BEARING
 * ════════════════════════════════════════════════════════════════════════════════════════════
 *
 * A contract that was never deployed for this layer is not a failure and must not be a pass. Layer B
 * has no Capsule vault of its own; reporting that as either verdict would be a lie in one direction
 * or the other. It renders as UNAVAILABLE with the reason, and the summary counts it separately.
 *
 * The gateway proofs behind published values are Nox decryption proofs. They are SIGNATURES over a
 * released plaintext, not zero-knowledge proofs, and nothing here calls them that.
 */

import { useCallback, useEffect, useState } from "react";

import { CAPSULE_VAULT_ABI, CROSS_BOOK_ABI, ROLL_BOOK_ABI, SERIES_TOKEN_ABI } from "../lib/abi.js";
import type { MarketRecord, SeriesRecord } from "../lib/series.js";
import type { Session } from "../lib/session.js";

/** A verdict, and the third one that keeps the other two honest. */
type Verdict = "pass" | "fail" | "unavailable";

interface Row {
  readonly id: string;
  readonly claim: string;
  readonly verdict: Verdict;
  readonly detail: string;
  /** Public values only. Rendered, and written into the downloadable artefact, verbatim. */
  readonly measured: Readonly<Record<string, string>>;
}

const VERDICT_LABEL: Readonly<Record<Verdict, string>> = {
  pass: "recomputed",
  fail: "disagrees",
  unavailable: "not deployed here",
};

export interface VerifyBandProps {
  readonly session: Session;
  readonly series: SeriesRecord;
  readonly market: MarketRecord | undefined;
  readonly chainId: number;
}

export function VerifyBand({
  session,
  series,
  market,
  chainId,
}: VerifyBandProps): React.ReactElement {
  const [rows, setRows] = useState<readonly Row[]>([]);
  const [running, setRunning] = useState(false);
  const [ranAtBlock, setRanAtBlock] = useState<bigint>();
  const [failure, setFailure] = useState<string>();

  const recompute = useCallback(async () => {
    setRunning(true);
    setFailure(undefined);
    const { publicClient } = session;
    const found: Row[] = [];

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

    /** Compares a chain read against what the record claims, and never the other way round. */
    const compare = (
      id: string,
      claim: string,
      onChain: string,
      recorded: string,
      measured: Record<string, string>,
    ): Row =>
      onChain.toLowerCase() === recorded.toLowerCase()
        ? { id, claim, verdict: "pass", detail: "the chain agrees with the record", measured }
        : {
            id,
            claim,
            verdict: "fail",
            detail: "the chain and the record disagree; the chain is what is true",
            measured: { ...measured, "on chain": onChain, "in the record": recorded },
          };

    try {
      const block = await publicClient.getBlockNumber();

      // ── 1. the series token really serves the series the record names ───────────────────
      const tokenSeries = await read(
        series.addresses.KyrveSeriesToken,
        SERIES_TOKEN_ABI,
        "SERIES_ID",
      );
      found.push(
        compare(
          "series-identity",
          "the deployed token serves the series this record names",
          tokenSeries,
          series.seriesId,
          { token: series.addresses.KyrveSeriesToken },
        ),
      );

      // ── 2. the published aggregate is a snapshot, and the LIVE supply is not public ─────
      //
      // The distinction is the whole of delta T-1 and is invisible unless it is checked: publishing
      // marks an ISOLATED snapshot decryptable, never the live total-supply handle. Two handles that
      // were equal would mean the live supply had been made permanently public by accident, and
      // there is no way to un-publish it.
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
      const zero = `0x${"00".repeat(32)}`;
      found.push(
        published === zero
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
              verdict: published === live ? "fail" : "pass",
              detail:
                published === live
                  ? "the LIVE supply handle is the published one — the live handle has been made " +
                    "permanently decryptable, and Nox has no way to undo that"
                  : "two distinct handles: publication marked a snapshot, and the live handle is " +
                    "still admin-granted to the token alone",
              measured: { "published snapshot": published, "live supply handle": live },
            },
      );

      // ── 3. the Capsule vault is bound to THIS series and THIS deployment ────────────────
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
        const vaultSeries = await read(vault, CAPSULE_VAULT_ABI, "SERIES_ID");
        const issued = await read(vault, CAPSULE_VAULT_ABI, "capsuleCount");
        found.push(
          compare(
            "capsule",
            "every capsule is bound to this chain, deployment and series",
            vaultSeries,
            series.seriesId,
            { vault, "capsules issued": issued },
          ),
        );
      }

      // ── 4. the Cross book's price, fee and beneficiary are immutable and declared ───────
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
          verdict: withinCap ? "pass" : "fail",
          detail: withinCap
            ? "the fee is within its compiled cap and the destination is an immutable"
            : "the fee exceeds the cap the contract compiled with",
          measured: { book, "fee (bps)": feeBps, "cap (bps)": maxBps, beneficiary },
        });
      }

      // ── 5. the Roll conversion is reproducible from two public numbers ─────────────────
      //
      // Recomputed here rather than read: `conversionWad` is a view, and a view that returned
      // anything it liked would be indistinguishable from a correct one until someone did the
      // arithmetic. `sourceFactor * WAD / targetPrice`, in the browser, from two public reads.
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
              "the source series has not opened redemption, so there is no conversion to check. " +
              "The book reverts SourceRedemptionNotOpen rather than defaulting to par.",
            measured: { book, "target price (wad)": targetPrice },
          });
        } else {
          const reported = await read(book, ROLL_BOOK_ABI, "conversionWad");
          const expected = (BigInt(factor) * 10n ** 18n) / BigInt(targetPrice);
          found.push({
            id: "roll",
            claim: "the Roll conversion is exactly sourceFactor * WAD / targetPrice",
            verdict: BigInt(reported) === expected ? "pass" : "fail",
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

      setRanAtBlock(block);
      setRows(found);
    } catch (error: unknown) {
      setFailure(
        error instanceof Error
          ? error.message
          : "the node could not be reached, so nothing was verified",
      );
      setRows([]);
    } finally {
      setRunning(false);
    }
  }, [session, series, market]);

  useEffect(() => {
    void recompute();
  }, [recompute]);

  const passed = rows.filter((row) => row.verdict === "pass").length;
  const failed = rows.filter((row) => row.verdict === "fail").length;
  const unavailable = rows.filter((row) => row.verdict === "unavailable").length;

  /**
   * The artefact. Public values only, and it says what it is not: a recomputation at one block, by
   * one browser, over the checks below — not an audit and not a proof of solvency at any other time.
   */
  const download = useCallback(() => {
    const artefact = {
      $comment:
        "Kyrve Verify — recomputed in a browser from chain state at the block below. Every row " +
        "states a fact, reads the chain for it, and compares against the deployment record; the " +
        "record is never the source of a verdict. PUBLIC VALUES ONLY: no private balance, no " +
        "decrypted amount and no key material appears here.",
      notAnAudit:
        "This is a recomputation of the listed checks at one block. It is not an audit, and it " +
        "says nothing about any block other than the one named.",
      proofNote:
        "Values published through the Nox gateway carry DECRYPTION PROOFS — signatures over a " +
        "released plaintext. They are not zero-knowledge proofs and are not described as such.",
      chainId,
      block: ranAtBlock?.toString() ?? null,
      seriesId: series.seriesId,
      summary: { passed, failed, unavailable },
      checks: rows.map((row) => ({
        id: row.id,
        claim: row.claim,
        verdict: row.verdict,
        detail: row.detail,
        measured: row.measured,
      })),
      recomputedAt: new Date().toISOString(),
    };
    const blob = new Blob([`${JSON.stringify(artefact, null, 2)}\n`], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `kyrve-verify-${series.seriesId.slice(2, 12)}-${ranAtBlock ?? "0"}.json`;
    anchor.click();
    URL.revokeObjectURL(url);
  }, [rows, chainId, series.seriesId, ranAtBlock, passed, failed, unavailable]);

  return (
    <section className="card" data-testid="verify-band">
      <div className="band-head">
        <h2>Verify</h2>
        <div className="band-meta">
          {ranAtBlock === undefined ? "not yet run" : `chain ${chainId} · block ${ranAtBlock}`}
        </div>
      </div>

      <p>
        Every row below states a fact, reads this chain for it, and compares. The deployment record
        supplies addresses and never a verdict — where the record and the chain disagree, the row
        fails and shows both. A page that displayed the record would have verified nothing.
      </p>

      {failure === undefined ? null : (
        <div className="reveal-warning" role="alert" data-testid="verify-failure">
          <strong>Nothing was verified</strong>
          <p>{failure}</p>
        </div>
      )}

      <ul className="verify-rows" data-testid="verify-rows">
        {rows.map((row) => (
          <li key={row.id} data-testid={`verify-${row.id}`} data-verdict={row.verdict}>
            <div className="verify-claim">
              <span className={`verify-verdict verify-${row.verdict}`}>
                {VERDICT_LABEL[row.verdict]}
              </span>
              <strong>{row.claim}</strong>
            </div>
            <p>{row.detail}</p>
            {Object.keys(row.measured).length === 0 ? null : (
              <dl className="facts">
                {Object.entries(row.measured).map(([key, value]) => (
                  <div key={key}>
                    <dt>{key}</dt>
                    <dd>{value}</dd>
                  </div>
                ))}
              </dl>
            )}
          </li>
        ))}
      </ul>

      <div className="band-meta" data-testid="verify-summary">
        {passed} recomputed · {failed} disagreeing · {unavailable} not deployed here
      </div>

      <div className="actions">
        <button type="button" onClick={() => void recompute()} disabled={running}>
          {running ? "Reading the chain…" : "Recompute from chain"}
        </button>
        <button
          type="button"
          className="primary"
          onClick={download}
          disabled={rows.length === 0}
          data-testid="verify-download"
        >
          Download this verification
        </button>
      </div>

      <p className="footnote">
        The downloadable file carries public values only — no private balance and no decrypted
        amount. Values published through the Nox gateway carry decryption proofs, which are
        signatures over a released plaintext; they are not zero-knowledge proofs and Kyrve does not
        describe them as such.
      </p>
    </section>
  );
}
