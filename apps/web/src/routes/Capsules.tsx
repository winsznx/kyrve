/**
 * `/app/capsules` — frozen selective disclosure.
 *
 * ════════════════════════════════════════════════════════════════════════════════════════════
 * THE VOCABULARY IS FIXED AND IT IS FIXED FOR A REASON
 * ════════════════════════════════════════════════════════════════════════════════════════════
 *
 * Nox has no `removeViewer`, no `removeAdmin`, and no way to un-set `allowPublicDecryption`. A
 * capsule's grant is therefore permanent, and a capsule's expiry governs exactly one thing —
 * `assertsValidAt`. It stops the capsule ASSERTING; it does not stop its recipient DECRYPTING.
 *
 * So this interface says "live access ended", "future snapshots disabled" and "this historical
 * snapshot remains available". It never says "revoked", never "expired" in a way that implies
 * unreadable, and never "the auditor can no longer read this" (P7-3, delta U-3, U-F10). Rendering an
 * expired capsule as "no longer readable" would be stating the opposite of the truth about a
 * permanent grant on a public network.
 *
 * ════════════════════════════════════════════════════════════════════════════════════════════
 * TWO CAPSULES OVER ONE BALANCE ARE ONE HANDLE UNLESS THE RECIPIENT IS MIXED IN
 * ════════════════════════════════════════════════════════════════════════════════════════════
 *
 * A Nox handle is deterministic in its operands, so two capsules computed identically over the same
 * balance come back byte-identical — which would mean one permanent ACL entry covering both
 * recipients. `KyrveSeriesToken.issueOwnershipCapsule` mixes the recipient and the issuer's sequence
 * into the isolation domain for exactly that reason, and delta R-6 records that the defence was
 * proven by removing it and watching the handles collide.
 */

import { type ReactElement, useCallback, useState } from "react";
import { parseEventLogs } from "viem";

import { Empty, Facts } from "../components/Facts.js";
import { RequiresWallet } from "../components/RequiresWallet.js";
import { classifyFailure, type FailureKind, type Phase, Status } from "../components/Status.js";
import { CAPSULE_READ_ABI, CAPSULE_SCOPE_LABEL, SERIES_TOKEN_CAPSULE_ABI } from "../lib/abi.js";
import { abbreviate, useChainRead } from "../lib/chain.js";
import { useKyrve } from "../lib/context.js";
import { capsuleVaultsOf, type LayerRecord } from "../lib/records.js";
import type { Session } from "../lib/session.js";
import { Link } from "../router/router.js";

/** Seven days. Well inside the contract's 90-day ceiling, and long enough for a real review. */
const DEFAULT_LIFETIME_DAYS = 7;

interface Failure {
  readonly kind: FailureKind;
  readonly detail: string;
}

export function Capsules(): ReactElement {
  const { record } = useKyrve();
  const vaults = capsuleVaultsOf(record);

  return (
    <>
      <section className="band">
        <span className="eyebrow">Provider · disclosure</span>
        <h1>Capsules</h1>
        <p className="lede">
          A capsule freezes one value at one block and grants one recipient the ability to decrypt
          that frozen copy — never the live handle. The grant is permanent, because Nox has no way
          to withdraw one. What a capsule's expiry governs is whether the capsule still asserts, not
          whether its recipient can still read the snapshot it froze.
        </p>
      </section>

      {vaults.length === 0 ? (
        <section className="band">
          <Empty title="No Capsule vault is deployed here" testId="capsules-empty">
            <p>
              A Capsule vault is deployed over one series. This deployment names none, so there is
              nothing to issue against and nothing to read — which is a fact about this deployment,
              not a verdict about capsules.
            </p>
          </Empty>
        </section>
      ) : (
        vaults.map(({ layer, vault }) => (
          <section className="band" key={layer.tag}>
            <h2>
              {layer.label} · vault <span className="mono">{abbreviate(vault)}</span>
            </h2>
            <RequiresWallet purpose="freeze a snapshot of your own claim and read the capsules you hold">
              {(session) => <CapsulePanel session={session} layer={layer} vault={vault} />}
            </RequiresWallet>
          </section>
        ))
      )}
    </>
  );
}

