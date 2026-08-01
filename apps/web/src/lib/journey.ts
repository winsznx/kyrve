/**
 * What has actually happened, and therefore what to do next.
 *
 * ════════════════════════════════════════════════════════════════════════════════════════════
 * THE NEXT ACTION IS DERIVED FROM CHAIN STATE, NEVER FROM A STORED STEP NUMBER
 * ════════════════════════════════════════════════════════════════════════════════════════════
 *
 * A wizard that remembers "you are on step 3" is wrong the moment anything happens outside the tab —
 * another device, a keeper transaction, a page opened yesterday. Kyrve's steps are all on chain, so
 * the stage is READ rather than remembered: a provider who has a confidential balance and no mandate
 * is at "set your terms" whether or not they have ever seen this screen.
 *
 * That also makes refresh trivially correct. There is no client-side progress to restore, so
 * restoring public workflow state on reload is the same code path as loading it the first time.
 *
 * ════════════════════════════════════════════════════════════════════════════════════════════
 * ONLY PUBLIC FACTS DECIDE THE STAGE
 * ════════════════════════════════════════════════════════════════════════════════════════════
 *
 * Whether a handle EXISTS is public. What it contains is not, and nothing here decrypts. So the
 * journey knows "this wallet has a confidential balance" and never "how much" — which is exactly
 * enough to choose a next action, and is why the home screen can be useful before anything is
 * decrypted.
 */

import { useEffect, useState } from "react";
import type { Address, PublicClient } from "viem";

import {
  CAPSULE_READ_ABI,
  MANDATE_BOOK_ABI,
  MandateState,
  QUOTE_REGISTRY_ABI,
  REQUEST_BOOK_ABI,
  SERIES_OWNERSHIP_ABI,
  WRAPPED_ASSET_ABI,
} from "./abi.js";
import type { KyrveRecord } from "./records.js";
import { capsuleVaultsOf, layersOf, settlementsOf } from "./records.js";
import type { Role } from "./role.js";
import { QuoteStatus } from "./settlement.js";
import { UNIVERSE } from "./universe.js";

const ZERO_HANDLE = /^0x0+$/;
const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";

/** The stages a task passes through. Rendered as a timeline, with only the relevant ones shown. */
export type Stage =
  | "submitted"
  | "encrypted"
  | "computing"
  | "quote-ready"
  | "settled"
  | "ownership-allocated";

export const STAGE_LABEL: Readonly<Record<Stage, string>> = {
  submitted: "Submitted",
  encrypted: "Encrypted",
  computing: "Computing",
  "quote-ready": "Quote ready",
  settled: "Settled",
  "ownership-allocated": "Ownership allocated",
};

export interface NextAction {
  /** The state the reader needs to understand before deciding what to do. */
  readonly heading: string;
  /** The imperative, in the reader's language. */
  readonly label: string;
  readonly path: string;
  /** Why this is the next thing, in one sentence. */
  readonly why: string;
  /** True when there is nothing left to do and the flow is complete. */
  readonly complete?: boolean;
}

export interface JourneyState {
  readonly loading: boolean;
  /** Absent when no wallet has answered. The public half of every screen still renders. */
  readonly hasWallet: boolean;

  // ── Provider facts, all public ──────────────────────────────────────────────────────────
  readonly hasPublicBalance: boolean;
  readonly hasConfidentialBalance: boolean;
  readonly mandateState: MandateState;
  readonly mandateEpoch: number | undefined;
  readonly hasClaim: boolean;
  readonly claimSeriesId: `0x${string}` | undefined;

  // ── Borrower facts ──────────────────────────────────────────────────────────────────────
  readonly hasLiveRequest: boolean;
  readonly quoteStatus: QuoteStatus;
  readonly quoteId: `0x${string}` | undefined;
  readonly hasFinishedEpoch: boolean;

  // ── Auditor facts ───────────────────────────────────────────────────────────────────────
  readonly capsulesHeld: number;
  readonly firstCapsuleId: `0x${string}` | undefined;

