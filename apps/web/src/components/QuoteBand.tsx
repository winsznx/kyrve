/**
 * The settlement band: one confidential result becomes one public quote, and settles exactly once.
 *
 * ════════════════════════════════════════════════════════════════════════════════════════════
 * EVERY NUMBER ON THIS PANEL IS READ FROM CHAIN STATE
 * ════════════════════════════════════════════════════════════════════════════════════════════
 *
 * The served record describes a finished EPOCH and carries the gateway proofs. It does not describe
 * a quote, and the panel never treats it as if it did. The selected market and rate, the aggregate
 * fill and the borrower are re-derived by calling `KyrvePublicResultVerifier.verifyForActivation`
 * read-only; the units, buyer assets, expiry and status come from `KyrveQuoteRegistry`; the credit
 * and debt come from Midnight; and the offer is recovered from the `OfferPublished` event.
 *
 * A panel that displayed a script's beliefs would be showing exactly the thing
 * `KyrveSettlementRatifier` exists to catch a mismatch in.
 *
 * ════════════════════════════════════════════════════════════════════════════════════════════
 * THE BOUNDARY, NAMED AT THE POINT OF ACTION
 * ════════════════════════════════════════════════════════════════════════════════════════════
 *
 * Activation is the moment the selected market, the selected rate, the aggregate amount and the
 * approved borrower stop being private. The warning above the activate button says so, is not
 * collapsible, and stays visible while the signature is pending — `.claude/rules/frontend.md`.
 *
 * What does NOT become public, and is not representable anywhere in this component: the full yield
 * curve, per-provider allocations, per-leaf capacities, the winning leaf's own capacity, the number
 * of providers behind the fill, and every leaf that lost.
 */

import { useCallback, useEffect, useState } from "react";
import { decodeAbiParameters, parseEventLogs } from "viem";

import {
  EXPIRY_CONTROLLER_ABI,
  MIDNIGHT_SETTLEMENT_ABI,
  PUBLIC_RESULT_VERIFIER_ABI,
  QUOTE_ACTIVATOR_ABI,
  QUOTE_REGISTRY_ABI,
  SERIES_VAULT_ABI,
} from "../lib/abi.js";
import type { Session } from "../lib/session.js";
import {
  explorerLink,
  formatUnits,
  QUOTE_STATUS_LABEL,
  QuoteStatus,
  type SettlementRecord,
} from "../lib/settlement.js";
import { classifyFailure, type FailureKind, type Phase, Status } from "./Status.js";

const OFFER_ABI_PARAM = QUOTE_ACTIVATOR_ABI[0].outputs[1];

/**
 * The `Market` struct with EVM-native widths.
 *
 * The served record carries these as decimal strings, because JSON numbers are doubles and a
 * `maturity` or an `lltv` would lose precision. They are widened to `bigint` exactly once, here, on
 * the way into a contract call.
 */
interface MarketArg {
  readonly chainId: bigint;
  readonly midnight: `0x${string}`;
  readonly loanToken: `0x${string}`;
  readonly collateralParams: readonly {
    readonly token: `0x${string}`;
    readonly lltv: bigint;
    readonly liquidationCursor: bigint;
    readonly oracle: `0x${string}`;
  }[];
  readonly maturity: bigint;
  readonly rcfThreshold: bigint;
  readonly enterGate: `0x${string}`;
  readonly liquidatorGate: `0x${string}`;
}

/**
 * The `Offer`, exactly as `OfferPublished` encoded it and exactly as `take` will receive it.
 *
 * Never rebuilt from parts. `offer.start` is the activation block's timestamp and `offerHash` covers
 * it, so an offer assembled locally would differ from the one the ratifier stored in precisely the
 * field that matters.
 */
interface OfferArg {
  readonly market: MarketArg;
  readonly buy: boolean;
  readonly maker: `0x${string}`;
  readonly start: bigint;
  readonly expiry: bigint;
  readonly tick: bigint;
  readonly group: `0x${string}`;
  readonly callback: `0x${string}`;
  readonly callbackData: `0x${string}`;
  readonly receiverIfMakerIsSeller: `0x${string}`;
  readonly ratifier: `0x${string}`;
  readonly reduceOnly: boolean;
  readonly maxUnits: bigint;
  readonly maxAssets: bigint;
  readonly continuousFeeCap: bigint;
}

