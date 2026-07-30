/**
 * The ownership band: one settled public credit position, privately owned.
 *
 * ════════════════════════════════════════════════════════════════════════════════════════════
 * EVERY NUMBER ON THIS PANEL COMES FROM CHAIN STATE OR FROM THE WALLET
 * ════════════════════════════════════════════════════════════════════════════════════════════
 *
 * The served record carries identifiers and transaction hashes and **no amounts at all** — see
 * `lib/series.ts`. So:
 *
 *   the connected provider's balance   a handle from `KyrveSeriesToken.confidentialBalanceOf`,
 *                                      decrypted in THIS browser by the connected wallet, after
 *                                      NoxCompute authorised it. Never sent anywhere.
 *   aggregate series supply            the published supply handle, read through the gateway's
 *                                      public-decryption path. Public because the curve already
 *                                      published the same number as the epoch's aggregate.
 *   public Midnight credit             `KyrveSeriesVault.positionOf`, live.
 *   solvency                           `AggregateSolvencyVerifier.latestSnapshot`, with the verdict
 *                                      bit decrypted through the public path.
 *   the claim's provenance             `SeriesOwnershipRegistry`, which is where the epoch and the
 *                                      sealed graph root the claim was minted under actually live.
 *
 * A panel that displayed a script's beliefs would be showing exactly what
 * `SeriesOwnershipRegistry`'s five refusals exist to catch a mismatch in.
 *
 * ════════════════════════════════════════════════════════════════════════════════════════════
 * THE PEER PROBE IS A PROOF SURFACE, NOT A CONVENIENCE
 * ════════════════════════════════════════════════════════════════════════════════════════════
 *
 * "Only the owner can read their balance" is worth nothing as a UI claim, because the UI is the thing
 * making the claim. So the panel offers to TRY: enter another holder's address and the page fetches
 * their handle — which is public — and asks the gateway for it with the connected wallet. The gateway
 * refuses, on chain, before releasing any key material, and the refusal is rendered as the
 * `not-authorised` failure state rather than as an error.
 *
 * Nothing about the value leaks from the refusal, and the page says that too. Phase 4's
 * `attempt-partial-fill` control exists for the same reason.
 *
 * ════════════════════════════════════════════════════════════════════════════════════════════
 * WHAT NEVER LEAVES THE BROWSER
 * ════════════════════════════════════════════════════════════════════════════════════════════
 *
 * A decrypted balance is held in `lib/session.ts`'s in-memory map and nowhere else — no
 * `localStorage`, no fetch body, no console line, no analytics event. `scripts/verify/privacy-scan.ts`
 * fails the build if any of those appears on the decryption path. Disconnecting clears the map
 * immediately; it does not withdraw any grant, because Nox has none to withdraw, and this panel never
 * says "revoked".
 */

import type { HandleAcl } from "@kyrve/nox";
import { readAcl } from "@kyrve/nox";
import { useCallback, useEffect, useState } from "react";

import {
  SERIES_OWNERSHIP_ABI,
  SERIES_TOKEN_ABI,
  SERIES_VAULT_ABI,
  SOLVENCY_VERIFIER_ABI,
} from "../lib/abi.js";
import {
  abbreviate,
  CLAIM_STATE_LABEL,
  type ClaimState,
  formatMaturity,
  type SeriesRecord,
  seriesExplorerLink,
} from "../lib/series.js";
import { recall, remember, type Session, useRevealed } from "../lib/session.js";
import { formatUnits } from "../lib/settlement.js";
import { ConfidentialValue } from "./ConfidentialValue.js";
import { classifyFailure, type FailureKind, type Phase, Status } from "./Status.js";

const ZERO_HANDLE = `0x${"00".repeat(32)}`;

interface Failure {
  readonly kind: FailureKind;
  readonly detail: string;
}

/** Everything read from chain state, in one shape so a partial read cannot render as a whole one. */
interface OnChain {
  readonly ownHandle: `0x${string}`;
  readonly ownAcl: HandleAcl | undefined;
  readonly claimState: ClaimState;
  readonly claimLockId: `0x${string}`;
  readonly boundEpochId: `0x${string}`;
  readonly boundGraphRoot: `0x${string}`;
  readonly allocatedCount: number;
  readonly closed: boolean;
  readonly supplyHandle: `0x${string}`;
  readonly creditUnits: bigint;
  readonly pendingFee: bigint;
  readonly coverage: bigint;
  readonly solvencyBlock: bigint;
  readonly verdictHandle: `0x${string}`;
  readonly snapshotCount: number;
  readonly tokenSymbol: string;
}

export interface OwnershipBandProps {
  readonly session: Session;
  readonly series: SeriesRecord;
}

