/**
 * `/app` — what this deployment is, and where each journey starts.
 *
 * Three journeys, and they are genuinely different people: a provider commits capital and never sees
 * a borrower's terms, a borrower asks for one quote and never sees the curve behind it, an auditor
 * reads one frozen snapshot and never sees a portfolio. The page is organised by who you are rather
 * than by which contract you are about to touch.
 */

import type { ReactElement } from "react";

import { Facts } from "../components/Facts.js";
import { useChainRead } from "../lib/chain.js";
import { useKyrve } from "../lib/context.js";
import { capsuleVaultsOf, layersOf, rollOf, settlementsOf } from "../lib/records.js";
import { Link } from "../router/router.js";

export function Overview(): ReactElement {
  const { record, publicClient } = useKyrve();
  const layers = layersOf(record);
  const settlements = settlementsOf(record);
  const vaults = capsuleVaultsOf(record);
  const roll = rollOf(record);

  /** The head block, so the page can say when it last agreed with the chain. */
  const head = useChainRead(
    async () => ({
      block: await publicClient.getBlockNumber(),
      chainId: await publicClient.getChainId(),
    }),
    [record.chainId],
  );

  return (
    <>
      <section className="band">
        <span className="eyebrow">Terminal</span>
        <h1>Overview</h1>
        <p className="lede">
          Encrypted lender mandates and one encrypted borrower requirement become one executable
          Morpho Midnight offer. The full yield curve, provider allocations, exposure limits,
          rejected alternatives and beneficial ownership stay private.
        </p>

        <Facts
          testId="overview-facts"
          facts={[
            { label: "Environment", value: record.environment },
            {
              label: "Chain",
              value:
                head.value === undefined
                  ? undefined
                  : `${head.value.chainId} · head block ${head.value.block}`,
              absent:
                head.state === "unavailable"
                  ? "the node did not answer, so nothing was read"
                  : "reading the chain",
            },
            { label: "Issuance stacks", value: String(layers.length) },
            { label: "Finished epochs being served", value: String(settlements.length) },
            { label: "Capsule vaults", value: String(vaults.length) },
            {
              label: "Roll book",
              value: roll === undefined ? undefined : "deployed",
              absent: "a roll needs two complete series",
            },
          ]}
        />
      </section>

      <section className="band">
        <h2>Three journeys</h2>
        <div className="grid">
          <div className="card">
            <h3>Provider</h3>
            <p className="lede">
              Wrap public assets into a confidential balance, publish an encrypted mandate, and hold
              a confidential claim on whatever settles.
            </p>
            <ol className="note">
              <li>
                <Link to="/app/fund" className="row-link">
                  Fund a confidential balance
                </Link>
              </li>
              <li>
                <Link to="/app/mandates" className="row-link">
                  Submit, replace or retire a mandate
                </Link>
              </li>
              <li>
                <Link to="/app/series" className="row-link">
                  Read your own claim on a series
                </Link>
              </li>
              <li>
                <Link to="/app/capsules" className="row-link">
                  Disclose one frozen value to one auditor
                </Link>
              </li>
              <li>
                <Link to="/app/roll" className="row-link">
                  Migrate between maturities
                </Link>
              </li>
            </ol>
          </div>

          <div className="card">
            <h3>Borrower</h3>
            <p className="lede">
              Ask for one quote. You never see the curve behind it, and a refusal never tells you
              which provider or which rule produced it.
            </p>
            <ol className="note">
              <li>
                <Link to="/app/request" className="row-link">
                  Submit an encrypted request with a bond
                </Link>
              </li>
              <li>
                <Link to="/app/curve" className="row-link">
                  Track the confidential computation
                </Link>
              </li>
              <li>
                <Link to="/app/quotes" className="row-link">
                  Verify, activate and settle exactly
                </Link>
              </li>
            </ol>
          </div>

          <div className="card">
            <h3>Auditor</h3>
            <p className="lede">
              Open a capsule, check its origin, decrypt only the frozen snapshot, and recompute the
              public facts from chain state. No wallet is needed for any of the public half.
            </p>
            <ol className="note">
              <li>
                <Link to="/app/capsules" className="row-link">
                  Open a capsule granted to you
                </Link>
              </li>
              <li>
                <Link to="/proof" className="row-link">
                  Recompute what Kyrve claims
                </Link>
              </li>
              <li>
                <Link to="/proof/deployment" className="row-link">
                  Check the deployment itself
                </Link>
              </li>
            </ol>
          </div>
        </div>
      </section>

      <section className="band">
        <div className="card">
          <h2>The two enforcement points, and why neither is redundant</h2>
          <p className="lede">
            <code>isRatified</code> is a view and never receives <code>units</code>, so a ratifier
            can authenticate an offer but can never enforce fill size. Midnight itself permits{" "}
            <code>newConsumed &lt;= offer.maxUnits</code>. So exact fill is enforced in{" "}
            <code>KyrveSeriesVault.onBuy</code>, which is the only place actual fill size reaches
            maker code — and the two checks cannot be collapsed into one.
          </p>
          <Link to="/proof" className="ghost">
            Verify this from chain state
          </Link>
        </div>
      </section>
    </>
  );
}
