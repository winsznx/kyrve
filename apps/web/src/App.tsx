/**
 * The Kyrve local confidential terminal.
 *
 * Five things, each of which exercises a real contract against a real Nox stack:
 *
 *   1. wrap public test USDC into a confidential balance   — the public boundary going in
 *   2. read and decrypt that private balance                — client-side, and only by its owner
 *   3. create and view an encrypted mandate                 — 35 handles, one epoch
 *   4. create and view an encrypted borrower request        — 19 handles, a public bond
 *   5. preview the public/private boundary before signing   — on every submission
 *
 * Nothing here is a mock. Every balance is a real handle read from the chain, every decryption is a
 * real gateway round trip authorised by a real on-chain ACL check, and a value this wallet cannot
 * read renders as redacted structure rather than as a zero.
 */

import {
  encryptMandate,
  encryptRequest,
  type HandleAcl,
  mandateDisclosure,
  readAcl,
  requestDisclosure,
} from "@kyrve/nox";
import { useCallback, useEffect, useMemo, useState } from "react";
import { formatEther, parseUnits } from "viem";

import { BoundaryPreview } from "./components/BoundaryPreview.js";
import { ConfidentialValue } from "./components/ConfidentialValue.js";
import { QuoteBand } from "./components/QuoteBand.js";
import { classifyFailure, type FailureKind, type Phase, Status } from "./components/Status.js";
import { ERC20_ABI, MANDATE_BOOK_ABI, REQUEST_BOOK_ABI, WRAPPED_ASSET_ABI } from "./lib/abi.js";
import { type Deployment, loadDeployment, noxNetworkFor } from "./lib/deployment.js";
import {
  lock,
  openSession,
  recall,
  remember,
  revealedCount,
  type Session,
  subscribe,
} from "./lib/session.js";
import type { SettlementDeployment } from "./lib/settlement.js";

const UNDERLYING_DECIMALS = 6;
/** The single public universe this local terminal quotes into. */
const UNIVERSE = `0x${"11".repeat(32)}` as `0x${string}`;

interface Failure {
  readonly kind: FailureKind;
  readonly detail: string;
}

export function App(): React.ReactElement {
  const [deployment, setDeployment] = useState<Deployment>();
  const [session, setSession] = useState<Session>();
  const [bootError, setBootError] = useState<string>();
  const [, forceRender] = useState(0);

  useEffect(() => subscribe(() => forceRender((n) => n + 1)), []);

  useEffect(() => {
    void (async () => {
      try {
        const record = await loadDeployment();
        setDeployment(record);
        const rpcUrl = window.__KYRVE_RPC_URL__ ?? "http://127.0.0.1:8545";
        const network = noxNetworkFor(record, window.__KYRVE_NOX_GATEWAY__ ?? undefined);
        setSession(await openSession(network, rpcUrl));
      } catch (error) {
        setBootError(error instanceof Error ? error.message : String(error));
      }
    })();
  }, []);

  if (bootError !== undefined) {
    return (
      <main className="page">
        <header className="masthead">
          <div className="wordmark">kyrve</div>
          <div className="tagline">One quote. The curve stays private.</div>
        </header>
        <section className="band">
          <div className="card">
            <h2>The terminal cannot start</h2>
            <p className="lede" data-testid="boot-error">
              {bootError}
            </p>
            <p className="lede">
              It refuses to start rather than pointing somewhere else. A confidential terminal
              showing a balance from a deployment that no longer exists is worse than one that does
              not open.
            </p>
          </div>
        </section>
      </main>
    );
  }

  if (deployment === undefined || session === undefined) {
    return (
      <main className="page">
        <header className="masthead">
          <div className="wordmark">kyrve</div>
        </header>
        <section className="band">
          <div className="card" data-testid="booting">
            <h2>Connecting</h2>
            <p className="lede">
              Reading the deployment record, then binding a handle client to this wallet.
            </p>
          </div>
        </section>
      </main>
    );
  }

  return <Terminal deployment={deployment} session={session} />;
}

function Terminal({
  deployment,
  session,
}: {
  deployment: Deployment;
  session: Session;
}): React.ReactElement {
  const settlement = settlementOf(deployment);

  return (
    <main className="page">
      <header className="masthead">
        <div>
          <div className="wordmark">kyrve</div>
          <div className="tagline">One quote. The curve stays private.</div>
        </div>
        <div className="tagline" data-testid="session">
          {deployment.environment} · chain {deployment.chainId} ·{" "}
          <span className="handle">{session.account}</span>
        </div>
      </header>

      <PrivacyLock />
      <WrapBand deployment={deployment} session={session} />
      <MandateBand deployment={deployment} session={session} />
      <RequestBand deployment={deployment} session={session} />
      {settlement !== undefined ? <QuoteBand settlement={settlement} session={session} /> : null}

      <section className="band">
        <div className="card">
          <h3>Licence disclosure</h3>
          <p className="lede" data-testid="disclosure">
            {deployment.disclosure}
          </p>
        </div>
      </section>
    </main>
  );
}

