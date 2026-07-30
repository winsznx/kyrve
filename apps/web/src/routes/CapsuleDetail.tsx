/**
 * `/app/capsules/:capsuleId` — one capsule, and the auditor's view of it.
 *
 * ════════════════════════════════════════════════════════════════════════════════════════════
 * THE AUDITOR JOURNEY, IN ONE PAGE
 * ════════════════════════════════════════════════════════════════════════════════════════════
 *
 *   1. open the capsule                — by its id, from a URL somebody sent
 *   2. verify origin and scope         — chain, deployment and series, recomputed here
 *   3. decrypt only the frozen snapshot — the one handle the grant covers, and nothing else
 *
 * Step 3 is the load-bearing one and the restriction is structural rather than enforced by this page:
 * the recipient holds a grant on ONE handle, the isolated snapshot, and the live balance handle was
 * never granted to anyone but its owner. An auditor who tried to read the portfolio would be refused
 * on chain before any key material was released.
 *
 * ════════════════════════════════════════════════════════════════════════════════════════════
 * WHAT EXPIRY DOES, STATED IN THE WORDS P7-3 FIXES
 * ════════════════════════════════════════════════════════════════════════════════════════════
 *
 * `assertsValidAt` is the only thing expiry governs. After it passes: live access ended, future
 * snapshots disabled, this historical snapshot remains available. Never "revoked", never "no longer
 * readable" — the grant is permanent and saying otherwise would be the opposite of the truth.
 */

import { type HandleAcl, readAcl } from "@kyrve/nox";
import { type ReactElement, useEffect, useState } from "react";

import { ConfidentialValue } from "../components/ConfidentialValue.js";
import { Empty, Facts } from "../components/Facts.js";
import { RequiresWallet } from "../components/RequiresWallet.js";
import { classifyFailure, type FailureKind, type Phase, Status } from "../components/Status.js";
import { CAPSULE_READ_ABI, CAPSULE_SCOPE_LABEL } from "../lib/abi.js";
import { abbreviate, formatTimestamp, useChainRead } from "../lib/chain.js";
import { useKyrve } from "../lib/context.js";
import { capsuleVaultsOf, type LayerRecord } from "../lib/records.js";
import { recall, remember, type Session, useRevealed } from "../lib/session.js";
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

interface Found {
  readonly layer: LayerRecord;
  readonly vault: `0x${string}`;
  readonly capsule: Capsule;
  readonly originDigest: `0x${string}`;
  readonly assertsNow: boolean;
  readonly chainNow: bigint;
}

