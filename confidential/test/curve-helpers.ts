/**
 * The Phase 3 harness: a complete curve epoch against the REAL local Nox stack.
 *
 * Everything here runs with the pinned iExec KMS, handle gateway, ingestor and runner at 0.6.0 in
 * Docker. Every handle is a real handle, every proof is a real gateway signature, every refused
 * decryption is a real refusal driven by a real on-chain ACL read, and every published value is a
 * real `allowPublicDecryption`. A mocked NoxCompute would be a mocked confidentiality path and is
 * forbidden — so if Docker is down these tests do not run, and the gate says NOT VERIFIED rather
 * than reporting green.
 *
 * The client side goes exclusively through `@kyrve/nox`, which `scripts/verify/import-boundary.ts`
 * enforces. The only direct `@iexec-nox` import is the Hardhat plugin that boots the stack.
 */

import assert from "node:assert/strict";

import {
  buildUniverse,
  type CurveRequest,
  type CurveResult,
  computeCurve,
  type Mandate,
  makeGrid,
  makeMandate,
  makeMarket,
  makeRequest,
  makeUniverseDraft,
  type Provider,
  UNIT,
  type Universe,
} from "@kyrve/curve";
import {
  encryptMandate,
  encryptRequest,
  grantHandleAccess,
  type Handle,
  type KyrveHandleClient,
  readAcl,
} from "@kyrve/nox";
import { keccak256, toHex } from "viem";

import {
  clientFor,
  deployHarness,
  flattenError,
  type Harness,
  LOCAL_NOX_NETWORK,
  mine,
  SUITE_POLL,
} from "./helpers.js";

/**
 * The poll policy a FULL-SCALE epoch needs.
 *
 * MEASURED, not guessed. A 16 x 128 epoch issues roughly fifteen thousand Nox operations, and the
 * off-chain runner processes them asynchronously with no callback into the contract — readiness is
 * discoverable only by polling. At that volume the runner falls minutes behind the chain, and the
 * suite's ordinary 30-second policy gives up long before the first published handle is computable.
 *
 * That is not a defect and it is not a Kyrve latency: it is the honest throughput of the stack at
 * launch scale, and it is exactly the number a keeper's timeout has to be sized against. Recorded
 * in `evidence/phase3/stage-gas.json` and as delta R-7. Testnet latency remains UNVERIFIED (AS-1).
 */
export interface PollOptions {
  readonly policy: {
    readonly initialDelayMs: number;
    readonly maxDelayMs: number;
    readonly multiplier: number;
    readonly timeoutMs: number;
  };
}

export const BENCH_POLL: PollOptions = {
  policy: { initialDelayMs: 1_000, maxDelayMs: 15_000, multiplier: 2, timeoutMs: 900_000 },
} as const;

/** Matches `QuoteEpochController.Stage`. */
export const STAGE = {
  Open: 0,
  CacheProviders: 1,
  Accumulate: 2,
  FinalizeLeaves: 3,
  ReduceWinner: 4,
  PublishWinner: 5,
  Allocate: 6,
  PublishAggregate: 7,
  Complete: 8,
  Cancelled: 9,
} as const;

/** Matches `CurveGraphRegistry.ResultRole`. */
export const ROLE = {
  SelectedMarketIndex: 0,
  SelectedRateIndex: 1,
  PrivacyFloorPassed: 2,
  QuoteReady: 3,
  AggregateFillAmount: 4,
} as const;

export interface CurveHarness extends Harness {
  universes: any;
  epochs: any;
  graph: any;
  ledger: any;
  engine: any;
  verifier: any;
  curator: any;
}

