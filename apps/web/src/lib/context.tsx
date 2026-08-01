/**
 * The one place the terminal learns what it is pointed at, and who is holding it.
 *
 * ════════════════════════════════════════════════════════════════════════════════════════════
 * READING AND SIGNING ARE DELIBERATELY SEPARATE
 * ════════════════════════════════════════════════════════════════════════════════════════════
 *
 * `publicClient` exists as soon as the record loads and needs no wallet. `session` exists only once
 * a wallet has answered. Every proof page, every public panel and the whole of `/` work on the first
 * alone, because the audience for a verification page is someone checking Kyrve who holds no
 * position in it — a page that demanded a wallet before it would show a recomputation would be
 * unusable by exactly the reader it is for.
 *
 * Conversely nothing confidential works without a session, and that is structural rather than
 * policy: `Nox.fromExternal` binds a proof to the wallet that is the DIRECT CALLER, so there is no
 * read-only mode that could stand in for one and no relayer that could be inserted.
 *
 * ════════════════════════════════════════════════════════════════════════════════════════════
 * WHY CONNECTING IS EXPLICIT
 * ════════════════════════════════════════════════════════════════════════════════════════════
 *
 * A page that opened a wallet session on load would prompt every visitor to `/` for an account, and
 * would silently re-open one for a provider who had just locked the session to clear a decrypted
 * balance off the screen. Connecting is an action; reconnecting is the same action.
 *
 * The one exception is a local development key injected into the page by the browser demonstration.
 * That connects immediately, because the demonstration is driving a real Chromium against a real
 * stack and a click-to-connect step there would test the click rather than the protocol.
 */

