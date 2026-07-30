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
        <h1>Verify</h1>
        <p className="lede">
          Every page under here states a fact, reads this chain for it, and compares. The deployment
          record supplies addresses and identifiers and is never the source of a verdict. Where the
          record and the chain disagree, the check fails and shows both values — the chain is what
          is true.
        </p>
        <p className="lede">
          Four verdicts, and two of them are neither pass nor fail.{" "}
          <strong>Not deployed here</strong> is what a contract that was never deployed for a layer
          gets, because calling that a pass or a failure would be a lie in one direction or the
          other. <strong>Reported, not verified here</strong> is what a record asserts and this
          browser did not check — listed rather than dropped, so it cannot be mistaken for a
          recomputation.
        </p>
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
                  — terms, offer hash, exact fill and the resulting position.
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

      <section className="band">
        <div className="card">
          <h2>What these pages are not</h2>
          <p className="lede">
            A recomputation at one block, by one browser, over the checks each page lists. Not an
            audit, and it says nothing about any block other than the one named.
          </p>
          <p className="lede">
            Values published through the Nox handle gateway carry <strong>decryption proofs</strong>{" "}
            — EIP-712 signatures by the Nox KMS attesting that a handle decrypts to a value. They
            are not zero-knowledge proofs and Kyrve never calls them that. A proof once issued is
            replayable by anyone forever and says nothing about which computation the value belongs
            to, so what makes one mean something is the binding: the handle registered for a role of
            a sealed epoch, or recorded in a capsule, or in an order. These pages check the binding
            first and the signature second.
          </p>
          <p className="lede">
            The confidential contract layer has <strong>no static-analysis coverage</strong>.
            crytic-compile cannot be made to drive solc 0.8.36, which is reproduced in delta U-5 and
            reported on every gate run rather than folded into a pass. Nothing on these pages should
            be read as implying otherwise.
          </p>
        </div>
      </section>
    </>
  );
}