/** Deploys the Phase 2 layer, then the Phase 3 layer on top, and binds the engine once. */
export async function deployCurveHarness(): Promise<CurveHarness> {
  const base = await deployHarness();
  const curator = base.wallets[0];

  const universes = await base.connection.viem.deployContract("CurveUniverseRegistry", [
    curator.account.address,
  ]);
  const epochs = await base.connection.viem.deployContract("QuoteEpochController", [
    universes.address,
    base.mandateBook.address,
    base.requestBook.address,
  ]);
  const graph = await base.connection.viem.deployContract("CurveGraphRegistry", [epochs.address]);
  const ledger = await base.connection.viem.deployContract("ReservationLedger", [
    base.controller.address,
  ]);
  const engine = await base.connection.viem.deployContract("NoxCurveEngine", [
    universes.address,
    epochs.address,
    graph.address,
    ledger.address,
    base.mandateBook.address,
    base.requestBook.address,
    base.vault.address,
    base.controller.address,
  ]);
  const verifier = await base.connection.viem.deployContract("CurveResultVerifier", [
    graph.address,
    engine.address,
    epochs.address,
  ]);

  // One-shot bindings. The three contracts reference the engine and the engine references them, so
  // one side of the cycle cannot be a constructor argument; `bindEngine` reverts forever after.
  await mine(base, await epochs.write.bindEngine([engine.address], { account: curator.account }));
  await mine(base, await graph.write.bindEngine([engine.address], { account: curator.account }));
  await mine(base, await ledger.write.bindEngine([engine.address], { account: curator.account }));

  return { ...base, universes, epochs, graph, ledger, engine, verifier, curator };
}

export interface UniverseOptions {
  readonly label?: string;
  readonly markets?: number;
  readonly ratesPerMarket?: number;
  readonly maxProviders?: number;
  readonly privacyFloor?: number;
  readonly minTicketAssets?: bigint;
  readonly cellsPerChunk?: number;
}

/**
 * Creates and activates a universe on chain, and returns the matching plaintext model of it.
 *
 * Both come from ONE draft. Building the on-chain universe and the reference universe separately
 * is how demonstration 20 would end up comparing two things that were never given the same inputs.
 */
export async function createUniverse(
  h: CurveHarness,
  options: UniverseOptions = {},
): Promise<{ universeId: `0x${string}`; universe: Universe }> {
  const markets = options.markets ?? 4;
  const ratesPerMarket = options.ratesPerMarket ?? 16;
  const label = options.label ?? `kyrve-curve-${markets}x${ratesPerMarket}-${Date.now()}`;

  const draft = makeUniverseDraft({
    label,
    chainId: 31337,
    registry: h.universes.address,
    markets,
    ratesPerMarket,
    maxProviders: options.maxProviders ?? 16,
    privacyFloor: options.privacyFloor ?? 2,
    minTicketAssets: options.minTicketAssets ?? UNIT,
    cellsPerChunk: options.cellsPerChunk ?? 64,
  });
  const universe = buildUniverse(draft);

  await mine(
    h,
    await h.universes.write.createUniverse(
      [label, draft.maxProviders, draft.privacyFloor, draft.minTicketAssets, draft.cellsPerChunk],
      { account: h.curator.account },
    ),
  );

  for (const grid of draft.markets) {
    await mine(
      h,
      await h.universes.write.addMarket(
        [
          universe.id,
          {
            marketId: grid.spec.marketId,
            marketStructHash: grid.spec.marketStructHash,
            maturity: grid.spec.maturity,
            collateralFamily: grid.spec.collateralFamily,
            maturityBucket: grid.spec.maturityBucket,
            tickSpacing: grid.spec.tickSpacing,
            settlementFeeFloorWad: grid.spec.settlementFeeFloorWad,
            publicPriority: grid.spec.publicPriority,
          },
          grid.ticks,
          grid.pricesWad,
        ],
        { account: h.curator.account },
      ),
    );
  }

  await mine(
    h,
    await h.universes.write.activateUniverse([universe.id], { account: h.curator.account }),
  );

  // The on-chain id must be the id the reference model derived, or every later binding compares
  // two different universes and agrees for the wrong reason.
  const onChainId = await h.universes.read.universeIdFor([label]);
  assert.equal(
    onChainId.toLowerCase(),
    universe.id.toLowerCase(),
    "universe id derivation drifted",
  );
  assert.equal(await h.universes.read.leafCount([universe.id]), BigInt(universe.leaves.length));

  return { universeId: universe.id, universe };
}

