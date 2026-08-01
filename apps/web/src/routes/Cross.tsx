/**
 * `/app/cross/:seriesId` — confidential secondary transfer, one series at a time.
 *
 * ════════════════════════════════════════════════════════════════════════════════════════════
 * WHY THE ROUTE TAKES A SERIES AND THERE IS NO COLLECTION PAGE
 * ════════════════════════════════════════════════════════════════════════════════════════════
 *
 * A Cross book is deployed OVER one series and holds it as an immutable. There is no cross surface
 * that exists without a series, so there is no `/app/cross` to navigate to — a nav item pointing at
 * one would be a control that cannot complete, which `.claude/rules/frontend.md` forbids outright.
 *
 * ════════════════════════════════════════════════════════════════════════════════════════════
 * WHAT AN OPEN ORDER DOES AND DOES NOT TELL YOU
 * ════════════════════════════════════════════════════════════════════════════════════════════
 *
 * `OrderState.Open` is public and says nothing about remaining escrow. An order can be matched down
 * to floor-division dust and still read Open, because the contract cannot say otherwise without
 * leaking a balance. Only the order's owner holds a grant on its escrow handle. So this page shows
 * the state and the owner's own escrow, and never a "remaining" figure derived from public state —
 * that number does not exist publicly and inventing it would be a fabricated metric.
 *
 * Two Sepolia runs netted zero and passed every public check (delta U-9). The copy says so.
 */

import { type ReactElement, useCallback, useState } from "react";

import { ConfidentialValue } from "../components/ConfidentialValue.js";
import { Empty, Facts } from "../components/Facts.js";
import { RequiresWallet } from "../components/RequiresWallet.js";
import { classifyFailure, type FailureKind, type Phase, Status } from "../components/Status.js";
import { Why } from "../components/Why.js";
import {
  CROSS_BOOK_ABI,
  CROSS_BOOK_ORDER_ABI,
  CROSS_SIDE,
  ORDER_STATE_LABEL,
  type OrderState,
} from "../lib/abi.js";
import { abbreviate, formatTimestamp, useChainRead } from "../lib/chain.js";
import { useKyrve } from "../lib/context.js";
import { type LayerRecord, layerBySeriesId } from "../lib/records.js";
import { recall, remember, type Session, useRevealed } from "../lib/session.js";
import { Link } from "../router/router.js";
import { useAcl } from "./Fund.js";

/** Seven days, inside the book's 30-day ceiling. */
const DEFAULT_LIFETIME_DAYS = 7n;

interface Order {
  readonly id: `0x${string}`;
  readonly state: OrderState;
  readonly side: number;
  readonly expiry: bigint;
  readonly matchCount: number;
  readonly escrow: `0x${string}`;
}

export function Cross({ seriesId }: { seriesId: `0x${string}` }): ReactElement {
  const { record } = useKyrve();
  const layer = layerBySeriesId(record, seriesId);
  const book = layer?.market?.addresses.KyrveCrossBook;

  if (layer === undefined || book === undefined) {
    return (
      <section className="band">
        <span className="eyebrow">Position transfer</span>
        <h1>Transfer a position</h1>
        <p className="lede">
          A private transfer market belongs to one settled position. This page does not create a
          market where one has not been deployed.
        </p>
        <Empty title="No private transfer market is available" testId="cross-unknown">
          <p>
            {layer === undefined
              ? "This deployment has no settled position with that identifier."
              : "This settled position has no Cross book deployed over it."}
          </p>
          <p>
            <Link to="/app/series" className="row-link">
              Every series this deployment holds
            </Link>
          </p>
        </Empty>
      </section>
    );
  }

  return (
    <>
      <section className="band">
        <span className="eyebrow">{layer.label} · secondary</span>
        <h1>Transfer a position</h1>
        <p className="lede">
          A Cross order moves a confidential claim between two parties without either balance
          becoming public. You escrow an encrypted amount; the keeper matches an exit against an
          entry; the conservation identities hold on both sides and the floor-division dust stays
          with the buyer.
        </p>
        <p className="note">Position {abbreviate(seriesId)}</p>
        <Economics book={book} />
      </section>

      <section className="band">
        <RequiresWallet purpose="escrow an encrypted amount bound to your wallet">
          {(session) => <OrderPanel session={session} layer={layer} book={book} />}
        </RequiresWallet>
      </section>

      <section className="band">
        <Why title="An open order says nothing about how much is left in it">
          <p>
            An order stays open until it is cancelled or fully settled, and matching leaves
            floor-division dust. An order can be drained to almost nothing and still read as open,
            because the contract cannot report a remainder without leaking a balance.
          </p>
          <p>
            Only the owner holds a grant on the escrow handle, so decrypting your own order above is
            the only way to answer the question. That is the design rather than a gap in it.
          </p>
        </Why>
      </section>
    </>
  );
}

