/**
 * `/app/roll` — confidential migration between two maturities.
 *
 * ════════════════════════════════════════════════════════════════════════════════════════════
 * THE ROLL IS MINIMAL, AND THIS PAGE MUST NOT IMPLY OTHERWISE
 * ════════════════════════════════════════════════════════════════════════════════════════════
 *
 * One intent against one supply between two series. That is the whole claim, and `pnpm verify:phase6`
 * prints it on every run. The expensive part of a larger roll is repeating the entire confidential
 * issuance stack per maturity: `bindSettler` is one-shot and the settler holds its series, token,
 * ownership registry, vault and market as immutables, so one custody vault serves exactly one series
 * and there is no configuration that makes a third maturity cheap (delta U-1).
 *
 * So there is no maturity ladder here, no "roll to any series" control and no queue of pending rolls.
 * Each of those would describe a system that does not exist (P7-5).
 *
 * ════════════════════════════════════════════════════════════════════════════════════════════
 * A ROLL IS NOT ATOMIC AND NOTHING CLAIMS IT IS
 * ════════════════════════════════════════════════════════════════════════════════════════════
 *
 * `statusOf` returns the NEXT ACTION, so an interrupted roll resumes from chain state. This page
 * renders that next action rather than a progress bar — a bar implying one transaction would be
 * precisely the claim the contracts deliberately do not make (U-F11).
 *
 * ════════════════════════════════════════════════════════════════════════════════════════════
 * THE CONVERSION IS RECOMPUTED, NOT READ
 * ════════════════════════════════════════════════════════════════════════════════════════════
 *
 * `conversionWad` is a view, and a view returning anything it liked would be indistinguishable from a
 * correct one until somebody did the arithmetic. Both operands are public, so the page multiplies
 * them out itself and shows both numbers.
 */

import { type ReactElement, useCallback, useState } from "react";

import { ConfidentialValue } from "../components/ConfidentialValue.js";
import { Empty, Facts } from "../components/Facts.js";
import { RequiresWallet } from "../components/RequiresWallet.js";
import { classifyFailure, type FailureKind, type Phase, Status } from "../components/Status.js";
import { Why } from "../components/Why.js";
import {
  INTENT_STATE_LABEL,
  type IntentState,
  NEXT_ACTION_LABEL,
  type NextAction,
  ROLL_BOOK_ABI,
  SERIES_TOKEN_ABI,
} from "../lib/abi.js";
import { abbreviate, useChainRead } from "../lib/chain.js";
import { useKyrve } from "../lib/context.js";
import { rollOf } from "../lib/records.js";
import { recall, remember, type Session, useRevealed } from "../lib/session.js";
import { Link } from "../router/router.js";
import { useAcl } from "./Fund.js";

const WAD = 10n ** 18n;
/** Seven days, inside the book's 30-day ceiling. */
const DEFAULT_LIFETIME_DAYS = 7n;