export interface ProviderSetup {
  readonly walletIndex: number;
  readonly mandate?: Partial<Mandate>;
  /** Confidential vault balance to fund. Defaults to a generous amount. */
  readonly balance?: bigint;
}

export interface SealedProviderState {
  readonly walletIndex: number;
  readonly address: `0x${string}`;
  readonly mandateId: `0x${string}`;
  readonly mandateEpoch: number;
  readonly mandate: Mandate;
  readonly balance: bigint;
  readonly balanceHandle: Handle;
  readonly client: KyrveHandleClient;
}

/**
 * Wraps public test USDC, deposits it confidentially, submits an encrypted mandate, and grants the
 * engine and the ledger access to exactly the handles they need.
 *
 * The grants are 36 separate transactions per provider — 35 mandate handles plus the vault balance
 * — because `INoxCompute` 0.2.4 has no batch entry point and `allow` is gated on the caller already
 * holding access, so nothing can make them on the provider's behalf. That cost is real and is
 * recorded rather than hidden behind a helper that makes it look free.
 */
export async function setupProvider(
  h: CurveHarness,
  universeId: `0x${string}`,
  setup: ProviderSetup,
): Promise<SealedProviderState> {
  const wallet = h.wallets[setup.walletIndex];
  const address = wallet.account.address as `0x${string}`;
  const client = await clientFor(h, setup.walletIndex);
  const balance = setup.balance ?? 2_000n * UNIT;
  const mandate = makeMandate(setup.mandate ?? {});

  // Public by construction: the wrap amount is a plain uint256 in calldata and cannot be hidden.
  if (balance > 0n) {
    await mine(
      h,
      await h.underlying.write.mint([address, balance], { account: h.wallets[0].account }),
    );
    await mine(
      h,
      await h.underlying.write.approve([h.asset.address, balance], { account: wallet.account }),
    );
    await mine(h, await h.asset.write.wrap([address, balance], { account: wallet.account }));

    // ERC-7984 has no per-amount allowance, so the operator window is all-or-nothing. The honest
    // pattern is grant, deposit, `until = 0` — and the window is capped at seven days by the asset.
    const until = BigInt(Math.floor(Date.now() / 1000) + 3_600);
    await mine(
      h,
      await h.asset.write.setOperator([h.vault.address, until], { account: wallet.account }),
    );

    const encrypted = await client.encrypt(balance, "euint256", h.vault.address);
    const nonce = await h.vault.read.nextNonce([address]);
    await mine(
      h,
      await h.vault.write.deposit([encrypted.handle, encrypted.proof, nonce], {
        account: wallet.account,
      }),
    );
    await mine(
      h,
      await h.asset.write.setOperator([h.vault.address, 0n], { account: wallet.account }),
    );
  }

  const encoded = await encryptMandate(client, h.mandateBook.address, mandate);
  const mandateNonce = await h.mandateBook.read.nextNonce([address]);
  await mine(
    h,
    await h.mandateBook.write.submitMandate(
      [universeId, encoded.struct, encoded.proofs, mandateNonce],
      {
        account: wallet.account,
      },
    ),
  );
  const mandateId = await h.mandateBook.read.mandateIdFor([address, universeId]);

  // Grant the engine every mandate handle, and the engine AND the ledger the vault balance handle.
  const handles = await h.mandateBook.read.handlesOf([mandateId, 1]);
  const balanceHandle = (await h.vault.read.confidentialAvailableOf([address])) as Handle;

  for (const handle of mandateHandleList(handles)) {
    await mine(h, await grantHandleAccess(wallet, LOCAL_NOX_NETWORK(), handle, h.engine.address));
  }
  // A provider who never deposited has the UNDEFINED handle here, which resolves to the type's
  // public zero — and a public handle has no ACL, so `INoxCompute.allow` refuses it outright with
  // `PublicHandleACLForbidden`. Skipping the grants leaves that provider in exactly the state case
  // 15b needs: a real submission that `sealProviderSnapshot` must refuse by name rather than
  // silently compute over.
  if (balance > 0n) {
    await mine(
      h,
      await grantHandleAccess(wallet, LOCAL_NOX_NETWORK(), balanceHandle, h.engine.address),
    );
    await mine(
      h,
      await grantHandleAccess(wallet, LOCAL_NOX_NETWORK(), balanceHandle, h.ledger.address),
    );
  }

  return {
    walletIndex: setup.walletIndex,
    address,
    mandateId,
    mandateEpoch: 1,
    mandate,
    balance,
    balanceHandle,
    client,
  };
}

