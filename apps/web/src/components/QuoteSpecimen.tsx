/**
 * The product, above the fold: one quote card with the book redacted beside it.
 *
 * ════════════════════════════════════════════════════════════════════════════════════════════
 * WHY THIS IS THE SECOND THING ON THE PAGE
 * ════════════════════════════════════════════════════════════════════════════════════════════
 *
 * The landing page used to be a headline, a subhead, two buttons, and then five thousand pixels of
 * prose before the product appeared. A reader had to be persuaded before they were shown anything.
 *
 * This inverts that. Four rows where the value column reads ENCRYPTED, one row where it reads a
 * number, and the whole argument has landed before the first paragraph. Everything after it is
 * elaboration rather than persuasion.
 *
 * ════════════════════════════════════════════════════════════════════════════════════════════
 * THE NUMBERS ARE REAL, AND THEY COME FROM A RECORD OF A REAL SETTLEMENT
 * ════════════════════════════════════════════════════════════════════════════════════════════
 *
 * `PROOF_SPECIMEN` is generated from `evidence/phase6/sepolia-settlement-a.json`, the Sepolia run
 * that actually happened. Nothing here is illustrative. If that evidence file is removed, the
 * generator emits nothing and this component renders its unavailable state rather than a plausible
 * number, because a fabricated rate on a landing page is exactly the thing this product exists to
 * argue against.
 *
 * The rows marked encrypted are encrypted in the protocol too. They are not blurred, not greyed and
 * not zeroed: they carry the same redacted structure the application uses for a value the reader
 * holds no grant on.
 */

import type { ReactElement } from "react";

import { PROOF_SPECIMEN } from "../generated/proof-summary.js";

/** What a lender and a borrower each keep, shown as the interface shows it. */
const PRIVATE_ROWS = [
  "Lender rate floor",
  "Borrower rate ceiling",
  "Provider allocations",
  "Rejected alternatives",
] as const;

export function QuoteSpecimen(): ReactElement {
  const s = PROOF_SPECIMEN;

  return (
    <div className="specimen" data-testid="quote-specimen">
      <div className="specimen-head">
        <span className="specimen-label">Settled quote</span>
        <span className="specimen-chain">Ethereum Sepolia</span>
      </div>

      <table className="specimen-table">
        <tbody>
          {PRIVATE_ROWS.map((label) => (
            <tr key={label} data-state="encrypted">
              <th scope="row">{label}</th>
              <td>
                <span className="specimen-redacted" aria-hidden="true">
                  <span />
                  <span />
                  <span />
                  <span />
                </span>
                <span className="specimen-state">encrypted</span>
              </td>
            </tr>
          ))}

          {/*
            The one public row.

            Cobalt is the page's single primary action colour and is not spent here — the row is
            marked by weight and by the absence of redaction, which is the honest signal. What makes
            it read as different is that it is the only row with a number in it.
          */}
          <tr data-state="public" data-testid="specimen-public">
            <th scope="row">Executable amount</th>
            <td>
              <span className="specimen-value">
                {s === null ? "—" : s.amount} <span className="specimen-unit">tUSDC</span>
              </span>
              <span className="specimen-state">public on activation</span>
            </td>
          </tr>
        </tbody>
      </table>

      <p className="specimen-foot">
        {s === null ? (
          "No settlement evidence is present in this checkout, so no figures are shown."
        ) : (
          <>
            Settled at exactly these units through unmodified Morpho Midnight.{" "}
            <a
              href={`https://sepolia.etherscan.io/tx/${s.settlementTx}`}
              target="_blank"
              rel="noreferrer"
            >
              View the transaction
            </a>
          </>
        )}
      </p>
    </div>
  );
}
