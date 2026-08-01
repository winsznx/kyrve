/**
 * `/app/request` — the borrower side, and it is asymmetric on purpose.
 *
 * ════════════════════════════════════════════════════════════════════════════════════════════
 * WHAT IS PUBLIC HERE AND WHY IT HAS TO BE
 * ════════════════════════════════════════════════════════════════════════════════════════════
 *
 * The bond is ETH and its value is visible. The expiry and the exact-fill requirement have to be
 * agreed by every verifier, so they are public too. What stays encrypted is the part a provider could
 * quote against: how much you want, the least you would accept, and every maximum rate you would pay.
 *
 * A request is not a promise of a quote. The confidential engine may produce nothing for it, and when
 * it does, there is no public reason and none can be produced — a private rejection that explained
 * itself would be a public oracle. The `private-no-fill` failure kind exists for exactly that and
 * names no provider and no rule.
 *
 * ════════════════════════════════════════════════════════════════════════════════════════════
 * CANCELLING RECOVERS THE FULL BOND, AND ONLY BEFORE SEALING
 * ════════════════════════════════════════════════════════════════════════════════════════════
 *
 * `cancelUnsealedRequest` is the only cancellation, and its name is the constraint: once an epoch has
 * sealed the request into its operation graph there is nothing to cancel, because the computation the
 * bond paid for has begun. The button says which one it is.
 */

import { encryptRequest, requestDisclosure } from "@kyrve/nox";
import { type ReactElement, useCallback, useEffect, useMemo, useState } from "react";
import { formatEther, parseUnits } from "viem";

import { BoundaryPreview } from "../components/BoundaryPreview.js";
import { ConfidentialValue } from "../components/ConfidentialValue.js";
import { Facts } from "../components/Facts.js";
import { RequiresWallet } from "../components/RequiresWallet.js";
import { classifyFailure, type FailureKind, type Phase, Status } from "../components/Status.js";
import { Why } from "../components/Why.js";
import { REQUEST_BOOK_ABI } from "../lib/abi.js";
import { formatTimestamp } from "../lib/chain.js";
import { useKyrve } from "../lib/context.js";
import { recall, remember, type Session, useRevealed } from "../lib/session.js";
import { UNIVERSE } from "../lib/universe.js";
import { Link } from "../router/router.js";
import { useAcl } from "./Fund.js";

const UNDERLYING_DECIMALS = 6;
/** One hour. The same lifetime the Phase 3 flow uses, and well inside the proof expiry. */
const LIFETIME_SECONDS = 3600n;

interface Failure {
  readonly kind: FailureKind;
  readonly detail: string;
}

export function RequestPage(): ReactElement {
  const { record } = useKyrve();

  return (
    <>
      <section className="band">
        <span className="eyebrow">Borrower · Step 1</span>
        <h1>Request capital</h1>
        <p className="lede">
          A request is asymmetric on purpose. The bond is ETH and its value is visible; the expiry
          and the exact-fill requirement have to be agreed by every verifier. What stays encrypted
          is the part a provider could quote against: how much you want, the least you would accept,
          and every maximum rate you would pay.
        </p>
        <details className="route-meta">
          <summary>Submission details</summary>
          <Facts
            facts={[
              {
                label: "Request book",
                value: <span className="mono">{record.addresses.ConfidentialRequestBook}</span>,
              },
              { label: "Universe", value: <span className="mono">{UNIVERSE}</span> },
              { label: "Handles per submission", value: "19, always" },
            ]}
          />
        </details>
      </section>

      <section className="band">
        <RequiresWallet purpose="submit an encrypted request bound to your wallet">
          {(session) => <RequestPanel session={session} />}
        </RequiresWallet>
      </section>

      <section className="band">
        <div className="card route-next">
          <span className="eyebrow">After you submit</span>
          <h2>Private matching selects one quote</h2>
          <p className="lede">
            An epoch runs over every eligible mandate and this request, and publishes exactly one
            leaf: a market, a rate and an aggregate amount. Everything it rejected stays private.
          </p>
          <Link to="/app/curve" className="ghost">
            View matching status
          </Link>
        </div>
      </section>

      <section className="band">
        <Why title="A refusal tells you nothing, and that is the mechanism">
          <p>
            If no quote can be produced you are told there is no fill and nothing else. No provider
            is named, no rule is named, and no reason is recorded on chain.
          </p>
          <p>
            A confidential rejection that explained itself would let anyone map the book by
            submitting requests and reading the refusals. The silence is what stops that.
          </p>
        </Why>
      </section>
    </>
  );
}

