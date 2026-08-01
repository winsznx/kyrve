/**
 * Kyrve Verify, as a panel any proof page can mount.
 *
 * ════════════════════════════════════════════════════════════════════════════════════════════
 * THIS PANEL DOES NOT DISPLAY THE RECORD. IT DISAGREES WITH IT.
 * ════════════════════════════════════════════════════════════════════════════════════════════
 *
 * A verification page that renders the contents of a deployment record has verified nothing — it has
 * reformatted a file anybody could have written. So every check states a fact, reads the chain for
 * that fact, and compares. The record supplies ADDRESSES and IDENTIFIERS and is never the source of a
 * verdict; where the record and the chain disagree, the check fails and shows both values.
 *
 * That is the same contract `scripts/verify/kyrve-verify.ts` holds itself to, deliberately: the CLI
 * and this panel must be CAPABLE of contradicting each other, or running both proves no more than
 * running one. Demonstration 24 is the executable proof — the served record is rewritten with a false
 * series id and the page has to turn that row red on its own.
 *
 * ════════════════════════════════════════════════════════════════════════════════════════════
 * FOUR VERDICTS, AND TWO OF THEM ARE NOT PASS OR FAIL
 * ════════════════════════════════════════════════════════════════════════════════════════════
 *
 *   unavailable            a contract that was never deployed for this layer. Layer B has no Capsule
 *                          vault of its own; calling that a pass or a fail is a lie in one direction
 *                          or the other, and U-F6 is what happened when the wrong contract was
 *                          attached instead of reporting it (P7-4).
 *   reported-not-verified  something a RECORD asserts that this browser did not check. Listed rather
 *                          than dropped, so it cannot be mistaken for something that was recomputed.
 *
 * ════════════════════════════════════════════════════════════════════════════════════════════
 * NO PRIVATE VALUE, ANYWHERE
 * ════════════════════════════════════════════════════════════════════════════════════════════
 *
 * No check decrypts anything, and the downloadable artefact carries public values only. It is meant
 * to be sent to someone, and a verification file carrying a private amount is a leak with a checksum.
 * `downloadArtefact` refuses one that contains a value this browser decrypted, or a URL at all.
 */

import { type ReactElement, useCallback, useEffect, useState } from "react";

import { type Check, downloadArtefact, VERDICT_LABEL, type Verdict } from "../lib/artefact.js";
import { useKyrve } from "../lib/context.js";
import { safeErrorMessage } from "../lib/redact.js";
import { revealedValues } from "../lib/session.js";
import { Hash, type HashKind } from "./Hash.js";

export interface VerifyPanelProps {
  /** What the artefact is about: `deployment`, `quote`, `series`, `capsule`. */
  readonly subject: string;
  readonly subjectId: string;
  readonly layer: string | undefined;
  /** Runs every check against the chain, at the block it is handed. */
  readonly run: (block: bigint) => Promise<readonly Check[]>;
  /** Re-runs when any of these change — a route parameter, usually. */
  readonly deps: readonly unknown[];
}