/** The book's economics, all of them immutables, read from the book rather than asserted here. */
function Economics({ book }: { book: `0x${string}` }): ReactElement {
  const { publicClient } = useKyrve();
  const read = useChainRead(async () => {
    const [priceWad, feeBps, maxFeeBps, beneficiary] = await Promise.all([
      publicClient.readContract({ address: book, abi: CROSS_BOOK_ABI, functionName: "PRICE_WAD" }),
      publicClient.readContract({ address: book, abi: CROSS_BOOK_ABI, functionName: "FEE_BPS" }),
      publicClient.readContract({
        address: book,
        abi: CROSS_BOOK_ABI,
        functionName: "MAX_FEE_BPS",
      }),
      publicClient.readContract({
        address: book,
        abi: CROSS_BOOK_ABI,
        functionName: "FEE_BENEFICIARY",
      }),
    ]);
    return { priceWad, feeBps, maxFeeBps, beneficiary };
  }, [book]);

  return (
    <Facts
      testId="cross-economics"
      facts={[
        { label: "Cross book", value: <span className="mono">{book}</span> },
        {
          label: "Price (wad)",
          value: read.value === undefined ? undefined : String(read.value.priceWad),
          absent: read.error === undefined ? "reading the chain" : "the node did not answer",
        },
        {
          label: "Fee",
          value:
            read.value === undefined
              ? undefined
              : `${String(read.value.feeBps)} bps of a compiled cap of ${String(read.value.maxFeeBps)}`,
          absent: read.error === undefined ? "reading the chain" : "the node did not answer",
        },
        {
          label: "Fee destination",
          value:
            read.value === undefined ? undefined : (
              <span className="mono">{String(read.value.beneficiary)}</span>
            ),
          absent: read.error === undefined ? "reading the chain" : "the node did not answer",
        },
      ]}
    />
  );
}