function RequestPanel({ session }: { session: Session }): ReactElement {
  const { record } = useKyrve();
  const [desired, setDesired] = useState("1200");
  const [minimum, setMinimum] = useState("1000");
  const [maxRate, setMaxRate] = useState("30");
  const [bondWei, setBondWei] = useState<bigint>(2_000_000_000_000_000n);
  const [requestId, setRequestId] = useState<`0x${string}`>();
  const [desiredHandle, setDesiredHandle] = useState<`0x${string}`>();
  const [expiresAt, setExpiresAt] = useState<bigint>();
  const [chainNow, setChainNow] = useState<bigint>();
  const [phase, setPhase] = useState<Phase>("idle");
  const [failure, setFailure] = useState<Failure>();
  const [busy, setBusy] = useState(false);

  const book = record.addresses.ConfidentialRequestBook;
  const acl = useAcl(session, desiredHandle);
  useRevealed();
  const value = recall(desiredHandle);

  const plaintext = useMemo(
    () => ({
      desiredAssets: parseUnits(desired || "0", UNDERLYING_DECIMALS),
      minimumAssets: parseUnits(minimum || "0", UNDERLYING_DECIMALS),
      maxRateIndexes: [Number(maxRate || 0), Number(maxRate || 0)],
      enabledFlags: [1, 1],
      preferredMaturityIndex: 1,
    }),
    [desired, minimum, maxRate],
  );

  const preview = useMemo(
    () => requestDisclosure(session.account, UNIVERSE, bondWei, Number(expiresAt ?? 0n), plaintext),
    [session.account, bondWei, expiresAt, plaintext],
  );

  const refresh = useCallback(async () => {
    const minimumBond = (await session.publicClient.readContract({
      address: book,
      abi: REQUEST_BOOK_ABI,
      functionName: "MIN_BOND_WEI",
    })) as bigint;
    setBondWei(minimumBond * 2n);

    // The chain's own clock, not the browser's. An expiry judged against a local clock would be a
    // verdict about the reader's machine, and the two disagree on a local node by construction.
    const block = await session.publicClient.getBlock();
    setChainNow(block.timestamp);

    const live = (await session.publicClient.readContract({
      address: book,
      abi: REQUEST_BOOK_ABI,
      functionName: "liveRequest",
      args: [session.account, UNIVERSE],
    })) as `0x${string}`;

    if (/^0x0+$/.test(live)) {
      setRequestId(undefined);
      setDesiredHandle(undefined);
      setExpiresAt(undefined);
      return;
    }
    setRequestId(live);

    const [request, handles] = await Promise.all([
      session.publicClient.readContract({
        address: book,
        abi: REQUEST_BOOK_ABI,
        functionName: "requestOf",
        args: [live],
      }) as Promise<{ expiresAt: bigint; bondWei: bigint }>,
      session.publicClient.readContract({
        address: book,
        abi: REQUEST_BOOK_ABI,
        functionName: "handlesOf",
        args: [live],
      }) as Promise<{ desiredAssets: `0x${string}` }>,
    ]);
    setExpiresAt(request.expiresAt);
    setDesiredHandle(handles.desiredAssets);
  }, [session, book]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function submit(): Promise<void> {
    setBusy(true);
    setFailure(undefined);
    try {
      setPhase("encrypting");
      const encoded = await encryptRequest(session.nox, book, plaintext);

      const nonce = (await session.publicClient.readContract({
        address: book,
        abi: REQUEST_BOOK_ABI,
        functionName: "nextNonce",
        args: [session.account],
      })) as bigint;

      setPhase("awaiting-signature");
      const hash = await session.walletClient.writeContract({
        address: book,
        abi: REQUEST_BOOK_ABI,
        functionName: "submitRequest",
        args: [
          UNIVERSE,
          encoded.struct,
          encoded.proofs,
          LIFETIME_SECONDS,
          true,
          `0x${"00".repeat(32)}` as `0x${string}`,
          nonce,
        ],
        value: bondWei,
        account: session.account,
        chain: null,
      } as never);

      setPhase("transaction-pending");
      await session.publicClient.waitForTransactionReceipt({ hash });
      setPhase("encrypted-input-accepted");
      await refresh();
      setPhase("done");
    } catch (error) {
      setFailure(classifyFailure(error));
      setPhase("failed");
    } finally {
      setBusy(false);
    }
  }

  async function cancel(): Promise<void> {
    if (requestId === undefined) return;
    setBusy(true);
    setFailure(undefined);
    try {
      setPhase("awaiting-signature");
      const hash = await session.walletClient.writeContract({
        address: book,
        abi: REQUEST_BOOK_ABI,
        functionName: "cancelUnsealedRequest",
        args: [requestId],
        account: session.account,
        chain: null,
      });
      setPhase("transaction-pending");
      await session.publicClient.waitForTransactionReceipt({ hash });
      await refresh();
      setPhase("cancelled");
    } catch (error) {
      setFailure(classifyFailure(error));
      setPhase("failed");
    } finally {
      setBusy(false);
    }
  }

  async function decrypt(): Promise<void> {
    if (desiredHandle === undefined) return;
    setBusy(true);
    setFailure(undefined);
    setPhase("runner-queued");
    try {
      remember(desiredHandle, await session.nox.decrypt(desiredHandle));
      setPhase("done");
    } catch (error) {
      setFailure(classifyFailure(error));
      setPhase("failed");
    } finally {
      setBusy(false);
    }
  }

  const expired =
    expiresAt !== undefined && chainNow !== undefined && expiresAt !== 0n && expiresAt <= chainNow;

  return (
    <div className="grid" data-testid="request-band">
      <div className="card">
        <h2>{requestId === undefined ? "Create a request" : "Live request"}</h2>

        <div className="row">
          <div className="field">
            <label htmlFor="req-desired">Desired assets</label>
            <input
              id="req-desired"
              type="text"
              value={desired}
              onChange={(event) => setDesired(event.target.value)}
              data-testid="request-desired"
            />
          </div>
          <div className="field">
            <label htmlFor="req-minimum">Minimum acceptable</label>
            <input
              id="req-minimum"
              type="text"
              value={minimum}
              onChange={(event) => setMinimum(event.target.value)}
              data-testid="request-minimum"
            />
          </div>
        </div>
        <div className="row">
          <div className="field">
            <label htmlFor="req-rate">Maximum rate index</label>
            <input
              id="req-rate"
              type="text"
              value={maxRate}
              onChange={(event) => setMaxRate(event.target.value)}
              data-testid="request-rate"
            />
          </div>
          <div className="field">
            <label htmlFor="req-bond">Bond (public)</label>
            <input id="req-bond" type="text" readOnly value={`${formatEther(bondWei)} ETH`} />
          </div>
        </div>

        <BoundaryPreview preview={preview} action="request" testId="request-boundary" />

        <div className="actions">
          {requestId === undefined ? (
            <button
              type="button"
              className="primary"
              onClick={() => void submit()}
              disabled={busy}
              data-testid="request-submit"
            >
              Submit encrypted request with bond
            </button>
          ) : (
            <button
              type="button"
              onClick={() => void cancel()}
              disabled={busy}
              data-testid="request-cancel"
            >
              Cancel while unsealed and recover the full bond
            </button>
          )}
        </div>

        <Status
          phase={expired && phase === "idle" ? "expired" : phase}
          failure={failure}
          testId="request-status"
        />
      </div>

      <div className="card">
        <h2>Your request</h2>
        <table>
          <tbody>
            <tr>
              <th>Request</th>
              <td className="handle" data-testid="request-id">
                {requestId ?? "not recorded"}
              </td>
            </tr>
            <tr>
              <th>Expires at</th>
              <td className="numeric" data-testid="request-expiry">
                {expiresAt === undefined ? "not recorded" : formatTimestamp(expiresAt)}
              </td>
            </tr>
            <tr>
              <th>Judged against</th>
              <td className="numeric">
                {chainNow === undefined
                  ? "not recorded"
                  : `${formatTimestamp(chainNow)} (chain clock)`}
              </td>
            </tr>
          </tbody>
        </table>

        {expired ? (
          <p className="note" data-testid="request-expired-note">
            The window closed. Nothing was refused and nothing failed. An expired request simply
            cannot be sealed into an epoch, and submitting the same one again will not reopen it.
          </p>
        ) : null}

        <div style={{ marginTop: 16 }}>
          <ConfidentialValue
            title="Desired assets"
            handle={desiredHandle}
            acl={acl}
            value={value}
            decimals={UNDERLYING_DECIMALS}
            onDecrypt={() => void decrypt()}
            busy={busy}
            testId="request-desired-value"
          />
        </div>
      </div>
    </div>
  );
}