export function OwnershipBand({ session, series }: OwnershipBandProps): React.ReactElement {
  const [chain, setChain] = useState<OnChain>();
  const [phase, setPhase] = useState<Phase>("idle");
  const [failure, setFailure] = useState<Failure>();
  const [supply, setSupply] = useState<bigint>();
  const [solvent, setSolvent] = useState<boolean>();
  const [peer, setPeer] = useState("");
  const [peerRefusal, setPeerRefusal] = useState<Failure>();
  const [peerProbed, setPeerProbed] = useState(false);

  // Subscribes to the decrypted-value store, so locking the session clears this panel's own value
  // immediately rather than leaving it on screen until something else re-renders.
  useRevealed();
  const ownValue = recall(chain?.ownHandle);

  const read = useCallback(async (): Promise<void> => {
    const { publicClient, account } = session;
    const token = series.addresses.KyrveSeriesToken;
    const ownership = series.addresses.SeriesOwnershipRegistry;
    const verifier = series.addresses.AggregateSolvencyVerifier;

    const [ownHandle, supplyHandle, symbol, claim, binding, position, snapshot, snapshotCount] =
      await Promise.all([
        publicClient.readContract({
          address: token,
          abi: SERIES_TOKEN_ABI,
          functionName: "confidentialBalanceOf",
          args: [account],
        }),
        publicClient.readContract({
          address: token,
          abi: SERIES_TOKEN_ABI,
          functionName: "publishedSupply",
        }),
        publicClient.readContract({
          address: token,
          abi: SERIES_TOKEN_ABI,
          functionName: "symbol",
        }),
        publicClient.readContract({
          address: ownership,
          abi: SERIES_OWNERSHIP_ABI,
          functionName: "claimOf",
          args: [series.quoteId, account],
        }),
        publicClient.readContract({
          address: ownership,
          abi: SERIES_OWNERSHIP_ABI,
          functionName: "bindingOf",
          args: [series.quoteId],
        }),
        publicClient.readContract({
          address: series.vault,
          abi: SERIES_VAULT_ABI,
          functionName: "positionOf",
          args: [series.marketId],
        }),
        publicClient.readContract({
          address: verifier,
          abi: SOLVENCY_VERIFIER_ABI,
          functionName: "latestSnapshot",
        }),
        publicClient.readContract({
          address: verifier,
          abi: SOLVENCY_VERIFIER_ABI,
          functionName: "snapshotCount",
        }),
      ]);

    // The ACL is read from NoxCompute, not inferred. The panel can therefore never claim a value is
    // readable when the chain says otherwise, nor show "encrypted" for something already published.
    const ownAcl =
      ownHandle === ZERO_HANDLE
        ? undefined
        : await readAcl(publicClient, session.network, ownHandle, account);

    setChain({
      ownHandle,
      ownAcl,
      claimState: Number(claim.state) as ClaimState,
      claimLockId: claim.lockId,
      boundEpochId: binding.epochId,
      boundGraphRoot: binding.graphRoot,
      allocatedCount: Number(binding.allocatedCount),
      closed: binding.closed,
      supplyHandle,
      creditUnits: position[0],
      pendingFee: position[2],
      coverage: snapshot.publicCoverage,
      solvencyBlock: snapshot.blockNumber,
      verdictHandle: snapshot.verdictHandle,
      snapshotCount: Number(snapshotCount),
      tokenSymbol: symbol,
    });
  }, [session, series]);

  useEffect(() => {
    void read().catch((error: unknown) => setFailure(classifyFailure(error)));
  }, [read]);

  const decryptOwn = useCallback(async (): Promise<void> => {
    if (chain === undefined) return;
    setFailure(undefined);
    setPhase("runner-queued");
    try {
      const value = await session.nox.decrypt(chain.ownHandle);
      // Into the in-memory map, and nowhere else.
      remember(chain.ownHandle, value);
      setPhase("done");
    } catch (error) {
      setPhase("idle");
      setFailure(classifyFailure(error));
    }
  }, [chain, session]);

  const readSupply = useCallback(async (): Promise<void> => {
    if (chain === undefined || chain.supplyHandle === ZERO_HANDLE) return;
    setFailure(undefined);
    setPhase("decryption-ready");
    try {
      const result = await session.nox.publicDecrypt(chain.supplyHandle);
      setSupply(result.value);
      const verdict = await session.nox.publicDecrypt(chain.verdictHandle);
      setSolvent(verdict.value === 1n);
      setPhase("done");
    } catch (error) {
      setPhase("idle");
      setFailure(classifyFailure(error));
    }
  }, [chain, session]);

  /**
   * Asks the gateway for another holder's balance, with this wallet.
   *
   * A SUCCESS HERE WOULD BE A DEFECT, and the panel says so before the attempt. The handle itself is
   * public — handles are addresses, not secrets — so fetching it proves nothing either way; what is
   * being tested is whether NoxCompute releases key material for it to a wallet that holds no grant.
   */
  const probePeer = useCallback(async (): Promise<void> => {
    const target = peer.trim();
    if (!/^0x[0-9a-fA-F]{40}$/.test(target)) {
      setPeerRefusal({
        kind: "public-invariant",
        detail: "that is not an address, so there is nothing to ask the gateway about",
      });
      return;
    }
    setPeerRefusal(undefined);
    setPeerProbed(false);
    try {
      const handle = await session.publicClient.readContract({
        address: series.addresses.KyrveSeriesToken,
        abi: SERIES_TOKEN_ABI,
        functionName: "confidentialBalanceOf",
        args: [target as `0x${string}`],
      });
      if (handle === ZERO_HANDLE) {
        setPeerRefusal({
          kind: "public-invariant",
          detail: `${target} holds no series balance on this chain, so there is nothing to refuse`,
        });
        return;
      }
      await session.nox.decrypt(handle);
      // Reached only if the gateway released a value it must not have.
      setPeerRefusal({
        kind: "public-invariant",
        detail:
          "the gateway returned a value for a handle this wallet holds no grant on. That is a " +
          "confidentiality failure, not a display problem.",
      });
    } catch (error) {
      setPeerRefusal(classifyFailure(error));
    } finally {
      setPeerProbed(true);
    }
  }, [peer, series, session]);

  const link = (kind: "tx" | "address", value: string): React.ReactElement => {
    const href = seriesExplorerLink(series, kind, value);
    return href === undefined ? (
      <span>{abbreviate(value)}</span>
    ) : (
      <a href={href} target="_blank" rel="noreferrer">
        {abbreviate(value)}
      </a>
    );
  };

  return (
    <section className="band" data-testid="ownership-band">
      <header className="band-head">
        <h2>Confidential series ownership</h2>
        {/*
          The connected account and the end-session control live in the masthead, once.
          They used to be duplicated here, which was harmless while the terminal was a single page
          and becomes a real defect the moment there are nineteen routes: two elements carrying the
          same `data-testid` make every assertion about them ambiguous, and a reader looking at two
          "disconnect" buttons cannot tell whether they do the same thing.
        */}
      </header>

      {/* ── The series, and the public position the claims are on ───────────────────────────── */}
      <dl className="facts">
        <div>
          <dt>Series</dt>
          <dd data-testid="series-id">{series.seriesId}</dd>
        </div>
        <div>
          <dt>Midnight market</dt>
          <dd data-testid="series-market">{link("address", series.marketId)}</dd>
        </div>
        <div>
          <dt>Maturity</dt>
          <dd data-testid="series-maturity">{formatMaturity(series.maturity)} UTC</dd>
        </div>
        <div>
          <dt>Series vault</dt>
          <dd data-testid="series-vault">{link("address", series.vault)}</dd>
        </div>
        <div>
          <dt>Quote</dt>
          <dd data-testid="quote-id">{series.quoteId}</dd>
        </div>
        <div>
          <dt>Epoch</dt>
          <dd data-testid="epoch-id">{series.epochId}</dd>
        </div>
        <div>
          <dt>Sealed graph root</dt>
          <dd data-testid="graph-root">{abbreviate(series.graphRoot)}</dd>
        </div>
        <div>
          <dt>Settlement</dt>
          <dd data-testid="settlement-tx">{link("tx", series.settlementTx)}</dd>
        </div>
        <div>
          <dt>Allocation</dt>
          <dd data-testid="allocation-tx">{link("tx", series.allocationTx)}</dd>
        </div>
      </dl>

      {/*
        The claim's provenance, read from the ownership registry rather than from the served record.
        If the registry's epoch and root disagreed with the record's, the record would be wrong — and
        showing the registry's is showing what the chain will enforce.
      */}
      {chain !== undefined ? (
        <dl className="facts">
          <div>
            <dt>This wallet's claim</dt>
            <dd data-testid="claim-state">{CLAIM_STATE_LABEL[chain.claimState]}</dd>
          </div>
          <div>
            <dt>Minted under epoch</dt>
            <dd data-testid="claim-epoch">
              {chain.boundEpochId === series.epochId
                ? "matches the epoch above"
                : `DISAGREES: ${abbreviate(chain.boundEpochId)}`}
            </dd>
          </div>
          <div>
            <dt>Minted under root</dt>
            <dd data-testid="claim-root">
              {chain.boundGraphRoot === series.graphRoot
                ? "matches the sealed root above"
                : `DISAGREES: ${abbreviate(chain.boundGraphRoot)}`}
            </dd>
          </div>
          <div>
            <dt>Holders on this quote</dt>
            <dd data-testid="allocated-count">
              {chain.allocatedCount} {chain.closed ? "(allocation sealed)" : "(open)"}
            </dd>
          </div>
        </dl>
      ) : null}

      {/* ── The private half ────────────────────────────────────────────────────────────────── */}
      <ConfidentialValue
        title="Your series balance"
        handle={chain?.ownHandle}
        acl={chain?.ownAcl}
        value={ownValue}
        // The claim is denominated in loan-token units of principal a provider committed — delta T-1
        // — so it renders at the loan token's precision. Showing the raw integer would invite a reader
        // to compare it against a figure of a different scale.
        decimals={series.loanTokenDecimals}
        onDecrypt={() => void decryptOwn()}
        busy={phase === "runner-queued"}
        testId="own-balance"
      />

      <p className="note">
        Decrypted in this browser only. No Kyrve server, log, metric or database receives it.
        Disconnecting clears it from memory immediately — it does not withdraw any grant, because
        Nox has none to withdraw.
      </p>

      {/* ── The public half ─────────────────────────────────────────────────────────────────── */}
      <dl className="facts">
        <div>
          <dt>Aggregate series supply</dt>
          <dd data-testid="aggregate-supply">
            {supply === undefined
              ? "not read yet"
              : `${formatUnits(supply.toString(), series.loanTokenDecimals)} ${chain?.tokenSymbol ?? ""}`}
          </dd>
        </div>
        <div>
          <dt>Public Midnight credit</dt>
          <dd data-testid="public-credit">
            {chain === undefined ? "reading…" : `${chain.creditUnits.toString()} units`}
          </dd>
        </div>
        <div>
          <dt>Public coverage at snapshot</dt>
          <dd data-testid="solvency-coverage">
            {chain === undefined ? "reading…" : chain.coverage.toString()}
          </dd>
        </div>
        <div>
          <dt>Solvency</dt>
          <dd data-testid="solvency-state">
            {solvent === undefined
              ? chain?.snapshotCount === 0
                ? "no snapshot taken"
                : "not verified yet"
              : solvent
                ? "verified solvent"
                : "INSOLVENT"}
          </dd>
        </div>
        <div>
          <dt>Snapshot block</dt>
          <dd data-testid="solvency-block">
            {chain === undefined ? "reading…" : chain.solvencyBlock.toString()}
          </dd>
        </div>
      </dl>

      <p className="note">
        Supply and the solvency verdict are read through the gateway's public-decryption path.
        Supply is public because the curve already published the same number as this epoch's
        aggregate; the verdict is one bit, and publishing it discloses nothing about the size of any
        claim. Both publications are irreversible — Nox has no un-publish.
      </p>

      <button type="button" data-testid="verify-supply" onClick={() => void readSupply()}>
        Read aggregate supply and verify solvency
      </button>

      {/* ── The proof that only the owner can read a balance ─────────────────────────────────── */}
      <div className="probe">
        <h3>Try to read another holder's balance</h3>
        <p className="note">
          A success here would be a confidentiality failure, not a feature. The handle is public;
          what is being tested is whether NoxCompute releases key material for it to a wallet
          holding no grant. It checks authorisation on chain before releasing anything, and nothing
          about the value leaks from the refusal.
        </p>
        <input
          type="text"
          data-testid="peer-address"
          placeholder="0x…"
          value={peer}
          onChange={(event) => setPeer(event.target.value)}
          spellCheck={false}
        />
        <button type="button" data-testid="attempt-peer-decrypt" onClick={() => void probePeer()}>
          Attempt to decrypt
        </button>
        {peerProbed ? (
          <div data-testid="peer-outcome" data-refusal={peerRefusal?.kind ?? "none"}>
            <Status failure={peerRefusal} phase="idle" testId="peer-refusal" />
          </div>
        ) : null}
      </div>

      {/* Other holders on this quote, so the probe can be aimed without guessing an address. */}
      {series.providers.length > 0 ? (
        <ul className="peers" data-testid="peer-list">
          {series.providers
            .filter((provider) => provider.toLowerCase() !== session.account.toLowerCase())
            .map((provider) => (
              <li key={provider}>
                <button type="button" onClick={() => setPeer(provider)}>
                  {abbreviate(provider)}
                </button>
              </li>
            ))}
        </ul>
      ) : null}

      <Status phase={phase} failure={failure} testId="ownership-status" />
    </section>
  );
}
