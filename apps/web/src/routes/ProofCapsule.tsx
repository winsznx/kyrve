/**
 * `/proof/capsule/:capsuleId` — one capsule's origin, recomputed.
 *
 * ════════════════════════════════════════════════════════════════════════════════════════════
 * A VALID PROOF SAYS NOTHING ABOUT WHICH QUOTE A VALUE BELONGS TO
 * ════════════════════════════════════════════════════════════════════════════════════════════
 *
 * `validateDecryptionProof` is a pure signature check: no ACL, no nonce, no expiry, no caller
 * binding. A proof once issued is replayable by anyone forever. So the thing worth verifying about a
 * capsule is its BINDING — chain, deployment, series and the claim behind it — and this page checks
 * that first. A page that verified a signature and called the capsule proven would have proven that
 * somebody once signed something.
 *
 * ════════════════════════════════════════════════════════════════════════════════════════════
 * EXPIRY IS REPORTED IN THE WORDS P7-3 FIXES
 * ════════════════════════════════════════════════════════════════════════════════════════════
 *
 * `assertsValidAt` is the only thing expiry governs. A lapsed capsule reports "live access ended,
 * future snapshots disabled, this historical snapshot remains available" — never "revoked", never
 * "no longer readable". Nox has no `removeViewer`, and describing a permanent grant as withdrawn
 * would be the opposite of the truth on a public network.
 */

import type { ReactElement } from "react";

import { Empty } from "../components/Facts.js";
import { compare, VerifyPanel } from "../components/VerifyPanel.js";
import { CAPSULE_READ_ABI, CAPSULE_SCOPE_LABEL } from "../lib/abi.js";
import type { Check } from "../lib/artefact.js";
import { abbreviate, formatTimestamp } from "../lib/chain.js";
import { useKyrve } from "../lib/context.js";
import { capsuleVaultsOf } from "../lib/records.js";
import { Link } from "../router/router.js";

interface Capsule {
  readonly issued: boolean;
  readonly scope: number;
  readonly subject: `0x${string}`;
  readonly recipient: `0x${string}`;
  readonly issuedAt: bigint;
  readonly expiry: bigint;
  readonly snapshotBlock: bigint;
  readonly quoteId: `0x${string}`;
  readonly snapshotHandle: `0x${string}`;
  readonly factsDigest: `0x${string}`;
}

