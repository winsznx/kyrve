/**
 * `/app/fund` — the public boundary going in.
 *
 * ════════════════════════════════════════════════════════════════════════════════════════════
 * THE ONE PLACE A VALUE CROSSES THE LINE IN THIS DIRECTION
 * ════════════════════════════════════════════════════════════════════════════════════════════
 *
 * Wrapping moves a public ERC-20 balance into a confidential ERC-7984 one. The amount wrapped is a
 * plain `uint256` in calldata and is public permanently. That is unavoidable from a public token, and
 * it is the honest cost of entering the confidential layer — so it is named at the point of action, in
 * a warning with no toggle, no `<details>` and no dismiss control.
 *
 * Unwrapping later is the same crossing in reverse and is worse: it marks the burn amount publicly
 * decryptable, and Nox has no un-publish. The warning says so rather than mentioning it on a later
 * screen the reader may never reach.
 *
 * Every balance here is a real handle read from the chain. A value this wallet cannot read renders as
 * redacted structure, never as a zero: showing "0" for something encrypted would be a claim about its
 * contents.
 */

import { type HandleAcl, readAcl } from "@kyrve/nox";
import { type ReactElement, useCallback, useEffect, useState } from "react";
import { parseUnits } from "viem";

import { ConfidentialValue } from "../components/ConfidentialValue.js";
import { Facts } from "../components/Facts.js";
import { RequiresWallet } from "../components/RequiresWallet.js";
import { classifyFailure, type FailureKind, type Phase, Status } from "../components/Status.js";
import { ERC20_ABI, WRAPPED_ASSET_ABI } from "../lib/abi.js";
import { formatAmount } from "../lib/chain.js";
import { useKyrve } from "../lib/context.js";
import { recall, remember, type Session, useRevealed } from "../lib/session.js";
import { Link } from "../router/router.js";

const UNDERLYING_DECIMALS = 6;

interface Failure {
  readonly kind: FailureKind;
  readonly detail: string;
}