/** The 35 mandate handles in the canonical order the contract documents. */
export function mandateHandleList(handles: any): Handle[] {
  return [
    handles.totalBudget,
    ...handles.marketCaps,
    ...handles.minRateIndexes,
    ...handles.enabledFlags,
    ...handles.collateralFamilyCaps,
    ...handles.maturityBucketCaps,
    handles.maxDurationIndex,
    handles.allocationWeight,
  ] as Handle[];
}

/** The 19 request handles in the canonical order the contract documents. */
export function requestHandleList(handles: any): Handle[] {
  return [
    handles.desiredAssets,
    handles.minimumAssets,
    ...handles.maxRateIndexes,
    ...handles.enabledFlags,
    handles.preferredMaturityIndex,
  ] as Handle[];
}

export interface BorrowerState {
  readonly walletIndex: number;
  readonly address: `0x${string}`;
  readonly requestId: `0x${string}`;
  readonly request: CurveRequest;
  readonly client: KyrveHandleClient;
}

export async function setupBorrower(
  h: CurveHarness,
  universeId: `0x${string}`,
  walletIndex: number,
  overrides: Partial<CurveRequest> = {},
): Promise<BorrowerState> {
  const wallet = h.wallets[walletIndex];
  const address = wallet.account.address as `0x${string}`;
  const client = await clientFor(h, walletIndex);
  const request = makeRequest(overrides);

  const encoded = await encryptRequest(client, h.requestBook.address, request);
  const nonce = await h.requestBook.read.nextNonce([address]);
  await mine(
    h,
    await h.requestBook.write.submitRequest(
      [
        universeId,
        encoded.struct,
        encoded.proofs,
        3_600n,
        true,
        `0x${"00".repeat(32)}` as `0x${string}`,
        nonce,
      ],
      { account: wallet.account, value: 10n ** 15n },
    ),
  );
  const requestId = await h.requestBook.read.liveRequest([address, universeId]);

  const handles = await h.requestBook.read.handlesOf([requestId]);
  for (const handle of requestHandleList(handles)) {
    await mine(h, await grantHandleAccess(wallet, LOCAL_NOX_NETWORK(), handle, h.engine.address));
  }

  return { walletIndex, address, requestId, request, client };
}

export interface EpochState {
  readonly epochId: `0x${string}`;
  readonly providers: readonly SealedProviderState[];
  readonly borrower: BorrowerState;
  readonly universe: Universe;
  readonly universeId: `0x${string}`;
  /** What the plaintext reference model says this epoch must produce. */
  readonly expected: CurveResult;
  /** Gas by stage, for the benchmark and the side-channel experiment. */
  readonly gas: Record<string, number[]>;
}