export function CapsuleDetail({ capsuleId }: { capsuleId: `0x${string}` }): ReactElement {
  const { record, publicClient } = useKyrve();
  const vaults = capsuleVaultsOf(record);

  /**
   * Looks in every vault this deployment names, and takes the first that knows the id.
   *
   * `capsuleOf` reverts `UnknownCapsule` rather than returning an empty struct, so a miss is a thrown
   * error rather than a zeroed record that would render as a real capsule with every field blank.
   */
  const found = useChainRead<Found | undefined>(async () => {
    for (const { layer, vault } of vaults) {
      try {
        const capsule = (await publicClient.readContract({
          address: vault,
          abi: CAPSULE_READ_ABI,
          functionName: "capsuleOf",
          args: [capsuleId],
        })) as Capsule;
        if (!capsule.issued) continue;

        const block = await publicClient.getBlock();
        const [originDigest, assertsNow] = await Promise.all([
          publicClient.readContract({
            address: vault,
            abi: CAPSULE_READ_ABI,
            functionName: "originDigest",
            args: [capsuleId],
          }) as Promise<`0x${string}`>,
          publicClient.readContract({
            address: vault,
            abi: CAPSULE_READ_ABI,
            functionName: "assertsValidAt",
            args: [capsuleId, block.timestamp],
          }) as Promise<boolean>,
        ]);
        return { layer, vault, capsule, originDigest, assertsNow, chainNow: block.timestamp };
      } catch {
        // `UnknownCapsule` from this vault. Try the next one rather than reporting a failure: a
        // capsule absent from layer A's vault is an ordinary state when layer B has its own.
      }
    }
    return undefined;
  }, [capsuleId, vaults.length]);

  if (found.state === "unavailable") {
    return (
      <section className="band">
        <h1>Capsule</h1>
        <Empty title="The capsule could not be read" testId="capsule-unavailable">
          <p>
            The node did not answer, so nothing was checked. This is availability, not authorisation
            — it is not a statement that the capsule does not exist and it is not reported as one.
          </p>
          <p className="note">{found.error}</p>
        </Empty>
      </section>
    );
  }

  if (found.value === undefined) {
    return (
      <section className="band">
        <h1>Capsule</h1>
        {found.state === "done" ? (
          <Empty title="No vault on this deployment knows this capsule" testId="capsule-unknown">
            <p>
              Capsule <span className="mono">{capsuleId}</span> was not issued by any Capsule vault
              this deployment names. A capsule is bound to one chain, one deployment and one series,
              so an id from elsewhere cannot be resolved here — and this page will not guess at one.
            </p>
            <p>
              <Link to="/app/capsules" className="row-link">
                The capsules this deployment does hold
              </Link>
            </p>
          </Empty>
        ) : (
          <p className="lede" aria-busy="true">
            Reading every Capsule vault this deployment names…
          </p>
        )}
      </section>
    );
  }

  const { layer, vault, capsule, originDigest, assertsNow, chainNow } = found.value;

  return (
    <>
      <section className="band">
        <span className="eyebrow">{layer.label} · frozen disclosure</span>
        <h1>Capsule {abbreviate(capsuleId)}</h1>
        <p className="lede">
          {CAPSULE_SCOPE_LABEL[capsule.scope] ?? "an unrecognised scope"}, frozen at block{" "}
          {capsule.snapshotBlock.toString()} and granted to one recipient permanently.
        </p>

        <Facts
          testId="capsule-facts"
          facts={[
            { label: "Capsule", value: <span className="mono">{capsuleId}</span> },
            { label: "Origin digest", value: <span className="mono">{originDigest}</span> },
            { label: "Capsule vault", value: <span className="mono">{vault}</span> },
            { label: "Series", value: <span className="mono">{layer.series.seriesId}</span> },
            { label: "Bound quote", value: <span className="mono">{capsule.quoteId}</span> },
            {
              label: "Subject",
              value:
                capsule.subject === "0x0000000000000000000000000000000000000000" ? undefined : (
                  <span className="mono">{capsule.subject}</span>
                ),
              absent: "this scope describes the series as a whole",
            },
            { label: "Recipient", value: <span className="mono">{capsule.recipient}</span> },
            { label: "Issued at", value: formatTimestamp(capsule.issuedAt) },
            { label: "Asserts until", value: formatTimestamp(capsule.expiry) },
            { label: "Snapshot block", value: capsule.snapshotBlock.toString() },
          ]}
        />
      </section>

      <section className="band">
        <div className="card" data-testid="capsule-validity" data-asserts={assertsNow}>
          <h2>{assertsNow ? "This capsule asserts its facts" : "Live access ended"}</h2>
          {assertsNow ? (
            <p className="lede">
              Judged against the chain's clock at {formatTimestamp(chainNow)}, this capsule still
              asserts. <code>assertsValidAt</code> is what expiry governs and it is the only thing
              it governs.
            </p>
          ) : (
            <p className="lede" data-testid="capsule-ended">
              Live access ended and future snapshots are disabled.{" "}
              <strong>This historical snapshot remains available</strong> to its recipient,
              permanently — Nox has no <code>removeViewer</code>, so nothing here was revoked and
              this interface does not say it was. What has ended is the capsule's ability to assert,
              not the recipient's ability to decrypt what it froze.
            </p>
          )}
        </div>
      </section>

      <section className="band">
        <RequiresWallet purpose="decrypt the frozen snapshot, if you are its recipient">
          {(session) => <SnapshotPanel session={session} capsule={capsule} />}
        </RequiresWallet>
      </section>

      <section className="band">
        <div className="card">
          <h2>Verify this capsule</h2>
          <p className="lede">
            A valid decryption proof says nothing about which quote a value belongs to — it is a
            signature over a released plaintext with no ACL, no nonce, no expiry and no caller
            binding. What makes this capsule mean something is its binding to this chain, this
            deployment and this series, and the proof page checks the binding before the signature.
          </p>
          <Link to={`/proof/capsule/${capsuleId}`} className="ghost">
            Recompute the origin from chain state
          </Link>
        </div>
      </section>
    </>
  );
}

function SnapshotPanel({ session, capsule }: { session: Session; capsule: Capsule }): ReactElement {
  const [acl, setAcl] = useState<HandleAcl>();
  const [phase, setPhase] = useState<Phase>("idle");
  const [failure, setFailure] = useState<{ kind: FailureKind; detail: string }>();
  const [busy, setBusy] = useState(false);
  useRevealed();
  const value = recall(capsule.snapshotHandle);

  const handle = capsule.snapshotHandle;

  useEffect(() => {
    if (/^0x0+$/.test(handle)) {
      setAcl(undefined);
      return;
    }
    let live = true;
    void readAcl(session.publicClient, session.network, handle, session.account)
      .then((result) => {
        if (live) setAcl(result);
      })
      .catch(() => {
        if (live) setAcl(undefined);
      });
    return () => {
      live = false;
    };
  }, [session, handle]);

  async function decrypt(): Promise<void> {
    setBusy(true);
    setFailure(undefined);
    setPhase("decryption-ready");
    try {
      remember(handle, await session.nox.decrypt(handle));
      setPhase("proof-ready");
    } catch (error) {
      setFailure(classifyFailure(error));
      setPhase("failed");
    } finally {
      setBusy(false);
    }
  }

  const isRecipient = capsule.recipient.toLowerCase() === session.account.toLowerCase();

  return (
    <div className="card" data-testid="capsule-snapshot">
      <h2>The frozen snapshot</h2>
      <p className="lede">
        One handle, isolated so its lineage is shared with nothing else. This is not the live
        balance handle: that one was never granted to anyone but its owner, and an attempt to read
        it would be refused on chain before any key material was released.
      </p>

      <ConfidentialValue
        title="Frozen snapshot"
        handle={/^0x0+$/.test(handle) ? undefined : handle}
        acl={acl}
        value={value}
        decimals={6}
        onDecrypt={() => void decrypt()}
        busy={busy}
        testId="snapshot-value"
      />

      {isRecipient ? null : (
        <p className="note" data-testid="not-recipient">
          This wallet is not the capsule's recipient. Nothing about the value leaks from that: Nox
          checks authorisation on chain before releasing key material, so a refusal here discloses
          no more than the refusal itself.
        </p>
      )}

      <Status phase={phase} failure={failure} testId="snapshot-status" />
    </div>
  );
}
