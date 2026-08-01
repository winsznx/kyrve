/**
 * `/app/mandates` — what a provider will lend, encrypted.
 *
 * ════════════════════════════════════════════════════════════════════════════════════════════
 * THE SHAPE OF A MANDATE IS NOT READABLE FROM THE TRANSACTION
 * ════════════════════════════════════════════════════════════════════════════════════════════
 *
 * Every submission carries the same 35 handles whether one market is enabled or eight. Unused slots
 * hold encrypted zeros, which is what makes the shape uninformative — and it is also why the form
 * cannot offer "add another market" as a way to send fewer handles. The count is fixed by the schema,
 * not by the input.
 *
 * ════════════════════════════════════════════════════════════════════════════════════════════
 * THREE LIFECYCLE ACTIONS AND ONLY ONE IS REVERSIBLE
 * ════════════════════════════════════════════════════════════════════════════════════════════
 *
 *   replace   opens a NEW epoch. The previous epoch stops authorising activity, and its handles are
 *             not destroyed and cannot be. Anyone who could already decrypt them still can,
 *             permanently. This interface does not call that "revoked".
 *   pause     stops the mandate being quoted against, and resumes on the same epoch.
 *   retire    TERMINAL. `mandateId` is deterministic in (provider, universe), so a retired mandate's
 *             identifier can never be reused and no new mandate for the same pair can be created.
 *             That is stated before the click, because the contract will not say it after.
 */

import { encryptMandate, mandateDisclosure } from "@kyrve/nox";
import { type ReactElement, useCallback, useEffect, useMemo, useState } from "react";
import { parseUnits } from "viem";

import { BoundaryPreview } from "../components/BoundaryPreview.js";
import { ConfidentialValue } from "../components/ConfidentialValue.js";
import { Facts } from "../components/Facts.js";
import { RequiresWallet } from "../components/RequiresWallet.js";
import { classifyFailure, type FailureKind, type Phase, Status } from "../components/Status.js";
import { Why } from "../components/Why.js";
import { MANDATE_BOOK_ABI, MANDATE_STATE_LABEL, MandateState } from "../lib/abi.js";
import { useKyrve } from "../lib/context.js";
import { recall, remember, type Session, useRevealed } from "../lib/session.js";
import { UNIVERSE } from "../lib/universe.js";
import { Link } from "../router/router.js";
import { useAcl } from "./Fund.js";

const UNDERLYING_DECIMALS = 6;

interface Failure {
  readonly kind: FailureKind;
  readonly detail: string;
}

export function Mandates(): ReactElement {
  const { record } = useKyrve();

  return (
    <>
      <section className="band">
        <span className="eyebrow">Provider · Step 2</span>
        <h1>Set lending terms</h1>
        <p className="lede">
          A mandate says how much you will lend, into which markets, and at what minimum rate. All
          of it is encrypted. The submission always carries the same 35 handles whether you enable
          one market or eight. The unused slots hold encrypted zeros, so the shape of your mandate
          is not readable from the transaction.
        </p>
        <details className="route-meta">
          <summary>Submission details</summary>
          <Facts
            facts={[
              {
                label: "Mandate book",
                value: <span className="mono">{record.addresses.EncryptedMandateBook}</span>,
              },
              { label: "Universe", value: <span className="mono">{UNIVERSE}</span> },
              { label: "Handles per submission", value: "35, always" },
            ]}
          />
        </details>
      </section>

      <section className="band">
        <RequiresWallet purpose="submit, replace or retire an encrypted mandate">
          {(session) => <MandatePanel session={session} />}
        </RequiresWallet>
      </section>

      <section className="band">
        <div className="card route-next">
          <span className="eyebrow">After you submit</span>
          <h2>Your terms wait for a matching run</h2>
          <p className="lede">
            A mandate is an offer to the curve engine, not a reservation. Capacity is reserved only
            when an epoch runs and selects a leaf. A reservation moves real capital out of your
            confidential balance in one subtraction, in the same contract that holds the coverage
            backing it.
          </p>
          <Link to="/app/curve" className="ghost">
            View matching status
          </Link>
        </div>
      </section>

      <section className="band">
        <Why title="Every mandate is the same size, whatever you put in it">
          <p>
            A submission carries 35 encrypted fields whether you enable one market or eight. The
            unused slots hold encrypted zeros, so the shape of your strategy cannot be read from the
            transaction the way it could if the payload grew with your appetite.
          </p>
          <p>
            Retiring is terminal for a related reason. The identifier is derived from your address
            and the market, so it can never be reused, and a retired epoch’s handles could otherwise
            be confused with a live one’s. Pausing is the reversible action.
          </p>
        </Why>
      </section>
    </>
  );
}