export function Roll(): ReactElement {
  const { record, publicClient } = useKyrve();
  const roll = rollOf(record);

  const conversion = useChainRead(async () => {
    if (roll === undefined) return undefined;
    const [sourceToken, targetPrice] = await Promise.all([
      publicClient.readContract({
        address: roll.book,
        abi: ROLL_BOOK_ABI,
        functionName: "SOURCE_TOKEN",
      }) as Promise<`0x${string}`>,
      publicClient.readContract({
        address: roll.book,
        abi: ROLL_BOOK_ABI,
        functionName: "TARGET_PRICE_WAD",
      }) as Promise<bigint>,
    ]);
    const factor = (await publicClient.readContract({
      address: sourceToken,
      abi: SERIES_TOKEN_ABI,
      functionName: "redemptionFactorWad",
    })) as bigint;

    if (factor === 0n) {
      return { open: false as const, sourceToken, targetPrice, factor };
    }
    const reported = (await publicClient.readContract({
      address: roll.book,
      abi: ROLL_BOOK_ABI,
      functionName: "conversionWad",
    })) as bigint;
    // Recomputed here from two public numbers, then compared. A reported conversion nobody
    // reproduced is a number, not a fact.
    const recomputed = (factor * WAD) / targetPrice;
    return { open: true as const, sourceToken, targetPrice, factor, reported, recomputed };
  }, [roll?.book]);

  if (roll === undefined) {
    return (
      <section className="band">
        <h1>Roll</h1>
        <Empty
          title="A roll needs two complete series, and this deployment has fewer"
          testId="roll-unavailable"
        >
          <p>
            One custody vault serves exactly one series, because <code>bindSettler</code> is
            one-shot and the settler holds its series, token, ownership registry, vault and market
            as immutables. A second maturity therefore needs a second engine, epoch controller,
            graph registry, ledger and settlement layer — there is no configuration that makes it
            cheap.
          </p>
          <p>
            That is why there is nothing to show here rather than an empty ladder: a maturity ladder
            on a deployment with one series would be describing a system that does not exist.
          </p>
        </Empty>
      </section>
    );
  }

  return (
    <>
      <section className="band">
        <span className="eyebrow">Provider · migration</span>
        <h1>Roll</h1>
        <p className="lede">
          One intent against one supply, between two series that share no contract. A roll{" "}
          <strong>transfers</strong> — it does not burn and mint. <code>Nox.mint</code> and{" "}
          <code>Nox.burn</code> are the only operations that touch confidential total supply and
          both produce a new handle, so an unchanged supply handle on both sides is proof the
          operation never happened. That is a stronger statement than an equal plaintext.
        </p>

        <Facts
          testId="roll-facts"
          facts={[
            { label: "Roll book", value: <span className="mono">{roll.book}</span> },
            {
              label: "Source series",
              value: (
                <Link to={`/app/series/${roll.source.series.seriesId}`}>
                  {abbreviate(roll.source.series.seriesId)}
                </Link>
              ),
            },
            {
              label: "Target series",
              value: (
                <Link to={`/app/series/${roll.target.series.seriesId}`}>
                  {abbreviate(roll.target.series.seriesId)}
                </Link>
              ),
            },
            {
              label: "Source redemption factor (wad)",
              value:
                conversion.value === undefined ? undefined : conversion.value.factor.toString(),
              absent:
                conversion.error === undefined ? "reading the chain" : "the node did not answer",
            },
            {
              label: "Target issue price (wad)",
              value:
                conversion.value === undefined
                  ? undefined
                  : conversion.value.targetPrice.toString(),
              absent:
                conversion.error === undefined ? "reading the chain" : "the node did not answer",
            },
          ]}
        />
      </section>

      <section className="band">
        <div className="card" data-testid="roll-conversion">
          <h2>The conversion</h2>
          {conversion.value === undefined ? (
            <p className="lede" aria-busy={conversion.state !== "unavailable"}>
              {conversion.state === "unavailable"
                ? `The book could not be read, so no conversion was checked. ${conversion.error ?? ""}`
                : "Reading both operands from chain state…"}
            </p>
          ) : !conversion.value.open ? (
            <p className="lede" data-testid="roll-not-open">
              The source series has not opened redemption, so there is no conversion to check. The
              book reverts <code>SourceRedemptionNotOpen</code> rather than defaulting to par — a
              roll priced at par by accident would move value between the two sides on every
              netting.
            </p>
          ) : (
            <>
              <p className="lede">
                <code>sourceFactor × WAD ÷ targetPrice</code>, recomputed in this browser from two
                public numbers.
              </p>
              <table>
                <tbody>
                  <tr>
                    <th>The book reports</th>
                    <td className="numeric" data-testid="roll-reported">
                      {conversion.value.reported.toString()}
                    </td>
                  </tr>
                  <tr>
                    <th>Recomputed here</th>
                    <td className="numeric" data-testid="roll-recomputed">
                      {conversion.value.recomputed.toString()}
                    </td>
                  </tr>
                  <tr>
                    <th>Agree</th>
                    <td data-testid="roll-agree">
                      {conversion.value.reported === conversion.value.recomputed
                        ? "yes — the book reports the arithmetic it declares"
                        : "NO — the book reports a conversion that is not the arithmetic it declares"}
                    </td>
                  </tr>
                </tbody>
              </table>
            </>
          )}
        </div>
      </section>

      <section className="band">
        <RequiresWallet purpose="escrow an encrypted source claim for migration">
          {(session) => (
            <IntentPanel
              session={session}
              book={roll.book}
              decimals={roll.source.series.loanTokenDecimals}
              symbol={roll.source.series.loanTokenSymbol}
            />
          )}
        </RequiresWallet>
      </section>

      <section className="band">
        <Why title="A roll moves a claim. It does not burn one and mint another">
          <p>
            Minting and burning are the only operations that touch confidential total supply, and
            both produce a new supply handle. After a roll the supply handles on both sides are
            unchanged, which proves no issuance happened more strongly than equal numbers would.
          </p>
          <p>
            A roll is also not one transaction and nothing here claims it is. The status shows the
            next action rather than a percentage, so an interrupted roll resumes from chain state.
          </p>
        </Why>
      </section>
    </>
  );
}