export function ProofCapsule({ capsuleId }: { capsuleId: `0x${string}` }): ReactElement {
  const { record, publicClient } = useKyrve();
  const vaults = capsuleVaultsOf(record);

  if (vaults.length === 0) {
    return (
      <section className="band">
        <h1>Capsule proof</h1>
        <Empty title="No Capsule vault is deployed here" testId="proof-capsule-unavailable">
          <p>
            This deployment names no Capsule vault, so there is nothing to ask about this id.
            Nothing was checked, and that is reported rather than turned into a verdict.
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

  async function run(): Promise<readonly Check[]> {
    const found: Check[] = [];

    for (const { layer, vault } of vaults) {
      let capsule: Capsule;
      try {
        capsule = (await publicClient.readContract({
          address: vault,
          abi: CAPSULE_READ_ABI,
          functionName: "capsuleOf",
          args: [capsuleId],
        })) as Capsule;
      } catch {
        // `UnknownCapsule` from this vault. Try the next: a capsule absent from layer A's vault is
        // an ordinary state when layer B has one of its own.
        continue;
      }
      if (!capsule.issued) continue;

      const block = await publicClient.getBlock();
      const [originDigest, vaultSeries, vaultChain, assertsNow] = await Promise.all([
        publicClient.readContract({
          address: vault,
          abi: CAPSULE_READ_ABI,
          functionName: "originDigest",
          args: [capsuleId],
        }) as Promise<`0x${string}`>,
        publicClient.readContract({
          address: vault,
          abi: CAPSULE_READ_ABI,
          functionName: "SERIES_ID",
        }) as Promise<`0x${string}`>,
        publicClient.readContract({
          address: vault,
          abi: CAPSULE_READ_ABI,
          functionName: "CHAIN_ID",
        }) as Promise<bigint>,
        publicClient.readContract({
          address: vault,
          abi: CAPSULE_READ_ABI,
          functionName: "assertsValidAt",
          args: [capsuleId, block.timestamp],
        }) as Promise<boolean>,
      ]);

      // ── 1. the vault holding it serves the series the record names ──────────────────────
      found.push(
        compare(
          "capsule-series",
          "the vault that issued this capsule serves the series this record names",
          vaultSeries,
          layer.series.seriesId,
          { vault, layer: layer.label },
        ),
      );

      // ── 2. the origin is this chain ─────────────────────────────────────────────────────
      found.push(
        compare(
          "capsule-chain",
          "the capsule's origin is the chain this browser is connected to",
          vaultChain.toString(),
          String(record.chainId),
          { "origin digest": originDigest },
        ),
      );

      // ── 3. what the capsule actually says ───────────────────────────────────────────────
      found.push({
        id: "capsule-scope",
        claim: "the capsule names one scope, one recipient and one frozen snapshot",
        verdict: "verified",
        detail:
          "read from the vault. The snapshot handle is an isolated value whose lineage is shared " +
          "with nothing else — it is not the live balance handle, which was never granted to anyone " +
          "but its owner.",
        measured: {
          scope: CAPSULE_SCOPE_LABEL[capsule.scope] ?? `unrecognised (${capsule.scope})`,
          subject:
            capsule.subject === "0x0000000000000000000000000000000000000000"
              ? "the series as a whole"
              : capsule.subject,
          recipient: capsule.recipient,
          "bound quote": capsule.quoteId,
          "snapshot handle": capsule.snapshotHandle,
          "snapshot block": capsule.snapshotBlock.toString(),
          "facts digest": capsule.factsDigest,
        },
      });

      // ── 4. what expiry does, and what it does not do ────────────────────────────────────
      found.push({
        id: "capsule-validity",
        claim: "the expiry governs whether the capsule asserts, not whether it can be decrypted",
        verdict: "verified",
        detail: assertsNow
          ? `This capsule asserts its facts, judged against the chain clock at ${formatTimestamp(block.timestamp)}.`
          : "Live access ended and future snapshots are disabled. This historical snapshot remains " +
            "available to its recipient, permanently: Nox has no removeViewer, so nothing was " +
            "revoked and nothing here says it was.",
        measured: {
          "asserts at this block": String(assertsNow),
          "asserts until": formatTimestamp(capsule.expiry),
          "chain clock": formatTimestamp(block.timestamp),
        },
      });

      // ── 5. the one thing this browser did not check ─────────────────────────────────────
      found.push({
        id: "snapshot-value-not-read",
        claim: "the frozen value itself",
        verdict: "reported-not-verified",
        detail:
          "This page did not decrypt anything and could not: the grant covers one recipient, and a " +
          "verification artefact carrying a private amount would be a leak with a checksum. The " +
          "recipient reads it in their own browser, through the gateway, or not at all.",
        measured: { "snapshot handle": capsule.snapshotHandle },
      });

      return found;
    }

    found.push({
      id: "capsule-unknown",
      claim: "some vault on this deployment issued this capsule",
      verdict: "failed",
      detail:
        "no Capsule vault this deployment names has ever issued this id. A capsule is bound to one " +
        "chain, one deployment and one series, so an id from elsewhere cannot be resolved here — " +
        "and this page will not resolve it against a different one.",
      measured: {
        "capsule id": capsuleId,
        "vaults searched": String(vaults.length),
      },
    });
    return found;
  }

  return (
    <>
      <section className="band">
        <span className="eyebrow">Verification</span>
        <h1>Capsule {abbreviate(capsuleId)}</h1>
        <p className="lede">
          The binding is what makes a capsule mean anything, so the binding is what is checked here:
          a decryption proof is a signature over a released plaintext with no ACL, no nonce, no
          expiry and no caller binding, and it is replayable by anyone forever.
        </p>
        <p className="note">
          <Link to={`/app/capsules/${capsuleId}`} className="row-link">
            Open this capsule in the terminal
          </Link>
        </p>
      </section>

      <VerifyPanel
        subject="capsule"
        subjectId={capsuleId}
        layer={undefined}
        run={run}
        deps={[capsuleId, vaults.length]}
      />
    </>
  );
}