/**
 * The settlement block, or nothing.
 *
 * A quote exists only after a confidential epoch has run and been publicly decrypted — minutes of
 * off-chain computation the page cannot bootstrap. So the band appears when the served record
 * carries a real finished epoch and is absent otherwise. Rendering it with placeholder terms would
 * be a placeholder proof, which `.claude/rules/frontend.md` forbids outright.
 */
function settlementOf(deployment: Deployment) {
  return (deployment as SettlementDeployment).settlement;
}

function PrivacyLock(): React.ReactElement {
  const count = revealedCount();
  return (
    <section className="band">
      <div className="card">
        <h2>Privacy lock</h2>
        <p className="lede">
          {count === 0
            ? "No decrypted value is held in memory."
            : `${count} decrypted value${count === 1 ? "" : "s"} held in this browser's memory, and nowhere else.`}{" "}
          Locking clears them immediately. It does not revoke anything — every grant this wallet
          already holds stays in place, permanently, because Nox has no way to withdraw one.
        </p>
        <button type="button" onClick={() => lock()} disabled={count === 0} data-testid="lock">
          Lock and clear {count} decrypted value{count === 1 ? "" : "s"}
        </button>
      </div>
    </section>
  );
}

/** Reads the ACL for a handle whenever it changes. Authorisation is never assumed. */
function useAcl(session: Session, handle: `0x${string}` | undefined): HandleAcl | undefined {
  const [acl, setAcl] = useState<HandleAcl>();
  useEffect(() => {
    if (handle === undefined || /^0x0+$/.test(handle)) {
      setAcl(undefined);
      return;
    }
    void readAcl(session.publicClient, session.network, handle, session.account)
      .then(setAcl)
      .catch(() => setAcl(undefined));
  }, [session, handle]);
  return acl;
}

function WrapBand({
  deployment,
  session,
}: {
  deployment: Deployment;
  session: Session;
}): React.ReactElement {
  const [amount, setAmount] = useState("1000");
  const [publicBalance, setPublicBalance] = useState<bigint>();
  const [handle, setHandle] = useState<`0x${string}`>();
  const [phase, setPhase] = useState<Phase>("idle");
  const [failure, setFailure] = useState<Failure>();
  const [busy, setBusy] = useState(false);

  const asset = deployment.addresses.KyrveWrappedAsset;
  const underlying = deployment.addresses.TestUnderlyingERC20;
  const acl = useAcl(session, handle);
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

      setPhase("submitted");
      const wrapHash = await session.walletClient.writeContract({
        address: asset,
        abi: WRAPPED_ASSET_ABI,
        functionName: "wrap",
        args: [session.account, units],
        account: session.account,
        chain: null,
      });
      await session.publicClient.waitForTransactionReceipt({ hash: wrapHash });

      setPhase("confirmed");
      await refresh();
      setPhase("done");
    } catch (error) {
      setFailure(classifyFailure(error));
      setPhase("idle");
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
      setPhase("idle");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="band" data-testid="wrap-band">
      <h2>Confidential balance</h2>
      <p className="lede">
        Wrapping moves a public ERC-20 balance into a confidential ERC-7984 one. The amount you wrap
        is a plain <code>uint256</code> in calldata and is public permanently — that is unavoidable,
        and it is the honest cost of entering the confidential layer from a public token. Everything
        after it is encrypted.
      </p>

      <div className="grid">
        <div className="card">
          <h3>Wrap</h3>
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
                    : (Number(publicBalance) / 10 ** UNDERLYING_DECIMALS).toFixed(2)}
                </td>
              </tr>
            </tbody>
          </table>

          <Status phase={phase} failure={failure} testId="wrap-status" />
        </div>

        <div className="card">
          <h3>Private balance</h3>
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
        </div>
      </div>
    </section>
  );
}