function MandatePanel({ session }: { session: Session }): ReactElement {
  const { record } = useKyrve();
  const [budget, setBudget] = useState("5000");
  const [capA, setCapA] = useState("2000");
  const [capB, setCapB] = useState("1500");
  const [minRateA, setMinRateA] = useState("12");
  const [minRateB, setMinRateB] = useState("18");
  const [mandateId, setMandateId] = useState<`0x${string}`>();
  const [epoch, setEpoch] = useState<number>();
  const [state, setState] = useState<MandateState>(MandateState.None);
  const [budgetHandle, setBudgetHandle] = useState<`0x${string}`>();
  const [phase, setPhase] = useState<Phase>("idle");
  const [failure, setFailure] = useState<Failure>();
  const [busy, setBusy] = useState(false);
  const [confirmRetire, setConfirmRetire] = useState(false);

  const book = record.addresses.EncryptedMandateBook;
  const acl = useAcl(session, budgetHandle);
  useRevealed();
  const value = recall(budgetHandle);

  const plaintext = useMemo(
    () => ({
      totalBudget: parseUnits(budget || "0", UNDERLYING_DECIMALS),
      marketCaps: [
        parseUnits(capA || "0", UNDERLYING_DECIMALS),
        parseUnits(capB || "0", UNDERLYING_DECIMALS),
      ],
      minRateIndexes: [Number(minRateA || 0), Number(minRateB || 0)],
      enabledFlags: [1, 1],
      collateralFamilyCaps: [parseUnits(capA || "0", UNDERLYING_DECIMALS)],
      maturityBucketCaps: [parseUnits(capB || "0", UNDERLYING_DECIMALS)],
      maxDurationIndex: 3,
      allocationWeight: 100,
    }),
    [budget, capA, capB, minRateA, minRateB],
  );

  const preview = useMemo(
    () => mandateDisclosure(session.account, UNIVERSE, (epoch ?? 0) + 1, plaintext),
    [session.account, epoch, plaintext],
  );

  const refresh = useCallback(async () => {
    const id = (await session.publicClient.readContract({
      address: book,
      abi: MANDATE_BOOK_ABI,
      functionName: "mandateIdFor",
      args: [session.account, UNIVERSE],
    })) as `0x${string}`;
    setMandateId(id);

    const mandate = (await session.publicClient.readContract({
      address: book,
      abi: MANDATE_BOOK_ABI,
      functionName: "mandateOf",
      args: [id],
    })) as { provider: `0x${string}`; activeEpoch: number; state: number };

    if (mandate.provider === "0x0000000000000000000000000000000000000000") {
      setEpoch(undefined);
      setBudgetHandle(undefined);
      setState(MandateState.None);
      return;
    }
    setEpoch(mandate.activeEpoch);
    setState(mandate.state as MandateState);

    const handles = (await session.publicClient.readContract({
      address: book,
      abi: MANDATE_BOOK_ABI,
      functionName: "handlesOf",
      args: [id, mandate.activeEpoch],
    })) as { totalBudget: `0x${string}` };
    setBudgetHandle(handles.totalBudget);
  }, [session, book]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function submit(): Promise<void> {
    setBusy(true);
    setFailure(undefined);
    try {
      setPhase("encrypting");
      const encoded = await encryptMandate(session.nox, book, plaintext);

      const nonce = (await session.publicClient.readContract({
        address: book,
        abi: MANDATE_BOOK_ABI,
        functionName: "nextNonce",
        args: [session.account],
      })) as bigint;

      setPhase("awaiting-signature");
      const existing = epoch !== undefined && mandateId !== undefined;
      const hash = await session.walletClient.writeContract({
        address: book,
        abi: MANDATE_BOOK_ABI,
        functionName: existing ? "replaceMandate" : "submitMandate",
        args: existing
          ? [mandateId, encoded.struct, encoded.proofs, nonce]
          : [UNIVERSE, encoded.struct, encoded.proofs, nonce],
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

  /** Pause, resume or retire. One write, one receipt, one re-read of chain state. */
  async function lifecycle(
    functionName: "pauseMandate" | "resumeMandate" | "retireMandate",
  ): Promise<void> {
    if (mandateId === undefined) return;
    setBusy(true);
    setFailure(undefined);
    try {
      setPhase("awaiting-signature");
      const hash = await session.walletClient.writeContract({
        address: book,
        abi: MANDATE_BOOK_ABI,
        functionName,
        args: [mandateId],
        account: session.account,
        chain: null,
      });
      setPhase("transaction-pending");
      await session.publicClient.waitForTransactionReceipt({ hash });
      await refresh();
      setPhase(functionName === "retireMandate" ? "cancelled" : "done");
      setConfirmRetire(false);
    } catch (error) {
      setFailure(classifyFailure(error));
      setPhase("failed");
    } finally {
      setBusy(false);
    }
  }

  async function decrypt(): Promise<void> {
    if (budgetHandle === undefined) return;
    setBusy(true);
    setFailure(undefined);
    setPhase("runner-queued");
    try {
      remember(budgetHandle, await session.nox.decrypt(budgetHandle));
      setPhase("done");
    } catch (error) {
      setFailure(classifyFailure(error));
      setPhase("failed");
    } finally {
      setBusy(false);
    }
  }

  const retired = state === MandateState.Retired;

  return (
    <div className="grid" data-testid="mandate-band">
      <div className="card">
        <h2>{epoch === undefined ? "Create a mandate" : `Replace mandate: epoch ${epoch}`}</h2>

        <div className="row">
          <div className="field">
            <label htmlFor="mandate-budget">Total budget</label>
            <input
              id="mandate-budget"
              type="text"
              inputMode="decimal"
              value={budget}
              onChange={(event) => setBudget(event.target.value)}
              data-testid="mandate-budget"
            />
          </div>
        </div>
        <div className="row">
          <div className="field">
            <label htmlFor="cap-a">Market 0 cap</label>
            <input
              id="cap-a"
              type="text"
              value={capA}
              onChange={(event) => setCapA(event.target.value)}
              data-testid="mandate-cap-0"
            />
          </div>
          <div className="field">
            <label htmlFor="rate-a">Market 0 minimum rate index</label>
            <input
              id="rate-a"
              type="text"
              value={minRateA}
              onChange={(event) => setMinRateA(event.target.value)}
              data-testid="mandate-rate-0"
            />
          </div>
        </div>
        <div className="row">
          <div className="field">
            <label htmlFor="cap-b">Market 1 cap</label>
            <input
              id="cap-b"
              type="text"
              value={capB}
              onChange={(event) => setCapB(event.target.value)}
              data-testid="mandate-cap-1"
            />
          </div>
          <div className="field">
            <label htmlFor="rate-b">Market 1 minimum rate index</label>
            <input
              id="rate-b"
              type="text"
              value={minRateB}
              onChange={(event) => setMinRateB(event.target.value)}
              data-testid="mandate-rate-1"
            />
          </div>
        </div>

        <BoundaryPreview preview={preview} action="submission" testId="mandate-boundary" />

        <div className="actions">
          <button
            type="button"
            className="primary"
            onClick={() => void submit()}
            disabled={busy || retired}
            data-testid="mandate-submit"
          >
            {epoch === undefined ? "Seal encrypted mandate" : "Replace: opens a new epoch"}
          </button>
        </div>

        {retired ? (
          <p className="note" data-testid="mandate-retired-note">
            This mandate is retired, permanently. <code>mandateId</code> is deterministic in your
            address and this universe, so the identifier cannot be reused and a new mandate for the
            same pair cannot be created — which is deliberate: reusing it would let a retired
            epoch's handles be confused with a live one's.
          </p>
        ) : null}

        <Status phase={phase} failure={failure} testId="mandate-status" />
      </div>

      <div className="card">
        <h2>Your mandate</h2>
        <table>
          <tbody>
            <tr>
              <th>Mandate</th>
              <td className="handle" data-testid="mandate-id">
                {mandateId ?? "not recorded"}
              </td>
            </tr>
            <tr>
              <th>Active epoch</th>
              <td className="numeric" data-testid="mandate-epoch">
                {epoch ?? "none"}
              </td>
            </tr>
            <tr>
              <th>State</th>
              <td data-testid="mandate-state">{MANDATE_STATE_LABEL[state]}</td>
            </tr>
          </tbody>
        </table>

        {epoch !== undefined && epoch > 1 ? (
          <p className="note" data-testid="epoch-note">
            Epoch {epoch - 1} no longer authorises any activity. Its handles were not destroyed and
            cannot be withdrawn. Anyone who could already decrypt them still can, permanently. Kyrve
            does not describe that as revoked.
          </p>
        ) : null}

        <div style={{ marginTop: 16 }}>
          <ConfidentialValue
            title="Total budget"
            handle={budgetHandle}
            acl={acl}
            value={value}
            decimals={UNDERLYING_DECIMALS}
            onDecrypt={() => void decrypt()}
            busy={busy}
            testId="mandate-budget-value"
          />
        </div>

        {mandateId === undefined || state === MandateState.None ? null : (
          <div className="actions">
            {state === MandateState.Paused ? (
              <button
                type="button"
                onClick={() => void lifecycle("resumeMandate")}
                disabled={busy}
                data-testid="mandate-resume"
              >
                Resume on epoch {epoch}
              </button>
            ) : (
              <button
                type="button"
                onClick={() => void lifecycle("pauseMandate")}
                disabled={busy || retired}
                data-testid="mandate-pause"
              >
                Pause: stops being quoted against
              </button>
            )}

            {retired ? null : confirmRetire ? (
              <button
                type="button"
                onClick={() => void lifecycle("retireMandate")}
                disabled={busy}
                data-testid="mandate-retire-confirm"
              >
                Retire permanently: this cannot be undone
              </button>
            ) : (
              <button
                type="button"
                onClick={() => setConfirmRetire(true)}
                disabled={busy}
                data-testid="mandate-retire"
              >
                Retire this mandate
              </button>
            )}
          </div>
        )}

        {confirmRetire && !retired ? (
          <div className="reveal-warning" role="alert" data-testid="mandate-retire-warning">
            <strong>Retiring is terminal and there is no recovery</strong>
            <p>
              A retired mandate cannot be resumed or replaced, and a new mandate for this address
              and this universe cannot be created afterwards because the identifier is deterministic
              in both. Pausing is the reversible action; this one is not.
            </p>
          </div>
        ) : null}
      </div>
    </div>
  );
}