  readonly stages: readonly Stage[];
  readonly reached: ReadonlySet<Stage>;
  readonly next: NextAction;
  readonly error: string | undefined;
}

const EMPTY: JourneyState = {
  loading: true,
  hasWallet: false,
  hasPublicBalance: false,
  hasConfidentialBalance: false,
  mandateState: MandateState.None,
  mandateEpoch: undefined,
  hasClaim: false,
  claimSeriesId: undefined,
  hasLiveRequest: false,
  quoteStatus: QuoteStatus.None,
  quoteId: undefined,
  hasFinishedEpoch: false,
  capsulesHeld: 0,
  firstCapsuleId: undefined,
  stages: [],
  reached: new Set(),
  next: {
    heading: "Connect a wallet to begin",
    label: "Connect a wallet",
    path: "/app/start",
    why: "Kyrve binds every encrypted submission to the wallet that signs it.",
  },
  error: undefined,
};

/**
 * Reads every public fact the home screen needs, in one pass.
 *
 * Failures are collected rather than thrown: a node that will not answer must produce "we could not
 * check" on the screen, not a blank page. Every field keeps its safe default, so the interface
 * degrades to "connect and begin" rather than to a confident wrong state.
 */
export function useJourney(
  record: KyrveRecord,
  publicClient: PublicClient,
  account: Address | undefined,
  role: Role,
): JourneyState {
  const [state, setState] = useState<JourneyState>(EMPTY);

  useEffect(() => {
    let live = true;

    void (async () => {
      if (account === undefined) {
        if (live) setState({ ...EMPTY, loading: false });
        return;
      }

      const layers = layersOf(record);
      const settlement = settlementsOf(record)[0]?.settlement;
      const vaults = capsuleVaultsOf(record);
      const facts = { ...EMPTY, loading: false, hasWallet: true } as {
        -readonly [K in keyof JourneyState]: JourneyState[K];
      };

      const read = async <T>(what: () => Promise<T>, fallback: T): Promise<T> => {
        try {
          return await what();
        } catch {
          return fallback;
        }
      };

      try {
        // ── Provider ────────────────────────────────────────────────────────────────────
        const publicBalance = await read(
          () =>
            publicClient.readContract({
              address: record.addresses.TestUnderlyingERC20,
              abi: WRAPPED_ASSET_ABI,
              functionName: "confidentialBalanceOf",
              args: [account],
            }) as Promise<`0x${string}`>,
          "0x" as `0x${string}`,
        );
        facts.hasPublicBalance = publicBalance !== "0x";

        const confidential = await read(
          () =>
            publicClient.readContract({
              address: record.addresses.KyrveWrappedAsset,
              abi: WRAPPED_ASSET_ABI,
              functionName: "confidentialBalanceOf",
              args: [account],
            }) as Promise<`0x${string}`>,
          `0x${"00".repeat(32)}` as `0x${string}`,
        );
        facts.hasConfidentialBalance = !ZERO_HANDLE.test(confidential);

        const mandateId = await read(
          () =>
            publicClient.readContract({
              address: record.addresses.EncryptedMandateBook,
              abi: MANDATE_BOOK_ABI,
              functionName: "mandateIdFor",
              args: [account, UNIVERSE],
            }) as Promise<`0x${string}`>,
          `0x${"00".repeat(32)}` as `0x${string}`,
        );
        const mandate = await read(
          () =>
            publicClient.readContract({
              address: record.addresses.EncryptedMandateBook,
              abi: MANDATE_BOOK_ABI,
              functionName: "mandateOf",
              args: [mandateId],
            }) as Promise<{ provider: Address; activeEpoch: number; state: number }>,
          { provider: ZERO_ADDRESS as Address, activeEpoch: 0, state: 0 },
        );
        if (mandate.provider !== ZERO_ADDRESS) {
          facts.mandateState = mandate.state as MandateState;
          facts.mandateEpoch = mandate.activeEpoch;
        }

        for (const layer of layers) {
          const claim = await read(
            () =>
              publicClient.readContract({
                address: layer.series.addresses.SeriesOwnershipRegistry,
                abi: SERIES_OWNERSHIP_ABI,
                functionName: "claimOf",
                args: [layer.series.quoteId, account],
              }) as Promise<{ state: number }>,
            { state: 0 },
          );
          if (claim.state === 1) {
            facts.hasClaim = true;
            facts.claimSeriesId = layer.series.seriesId;
            break;
          }
        }

        // ── Borrower ────────────────────────────────────────────────────────────────────
        const liveRequest = await read(
          () =>
            publicClient.readContract({
              address: record.addresses.ConfidentialRequestBook,
              abi: REQUEST_BOOK_ABI,
              functionName: "liveRequest",
              args: [account, UNIVERSE],
            }) as Promise<`0x${string}`>,
          `0x${"00".repeat(32)}` as `0x${string}`,
        );
        facts.hasLiveRequest = !ZERO_HANDLE.test(liveRequest);
        facts.hasFinishedEpoch = settlement !== undefined;

        const quoteId = layers[0]?.series.quoteId;
        if (settlement !== undefined && quoteId !== undefined) {
          const execution = await read(
            () =>
              publicClient.readContract({
                address: settlement.addresses.KyrveQuoteRegistry,
                abi: QUOTE_REGISTRY_ABI,
                functionName: "executionOf",
                args: [quoteId],
              }) as Promise<{ status: number; vault: Address }>,
            { status: 0, vault: ZERO_ADDRESS as Address },
          );
          if (execution.vault !== ZERO_ADDRESS) {
            facts.quoteStatus = execution.status as QuoteStatus;
            facts.quoteId = quoteId;
          }
        }

        // ── Auditor ─────────────────────────────────────────────────────────────────────
        for (const { vault } of vaults) {
          const held = await read(
            () =>
              publicClient.readContract({
                address: vault,
                abi: CAPSULE_READ_ABI,
                functionName: "capsulesFor",
                args: [account],
              }) as Promise<readonly `0x${string}`[]>,
            [],
          );
          if (held.length > 0) {
            facts.capsulesHeld += held.length;
            facts.firstCapsuleId ??= held[0];
          }
        }
      } catch (error) {
        facts.error = error instanceof Error ? error.message : String(error);
      }

      const { stages, reached } = timeline(role, facts);
      if (live) setState({ ...facts, stages, reached, next: chooseNext(role, facts) });
    })();

    return () => {
      live = false;
    };
  }, [record, publicClient, account, role]);

  return state;
}