import type { NoxNetwork } from "@kyrve/nox";
import { useConnectModal } from "@rainbow-me/rainbowkit";
import {
  createContext,
  type ReactElement,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { PublicClient } from "viem";
import { useAccount, useWalletClient } from "wagmi";
import { noxNetworkFor } from "./deployment.js";
import type { LifecycleState } from "./lifecycle.js";
import { type KyrveRecord, loadRecord } from "./records.js";
import { safeErrorMessage } from "./redact.js";
import { hasOnboarded, markOnboarded, type Role, readRole, writeRole } from "./role.js";
import {
  lock,
  openPublicClient,
  openSession,
  openSessionFromWallet,
  type Session,
} from "./session.js";

/** How the wallet half of the terminal is doing. Four states, none of them a spinner. */
export type WalletState =
  | "not-connected"
  | "connecting"
  | "connected"
  /** Ended deliberately. Distinct from never-connected: it must not silently re-open. */
  | "ended";

export interface Kyrve {
  readonly record: KyrveRecord;
  readonly network: NoxNetwork;
  readonly publicClient: PublicClient;
  readonly rpcUrl: string;
  readonly session: Session | undefined;
  readonly walletState: WalletState;
  /** Present when connecting failed. Redacted; never carries an RPC credential. */
  readonly walletFailure: string | undefined;
  readonly connect: () => Promise<void>;
  /** Clears every decrypted value from memory. NOT a revocation — Nox has none to offer. */
  readonly disconnect: () => void;

  /**
   * Who the reader has said they are, and whether they have been introduced.
   *
   * `undefined` means they have not chosen, which is a real state rather than a default: guessing a
   * role would put a borrower in front of lending terms and teach them the product is not for them.
   */
  readonly role: Role | undefined;
  readonly onboarded: boolean;
  readonly chooseRole: (role: Role) => void;
  readonly completeOnboarding: () => void;
}

const KyrveContext = createContext<Kyrve | undefined>(undefined);

/** The terminal's context. Throws rather than returning a plausible empty one. */
export function useKyrve(): Kyrve {
  const value = useContext(KyrveContext);
  if (value === undefined) {
    throw new Error("useKyrve was called outside the provider, so there is no deployment to read");
  }
  return value;
}

/**
 * The wallet session, or the reason there is not one.
 *
 * Returns `undefined` rather than throwing, so a page can render its public half and name the
 * missing wallet in place of the confidential half instead of failing whole.
 */
export function useSession(): Session | undefined {
  return useKyrve().session;
}

/** The lifecycle state a page should show when it needs a wallet and does not have one. */
export function walletLifecycle(state: WalletState): LifecycleState | undefined {
  if (state === "connecting") return "waiting-for-wallet";
  if (state === "not-connected" || state === "ended") return "waiting-for-wallet";
  return undefined;
}

export interface BootState {
  readonly record: KyrveRecord | undefined;
  readonly error: string | undefined;
}

export interface KyrveProviderProps {
  readonly children: ReactNode;
  /** Rendered while the record is loading, and when it cannot be loaded. */
  readonly fallback: (boot: BootState) => ReactElement;
}

export function KyrveProvider({ children, fallback }: KyrveProviderProps): ReactElement {
  const [boot, setBoot] = useState<BootState>({ record: undefined, error: undefined });
  /*
    RainbowKit's modal opener.

    Read here rather than at each call site so that every control in the product which says "connect
    wallet" opens the same chooser. The onboarding step used to own its own button and got a no-op.
  */
  const { openConnectModal } = useConnectModal();

  // RainbowKit's connection, read through wagmi. Undefined until somebody connects.
  const { address: wagmiAccount } = useAccount();
  const { data: wagmiClient } = useWalletClient();
  const [session, setSession] = useState<Session>();
  const [walletState, setWalletState] = useState<WalletState>("not-connected");

  /**
   * Whether a session is currently open, readable without depending on it.
   *
   * The wallet effect below both writes `walletState` and needs to know it, and a `useState` cannot
   * serve both without the effect invalidating itself. See the note on that effect's dependencies.
   */
  const opened = useRef(false);
  const [walletFailure, setWalletFailure] = useState<string>();

  /*
    The wallet state as of the last render, for effects that must ASK about it without OBSERVING it.
    Reading it from the dependency array instead is what produced the connect loop described below.
  */
  const stateRef = useRef<WalletState>(walletState);
  stateRef.current = walletState;
  const [role, setRole] = useState<Role | undefined>(() => readRole());
  const [onboarded, setOnboarded] = useState<boolean>(() => hasOnboarded());

  const chooseRole = useCallback((next: Role): void => {
    writeRole(next);
    setRole(next);
  }, []);

  const completeOnboarding = useCallback((): void => {
    markOnboarded();
    setOnboarded(true);
  }, []);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const record = await loadRecord();
        if (!cancelled) setBoot({ record, error: undefined });
      } catch (error) {
        if (!cancelled) setBoot({ record: undefined, error: safeErrorMessage(error) });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  /*
   * Where the chain is, in precedence order.
   *
   *   1. an injected URL — the browser demonstration and local development hand one in
   *   2. a same-origin `/rpc` proxy, on any deployment that is not a local dev server
   *   3. the local node
   *
   * Step 2 is what keeps the provider credential out of the bundle. The browser talks to its own
   * origin and the Worker attaches the key server-side; a URL with a key compiled into an asset
   * would ship it to every visitor, which `verify:bundles` fails the build for.
   */
  const rpcUrl =
    window.__KYRVE_RPC_URL__ ??
    (window.location.hostname === "127.0.0.1" || window.location.hostname === "localhost"
      ? "http://127.0.0.1:8545"
      : `${window.location.origin}/rpc`);

  const network = useMemo(() => {
    if (boot.record === undefined) return undefined;
    return noxNetworkFor(
      boot.record,
      window.__KYRVE_NOX_GATEWAY__ ?? boot.record.gatewayUrl ?? undefined,
    );
  }, [boot.record]);

  const publicClient = useMemo(
    () => (network === undefined ? undefined : openPublicClient(network, rpcUrl)),
    [network, rpcUrl],
  );

  /**
   * Two adapters behind one action.
   *
   * ════════════════════════════════════════════════════════════════════════════════════════════
   * THE REAL PATH OPENS RAINBOWKIT; THE TEST PATH NEVER DOES
   * ════════════════════════════════════════════════════════════════════════════════════════════
   *
   * With an injected key this connects deterministically: the path four browser suites drive. It
   * cannot be reached from a URL — nothing here reads `location.search` — and it cannot be reached
   * at all unless the harness put the key on `window` before the first script ran, which only
   * `addInitScript` can do.
   *
   * Without one, it opens RainbowKit's modal. It used to return, on the assumption that the header
   * control was the only way a real visitor would ever connect — which was true of the header and
   * false of the onboarding step, where the same action is the whole point of the screen and did
   * nothing at all when clicked.
   *
   * That is the failure this codebase is most careful about, arriving from the other direction. A
   * silent no-op is correct for a CONFIDENTIAL refusal, where a reason would be an oracle. This is a
   * public UI action, and a public action that fails silently is just broken.
   */
  const connect = useCallback(async (): Promise<void> => {
    if (network === undefined) return;
    if (window.__KYRVE_LOCAL_KEY__ === undefined) {
      /*
        Undefined while RainbowKit is still mounting its modal context. Nothing to fall back to —
        opening a wallet chooser is the only thing this can mean — so it reports rather than
        pretending the click was received.
      */
      if (openConnectModal === undefined) {
        setWalletFailure("The wallet chooser is still loading. Try again in a moment.");
        return;
      }
      openConnectModal();
      return;
    }
    setWalletState("connecting");
    setWalletFailure(undefined);
    try {
      setSession(await openSession(network, rpcUrl));
      setWalletState("connected");
    } catch (error) {
      setWalletFailure(safeErrorMessage(error));
      setWalletState("not-connected");
    }
  }, [network, rpcUrl, openConnectModal]);

  /**
   * Ends the session and clears every decrypted value from memory, immediately.
   *
   * NOT A REVOCATION, and no surface in this product may call it one. The wallet keeps every ACL
   * grant it held — Nox has no `removeAdmin` and no `removeViewer` — so this is a local-display
   * action. What it does guarantee is that a screenshot taken a moment later cannot contain a
   * private balance.
   */
  const disconnect = useCallback((): void => {
    lock();
    setSession(undefined);
    setWalletState("ended");
  }, []);

  /**
   * The injected local key connects without a click.
   *
   * Only when the page was handed one, which happens in the browser demonstration and in local
   * development. A real wallet is never auto-connected.
   */
  useEffect(() => {
    if (network === undefined) return;
    if (window.__KYRVE_LOCAL_KEY__ === undefined) return;
    if (stateRef.current !== "not-connected") return;
    void connect();
  }, [network, connect]);

  /**
   * The production adapter: whatever RainbowKit connected becomes a Kyrve session.
   *
   * wagmi hands back a viem `WalletClient`, which is exactly what `Session` already holds — so every
   * route, panel and protocol action downstream is identical whichever adapter connected. That is
   * why adding RainbowKit changed no protocol code and broke no passing suite.
   *
   * The effect also covers account switching and disconnection from the wallet's own UI: when
   * `wagmiClient` or `wagmiAccount` changes, the session is rebuilt against the new signer rather
   * than left bound to the previous one, which would sign as somebody the user is no longer.
   *
   * ════════════════════════════════════════════════════════════════════════════════════════════
   * IT MUST NOT DEPEND ON THE STATE IT SETS
   * ════════════════════════════════════════════════════════════════════════════════════════════
   *
   * `walletState` was in the dependency array and is set in the body. Connecting therefore ran:
   * set "connecting" -> state changed -> effect re-runs -> cleanup abandons the in-flight session
   * build -> set "connecting" -> forever. The interface sat on "Waiting for your wallet…" while the
   * wallet reported itself connected, and each iteration built another handle client, so a wallet
   * extension's console filled with hundreds of repeated `eth_call`s.
   *
   * The state was only ever read to decide whether a disconnection should clear an existing session,
   * which is a question about the PREVIOUS render. A ref answers it without making the effect
   * observe its own writes.
   */
  useEffect(() => {
    if (network === undefined) return;
    if (window.__KYRVE_LOCAL_KEY__ !== undefined) return;

    if (wagmiClient === undefined || wagmiAccount === undefined) {
      // Disconnected in the wallet. Clear decrypted values with it: a balance decrypted by an
      // account that is no longer connected must not stay on screen.
      //
      // Read through a ref rather than from `walletState` directly. This effect WRITES that state,
      // and depending on what it writes is what made the deployed build reconnect forever — see the
      // note on the dependency array below.
      if (opened.current) {
        opened.current = false;
        lock();
        setSession(undefined);
        setWalletState("not-connected");
      }
      return;
    }

    let live = true;
    setWalletState("connecting");
    void (async () => {
      try {
        const next = await openSessionFromWallet(network, rpcUrl, wagmiClient, wagmiAccount);
        if (!live) return;
        opened.current = true;
        setSession(next);
        setWalletState("connected");
        setWalletFailure(undefined);
      } catch (error) {
        if (!live) return;
        opened.current = false;
        setWalletFailure(safeErrorMessage(error));
        setWalletState("not-connected");
      }
    })();
    return () => {
      live = false;
    };
    /*
     * `walletState` is NOT a dependency, and adding it back breaks the product.
     *
     * This effect sets `walletState` on both of its paths. Listing it here made every successful
     * connection invalidate the effect that had just produced it: connect, open a session, set
     * "connected", re-run, set "connecting", open another session, forever. In the deployed build
     * that presented as a connect button stuck on "Waiting for your wallet…" beside a wallet that
     * was plainly connected, and a console filling with `eth_call` at several per second.
     *
     * It cost hours precisely because both symptoms pointed away from the cause: the button read as
     * a connector problem and the flood read as an RPC problem. Neither was. The disconnect branch
     * reads `opened` instead, which is a ref for exactly this reason — it carries the same fact
     * without making this effect depend on its own output.
     */
  }, [network, rpcUrl, wagmiClient, wagmiAccount]);

  if (boot.record === undefined || network === undefined || publicClient === undefined) {
    return fallback(boot);
  }

  const value: Kyrve = {
    record: boot.record,
    network,
    publicClient,
    rpcUrl,
    session,
    walletState,
    walletFailure,
    connect,
    disconnect,
    role,
    onboarded,
    chooseRole,
    completeOnboarding,
  };

  return <KyrveContext.Provider value={value}>{children}</KyrveContext.Provider>;
}