/** Reads the ACL for a handle whenever it changes. Authorisation is never assumed. */
export function useAcl(session: Session, handle: `0x${string}` | undefined): HandleAcl | undefined {
  const [acl, setAcl] = useState<HandleAcl>();
  useEffect(() => {
    if (handle === undefined || /^0x0+$/.test(handle)) {
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
  return acl;
}

export function Fund(): ReactElement {
  const { record } = useKyrve();

  return (
    <>
      <section className="band">
        <span className="eyebrow">Provider · step one</span>
        <h1>Confidential balance</h1>
        <p className="lede">
          Wrapping moves a public ERC-20 balance into a confidential ERC-7984 one. The amount you
          wrap is a plain <code>uint256</code> in calldata and is public permanently — that is
          unavoidable, and it is the honest cost of entering the confidential layer from a public
          token. Everything after it is encrypted.
        </p>
        <Facts
          facts={[
            {
              label: "Public test token",
              value: <span className="mono">{record.addresses.TestUnderlyingERC20}</span>,
            },
            {
              label: "Confidential wrapper",
              value: <span className="mono">{record.addresses.KyrveWrappedAsset}</span>,
            },
            {
              label: "Custody vault",
              value: <span className="mono">{record.addresses.KyrveConfidentialAssetVault}</span>,
            },
          ]}
        />
        <p className="note">
          The wrapper wraps the market's own loan token. Three phases tolerated two test tokens
          because nothing crossed back; the moment one did, activation reverted with a funding
          shortfall on a run where every encrypted step had succeeded (delta T-10).
        </p>
      </section>

      <section className="band">
        <RequiresWallet purpose="wrap and read your own confidential balance">
          {(session) => <WrapPanel session={session} />}
        </RequiresWallet>
      </section>

      <section className="band">
        <div className="card">
          <h2>Next</h2>
          <p className="lede">
            A confidential balance is capital, not a commitment. A mandate is what tells the curve
            engine how much of it you will lend, into which markets, and at what minimum rate.
          </p>
          <Link to="/app/mandates" className="ghost">
            Submit a lending mandate
          </Link>
        </div>
      </section>
    </>
  );
}

function WrapPanel({ session }: { session: Session }): ReactElement {
  const { record } = useKyrve();
  const [amount, setAmount] = useState("1000");
  const [publicBalance, setPublicBalance] = useState<bigint>();
  const [handle, setHandle] = useState<`0x${string}`>();
  const [phase, setPhase] = useState<Phase>("idle");
  const [failure, setFailure] = useState<Failure>();
  const [busy, setBusy] = useState(false);

  const asset = record.addresses.KyrveWrappedAsset;
  const underlying = record.addresses.TestUnderlyingERC20;
  const acl = useAcl(session, handle);
  useRevealed();
  const value = recall(handle);

  const refresh = useCallback(async () => {
    const [publicSide, confidential] = await Promise.all([
      session.publicClient.readContract({
        address: underlying,
        abi: ERC20_ABI,
        functionName: "balanceOf",
        args: [session.account],
      }),
      session.publicClient.readContract({
        address: asset,
        abi: WRAPPED_ASSET_ABI,
        functionName: "confidentialBalanceOf",
        args: [session.account],
      }),
    ]);
    setPublicBalance(publicSide as bigint);
    setHandle(confidential as `0x${string}`);
  }, [session, asset, underlying]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function wrap(): Promise<void> {
    setBusy(true);
    setFailure(undefined);
    try {
      const units = parseUnits(amount, UNDERLYING_DECIMALS);

      setPhase("awaiting-signature");
      const mintHash = await session.walletClient.writeContract({
        address: underlying,
        abi: ERC20_ABI,
        functionName: "mint",
        args: [session.account, units],
        account: session.account,
        chain: null,
      });
      await session.publicClient.waitForTransactionReceipt({ hash: mintHash });

      const approveHash = await session.walletClient.writeContract({
        address: underlying,
        abi: ERC20_ABI,
        functionName: "approve",
        args: [asset, units],
        account: session.account,
        chain: null,
      });
      await session.publicClient.waitForTransactionReceipt({ hash: approveHash });

      setPhase("transaction-pending");
      const wrapHash = await session.walletClient.writeContract({
        address: asset,
        abi: WRAPPED_ASSET_ABI,
        functionName: "wrap",
        args: [session.account, units],
        account: session.account,
        chain: null,
      });
      await session.publicClient.waitForTransactionReceipt({ hash: wrapHash });

      setPhase("event-confirmed");
      await refresh();
      setPhase("done");
    } catch (error) {
      setFailure(classifyFailure(error));
      setPhase("failed");
    } finally {
      setBusy(false);
    }
  }

  async function decrypt(): Promise<void> {
    if (handle === undefined) return;
    setBusy(true);
    setFailure(undefined);
    setPhase("runner-queued");
    try {
      const plaintext = await session.nox.decrypt(handle);
      // Straight into the in-memory map. Not logged, not stored, not sent anywhere.
      remember(handle, plaintext);
      setPhase("done");
    } catch (error) {
      setFailure(classifyFailure(error));
      setPhase("failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid" data-testid="wrap-band">
      <div className="card">
        <h2>Wrap</h2>
        <div className="row">
          <div className="field">
            <label htmlFor="wrap-amount">Amount to wrap (tUSDC)</label>
            <input
              id="wrap-amount"
              type="text"
              inputMode="decimal"
              value={amount}
              onChange={(event) => setAmount(event.target.value)}
              data-testid="wrap-amount"
            />
          </div>
          <button
            type="button"
            className="primary"
            onClick={() => void wrap()}
            disabled={busy}
            data-testid="wrap-submit"
          >
            Wrap — this amount becomes public
          </button>
        </div>

        <div className="reveal-warning" role="alert">
          <strong>This crosses the public boundary</strong>
          <p>
            The amount above appears in the transaction and stays readable by anyone, forever.
            Unwrapping later is the same crossing in reverse: it marks the burn amount publicly
            decryptable, and Nox has no un-publish.
          </p>
        </div>

        <table>
          <tbody>
            <tr>
              <th>Public tUSDC balance</th>
              <td className="numeric" data-testid="public-balance">
                {publicBalance === undefined
                  ? "—"
                  : formatAmount(publicBalance, UNDERLYING_DECIMALS)}
              </td>
            </tr>
          </tbody>
        </table>

        <Status phase={phase} failure={failure} testId="wrap-status" />
      </div>

      <div className="card">
        <h2>Private balance</h2>
        <ConfidentialValue
          title="Confidential balance"
          handle={handle}
          acl={acl}
          value={value}
          decimals={UNDERLYING_DECIMALS}
          onDecrypt={() => void decrypt()}
          busy={busy}
          testId="private-balance"
        />
        <p className="note">
          Decrypted in this browser and held in memory only. No Kyrve server, log, metric or
          database receives it. Locking the session clears it immediately — and revokes nothing,
          because Nox has no grant to withdraw.
        </p>
      </div>
    </div>
  );
}