/** The stages worth showing for this role, and how far they have got. */
function timeline(
  role: Role,
  facts: JourneyState,
): { stages: readonly Stage[]; reached: ReadonlySet<Stage> } {
  const reached = new Set<Stage>();

  if (role === "provider") {
    const stages: Stage[] = [
      "submitted",
      "encrypted",
      "computing",
      "settled",
      "ownership-allocated",
    ];
    if (facts.hasConfidentialBalance) reached.add("submitted");
    if (facts.mandateState === MandateState.Active) {
      reached.add("encrypted");
      reached.add("computing");
    }
    if (facts.quoteStatus === QuoteStatus.Consumed) reached.add("settled");
    if (facts.hasClaim) reached.add("ownership-allocated");
    return { stages, reached };
  }

  if (role === "borrower") {
    const stages: Stage[] = ["submitted", "encrypted", "computing", "quote-ready", "settled"];
    if (facts.hasLiveRequest) {
      reached.add("submitted");
      reached.add("encrypted");
    }
    if (facts.hasFinishedEpoch) reached.add("computing");
    if (facts.quoteStatus === QuoteStatus.Executable) reached.add("quote-ready");
    if (facts.quoteStatus === QuoteStatus.Consumed) {
      reached.add("quote-ready");
      reached.add("settled");
    }
    return { stages, reached };
  }

  const stages: Stage[] = ["settled", "ownership-allocated"];
  if (facts.hasFinishedEpoch) reached.add("settled");
  if (facts.capsulesHeld > 0) reached.add("ownership-allocated");
  return { stages, reached };
}