/** Opens an epoch, seals every snapshot into it, and prepares it. Stops before stage B. */
export async function openAndSeal(
  h: CurveHarness,
  universeId: `0x${string}`,
  universe: Universe,
  providers: readonly SealedProviderState[],
  borrower: BorrowerState,
): Promise<EpochState> {
  const borrowerWallet = h.wallets[borrower.walletIndex];
  await mine(
    h,
    await h.epochs.write.openEpoch([universeId, borrower.requestId, 3_600n], {
      account: borrowerWallet.account,
    }),
  );
  const epochId = await h.epochs.read.epochIdFor([universeId, borrower.requestId]);
  const gas: Record<string, number[]> = {};

  for (const provider of providers) {
    const wallet = h.wallets[provider.walletIndex];
    const nonce = await h.engine.read.nextNonce([provider.address]);
    const receipt = await mine(
      h,
      await h.engine.write.sealProviderSnapshot(
        [epochId, provider.mandateId, provider.mandateEpoch, nonce],
        {
          account: wallet.account,
        },
      ),
    );
    record(gas, "sealProvider", receipt);
  }

  const borrowerNonce = await h.engine.read.nextNonce([borrower.address]);
  record(
    gas,
    "sealRequest",
    await mine(
      h,
      await h.engine.write.sealRequestSnapshot([epochId, borrowerNonce], {
        account: borrowerWallet.account,
      }),
    ),
  );

  record(
    gas,
    "prepareEpoch",
    await mine(
      h,
      await h.engine.write.prepareEpoch([epochId], { account: borrowerWallet.account }),
    ),
  );

  const expected = computeCurve(
    universe,
    providers.map<Provider>((p) => ({
      address: p.address,
      mandate: p.mandate,
      balance: p.balance,
    })),
    borrower.request,
  );

  return { epochId, providers, borrower, universe, universeId, expected, gas };
}

function record(gas: Record<string, number[]>, stage: string, receipt: any): void {
  const samples = gas[stage] ?? [];
  samples.push(Number(receipt.gasUsed));
  gas[stage] = samples;
}

/** Runs every chunk of one stage, then advances. Returns the chunk count it executed. */
export async function runStage(
  h: CurveHarness,
  epoch: EpochState,
  stage: number,
  method: string,
  keeper: any,
): Promise<number> {
  const progress = await h.epochs.read.progressOf([epoch.epochId, stage]);
  const total = Number(progress.total);
  for (let chunk = 0; chunk < total; chunk += 1) {
    const args =
      method === "publishWinner" || method === "publishAggregate"
        ? [epoch.epochId]
        : [epoch.epochId, chunk];
    const receipt = await mine(h, await h.engine.write[method](args, { account: keeper.account }));
    record(epoch.gas, method, receipt);
  }
  await mine(h, await h.engine.write.advanceStage([epoch.epochId], { account: keeper.account }));
  return total;
}

/**
 * Drives the whole epoch to a published aggregate.
 *
 * The winner has to be publicly decrypted and PROVEN on chain between stage E2 and stage F,
 * because stage F needs to index the winning leaf publicly and the only honest way to learn it is
 * a gateway proof bound to the handle the sealed graph committed to.
 */
export async function runEpoch(
  h: CurveHarness,
  epoch: EpochState,
  keeperIndex = 9,
  poll: PollOptions = SUITE_POLL,
): Promise<EpochState> {
  const keeper = h.wallets[keeperIndex];

  await runStage(h, epoch, STAGE.CacheProviders, "cacheProviderChunk", keeper);
  await runStage(h, epoch, STAGE.Accumulate, "accumulateLeafChunk", keeper);
  await runStage(h, epoch, STAGE.FinalizeLeaves, "finalizeLeafChunk", keeper);
  await runStage(h, epoch, STAGE.ReduceWinner, "reduceWinnerChunk", keeper);
  await runStage(h, epoch, STAGE.PublishWinner, "publishWinner", keeper);

  await proveWinner(h, epoch, keeper, poll);

  await runStage(h, epoch, STAGE.Allocate, "allocateChunk", keeper);
  await runStage(h, epoch, STAGE.PublishAggregate, "publishAggregate", keeper);

  return epoch;
}

/** Publicly decrypts the selected market and rate, then proves both on chain. */
export async function proveWinner(
  h: CurveHarness,
  epoch: EpochState,
  keeper: any,
  poll: PollOptions = SUITE_POLL,
): Promise<void> {
  const published = await h.engine.read.publishedOf([epoch.epochId]);
  const client = await clientFor(h, 0);

  const market = await client.publicDecrypt(published.marketIndex as Handle, poll);
  const rate = await client.publicDecrypt(published.rateIndex as Handle, poll);

  const receipt = await mine(
    h,
    await h.engine.write.proveWinner(
      [
        epoch.epochId,
        Number(market.value),
        Number(rate.value),
        market.decryptionProof,
        rate.decryptionProof,
      ],
      { account: keeper.account },
    ),
  );
  record(epoch.gas, "proveWinner", receipt);
}