function MandateBand({
  deployment,
  session,
}: {
  deployment: Deployment;
  session: Session;
}): React.ReactElement {
  const [budget, setBudget] = useState("5000");
  const [capA, setCapA] = useState("2000");
  const [capB, setCapB] = useState("1500");
  const [minRateA, setMinRateA] = useState("12");
  const [minRateB, setMinRateB] = useState("18");
  const [mandateId, setMandateId] = useState<`0x${string}`>();
  const [epoch, setEpoch] = useState<number>();
  const [budgetHandle, setBudgetHandle] = useState<`0x${string}`>();
  const [phase, setPhase] = useState<Phase>("idle");
  const [failure, setFailure] = useState<Failure>();
  const [busy, setBusy] = useState(false);

  const book = deployment.addresses.EncryptedMandateBook;
  const acl = useAcl(session, budgetHandle);
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
      return;
    }
    setEpoch(mandate.activeEpoch);

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

      setPhase("submitted");
      await session.publicClient.waitForTransactionReceipt({ hash });
      setPhase("confirmed");
      await refresh();
      setPhase("done");
    } catch (error) {
      setFailure(classifyFailure(error));
      setPhase("idle");
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
      setPhase("idle");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="band" data-testid="mandate-band">
      <h2>Lending mandate</h2>
      <p className="lede">
        A mandate says how much you will lend, into which markets, and at what minimum rate. All of
        it is encrypted. The submission always carries the same 35 handles whether you enable one
        market or eight — the unused slots hold encrypted zeros, so the shape of your mandate is not
        readable from the transaction.
      </p>

      <div className="grid">
        <div className="card">
          <h3>{epoch === undefined ? "Create a mandate" : `Replace mandate — epoch ${epoch}`}</h3>

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

          <div className="row" style={{ marginTop: 24 }}>
            <button
              type="button"
              className="primary"
              onClick={() => void submit()}
              disabled={busy}
              data-testid="mandate-submit"
            >
              {epoch === undefined ? "Seal encrypted mandate" : "Replace — opens a new epoch"}
            </button>
          </div>

          <Status phase={phase} failure={failure} testId="mandate-status" />
        </div>

        <div className="card">
          <h3>Your mandate</h3>
          <table>
            <tbody>
              <tr>
                <th>Mandate</th>
                <td className="handle" data-testid="mandate-id">
                  {mandateId ?? "—"}
                </td>
              </tr>
              <tr>
                <th>Active epoch</th>
                <td className="numeric" data-testid="mandate-epoch">
                  {epoch ?? "none"}
                </td>
              </tr>
            </tbody>
          </table>

          {epoch !== undefined && epoch > 1 ? (
            <p className="lede" style={{ marginTop: 16 }} data-testid="epoch-note">
              Epoch {epoch - 1} no longer authorises any activity. Its handles were not destroyed
              and cannot be — anyone who could already decrypt them still can, permanently. Kyrve
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
        </div>
      </div>
    </section>
  );
}

function RequestBand({
  deployment,
  session,
}: {
  deployment: Deployment;
  session: Session;
}): React.ReactElement {
  const [desired, setDesired] = useState("1200");
  const [minimum, setMinimum] = useState("1000");
  const [maxRate, setMaxRate] = useState("30");
  const [bondWei, setBondWei] = useState<bigint>(2_000_000_000_000_000n);
  const [requestId, setRequestId] = useState<`0x${string}`>();
  const [desiredHandle, setDesiredHandle] = useState<`0x${string}`>();
  const [expiresAt, setExpiresAt] = useState<number>();
  const [phase, setPhase] = useState<Phase>("idle");
  const [failure, setFailure] = useState<Failure>();
  const [busy, setBusy] = useState(false);

  const book = deployment.addresses.ConfidentialRequestBook;
  const acl = useAcl(session, desiredHandle);
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
    () => requestDisclosure(session.account, UNIVERSE, bondWei, expiresAt ?? 0, plaintext),
    [session.account, bondWei, expiresAt, plaintext],
  );

  const refresh = useCallback(async () => {
    const minimumBond = (await session.publicClient.readContract({
      address: book,
      abi: REQUEST_BOOK_ABI,
      functionName: "MIN_BOND_WEI",
    })) as bigint;
    setBondWei(minimumBond * 2n);

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
    setExpiresAt(Number(request.expiresAt));
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
          3600n,
          true,
          `0x${"00".repeat(32)}` as `0x${string}`,
          nonce,
        ],
        value: bondWei,
        account: session.account,
        chain: null,
      } as never);

      setPhase("submitted");
      await session.publicClient.waitForTransactionReceipt({ hash });
      setPhase("confirmed");
      await refresh();
      setPhase("done");
    } catch (error) {
      setFailure(classifyFailure(error));
      setPhase("idle");
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
      setPhase("submitted");
      await session.publicClient.waitForTransactionReceipt({ hash });
      await refresh();
      setPhase("done");
    } catch (error) {
      setFailure(classifyFailure(error));
      setPhase("idle");
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
      setPhase("idle");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="band" data-testid="request-band">
      <h2>Borrower request</h2>
      <p className="lede">
        A request is asymmetric on purpose. The bond is ETH and its value is visible; the expiry and
        the exact-fill requirement have to be agreed by every verifier. What stays encrypted is the
        part a provider could quote against: how much you want, the least you would accept, and
        every maximum rate you would pay.
      </p>

      <div className="grid">
        <div className="card">
          <h3>{requestId === undefined ? "Create a request" : "Live request"}</h3>

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

          <div className="row" style={{ marginTop: 24 }}>
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
                Cancel and recover the full bond
              </button>
            )}
          </div>

          <Status phase={phase} failure={failure} testId="request-status" />
        </div>

        <div className="card">
          <h3>Your request</h3>
          <table>
            <tbody>
              <tr>
                <th>Request</th>
                <td className="handle" data-testid="request-id">
                  {requestId ?? "—"}
                </td>
              </tr>
              <tr>
                <th>Expires at</th>
                <td className="numeric">{expiresAt ?? "—"}</td>
              </tr>
            </tbody>
          </table>

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
    </section>
  );
}