/**
 * The single dominant action.
 *
 * Exactly one, always. A screen offering three equally weighted things is a screen that has not
 * decided, and the reader then has to model the protocol to choose — which is the problem this whole
 * correction exists to remove.
 */
function chooseNext(role: Role, facts: JourneyState): NextAction {
  if (!facts.hasWallet) return EMPTY.next;

  if (role === "provider") {
    if (!facts.hasConfidentialBalance) {
      return {
        heading: "Your capital is not in the private workspace yet",
        label: "Add capital to begin",
        path: "/app/fund",
        why: "You hold no confidential balance yet. Lending terms without capital behind them cannot be filled.",
      };
    }
    if (facts.mandateState === MandateState.None) {
      return {
        heading: "Your capital is ready for private lending terms",
        label: "Define your lending terms",
        path: "/app/mandates",
        why: "Your capital is confidential and idle. Terms tell the private matching what you will lend, where, and at what floor.",
      };
    }
    if (facts.mandateState === MandateState.Paused) {
      return {
        heading: "Your lending terms are paused",
        label: "Resume your lending terms",
        path: "/app/mandates",
        why: "Your terms are paused, so nothing will be matched against them.",
      };
    }
    if (facts.mandateState === MandateState.Retired) {
      return {
        heading: "Your lending terms are retired",
        label: "Review your position",
        path: "/app/series",
        why: "Your terms are retired permanently. Anything already allocated to you is still yours.",
        complete: true,
      };
    }
    if (facts.hasClaim) {
      return {
        heading: "You hold settled credit",
        label: "Share a disclosure",
        path: "/app/capsules",
        why: "You own settled credit. A disclosure grants one reviewer one frozen value and nothing else.",
        complete: true,
      };
    }
    return {
      heading: "Your lending terms are live",
      label: "View matching status",
      path: "/app/curve",
      why: "No allocation exists until a matching run selects one quote. Your rate floor, budget and allocation stay encrypted throughout.",
    };
  }

  if (role === "borrower") {
    if (!facts.hasLiveRequest && facts.quoteStatus === QuoteStatus.None) {
      return {
        heading: "You have not submitted a borrowing request",
        label: "Request a confidential quote",
        path: "/app/request",
        why: "State privately how much you need and the most you will pay. Only the bond is public.",
      };
    }
    if (facts.quoteStatus === QuoteStatus.Executable) {
      return {
        heading: "One quote is ready for your decision",
        label: "Review and settle your quote",
        path: "/app/quotes",
        why: "One quote is executable. Settling takes it at exactly its size. A partial fill is refused.",
      };
    }
    if (facts.quoteStatus === QuoteStatus.Consumed) {
      return {
        heading: "Your quote settled at its exact size",
        label: "View your debt and its proof",
        path: `/app/quotes/${facts.quoteId ?? ""}`,
        why: "Your quote settled through unmodified Midnight. The credit position is public; who owns it is not.",
        complete: true,
      };
    }
    return {
      heading: "Your request is waiting for matching",
      label: "View matching status",
      path: "/app/curve",
      why: "Your request is sealed. The confidential engine is evaluating it against every eligible lender.",
    };
  }

  if (facts.capsulesHeld > 0) {
    return {
      heading: "A frozen disclosure is ready for you",
      label: "Open your disclosure",
      path: `/app/capsules/${facts.firstCapsuleId ?? ""}`,
      why: "Somebody granted you a frozen snapshot. You can decrypt that one value and nothing else.",
    };
  }
  return {
    heading: "Public deployment evidence is ready to check",
    label: "Verify the deployment",
    path: "/proof/deployment",
    why: "No disclosure has been granted to this wallet. Everything public can still be recomputed from chain state.",
  };
}
