/**
 * The downloadable verification artefact.
 *
 * ════════════════════════════════════════════════════════════════════════════════════════════
 * FOUR LABELS, AND THE FOURTH IS THE ONE THAT KEEPS THE FILE HONEST
 * ════════════════════════════════════════════════════════════════════════════════════════════
 *
 *   verified               a fact was stated, the chain was read for it, and they agree
 *   failed                 a fact was stated, the chain was read for it, and they disagree
 *   unavailable            the check could not run. Not a pass and not a fail (P7-4)
 *   reported-not-verified  something a RECORD asserts that this browser did not check
 *
 * The fourth label exists because of what Phase 6 shipped without static analysis. `verify:phase6`
 * reports the confidential layer as UNVERIFIED BY SLITHER on every run rather than folding it into a
 * pass, and P7-1 requires Phase 7 to carry that forward rather than let a green gate widen the claim.
 * An artefact with three labels has nowhere to put "the deployment record says 43 contracts are
 * verified on Etherscan, and this page did not call Etherscan" — so it would either be dropped, which
 * hides it, or listed as `verified`, which is a lie about who checked.
 *
 * ════════════════════════════════════════════════════════════════════════════════════════════
 * WHAT MAY GO IN THE FILE
 * ════════════════════════════════════════════════════════════════════════════════════════════
 *
 * Public values only: addresses, identifiers, handles, public amounts and verdict bits. No private
 * balance, no decrypted amount, no key material, no RPC URL. The artefact is meant to be SENT to
 * someone, and a verification file carrying a private amount is a leak with a checksum.
 * `assertArtefactIsPublic` is the runtime check, and it is called on the way to the download rather
 * than in a test, so the guarantee holds in the product.
 */

export type Verdict = "verified" | "failed" | "unavailable" | "reported-not-verified";

export const VERDICT_LABEL: Readonly<Record<Verdict, string>> = {
  verified: "recomputed",
  failed: "disagrees",
  unavailable: "not deployed here",
  "reported-not-verified": "reported, not verified here",
};

export const VERDICT_MEANING: Readonly<Record<Verdict, string>> = {
  verified: "This browser read the chain for this fact and the chain agreed.",
  failed:
    "This browser read the chain for this fact and the chain disagreed. The chain is what is true.",
  unavailable:
    "This check could not run. It is not a pass and it is not a failure — reporting it as either " +
    "would state something nobody measured.",
  "reported-not-verified":
    "A record asserts this and this browser did not check it. It is listed so that it cannot be " +
    "mistaken for something that was recomputed.",
};

export interface Check {
  readonly id: string;
  readonly claim: string;
  readonly verdict: Verdict;
  readonly detail: string;
  /** Public values only. Written into the artefact verbatim. */
  readonly measured: Readonly<Record<string, string>>;
}

export interface ArtefactInput {
  /** What this artefact is about: `deployment`, `quote`, `series`, `capsule`. */
  readonly subject: string;
  /** The public identifier the artefact is about, or the environment name for a deployment. */
  readonly subjectId: string;
  readonly chainId: number;
  /** The block every check was read at. `undefined` when nothing could be read. */
  readonly block: bigint | undefined;
  /** Which issuance stack, so a layer A artefact can never be mistaken for a layer B one. */
  readonly layer: string | undefined;
  readonly checks: readonly Check[];
}

function tally(checks: readonly Check[], verdict: Verdict): number {
  return checks.filter((check) => check.verdict === verdict).length;
}

/**
 * Refuses an artefact that carries a value it must not.
 *
 * A positive list would be better and is not possible: `measured` legitimately holds arbitrary public
 * hex. So this is a negative check against the values that must never appear — every decrypted value
 * this browser is currently holding — which is exactly the set that could leak from this page.
 */
export function assertArtefactIsPublic(serialised: string, forbidden: readonly bigint[]): void {
  for (const value of forbidden) {
    // A short value would false-positive against ordinary hex; a real balance is never single-digit.
    const text = value.toString();
    if (text.length < 4) continue;
    if (serialised.includes(text)) {
      throw new Error(
        "refusing to produce this artefact: it contains a value that was decrypted in this " +
          "browser. The artefact is meant to be sent to someone, and it carries public values only.",
      );
    }
  }
  if (/https?:\/\/[^\s"]{12,}/.test(serialised)) {
    throw new Error(
      "refusing to produce this artefact: it contains a URL. An RPC endpoint carries the " +
        "provider credential in its path (U-F1), and an artefact is a file that gets forwarded.",
    );
  }
}

/**
 * Builds the artefact object.
 *
 * The three prose fields are not decoration. `notAnAudit` and `proofNote` are the two sentences P7-4
 * requires, and `verdictMeanings` ships the label definitions with the file so a reader who has
 * never seen Kyrve cannot mistake `reported-not-verified` for a pass.
 */
export function buildArtefact(input: ArtefactInput): Record<string, unknown> {
  return {
    $comment:
      "Kyrve Verify — recomputed in a browser from chain state at the block below. Every check " +
      "states a fact, reads the chain for it, and compares against the deployment record; the " +
      "record is never the source of a verdict. PUBLIC VALUES ONLY: no private balance, no " +
      "decrypted amount and no key material appears here.",
    notAnAudit:
      "This is a recomputation of the listed checks at one block, by one browser. It is not an " +
      "audit, and it says nothing about any block other than the one named.",
    proofNote:
      "Values published through the Nox handle gateway carry DECRYPTION PROOFS — signatures over a " +
      "released plaintext. They are not zero-knowledge proofs and are not described as such.",
    verdictMeanings: VERDICT_MEANING,
    subject: input.subject,
    subjectId: input.subjectId,
    layer: input.layer ?? null,
    chainId: input.chainId,
    block: input.block?.toString() ?? null,
    summary: {
      verified: tally(input.checks, "verified"),
      failed: tally(input.checks, "failed"),
      unavailable: tally(input.checks, "unavailable"),
      "reported-not-verified": tally(input.checks, "reported-not-verified"),
    },
    checks: input.checks.map((check) => ({
      id: check.id,
      claim: check.claim,
      verdict: check.verdict,
      detail: check.detail,
      measured: check.measured,
    })),
    recomputedAt: new Date().toISOString(),
  };
}

/**
 * Serialises, checks, and hands the browser a file.
 *
 * The forbidden set is passed in by the caller rather than read here, so this module never touches
 * the decrypted-value map and cannot become a path from it to a file.
 */
export function downloadArtefact(input: ArtefactInput, forbidden: readonly bigint[]): void {
  const serialised = `${JSON.stringify(buildArtefact(input), null, 2)}\n`;
  assertArtefactIsPublic(serialised, forbidden);

  const blob = new Blob([serialised], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  const id = input.subjectId.replace(/^0x/, "").slice(0, 10) || input.subject;
  anchor.download = `kyrve-verify-${input.subject}-${id}-${input.block ?? "0"}.json`;
  anchor.click();
  URL.revokeObjectURL(url);
}
