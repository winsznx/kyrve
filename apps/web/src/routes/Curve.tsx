/**
 * `/app/curve` — the confidential computation, named stage by stage.
 *
 * ════════════════════════════════════════════════════════════════════════════════════════════
 * THE CHART HAS NO DATA SOURCE, AND SAYS SO
 * ════════════════════════════════════════════════════════════════════════════════════════════
 *
 * `RedactedCurve` is structure with no values in it: it is generated from geometry constants, not
 * from any measurement, so there is nothing in it to recover. That is the only honest drawing of a
 * curve nobody on this page is authorised to read — zeroes would imply no liquidity, sample points
 * would be a lie about a confidential system, and a blur would suggest the values are in the page.
 *
 * The one thing drawn in Cobalt is the selected point, and only once a quote genuinely exists. Its
 * position along the axis is derived from the winning leaf's PUBLIC rate index within the universe's
 * PUBLIC grid — both public from activation — so the mark discloses nothing the quote did not.
 *
 * ════════════════════════════════════════════════════════════════════════════════════════════
 * THE STAGE COSTS ARE MEASURED, NOT ESTIMATED
 * ════════════════════════════════════════════════════════════════════════════════════════════
 *
 * `CURVE_STAGE_GAS` is the Phase 3 measurement, checked by `verify:phase3` against
 * `evidence/phase3/stage-gas.json` — so a future optimisation has to be reflected there deliberately
 * rather than drifting. They are LOCAL measurements: testnet gas is UNVERIFIED (AS-1) and this page
 * says so rather than presenting them as a forecast.
 */

import {
  CURVE_MAX_CELLS_PER_TRANSACTION,
  CURVE_MIN_PRIVACY_FLOOR,
  CURVE_STAGE_GAS,
  CURVE_TRANSACTION_GAS_CEILING,
} from "@kyrve/curve";
import type { ReactElement } from "react";

import { Empty, Facts } from "../components/Facts.js";
import { RedactedCurve } from "../components/RedactedCurve.js";
import { PUBLIC_RESULT_VERIFIER_ABI } from "../lib/abi.js";
import { abbreviate, useChainRead } from "../lib/chain.js";
import { useKyrve } from "../lib/context.js";
import { settlementsOf } from "../lib/records.js";
import { Link } from "../router/router.js";

/** The stages an epoch runs, in order, with what each one's unit actually is. */
const STAGES: readonly { readonly name: string; readonly unit: string; readonly gas: number }[] = [
  { name: "Prepare epoch", unit: "once per epoch", gas: CURVE_STAGE_GAS.prepareEpoch },
  { name: "Seal providers", unit: "per provider, once at seal", gas: CURVE_STAGE_GAS.sealProvider },
  { name: "Cache eligibility", unit: "per (provider, market)", gas: CURVE_STAGE_GAS.cacheUnit },
  {
    name: "Accumulate leaves",
    unit: "per (provider, leaf) cell",
    gas: CURVE_STAGE_GAS.accumulateCell,
  },
  { name: "Finalise leaves", unit: "per leaf", gas: CURVE_STAGE_GAS.finalizeLeaf },
  { name: "Reduce to a winner", unit: "per leaf", gas: CURVE_STAGE_GAS.reduceLeaf },
  { name: "Publish the winner", unit: "once per epoch", gas: CURVE_STAGE_GAS.publishWinner },
  { name: "Allocate", unit: "per provider", gas: CURVE_STAGE_GAS.allocateProvider },
  { name: "Publish the aggregate", unit: "once per epoch", gas: CURVE_STAGE_GAS.publishAggregate },
];

