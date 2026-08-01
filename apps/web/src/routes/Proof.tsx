/**
 * `/proof` — the index of everything that can be recomputed.
 *
 * No wallet is needed for anything under `/proof`. The audience for a verification page is somebody
 * checking Kyrve who holds no position in it, and a page that demanded a wallet before it would show
 * a recomputation would be unusable by exactly that reader.
 */

import type { ReactElement } from "react";

import { Empty } from "../components/Facts.js";
import { abbreviate } from "../lib/chain.js";
import { useKyrve } from "../lib/context.js";
import { capsuleVaultsOf, layersOf } from "../lib/records.js";
import { Link } from "../router/router.js";

export function Proof(): ReactElement {
  const { record } = useKyrve();
  const layers = layersOf(record);
  const vaults = capsuleVaultsOf(record);

  return (
    <>
      <section className="band">
        <span className="eyebrow">Verification</span>
        <h1>Verify this deployment</h1>
        <p className="lede">
          Each check reads this chain in your browser and compares the result with the deployment
          record. The record supplies addresses but never decides a verdict.
        </p>
        <details className="route-meta">
          <summary>How verdicts work</summary>
          <p className="note">
            A check can be recomputed, failed, not deployed here, or reported without a local
            verification. The last two categories keep an unavailable check from being mistaken for
            a pass or a failure.
          </p>
        </details>
      </section>

      <section className="band">
        <ul className="rows">
          <li>
            <h2>
              <Link to="/proof/deployment" className="row-link">
                Deployment
              </Link>
            </h2>
            <p className="note">
              Every address in the record checked for deployed code, the compiler pins each layer
              was built with, and the source-verification status the records report.
            </p>
          </li>

          {layers.length === 0 ? (
            <li>
              <Empty title="No series or quote to verify yet" testId="proof-empty">
                <p>
                  A series and a quote exist after an epoch has run and settled. Until then there is
                  nothing to recompute, and a proof page rendered against nothing would be a
                  placeholder proof.
                </p>
              </Empty>
            </li>
          ) : (
            layers.map((layer) => (
              <li key={layer.tag}>
                <span className="eyebrow">{layer.label}</span>
                <h2>
                  <Link to={`/proof/series/${layer.series.seriesId}`} className="row-link">
                    Series {abbreviate(layer.series.seriesId)}
                  </Link>
                </h2>
                <p className="note">
                  Identity, the published aggregate against the live supply handle, public coverage,
                  and every market-layer binding this layer has.
                </p>
                <p className="note">
                  <Link to={`/proof/quote/${layer.series.quoteId}`} className="row-link">
                    Quote {abbreviate(layer.series.quoteId)}
                  </Link>{" "}
                  includes terms, offer hash, exact fill and the resulting position.
                </p>
              </li>
            ))
          )}

          {vaults.length === 0 ? null : (
            <li>
              <h2>Capsules</h2>
              <p className="note">
                A capsule is verified by its id. Open one from{" "}
                <Link to="/app/capsules" className="row-link">
                  the capsules you hold
                </Link>{" "}
                and follow its verification link, or go straight to{" "}
                <code className="mono">/proof/capsule/&lt;capsuleId&gt;</code>.
              </p>
            </li>
          )}
        </ul>
      </section>

      <section className="band technical-section">
        <details className="route-detail">
          <summary>
            <span>Important limits</span>
            <small>A browser recomputes one named block. It does not perform an audit.</small>
          </summary>
          <div className="route-detail-body">
            <h2>What these pages are not</h2>
            <p className="note">
              A recomputation at one block, by one browser, over the checks each page lists. It says
              nothing about any block other than the one named.
            </p>
            <p className="note">
              Values published through the Nox handle gateway carry{" "}
              <strong>decryption proofs</strong>. These are EIP-712 signatures by the Nox KMS
              attesting that a handle decrypts to a value. They are not zero-knowledge proofs and
              Kyrve never calls them that. A proof once issued is replayable by anyone forever and
              says nothing about which computation the value belongs to. The binding, checked before
              the signature, gives it meaning here.
            </p>
            <p className="note">
              The confidential contract layer has <strong>no static-analysis coverage</strong>.
              crytic-compile cannot be made to drive solc 0.8.36. This is reported on every gate run
              rather than folded into a pass.
            </p>
          </div>
        </details>
      </section>
    </>
  );
}