function OrderPanel({
  session,
  layer,
  book,
}: {
  session: Session;
  layer: LayerRecord;
  book: `0x${string}`;
}): ReactElement {
  const [amount, setAmount] = useState("100");
  const [side, setSide] = useState<0 | 1>(CROSS_SIDE.Exit);
  const [phase, setPhase] = useState<Phase>("idle");
  const [failure, setFailure] = useState<{ kind: FailureKind; detail: string }>();
  const [busy, setBusy] = useState(false);

  const decimals = layer.series.loanTokenDecimals;

  /** Every order this wallet has opened on this book, newest last. Ids are deterministic. */
  const mine = useChainRead<readonly Order[]>(async () => {
    const count = (await session.publicClient.readContract({
      address: book,
      abi: CROSS_BOOK_ORDER_ABI,
      functionName: "submittedBy",
      args: [session.account],
    })) as bigint;

    const orders: Order[] = [];
    for (let sequence = 0n; sequence < count; sequence += 1n) {
      for (const which of [CROSS_SIDE.Exit, CROSS_SIDE.Entry] as const) {
        const id = (await session.publicClient.readContract({
          address: book,
          abi: CROSS_BOOK_ORDER_ABI,
          functionName: "orderIdFor",
          args: [session.account, which, sequence],
        })) as `0x${string}`;
        try {
          const [state, orderSide, , , expiry, matchCount] =
            (await session.publicClient.readContract({
              address: book,
              abi: CROSS_BOOK_ORDER_ABI,
              functionName: "orderOf",
              args: [id],
            })) as [number, number, `0x${string}`, bigint, bigint, number, `0x${string}`, bigint];
          const escrow = (await session.publicClient.readContract({
            address: book,
            abi: CROSS_BOOK_ORDER_ABI,
            functionName: "confidentialEscrowOf",
            args: [id],
          })) as `0x${string}`;
          orders.push({
            id,
            state: state as OrderState,
            side: orderSide,
            expiry,
            matchCount,
            escrow,
          });
        } catch {
          // `UnknownOrder`: this sequence was opened on the other side. Not an error.
        }
      }
    }
    return orders;
  }, [book, session.account]);

  const refresh = mine.refresh;

  const submit = useCallback(async (): Promise<void> => {
    setBusy(true);
    setFailure(undefined);
    try {
      const scale = 10n ** BigInt(decimals);
      const units = BigInt(Math.round(Number(amount || "0") * Number(scale)));

      setPhase("encrypting");
      // The wallet that encrypts must be the DIRECT CALLER of the book. No relayer, no paymaster,
      // no batch router — `Nox.fromExternal` binds the proof to owner, contract, chain and expiry.
      const input = await session.nox.encrypt(units, "euint256", book);

      const nonce = (await session.publicClient.readContract({
        address: book,
        abi: CROSS_BOOK_ORDER_ABI,
        functionName: "nextNonce",
        args: [session.account],
      })) as bigint;

      const block = await session.publicClient.getBlock();
      const expiry = block.timestamp + DEFAULT_LIFETIME_DAYS * 86_400n;

      setPhase("awaiting-signature");
      const hash = await session.walletClient.writeContract({
        address: book,
        abi: CROSS_BOOK_ORDER_ABI,
        functionName: side === CROSS_SIDE.Exit ? "submitExit" : "submitEntry",
        args: [input.handle, input.proof, expiry, nonce],
        account: session.account,
        chain: null,
      });

      setPhase("transaction-pending");
      await session.publicClient.waitForTransactionReceipt({ hash });
      setPhase("encrypted-input-accepted");
      refresh();
    } catch (error) {
      setFailure(classifyFailure(error));
      setPhase("failed");
    } finally {
      setBusy(false);
    }
  }, [session, book, amount, side, decimals, refresh]);

  const cancel = useCallback(
    async (id: `0x${string}`): Promise<void> => {
      setBusy(true);
      setFailure(undefined);
      try {
        setPhase("awaiting-signature");
        const hash = await session.walletClient.writeContract({
          address: book,
          abi: CROSS_BOOK_ORDER_ABI,
          functionName: "cancel",
          args: [id],
          account: session.account,
          chain: null,
        });
        setPhase("transaction-pending");
        await session.publicClient.waitForTransactionReceipt({ hash });
        setPhase("cancelled");
        refresh();
      } catch (error) {
        setFailure(classifyFailure(error));
        setPhase("failed");
      } finally {
        setBusy(false);
      }
    },
    [session, book, refresh],
  );

  return (
    <div className="grid" data-testid="cross-band">
      <div className="card">
        <h2>Open an order</h2>
        <div className="row">
          <div className="field">
            <label htmlFor="cross-amount">Amount to escrow ({layer.series.loanTokenSymbol})</label>
            <input
              id="cross-amount"
              type="text"
              inputMode="decimal"
              value={amount}
              onChange={(event) => setAmount(event.target.value)}
              data-testid="cross-amount"
            />
          </div>
          <div className="field">
            <label htmlFor="cross-side">Side</label>
            <select
              id="cross-side"
              value={side}
              onChange={(event) => setSide(Number(event.target.value) === 1 ? 1 : 0)}
              data-testid="cross-side"
            >
              <option value={CROSS_SIDE.Exit}>Exit: give up a claim</option>
              <option value={CROSS_SIDE.Entry}>Entry: take one on</option>
            </select>
          </div>
        </div>

        <div className="reveal-warning" role="note" data-testid="cross-boundary">
          <strong>Nothing here crosses the boundary</strong>
          <p>
            The amount is encrypted before it leaves this browser and the escrow stays a handle only
            you hold a grant on. What becomes public is that an order exists, on which side, and
            when it expires. Settling a residual publicly is a separate action with its own warning.
            It is permanent because Nox has no way to un-publish it.
          </p>
        </div>

        <div className="actions">
          <button
            type="button"
            className="primary"
            onClick={() => void submit()}
            disabled={busy}
            data-testid="cross-submit"
          >
            Escrow encrypted amount
          </button>
        </div>

        <Status phase={phase} failure={failure} testId="cross-status" />
      </div>

      <div className="card">
        <h2>Your orders</h2>
        {mine.state === "unavailable" ? (
          <p className="lede">
            The book could not be read, so this list is unavailable rather than empty. {mine.error}
          </p>
        ) : mine.value === undefined ? (
          <p className="lede" aria-busy="true">
            Reading your orders…
          </p>
        ) : mine.value.length === 0 ? (
          <p className="lede" data-testid="cross-none">
            You have opened no order on this book.
          </p>
        ) : (
          <ul className="rows" data-testid="cross-orders">
            {mine.value.map((order) => (
              <OrderRow
                key={order.id}
                order={order}
                session={session}
                decimals={decimals}
                busy={busy}
                onCancel={() => void cancel(order.id)}
              />
            ))}
          </ul>
        )}

        <p className="note">
          An open order says nothing about how much escrow is left. Matching leaves floor-division
          dust, and the contract cannot report a remainder without leaking a balance — so only the
          owner's own escrow, decrypted here, answers that question.
        </p>
      </div>
    </div>
  );
}