export function VerifyPanel({
  subject,
  subjectId,
  layer,
  run,
  deps,
}: VerifyPanelProps): ReactElement {
  const { publicClient, record } = useKyrve();
  const [checks, setChecks] = useState<readonly Check[]>([]);
  const [block, setBlock] = useState<bigint>();
  const [running, setRunning] = useState(false);
  const [failure, setFailure] = useState<string>();
  const [attempt, setAttempt] = useState(0);
  const [downloadError, setDownloadError] = useState<string>();

  /*
   * `run` is deliberately not a dependency, and `attempt` deliberately is.
   *
   * `run` is a fresh closure per render, so depending on it would re-run the whole verification
   * forever — and a verification that re-ran on every render would hammer the node and produce a
   * different block on each pass. The caller declares what it actually depends on, and `attempt` is
   * the explicit recompute trigger the reader presses.
   */
  // biome-ignore lint/correctness/useExhaustiveDependencies: explained directly above.
  useEffect(() => {
    let live = true;
    setRunning(true);
    setFailure(undefined);
    void (async () => {
      try {
        // The block is read FIRST and passed in, so every check in one artefact names the same
        // block. Reading it per check would produce a file whose rows were measured at different
        // heights and whose header claimed one.
        const at = await publicClient.getBlockNumber();
        const found = await run(at);
        if (!live) return;
        setBlock(at);
        setChecks(found);
      } catch (error) {
        if (!live) return;
        setFailure(safeErrorMessage(error));
        setChecks([]);
      } finally {
        if (live) setRunning(false);
      }
    })();
    return () => {
      live = false;
    };
  }, [...deps, attempt]);

  const tally = (verdict: Verdict): number =>
    checks.filter((check) => check.verdict === verdict).length;

  const download = useCallback((): void => {
    setDownloadError(undefined);
    try {
      downloadArtefact(
        {
          subject,
          subjectId,
          layer,
          chainId: record.chainId,
          block,
          checks,
        },
        revealedValues(),
      );
    } catch (error) {
      setDownloadError(safeErrorMessage(error));
    }
  }, [subject, subjectId, layer, record.chainId, block, checks]);

  return (
    <section className="band" data-testid="verify-band">
      <div className="band-head">
        <h2>Verify</h2>
        <div className="band-meta">
          {block === undefined
            ? "not yet run"
            : `chain ${record.chainId} · block ${block}${layer === undefined ? "" : ` · ${layer}`}`}
        </div>
      </div>

      <p className="lede">
        Every check below states a fact, reads this chain for it, and compares. The deployment
        record supplies addresses and never a verdict. Where the record and the chain disagree, the
        check fails and shows both. A page that displayed the record would have verified nothing.
      </p>

      {failure === undefined ? null : (
        <div className="reveal-warning" role="alert" data-testid="verify-failure">
          <strong>Nothing was verified</strong>
          <p>{failure}</p>
        </div>
      )}

      <ul className="verify-rows" data-testid="verify-rows">
        {checks.map((check) => (
          <li key={check.id} data-testid={`verify-${check.id}`} data-verdict={check.verdict}>
            <div className="verify-claim">
              <span className={`verify-verdict${check.verdict === "failed" ? " verify-fail" : ""}`}>
                {VERDICT_LABEL[check.verdict]}
              </span>
              <strong>{check.claim}</strong>
            </div>
            <p>{check.detail}</p>
            {Object.keys(check.measured).length === 0 ? null : (
              <dl className="facts">
                {Object.entries(check.measured).map(([key, value]) => (
                  <div key={key}>
                    <dt>{key}</dt>
                    <dd>
                      {/*
                        Every measured value that is a real chain object becomes a link.

                        This is the page whose whole argument is "check this yourself", and it was
                        rendering forty hex strings as inert text. A reader had to select, copy, find
                        an explorer and paste — which is the difference between verifiable in
                        principle and verifiable.
                      */}
                      {isHex(value) ? <Hash value={value} kind={kindOf(key, value)} /> : value}
                    </dd>
                  </div>
                ))}
              </dl>
            )}
          </li>
        ))}
      </ul>

      <div className="band-meta" data-testid="verify-summary">
        {tally("verified")} recomputed · {tally("failed")} disagreeing · {tally("unavailable")} not
        deployed here · {tally("reported-not-verified")} reported but not verified here
      </div>

      <div className="actions">
        <button
          type="button"
          onClick={() => setAttempt((n) => n + 1)}
          disabled={running}
          data-testid="verify-recompute"
        >
          {running ? "Reading the chain…" : "Recompute from chain"}
        </button>
        <button
          type="button"
          className="primary"
          onClick={download}
          disabled={checks.length === 0}
          data-testid="verify-download"
        >
          Download this verification
        </button>
      </div>

      {downloadError === undefined ? null : (
        <p className="note" role="alert" data-testid="verify-download-refused">
          {downloadError}
        </p>
      )}

      <p className="footnote">
        The downloadable file carries public values only. It has no private balance or decrypted
        amount, and it says what it is not: a recomputation at one block by one browser over the
        checks listed, not an audit. Values published through the Nox gateway carry decryption
        proofs, which are signatures over a released plaintext; they are not zero-knowledge proofs
        and Kyrve does not describe them as such.
      </p>
    </section>
  );
}

/**
 * Compares a chain read against what the record claims, and never the other way round.
 *
 * Exported because every proof page needs it and each one writing its own comparison is how a page
 * ends up comparing the record against itself.
 */
/** Whether a measured value is a chain object rather than a number or a sentence. */
function isHex(value: string): boolean {
  return /^0x[0-9a-fA-F]{8,}$/.test(value.trim());
}

/**
 * What a measured value IS, inferred from the label rather than from its length.
 *
 * A 32-byte hex string is a transaction hash, a series id, a quote id, a graph root or a Nox handle,
 * and they are indistinguishable by shape. Guessing from length would link a series id to a
 * transaction page and produce a confident 404 on the one surface that exists to be checked — so the
 * label decides, and anything not recognised is an identifier with no link.
 */
function kindOf(label: string, value: string): HashKind {
  const key = label.toLowerCase();
  if (key.includes(" tx") || key.endsWith("tx") || key.includes("transaction")) return "tx";
  if (key.includes("block")) return "block";
  // A 20-byte value is an address whatever it is called; nothing else is that length.
  if (/^0x[0-9a-fA-F]{40}$/.test(value.trim())) return "address";
  if (
    key.includes("vault") ||
    key.includes("token") ||
    key.includes("book") ||
    key.includes("registry") ||
    key.includes("verifier") ||
    key.includes("beneficiary") ||
    key.includes("ratifier") ||
    key.includes("taker") ||
    key.includes("recipient") ||
    key.includes("subject") ||
    key.includes("maker")
  ) {
    return "address";
  }
  return "id";
}

export function compare(
  id: string,
  claim: string,
  onChain: string,
  recorded: string,
  measured: Record<string, string>,
): Check {
  return onChain.toLowerCase() === recorded.toLowerCase()
    ? { id, claim, verdict: "verified", detail: "the chain agrees with the record", measured }
    : {
        id,
        claim,
        verdict: "failed",
        detail: "the chain and the record disagree; the chain is what is true",
        measured: { ...measured, "on chain": onChain, "in the record": recorded },
      };
}