function CapsulePanel({
  session,
  layer,
  vault,
}: {
  session: Session;
  layer: LayerRecord;
  vault: `0x${string}`;
}): ReactElement {
  const [recipient, setRecipient] = useState("");
  const [days, setDays] = useState(String(DEFAULT_LIFETIME_DAYS));
  const [phase, setPhase] = useState<Phase>("idle");
  const [failure, setFailure] = useState<Failure>();
  const [busy, setBusy] = useState(false);
  const [issued, setIssued] = useState<`0x${string}`>();

  const held = useChainRead(
    () =>
      session.publicClient.readContract({
        address: vault,
        abi: CAPSULE_READ_ABI,
        functionName: "capsulesFor",
        args: [session.account],
      }) as Promise<readonly `0x${string}`[]>,
    [vault, session.account],
  );

  const refresh = held.refresh;

  const issue = useCallback(async (): Promise<void> => {
    setBusy(true);
    setFailure(undefined);
    setIssued(undefined);
    try {
      const token = layer.series.addresses.KyrveSeriesToken;
      const block = await session.publicClient.getBlock();
      const expiry = block.timestamp + BigInt(Math.max(1, Number(days || "1"))) * 86_400n;

      const nonce = (await session.publicClient.readContract({
        address: token,
        abi: SERIES_TOKEN_CAPSULE_ABI,
        functionName: "nextNonce",
        args: [session.account],
      })) as bigint;

      setPhase("awaiting-signature");
      const hash = await session.walletClient.writeContract({
        address: token,
        abi: SERIES_TOKEN_CAPSULE_ABI,
        functionName: "issueOwnershipCapsule",
        args: [recipient as `0x${string}`, layer.series.quoteId, expiry, nonce],
        account: session.account,
        chain: null,
      });

      setPhase("transaction-pending");
      const receipt = await session.publicClient.waitForTransactionReceipt({ hash });
      const events = parseEventLogs({
        abi: SERIES_TOKEN_CAPSULE_ABI,
        logs: receipt.logs,
        eventName: "OwnershipCapsuleIssued",
      });
      const first = events[0];
      if (first === undefined) throw new Error("the transaction issued no capsule");
      setIssued(first.args.capsuleId as `0x${string}`);
      setPhase("done");
      refresh();
    } catch (error) {
      setFailure(classifyFailure(error));
      setPhase("failed");
    } finally {
      setBusy(false);
    }
  }, [session, layer, recipient, days, refresh]);

  return (
    <div className="grid" data-testid="capsule-band">
      <div className="card">
        <h3>Freeze a snapshot of your claim</h3>
        <p className="lede">
          The snapshot is taken from your own balance by the series token, at the block this
          transaction lands in. Its value equals your balance at that block and its lineage is
          shared with nothing else — it is not the live balance handle, which is never granted to
          anyone but you.
        </p>

        <div className="row">
          <div className="field">
            <label htmlFor="capsule-recipient">Recipient</label>
            <input
              id="capsule-recipient"
              type="text"
              inputMode="text"
              placeholder="0x…"
              value={recipient}
              onChange={(event) => setRecipient(event.target.value)}
              data-testid="capsule-recipient"
            />
          </div>
          <div className="field">
            <label htmlFor="capsule-days">Asserts for (days)</label>
            <input
              id="capsule-days"
              type="text"
              inputMode="numeric"
              value={days}
              onChange={(event) => setDays(event.target.value)}
              data-testid="capsule-days"
            />
          </div>
        </div>

        <div className="reveal-warning" role="alert" data-testid="capsule-warning">
          <strong>This grant is permanent and cannot be withdrawn</strong>
          <p>
            The recipient will be able to decrypt this frozen snapshot forever. Nox has no{" "}
            <code>removeViewer</code> and no <code>removeAdmin</code>. The expiry above controls
            only whether the capsule still asserts its facts — after it passes, live access ends and
            future snapshots are disabled, and this historical snapshot remains available to its
            recipient.
          </p>
        </div>

        <div className="actions">
          <button
            type="button"
            className="primary"
            onClick={() => void issue()}
            disabled={busy || !/^0x[0-9a-fA-F]{40}$/.test(recipient)}
            data-testid="capsule-issue"
          >
            Freeze snapshot and grant permanently
          </button>
        </div>

        {issued === undefined ? null : (
          <p className="note" data-testid="capsule-issued">
            Capsule{" "}
            <Link to={`/app/capsules/${issued}`} className="row-link">
              {abbreviate(issued)}
            </Link>
          </p>
        )}

        <Status phase={phase} failure={failure} testId="capsule-status" />
      </div>

      <div className="card">
        <h3>Capsules granted to you</h3>
        {held.state === "unavailable" ? (
          <p className="lede" data-testid="capsules-unavailable">
            The vault could not be read, so this list is unavailable. That is not the same as being
            empty, and it is not reported as empty. {held.error}
          </p>
        ) : held.value === undefined ? (
          <p className="lede" aria-busy="true">
            Reading the vault…
          </p>
        ) : held.value.length === 0 ? (
          <p className="lede" data-testid="capsules-none">
            Nobody has granted you a capsule on this series.
          </p>
        ) : (
          <ul className="rows" data-testid="capsules-held">
            {held.value.map((id) => (
              <li key={id}>
                <Link to={`/app/capsules/${id}`} className="row-link">
                  {abbreviate(id)}
                </Link>
              </li>
            ))}
          </ul>
        )}

        <Facts
          facts={[
            { label: "Capsule vault", value: <span className="mono">{vault}</span> },
            {
              label: "Series token",
              value: <span className="mono">{layer.series.addresses.KyrveSeriesToken}</span>,
            },
            { label: "Bound quote", value: abbreviate(layer.series.quoteId) },
            { label: "Scopes the vault can issue", value: CAPSULE_SCOPE_LABEL.length.toString() },
          ]}
        />
        <p className="note">
          Every capsule is bound to this chain, this deployment and this series. A valid decryption
          proof says nothing about which quote a value belongs to, so the binding is what makes a
          capsule mean anything — and{" "}
          <Link to="/proof" className="row-link">
            the proof pages
          </Link>{" "}
          check the binding before they look at a signature.
        </p>
      </div>
    </div>
  );
}