/** Reads every published value back through the read-only verifier, with real gateway proofs. */
export async function verifyPublishedQuote(
  h: CurveHarness,
  epoch: EpochState,
  poll: PollOptions = SUITE_POLL,
): Promise<{
  marketIndex: number;
  rateIndex: number;
  privacyFloorPassed: boolean;
  quoteReady: boolean;
  aggregateFillAmount: bigint;
}> {
  const published = await h.engine.read.publishedOf([epoch.epochId]);
  const client = await clientFor(h, 0);

  const [market, rate, floor, ready, aggregate] = [
    await client.publicDecrypt(published.marketIndex as Handle, poll),
    await client.publicDecrypt(published.rateIndex as Handle, poll),
    await client.publicDecrypt(published.floorPassed as Handle, poll),
    await client.publicDecrypt(published.quoteReady as Handle, poll),
    await client.publicDecrypt(published.aggregateFill as Handle, poll),
  ];

  const result = await h.verifier.read.verifyQuote([
    epoch.epochId,
    market.decryptionProof,
    rate.decryptionProof,
    floor.decryptionProof,
    ready.decryptionProof,
    aggregate.decryptionProof,
  ]);

  // The verifier's answer and the gateway's must agree; if they can differ, the binding is loose.
  assert.equal(Number(result.marketIndex), Number(market.value));
  assert.equal(Number(result.rateIndex), Number(rate.value));
  assert.equal(result.aggregateFillAmount, aggregate.value);

  return {
    marketIndex: Number(market.value),
    rateIndex: Number(rate.value),
    privacyFloorPassed: result.privacyFloorPassed,
    quoteReady: result.quoteReady,
    aggregateFillAmount: aggregate.value,
  };
}

/** Reads authoritative on-chain ACL for a handle and an account. Never an indexer. */
export async function acl(h: CurveHarness, handle: Handle, account: `0x${string}`) {
  return readAcl(h.publicClient, LOCAL_NOX_NETWORK(), handle, account);
}

export { makeGrid, makeMandate, makeMarket, makeRequest, UNIT };

/**
 * Asserts a call reverts with a NAMED custom error, matched by its 4-byte selector.
 *
 * WHY NOT MATCH THE NAME AS TEXT. viem can only name a custom error when it finds it on the ABI it
 * was handed, and several of these reverts originate in a contract other than the one being called
 * — `NotAllowed` comes from NoxCompute, and an automatic gas estimation surfaces the revert as a
 * raw `ProviderError` before viem ever consults an ABI. The error then appears only as its
 * selector, and a test asserting on the human-readable name would silently match nothing and be
 * weakened to "it reverted somehow" — which is the exact failure `.claude/rules/testing.md` warns
 * about.
 *
 * The selector is computed from the contract's own ABI, so a renamed or re-signatured error fails
 * this helper rather than quietly stopping being checked.
 */
export async function assertRevertsWithError(
  action: () => Promise<unknown>,
  contract: { abi: readonly unknown[] },
  errorName: string,
  what: string,
): Promise<void> {
  const entry = (
    contract.abi as { type: string; name?: string; inputs?: { type: string }[] }[]
  ).find((item) => item.type === "error" && item.name === errorName);
  assert.ok(
    entry !== undefined,
    `${what}: the ABI declares no error called ${errorName}. Either it was renamed or the test is ` +
      "checking for something that no longer exists.",
  );
  const signature = `${errorName}(${(entry.inputs ?? []).map((input) => input.type).join(",")})`;
  const selector = keccak256(toHex(signature)).slice(0, 10);

  let raised: unknown;
  try {
    await action();
  } catch (error) {
    raised = error;
  }
  assert.ok(raised !== undefined, `${what}: expected a revert, but the call succeeded`);

  const text = flattenError(raised);
  assert.ok(
    text.includes(selector) || text.includes(errorName),
    `${what}: reverted, but not with ${signature} (${selector}).\nActual: ${text.slice(0, 900)}`,
  );
}