function IntentPanel({
  session,
  book,
  decimals,
  symbol,
}: {
  session: Session;
  book: `0x${string}`;
  decimals: number;
  symbol: string;
}): ReactElement {
  const [amount, setAmount] = useState("50");
  const [phase, setPhase] = useState<Phase>("idle");
  const [failure, setFailure] = useState<{ kind: FailureKind; detail: string }>();
  const [busy, setBusy] = useState(false);

  const mine = useChainRead(async () => {
    const count = (await session.publicClient.readContract({
      address: book,
      abi: ROLL_BOOK_ABI,
      functionName: "submittedBy",
      args: [session.account],
    })) as bigint;

    const intents: {
      id: `0x${string}`;
      state: IntentState;
      next: NextAction;
      netCount: number;
      escrow: `0x${string}`;
    }[] = [];
    for (let sequence = 0n; sequence < count; sequence += 1n) {
      const id = (await session.publicClient.readContract({
        address: book,
        abi: ROLL_BOOK_ABI,
        functionName: "intentIdFor",
        args: [session.account, sequence],
      })) as `0x${string}`;
      try {
        const [state, , netCount, , , next] = (await session.publicClient.readContract({
          address: book,
          abi: ROLL_BOOK_ABI,
          functionName: "statusOf",
          args: [id],
        })) as [number, `0x${string}`, number, `0x${string}`, bigint, number];
        const escrow = (await session.publicClient.readContract({
          address: book,
          abi: ROLL_BOOK_ABI,
          functionName: "confidentialIntentEscrow",
          args: [id],
        })) as `0x${string}`;
        intents.push({
          id,
          state: state as IntentState,
          next: next as NextAction,
          netCount,
          escrow,
        });
      } catch {
        // `UnknownIntent`: this sequence belongs to a supply rather than an intent. Not an error.
      }
    }
    return intents;
  }, [book, session.account]);

  const refresh = mine.refresh;

  const submit = useCallback(async (): Promise<void> => {
    setBusy(true);
    setFailure(undefined);
    try {
      const scale = 10n ** BigInt(decimals);
      const units = BigInt(Math.round(Number(amount || "0") * Number(scale)));

      setPhase("encrypting");
      const input = await session.nox.encrypt(units, "euint256", book);

      const nonce = (await session.publicClient.readContract({
        address: book,
        abi: ROLL_BOOK_ABI,
        functionName: "nextNonce",
        args: [session.account],
      })) as bigint;

      const block = await session.publicClient.getBlock();
      const expiry = block.timestamp + DEFAULT_LIFETIME_DAYS * 86_400n;

      setPhase("awaiting-signature");
      const hash = await session.walletClient.writeContract({
        address: book,
        abi: ROLL_BOOK_ABI,
        functionName: "submitIntent",
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
  }, [session, book, amount, decimals, refresh]);

  return (
    <div className="grid" data-testid="roll-band">
      <div className="card">
        <h2>Open a roll intent</h2>
        <div className="row">
          <div className="field">
            <label htmlFor="roll-amount">Source claim to migrate ({symbol})</label>
            <input
              id="roll-amount"
              type="text"
              inputMode="decimal"
              value={amount}
              onChange={(event) => setAmount(event.target.value)}
              data-testid="roll-amount"
            />
          </div>
        </div>

        <div className="reveal-warning" role="note" data-testid="roll-boundary">
          <strong>Nothing here crosses the boundary</strong>
          <p>
            The amount is encrypted before it leaves this browser. What becomes public is that an
            intent exists and when it expires. If a residual has to be settled publicly later, that
            is a separate action with its own warning — and the published residual is public from
            that block, permanently, because Nox has no un-publish.
          </p>
        </div>

        <div className="actions">
          <button
            type="button"
            className="primary"
            onClick={() => void submit()}
            disabled={busy}
            data-testid="roll-submit"
          >
            Escrow encrypted claim
          </button>
        </div>

        <Status phase={phase} failure={failure} testId="roll-status" />
      </div>

      <div className="card">
        <h2>Your intents</h2>
        {mine.state === "unavailable" ? (
          <p className="lede">
            The book could not be read, so this list is unavailable rather than empty. {mine.error}
          </p>
        ) : mine.value === undefined ? (
          <p className="lede" aria-busy="true">
            Reading your intents…
          </p>
        ) : mine.value.length === 0 ? (
          <p className="lede" data-testid="roll-none">
            You have opened no roll intent.
          </p>
        ) : (
          <ul className="rows" data-testid="roll-intents">
            {mine.value.map((intent) => (
              <IntentRow key={intent.id} intent={intent} session={session} decimals={decimals} />
            ))}
          </ul>
        )}

        <p className="note">
          The status line is the next action rather than a percentage, because a roll is not atomic
          and nothing in Kyrve claims it is. An interrupted roll resumes from chain state: the book
          answers what remains to be done, not how far along it is.
        </p>
      </div>
    </div>
  );
}

function IntentRow({
  intent,
  session,
  decimals,
}: {
  intent: {
    id: `0x${string}`;
    state: IntentState;
    next: NextAction;
    netCount: number;
    escrow: `0x${string}`;
  };
  session: Session;
  decimals: number;
}): ReactElement {
  const acl = useAcl(session, intent.escrow);
  useRevealed();
  const value = recall(intent.escrow);
  const [working, setWorking] = useState(false);

  async function decrypt(): Promise<void> {
    setWorking(true);
    try {
      remember(intent.escrow, await session.nox.decrypt(intent.escrow));
    } catch {
      // The refusal is the ACL state, which `ConfidentialValue` reads from chain and renders.
    } finally {
      setWorking(false);
    }
  }

  return (
    <li data-testid={`roll-intent-${intent.id.slice(2, 10)}`}>
      <span className="eyebrow">
        {INTENT_STATE_LABEL[intent.state]} · {intent.netCount} netting
        {intent.netCount === 1 ? "" : "s"}
      </span>
      <p className="mono">{abbreviate(intent.id)}</p>
      <p className="note" data-testid={`roll-next-${intent.id.slice(2, 10)}`}>
        Next: {NEXT_ACTION_LABEL[intent.next]}
      </p>
      <ConfidentialValue
        title="Unmatched source claim"
        handle={intent.escrow}
        acl={acl}
        value={value}
        decimals={decimals}
        onDecrypt={() => void decrypt()}
        busy={working}
        testId={`roll-escrow-${intent.id.slice(2, 10)}`}
      />
    </li>
  );
}