function OrderRow({
  order,
  session,
  decimals,
  busy,
  onCancel,
}: {
  order: Order;
  session: Session;
  decimals: number;
  busy: boolean;
  onCancel: () => void;
}): ReactElement {
  const acl = useAcl(session, order.escrow);
  useRevealed();
  const value = recall(order.escrow);
  const [working, setWorking] = useState(false);

  async function decrypt(): Promise<void> {
    setWorking(true);
    try {
      remember(order.escrow, await session.nox.decrypt(order.escrow));
    } catch {
      // The refusal is rendered by `ConfidentialValue`'s state, which reads the ACL from chain.
      // Swallowing it here is deliberate: a thrown authorisation refusal is the expected outcome for
      // a handle this wallet does not hold, and surfacing it as a page error would call it a fault.
    } finally {
      setWorking(false);
    }
  }

  return (
    <li data-testid={`cross-order-${order.id.slice(2, 10)}`}>
      <span className="eyebrow">
        {order.side === CROSS_SIDE.Exit ? "exit" : "entry"} · {ORDER_STATE_LABEL[order.state]} ·{" "}
        {order.matchCount} match{order.matchCount === 1 ? "" : "es"}
      </span>
      <p className="mono">{abbreviate(order.id)}</p>
      <p className="note">Expires {formatTimestamp(order.expiry)}</p>
      <ConfidentialValue
        title="Remaining escrow"
        handle={order.escrow}
        acl={acl}
        value={value}
        decimals={decimals}
        onDecrypt={() => void decrypt()}
        busy={working}
        testId={`cross-escrow-${order.id.slice(2, 10)}`}
      />
      <div className="actions">
        <button type="button" onClick={onCancel} disabled={busy || order.state !== 1}>
          Cancel this order
        </button>
      </div>
    </li>
  );
}