export function Curve(): ReactElement {
  const { record, publicClient } = useKyrve();
  const settlements = settlementsOf(record);

  /*
    The first settlement THAT CARRIES A CANDIDATE.

    A record can name a settlement layer without serving a finished epoch — every public deployment
    does. This page is about the epoch, so a settlement with no candidate is nothing for it to show
    and it renders the same explained empty state as no settlement at all.
  */
  const first = settlements.find((entry) => entry.settlement.candidate !== undefined);
  const candidate = first?.settlement.candidate;

  /**
   * The published leaf, re-derived on chain rather than read from the record.
   *
   * `verifyForActivation` is a view, so this costs nothing and reveals nothing — and it is the same
   * call activation makes, which is what makes the number on this page the number that will be
   * activated rather than one a script wrote down.
   */
  const verified = useChainRead(async () => {
    if (first === undefined || candidate === undefined) return undefined;
    const { addresses } = first.settlement;
    return (await publicClient.readContract({
      address: addresses.KyrvePublicResultVerifier,
      abi: PUBLIC_RESULT_VERIFIER_ABI,
      functionName: "verifyForActivation",
      args: [
        candidate.epochId,
        candidate.graphRoot,
        candidate.requestId,
        candidate.universeId,
        candidate.proofs.market,
        candidate.proofs.rate,
        candidate.proofs.floor,
        candidate.proofs.ready,
        candidate.proofs.aggregate,
      ],
    })) as { marketIndex: number; rateIndex: number; borrower: `0x${string}` };
  }, [candidate?.epochId]);

  const rateIndex = verified.value?.rateIndex ?? candidate?.rateIndex;
  const resolved = rateIndex !== undefined;

  return (
    <>
      <section className="band">
        <span className="eyebrow">Matching status</span>
        <h1>Private matching</h1>
        <p className="lede">
          Kyrve evaluates eligible lending terms and a borrower request on encrypted values. It can
          publish one executable quote. Every other market, rate, allocation and capacity remains
          private.
        </p>

        <div className="card curve-summary">
          <span className="eyebrow">Private by design</span>
          <h2>Only the selected quote becomes readable</h2>
          <RedactedCurve
            className="hero-field"
            resolved={resolved}
            at={rateIndex === undefined ? 0.62 : Math.min(rateIndex / 16, 1)}
            testId="curve-field"
          />
          <p className="note">
            This is deliberate redacted structure. It is drawn from geometry constants, not a market
            measurement, so no private data can be recovered from it.
            {resolved
              ? " The Cobalt point is the selected quote, positioned by its public rate index in the public grid."
              : " No point is shown because no quote has been selected."}
          </p>
        </div>
      </section>

      {first === undefined || candidate === undefined ? (
        <section className="band">
          <Empty title="No matching run has published a quote" testId="curve-empty">
            <p>
              Matching takes several encrypted transactions and may take minutes. This page reports
              published results. It does not invent a progress state for work that has not run.
            </p>
            <p>
              <Link to="/app/mandates" className="row-link">
                Submit a mandate
              </Link>{" "}
              and{" "}
              <Link to="/app/request" className="row-link">
                a request
              </Link>{" "}
              first, or run the browser demonstration, which drives a whole epoch end to end.
            </p>
          </Empty>
        </section>
      ) : (
        <section className="band">
          <h2>The finished epoch</h2>
          <Facts
            testId="curve-epoch"
            facts={[
              {
                label: "Epoch",
                value: <span className="mono">{candidate.epochId}</span>,
              },
              {
                label: "Sealed graph root",
                value: <span className="mono">{candidate.graphRoot}</span>,
              },
              {
                label: "Request",
                value: abbreviate(candidate.requestId),
              },
              {
                label: "Selected market",
                value: verified.value === undefined ? undefined : `#${verified.value.marketIndex}`,
                absent:
                  verified.state === "unavailable"
                    ? "the verifier could not be reached"
                    : "re-deriving on chain",
              },
              {
                label: "Selected rate index",
                value: verified.value === undefined ? undefined : `#${verified.value.rateIndex}`,
                absent:
                  verified.state === "unavailable"
                    ? "the verifier could not be reached"
                    : "re-deriving on chain",
              },
              {
                label: "Privacy floor",
                value: `at least ${CURVE_MIN_PRIVACY_FLOOR} providers. Kyrve publishes the boolean, never the count`,
              },
            ]}
          />
          <p className="note">
            The provider count behind this fill is not shown and is not representable on this page.
            Only the privacy-floor boolean is public; an exact count would be the thing the floor
            exists to withhold.
          </p>
          <p className="note">
            <Link to="/app/quotes" className="row-link">
              Verify and activate this result
            </Link>
          </p>
        </section>
      )}

      <section className="band technical-section">
        <details className="route-detail">
          <summary>
            <span>Technical measurements</span>
            <small>Measured costs and the reason matching reports only published results.</small>
          </summary>
          <div className="route-detail-body">
            <h2>What an epoch costs</h2>
            <p className="lede">
              Every encrypted primitive is a separate external call, so cost scales linearly with
              operation count and the work is split across transactions. These are measured figures
              from the Phase 3 run, not estimates. <code>verify:phase3</code> fails if they disagree
              with the recorded measurement.
            </p>
            <div className="table-scroll">
              <table data-testid="curve-stages">
                <thead>
                  <tr>
                    <th>Stage</th>
                    <th>Unit</th>
                    <th>Measured gas</th>
                  </tr>
                </thead>
                <tbody>
                  {STAGES.map((stage) => (
                    <tr key={stage.name}>
                      <td>{stage.name}</td>
                      <td>{stage.unit}</td>
                      <td className="numeric">{stage.gas.toLocaleString("en-GB")}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="note">
              A single transaction may not exceed{" "}
              {CURVE_TRANSACTION_GAS_CEILING.toLocaleString("en-GB")} gas under EIP-7825 on the
              Osaka fork. The accumulate chunk is bounded at {CURVE_MAX_CELLS_PER_TRANSACTION}{" "}
              cells.
              <code>verify:gas-cap</code> is the regression gate that keeps the bound in place.
            </p>
            <p className="note">
              These are local measurements. Testnet gas remains <strong>unverified</strong> and is
              not presented here as a forecast.
            </p>
            <h3>Why matching advances in visible steps</h3>
            <p className="note">
              Nox has no batch entry point. Each primitive is a separate external call, so an epoch
              is tens of transactions rather than one. There is also no callback when off-chain work
              finishes. Readiness is found by polling, so the page reports a completed result
              instead of inventing a progress state it cannot know.
            </p>
          </div>
        </details>
      </section>
    </>
  );
}