interface Execution {
  readonly offerHash: `0x${string}`;
  readonly marketId: `0x${string}`;
  readonly exactUnits: bigint;
  readonly expectedBuyerAssets: bigint;
  readonly maxPendingFee: bigint;
  readonly expiry: number;
  readonly activatedAt: number;
  readonly status: number;
  readonly taker: `0x${string}`;
  readonly vault: `0x${string}`;
  readonly ratifier: `0x${string}`;
}

interface Verified {
  readonly marketIndex: number;
  readonly rateIndex: number;
  readonly aggregateFillAmount: bigint;
  readonly graphRoot: `0x${string}`;
  readonly borrower: `0x${string}`;
}

interface Position {
  readonly credit: bigint;
  readonly debt: bigint;
}

interface Failure {
  readonly kind: FailureKind;
  readonly detail: string;
}

export function QuoteBand({
  settlement,
  session,
}: {
  settlement: SettlementRecord;
  session: Session;
}): React.ReactElement {
  const { candidate, addresses } = settlement;

  const [phase, setPhase] = useState<Phase>("idle");
  const [failure, setFailure] = useState<Failure>();
  const [busy, setBusy] = useState(false);

  const [verified, setVerified] = useState<Verified>();
  const [quoteId, setQuoteId] = useState<`0x${string}`>();
  const [offer, setOffer] = useState<OfferArg>();
  const [execution, setExecution] = useState<Execution>();
  const [position, setPosition] = useState<Position>();
  const [fillRejection, setFillRejection] = useState<string>();
  const [settlementTx, setSettlementTx] = useState<`0x${string}`>();
  const [activationTx, setActivationTx] = useState<`0x${string}`>();

  const decimals = candidate.loanTokenDecimals;

  /** Reads the quote and the public position back. Called after every write. */
  const refresh = useCallback(
    async (id: `0x${string}`): Promise<void> => {
      const read = (await session.publicClient.readContract({
        address: addresses.KyrveQuoteRegistry,
        abi: QUOTE_REGISTRY_ABI,
        functionName: "executionOf",
        args: [id],
      })) as Execution;
      setExecution(read);

      if (read.vault !== "0x0000000000000000000000000000000000000000") {
        const [credit, debt] = (await session.publicClient.readContract({
          address: read.vault,
          abi: SERIES_VAULT_ABI,
          functionName: "positionOf",
          args: [read.marketId],
        })) as [bigint, bigint, bigint];
        setPosition({ credit, debt });
      }
    },
    [addresses.KyrveQuoteRegistry, session.publicClient],
  );

  // An epoch may already have been activated by an earlier visit. Adopt it rather than offering to
  // activate something that exists — the registry refuses a second quote per epoch, forever.
  useEffect(() => {
    void (async () => {
      const existing = (await session.publicClient.readContract({
        address: addresses.KyrveQuoteRegistry,
        abi: QUOTE_REGISTRY_ABI,
        functionName: "quoteOfEpoch",
        args: [candidate.epochId],
      })) as `0x${string}`;
      if (existing !== `0x${"00".repeat(32)}`) {
        setQuoteId(existing);
        await refresh(existing);
      }
    })();
  }, [addresses.KyrveQuoteRegistry, candidate.epochId, refresh, session.publicClient]);

  function fail(error: unknown): void {
    const classified = classifyFailure(error);
    setFailure({ kind: classified.kind, detail: classified.detail });
    setPhase("idle");
  }

  /** 1. Re-runs the settlement layer's own verification, read-only. No signature, no gas. */
  async function verify(): Promise<void> {
    setBusy(true);
    setFailure(undefined);
    setPhase("decryption-ready");
    try {
      const result = (await session.publicClient.readContract({
        address: addresses.KyrvePublicResultVerifier,
        abi: PUBLIC_RESULT_VERIFIER_ABI,
        functionName: "verifyForActivation",
        args: [
          candidate.epochId,
          candidate.graphRoot,
          candidate.requestId,
          candidate.universeId,
          candidate.proofs.market,
          candidate.proofs.rate,
          candidate.proofs.floor,
          candidate.proofs.ready,
          candidate.proofs.aggregate,
        ],
      })) as Verified;
      setVerified(result);
      setPhase("done");
    } catch (error) {
      fail(error);
    } finally {
      setBusy(false);
    }
  }

  /** 2. The boundary crossing. One epoch, one quote, forever. */
  async function activate(): Promise<void> {
    setBusy(true);
    setFailure(undefined);
    try {
      setPhase("awaiting-signature");
      const hash = await session.walletClient.writeContract({
        address: addresses.QuoteActivator,
        abi: QUOTE_ACTIVATOR_ABI,
        functionName: "activate",
        args: [
          {
            epochId: candidate.epochId,
            expectedGraphRoot: candidate.graphRoot,
            expectedRequestId: candidate.requestId,
            expectedUniverseId: candidate.universeId,
            market: marketArg(),
            leafIndex: BigInt(candidate.leafIndex),
            lifetime: BigInt(candidate.lifetimeSeconds),
            maxPendingFee: BigInt(candidate.maxPendingFee),
          },
          {
            marketProof: candidate.proofs.market,
            rateProof: candidate.proofs.rate,
            floorProof: candidate.proofs.floor,
            readyProof: candidate.proofs.ready,
            aggregateProof: candidate.proofs.aggregate,
          },
        ],
        account: session.account,
        chain: null,
      });
      setActivationTx(hash);
      setPhase("transaction-pending");

      const receipt = await session.publicClient.waitForTransactionReceipt({ hash });
      // The offer is recovered from the event, never from a simulation: `offer.start` is
      // `block.timestamp`, so a simulated offer differs from the mined one in exactly the field the
      // hash covers, and no ratifier would accept it.
      const events = parseEventLogs({
        abi: QUOTE_ACTIVATOR_ABI,
        logs: receipt.logs,
        eventName: "OfferPublished",
      });
      const published = events[0];
      if (published === undefined) throw new Error("activation published no offer");

      const [decoded] = decodeAbiParameters(
        [OFFER_ABI_PARAM],
        published.args.offer as `0x${string}`,
      );
      setOffer(decoded as unknown as OfferArg);
      setQuoteId(published.args.quoteId as `0x${string}`);
      await refresh(published.args.quoteId as `0x${string}`);
      setPhase("done");
    } catch (error) {
      fail(error);
    } finally {
      setBusy(false);
    }
  }

  /**
   * 3. A partial fill, which MUST be refused.
   *
   * Midnight itself permits `newConsumed <= offer.maxUnits`, so this is not a formality: the only
   * thing that stops it is `KyrveSeriesVault.onBuy`. The rejection is shown as a result rather than
   * as an error, because a refused partial fill is the system working.
   */
  async function attemptPartialFill(): Promise<void> {
    if (offer === undefined || execution === undefined) return;
    setBusy(true);
    setFailure(undefined);
    setFillRejection(undefined);
    setPhase("awaiting-signature");
    try {
      await session.publicClient.simulateContract({
        address: settlement.midnight,
        abi: MIDNIGHT_SETTLEMENT_ABI,
        functionName: "take",
        args: [
          offer,
          "0x",
          execution.exactUnits - 1n,
          session.account,
          session.account,
          "0x0000000000000000000000000000000000000000",
          "0x",
        ],
        account: session.account,
      });
      setFillRejection("ACCEPTED — this is a defect. A partial fill must never be admitted.");
      setPhase("idle");
    } catch (error) {
      setFillRejection(shortReason(error));
      setPhase("done");
      if (quoteId !== undefined) await refresh(quoteId);
    } finally {
      setBusy(false);
    }
  }

  /** 4. The exact fill, through unmodified Midnight. */
  async function settle(): Promise<void> {
    if (offer === undefined || execution === undefined) return;
    setBusy(true);
    setFailure(undefined);
    try {
      setPhase("awaiting-signature");
      const hash = await session.walletClient.writeContract({
        address: settlement.midnight,
        abi: MIDNIGHT_SETTLEMENT_ABI,
        functionName: "take",
        args: [
          offer,
          "0x",
          execution.exactUnits,
          session.account,
          session.account,
          "0x0000000000000000000000000000000000000000",
          "0x",
        ],
        account: session.account,
        chain: null,
      });
      setSettlementTx(hash);
      setPhase("transaction-pending");
      await session.publicClient.waitForTransactionReceipt({ hash });
      if (quoteId !== undefined) await refresh(quoteId);
      setPhase("done");
    } catch (error) {
      fail(error);
    } finally {
      setBusy(false);
    }
  }

  /** 5. Cancellation, while the window is still open. Operator only. */
  async function cancel(): Promise<void> {
    await retire("cancelQuote");
  }

  /** 6. Expiry recovery, once the window has closed. Permissionless. */
  async function recover(): Promise<void> {
    await retire("expireQuote");
  }

  async function retire(functionName: "cancelQuote" | "expireQuote"): Promise<void> {
    if (quoteId === undefined) return;
    setBusy(true);
    setFailure(undefined);
    try {
      setPhase("awaiting-signature");
      const hash = await session.walletClient.writeContract({
        address: addresses.KyrveQuoteExpiryController,
        abi: EXPIRY_CONTROLLER_ABI,
        functionName,
        args: [quoteId],
        account: session.account,
        chain: null,
      });
      setPhase("transaction-pending");
      await session.publicClient.waitForTransactionReceipt({ hash });
      await refresh(quoteId);
      setPhase("done");
    } catch (error) {
      fail(error);
    } finally {
      setBusy(false);
    }
  }

  function marketArg(): MarketArg {
    const m = candidate.market;
    return {
      chainId: BigInt(m.chainId),
      midnight: m.midnight,
      loanToken: m.loanToken,
      collateralParams: m.collateralParams.map((c) => ({
        token: c.token,
        lltv: BigInt(c.lltv),
        liquidationCursor: BigInt(c.liquidationCursor),
        oracle: c.oracle,
      })),
      maturity: BigInt(m.maturity),
      rcfThreshold: BigInt(m.rcfThreshold),
      enterGate: m.enterGate,
      liquidatorGate: m.liquidatorGate,
    };
  }

  const status = (execution?.status ?? QuoteStatus.None) as QuoteStatus;
  const live = status === QuoteStatus.Executable;
  const settled = status === QuoteStatus.Consumed;

  return (
    <section className="band" data-testid="quote-band">
      <h2>Quote and settlement</h2>
      <p className="lede">
        One confidential epoch produced one leaf. Verifying it costs nothing and reveals nothing.
        Activating it is the moment the market, the rate, the amount and the borrower become public,
        and it can happen once per epoch, forever.
      </p>

      <div className="grid">
        <div className="card">
          <h3>The verified public result</h3>
          <table>
            <tbody>
              <tr>
                <td>Selected market</td>
                <td className="numeric" data-testid="quote-market">
                  #{verified?.marketIndex ?? candidate.marketIndex}
                </td>
              </tr>
              <tr>
                <td>Selected rate</td>
                <td className="numeric" data-testid="quote-rate">
                  #{verified?.rateIndex ?? candidate.rateIndex} · tick {candidate.tick}
                </td>
              </tr>
              <tr>
                <td>Executable aggregate fill</td>
                <td className="numeric" data-testid="quote-aggregate">
                  {formatUnits(
                    (
                      verified?.aggregateFillAmount ?? BigInt(candidate.aggregateFillAmount)
                    ).toString(),
                    decimals,
                  )}{" "}
                  {candidate.loanTokenSymbol}
                </td>
              </tr>
              <tr>
                <td>Maturity</td>
                <td className="numeric" data-testid="quote-maturity">
                  {new Date(Number(candidate.maturity) * 1000).toISOString().slice(0, 10)}
                </td>
              </tr>
              <tr>
                <td>Approved borrower</td>
                <td className="handle" data-testid="quote-borrower">
                  {verified?.borrower ?? candidate.borrower}
                </td>
              </tr>
              <tr>
                <td>Proof verification</td>
                <td data-testid="quote-proof-state">
                  {verified === undefined ? "not verified in this session" : "verified on chain"}
                </td>
              </tr>
            </tbody>
          </table>
          <p className="lede" style={{ marginTop: 16 }} data-testid="aggregate-note">
            The aggregate is the sum of what providers actually reserved, not the winning leaf's
            capacity. Those differ by floor-division dust, and the executable quote is sized from
            the reserved sum so the maker never owes more than was committed.
          </p>
          <div className="row" style={{ marginTop: 24 }}>
            <button type="button" onClick={verify} disabled={busy} data-testid="verify-result">
              Verify selected result
            </button>
          </div>
        </div>

        <div className="card">
          <h3>Quote</h3>
          <table>
            <tbody>
              <tr>
                <td>Activation</td>
                <td data-testid="activation-state">
                  {quoteId === undefined ? "not activated" : "activated"}
                </td>
              </tr>
              <tr>
                <td>Quote id</td>
                <td className="handle" data-testid="quote-id">
                  {quoteId ?? "—"}
                </td>
              </tr>
              <tr>
                <td>Settlement</td>
                <td data-testid="settlement-state">{QUOTE_STATUS_LABEL[status]}</td>
              </tr>
              <tr>
                <td>Exact units</td>
                <td className="numeric" data-testid="quote-units">
                  {execution === undefined ? "—" : execution.exactUnits.toString()}
                </td>
              </tr>
              <tr>
                <td>Buyer assets</td>
                <td className="numeric" data-testid="quote-buyer-assets">
                  {execution === undefined
                    ? "—"
                    : `${formatUnits(execution.expectedBuyerAssets.toString(), decimals)} ${candidate.loanTokenSymbol}`}
                </td>
              </tr>
              <tr>
                <td>Expiry</td>
                <td className="numeric" data-testid="quote-expiry">
                  {execution === undefined || execution.expiry === 0
                    ? "—"
                    : new Date(execution.expiry * 1000)
                        .toISOString()
                        .slice(0, 19)
                        .replace("T", " ")}
                </td>
              </tr>
              <tr>
                <td>Public credit</td>
                <td className="numeric" data-testid="public-credit">
                  {position === undefined ? "—" : position.credit.toString()}
                </td>
              </tr>
              <tr>
                <td>Public debt</td>
                <td className="numeric" data-testid="public-debt">
                  {position === undefined ? "—" : position.debt.toString()}
                </td>
              </tr>
            </tbody>
          </table>

          {activationTx !== undefined ? (
            <TxLink settlement={settlement} hash={activationTx} label="activation" />
          ) : null}
          {settlementTx !== undefined ? (
            <TxLink settlement={settlement} hash={settlementTx} label="settlement" />
          ) : null}

          {quoteId === undefined ? (
            <div className="reveal-warning" role="alert" data-testid="activation-warning">
              <strong>Activating makes this quote public, permanently.</strong> The selected market,
              the selected rate, the aggregate amount and the borrower's address all become readable
              by anyone. The rest of the curve — every other leaf, every provider allocation, every
              capacity and how many providers are behind this fill — stays encrypted and is not part
              of what is published.
            </div>
          ) : null}

          <div className="row" style={{ marginTop: 24 }}>
            {quoteId === undefined ? (
              <button
                type="button"
                className="primary"
                onClick={activate}
                disabled={busy}
                data-testid="activate-quote"
              >
                Activate quote
              </button>
            ) : (
              <>
                <button
                  type="button"
                  onClick={attemptPartialFill}
                  disabled={busy || !live || offer === undefined}
                  data-testid="attempt-partial-fill"
                >
                  Attempt partial fill
                </button>
                <button
                  type="button"
                  className="primary"
                  onClick={settle}
                  disabled={busy || !live || offer === undefined}
                  data-testid="settle-quote"
                >
                  Settle exact quote
                </button>
                <button
                  type="button"
                  onClick={cancel}
                  disabled={busy || !live}
                  data-testid="cancel-quote"
                >
                  Cancel unused quote
                </button>
                <button
                  type="button"
                  onClick={recover}
                  disabled={busy || !live}
                  data-testid="recover-expired-quote"
                >
                  Recover expired quote
                </button>
              </>
            )}
          </div>

          {fillRejection !== undefined ? (
            <p className="lede" style={{ marginTop: 16 }} data-testid="fill-rejection">
              Partial fill refused: {fillRejection}
            </p>
          ) : null}
          {settled ? (
            <p className="lede" style={{ marginTop: 16 }} data-testid="consumption-note">
              The quote is consumed. It cannot settle again, be cancelled, or be recovered — the
              registry keeps the id forever and Midnight's group is exhausted.
            </p>
          ) : null}

          <Status phase={phase} failure={failure} testId="quote-status" />
        </div>
      </div>
    </section>
  );
}

function TxLink({
  settlement,
  hash,
  label,
}: {
  settlement: SettlementRecord;
  hash: `0x${string}`;
  label: string;
}): React.ReactElement {
  const href = explorerLink(settlement, "tx", hash);
  return (
    <p className="lede" style={{ marginTop: 8 }} data-testid={`tx-${label}`}>
      {label}:{" "}
      {href === undefined ? (
        <span className="handle">{hash}</span>
      ) : (
        <a className="handle" href={href} target="_blank" rel="noreferrer">
          {hash}
        </a>
      )}
    </p>
  );
}

/**
 * The first meaningful line of a revert.
 *
 * Deliberately not "something went wrong": a refused partial fill names the check that refused it,
 * and showing that is the difference between a demonstration and a claim.
 */
function shortReason(error: unknown): string {
  const text = error instanceof Error ? error.message : String(error);
  const named = /(?:reverted with (?:the following reason|custom error)[:\s]*)([^\n]+)/i.exec(text);
  if (named?.[1] !== undefined) return named[1].trim();
  const firstLine = text.split("\n").find((line) => line.trim().length > 0);
  return (firstLine ?? "refused").trim().slice(0, 160);
}
