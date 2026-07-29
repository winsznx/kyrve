/**
 * A real confidential curve epoch, on Ethereum Sepolia, against the hosted iExec Nox stack.
 *
 * ════════════════════════════════════════════════════════════════════════════════════════════
 * WHAT THIS CLOSES
 * ════════════════════════════════════════════════════════════════════════════════════════════
 *
 * The Phase 3 gate had exactly one SKIP: every stage was proven against the real Nox stack
 * LOCALLY, and the deployed layer was verified read-only on Sepolia, but the two had never been
 * combined on a public network. That is the last place a local-only assumption can hide — and
 * Phase 3 already found two of those the hard way (deltas R-10 and R-12), both of which passed
 * every local test.
 *
 * ════════════════════════════════════════════════════════════════════════════════════════════
 * THE SHAPE, AND WHY IT IS SMALL
 * ════════════════════════════════════════════════════════════════════════════════════════════
 *
 * Two providers, one borrower, one market, two rates. That is the smallest universe that still
 * exercises every stage and every boundary crossing: a privacy floor of 2 needs two providers, and
 * two leaves make the winner fold do a real comparison rather than only seeding.
 *
 * It is small because each provider costs 36 separate `INoxCompute.allow` transactions — there is
 * no batch entry point — and this is a public network, not a local node. The 16 x 128 universe is
 * proven locally in `confidential/test/82-curve-benchmark.ts`; what is proven HERE is that the
 * whole pipeline works against hosted services and a real chain.
 *
 * ════════════════════════════════════════════════════════════════════════════════════════════
 * WALLETS
 * ════════════════════════════════════════════════════════════════════════════════════════════
 *
 * The deployer is the curator and the borrower. The two providers are the disposable wallets from
 * `pnpm dust:generate`, funded from the deployer here and sweepable back with `pnpm dust:sweep`
 * afterwards. Providers must be distinct addresses — one mandate per provider per universe — and
 * every entry point refuses a contract caller, so they must be EOAs signing for themselves.
 *
 * No decrypted value is ever written to the evidence file.
 */

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { NOX_COMPUTE_BY_CHAIN, NOX_GATEWAY_BY_CHAIN } from "@kyrve/config";
import {
  buildUniverse,
  computeCurve,
  makeMandate,
  makeRequest,
  makeUniverseDraft,
  type Provider,
  UNIT,
  type UniverseDraft,
} from "@kyrve/curve";
import { encodeMarket } from "@kyrve/midnight";
import {
  createHandleClient,
  encryptMandate,
  encryptRequest,
  grantHandleAccess,
  type Handle,
} from "@kyrve/nox";
import { tickToPrice } from "@kyrve/quote-math";
import {
  type Address,
  createPublicClient,
  createWalletClient,
  formatEther,
  type Hex,
  http,
  keccak256,
  type PublicClient,
  parseEther,
  type WalletClient,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { sepolia } from "viem/chains";

import {
  assertBroadcastArmed,
  assertNoSecrets,
  deployer,
  loadEnv,
  sepoliaRpc,
} from "../lib/env.js";
import { readJson, repoPath, stableStringify } from "../lib/shell.js";

const CHAIN_ID = 11_155_111;

/** Matches `QuoteEpochController.Stage`. */
const STAGE = {
  CacheProviders: 1,
  Accumulate: 2,
  FinalizeLeaves: 3,
  ReduceWinner: 4,
  PublishWinner: 5,
  Allocate: 6,
  PublishAggregate: 7,
} as const;

/** The hosted stack is slower and less predictable than the local one; this is generous on purpose. */
const POLL = {
  policy: { initialDelayMs: 2_000, maxDelayMs: 20_000, multiplier: 2, timeoutMs: 600_000 },
} as const;

/** Enough for ~7.5M gas of provider setup at a few gwei, with room to spare. */
const PROVIDER_FUNDING = parseEther("0.02");

function abiOf(name: string, dir = "contracts"): readonly unknown[] {
  const path = repoPath(`confidential/artifacts/${dir}/${name}.sol/${name}.json`);
  return (JSON.parse(readFileSync(path, "utf8")) as { abi: readonly unknown[] }).abi;
}

/**
 * Reads a `view` function.
 *
 * The cast lives here and nowhere else. Every call site was previously `as never` on the ABI,
 * which defeats viem's inference in a way that produces errors about `code` being missing — a
 * message that says nothing about the actual mistake. One helper, one cast, one place to be wrong.
 */
async function read<T>(
  publicClient: PublicClient,
  address: Address,
  abi: readonly unknown[],
  functionName: string,
  args: readonly unknown[],
): Promise<T> {
  return (await publicClient.readContract({ address, abi, functionName, args } as never)) as T;
}

/** A deployment record is `Record<string, Address>`; a missing key must fail loudly, not be `undefined`. */
function requireAddress(map: Readonly<Record<string, Address>>, name: string): Address {
  const value = map[name];
  if (value === undefined) {
    throw new Error(`the Sepolia deployment record has no address for ${name}`);
  }
  return value;
}

interface Ctx {
  readonly publicClient: PublicClient;
  readonly curve: Readonly<Record<string, Address>>;
  readonly phase2: Readonly<Record<string, Address>>;
  gas: bigint;
}

async function send(
  ctx: Ctx,
  wallet: WalletClient,
  args: Parameters<WalletClient["writeContract"]>[0],
  what: string,
): Promise<void> {
  const hash = await wallet.writeContract(args);
  const receipt = await ctx.publicClient.waitForTransactionReceipt({ hash });
  if (receipt.status !== "success") throw new Error(`${what} reverted: ${hash}`);
  ctx.gas += receipt.gasUsed;
}

/**
 * Sends many independent transactions from one wallet with explicit nonces, then waits for all.
 *
 * The ACL grants are 36 per provider and 19 for the borrower — 91 transactions whose only ordering
 * requirement is that they all land. Waiting for each receipt in turn would be twenty minutes of
 * block time for no benefit. Every receipt is still checked: a failure anywhere fails the run,
 * rather than being swallowed because a later transaction succeeded.
 */
async function sendBatch(
  ctx: Ctx,
  account: ReturnType<typeof privateKeyToAccount>,
  build: (nonce: number) => Promise<Hex>[],
  what: string,
): Promise<void> {
  const startNonce = await ctx.publicClient.getTransactionCount({ address: account.address });
  const hashes = await Promise.all(build(startNonce));
  for (const hash of hashes) {
    const receipt = await ctx.publicClient.waitForTransactionReceipt({ hash });
    if (receipt.status !== "success") throw new Error(`${what} reverted: ${hash}`);
    ctx.gas += receipt.gasUsed;
  }
}

/**
 * A universe whose one market IS a deployed Sepolia Midnight market, and whose grid prices ARE
 * `TickLib.tickToPrice`.
 *
 * ════════════════════════════════════════════════════════════════════════════════════════════
 * WHY THE DEFAULT UNIVERSE CANNOT BE SETTLED AGAINST
 * ════════════════════════════════════════════════════════════════════════════════════════════
 *
 * Phase 3 had no settlement, so its Sepolia epoch used `makeUniverseDraft`: synthetic market ids,
 * synthetic struct hashes and a synthetic price curve. That is entirely correct for proving the curve
 * engine, and entirely unusable for proving a quote — `QuoteActivator` checks the market against
 * Midnight's own `IdLib.toId` AND its struct hash, and checks the leaf price against the pinned
 * `TickLib`. A synthetic universe is refused, as it should be.
 *
 * So this mode exists, off by default, behind `KYRVE_SETTLEMENT_UNIVERSE=true`. The Phase 3 epoch
 * keeps its exact previous behaviour; Phase 4 asks for a universe it can actually settle.
 *
 * The ticks are chosen high, where `tickToPrice` is strictly descending — the registry requires that
 * — and comfortably above the market's settlement fee, which `take` subtracts with a checked
 * subtraction (PRD v1.1 A-3).
 */
function settlementGradeDraft(label: string, registry: Hex): UniverseDraft {
  const record = readJson<{
    markets: readonly {
      readonly id: Hex;
      readonly key: string;
      readonly market: Record<string, unknown>;
    }[];
  }>(repoPath("deployments/sepolia/markets.json"));

  // The 90-day WETH market: one collateral leg, the same shape the local harness settles against.
  const chosen = record.markets.find((entry) => entry.key === "usdc-90d-weth") ?? record.markets[0];
  if (chosen === undefined) throw new Error("deployments/sepolia/markets.json records no market");

  const ticks = [6000, 5968];
  const pricesWad = ticks.map((tick) => tickToPrice(BigInt(tick)));
  for (let i = 1; i < pricesWad.length; i += 1) {
    const previous = pricesWad[i - 1];
    const current = pricesWad[i];
    if (previous === undefined || current === undefined || previous <= current) {
      throw new Error(`the settlement grid must be strictly descending; tick ${ticks[i]} is not`);
    }
  }

  console.log(`  universe   SETTLEMENT-GRADE, market ${chosen.key} (${chosen.id})`);

  return {
    label,
    chainId: CHAIN_ID,
    registry,
    maxProviders: 2,
    privacyFloor: 2,
    minTicketAssets: UNIT,
    cellsPerChunk: 4,
    markets: [
      {
        spec: {
          marketId: chosen.id,
          marketStructHash: keccak256(encodeMarket(chosen.market as never)),
          maturity: BigInt((chosen.market as { maturity: string }).maturity),
          collateralFamily: 0,
          maturityBucket: 0,
          tickSpacing: 4,
          // The 90-day fee is far below any of these prices; the floor is a static guard and the
          // live check happens in `QuoteActivator` against `IMidnight.settlementFee`.
          settlementFeeFloorWad: 10n ** 15n,
          publicPriority: 0,
        },
        ticks,
        pricesWad,
      },
    ],
  };
}

async function main(): Promise<void> {
  /**
   * Off by default. Phase 3's epoch keeps its synthetic universe; Phase 4 asks for one whose market
   * and prices a quote can actually be activated against.
   */
  const settlementUniverse = process.env["KYRVE_SETTLEMENT_UNIVERSE"] === "true";
  loadEnv();
  assertBroadcastArmed();

  /**
   * `--resume=<universeId>` verifies an epoch that already ran, instead of paying for another 130
   * transactions on a public network.
   *
   * The reference model needs the universe's SHAPE — leaves, markets, floor, minimum ticket — and
   * none of that depends on the label, so rebuilding the draft with a fresh label and substituting
   * the on-chain id gives an identical model. The request and epoch ids are derivable from the
   * request book and the controller.
   */
  const resumeArg = process.argv.find((a) => a.startsWith("--resume="));
  const resumeUniverse = resumeArg?.slice("--resume=".length) as Hex | undefined;

  const rpc = sepoliaRpc();
  const publicClient = createPublicClient({
    chain: sepolia,
    transport: http(rpc.url),
    cacheTime: 0,
  });

  const observed = await publicClient.getChainId();
  if (observed !== CHAIN_ID)
    throw new Error(`connected chain is ${observed}, expected ${CHAIN_ID}`);

  const curveRecord = readJson<{
    addresses: Record<string, Address>;
    phase2: Record<string, Address>;
  }>(repoPath("deployments/sepolia/curve.json"));

  const curve = {
    CurveUniverseRegistry: requireAddress(curveRecord.addresses, "CurveUniverseRegistry"),
    QuoteEpochController: requireAddress(curveRecord.addresses, "QuoteEpochController"),
    CurveGraphRegistry: requireAddress(curveRecord.addresses, "CurveGraphRegistry"),
    ReservationLedger: requireAddress(curveRecord.addresses, "ReservationLedger"),
    NoxCurveEngine: requireAddress(curveRecord.addresses, "NoxCurveEngine"),
    CurveResultVerifier: requireAddress(curveRecord.addresses, "CurveResultVerifier"),
  } as const;
  const phase2 = {
    TestUnderlyingERC20: requireAddress(curveRecord.phase2, "TestUnderlyingERC20"),
    KyrveWrappedAsset: requireAddress(curveRecord.phase2, "KyrveWrappedAsset"),
    KyrveConfidentialAssetVault: requireAddress(curveRecord.phase2, "KyrveConfidentialAssetVault"),
    EncryptedMandateBook: requireAddress(curveRecord.phase2, "EncryptedMandateBook"),
    ConfidentialRequestBook: requireAddress(curveRecord.phase2, "ConfidentialRequestBook"),
  } as const;

  const ctx: Ctx = { publicClient, curve, phase2, gas: 0n };

  const gateway = NOX_GATEWAY_BY_CHAIN[CHAIN_ID];
  const noxCompute = NOX_COMPUTE_BY_CHAIN[CHAIN_ID];
  if (gateway === undefined || noxCompute === undefined) {
    throw new Error("no Nox endpoint is known for Sepolia");
  }
  const network = { chainId: CHAIN_ID, name: "ethereum-sepolia", noxCompute, gatewayUrl: gateway };

  // ── Wallets ────────────────────────────────────────────────────────────────────────────────
  const curator = privateKeyToAccount(deployer().privateKey);
  const providerAccounts = [1, 2].map((i) => {
    const raw = (process.env[`DUST_PRIVATE_KEY_${i}`] ?? "").trim();
    if (!/^0x[0-9a-fA-F]{64}$/.test(raw)) {
      throw new Error(`DUST_PRIVATE_KEY_${i} is missing or malformed. Run \`pnpm dust:generate\`.`);
    }
    return privateKeyToAccount(raw as Hex);
  });

  const curatorWallet = createWalletClient({
    account: curator,
    chain: sepolia,
    transport: http(rpc.url),
  });
  const providerWallets = providerAccounts.map((account) =>
    createWalletClient({ account, chain: sepolia, transport: http(rpc.url) }),
  );

  // ── ABIs and fixtures, needed by BOTH paths ────────────────────────────────────────────────
  const universeAbi = abiOf("CurveUniverseRegistry");
  const underlyingAbi = abiOf("TestUnderlyingERC20", "contracts/test");
  const assetAbi = abiOf("KyrveWrappedAsset");
  const vaultAbi = abiOf("KyrveConfidentialAssetVault");
  const mandateAbi = abiOf("EncryptedMandateBook");
  const requestAbi = abiOf("ConfidentialRequestBook");
  const epochAbi = abiOf("QuoteEpochController");
  const engineAbi = abiOf("NoxCurveEngine");

  const balances = [700n * UNIT, 600n * UNIT] as const;
  const mandates = [
    makeMandate({ marketCaps: [400n * UNIT], minRateIndexes: [0] }),
    makeMandate({ marketCaps: [300n * UNIT], minRateIndexes: [0] }),
  ] as const;
  const request = makeRequest({
    desiredAssets: 300n * UNIT,
    minimumAssets: 10n * UNIT,
    maxRateIndexes: [1],
  });

  const label = `kyrve-sepolia-epoch-${Date.now()}`;
  const draft = settlementUniverse
    ? settlementGradeDraft(label, curve.CurveUniverseRegistry)
    : makeUniverseDraft({
        label,
        chainId: CHAIN_ID,
        registry: curve.CurveUniverseRegistry,
        markets: 1,
        ratesPerMarket: 2,
        maxProviders: 2,
        privacyFloor: 2,
        cellsPerChunk: 4,
      });
  const built = buildUniverse(draft);
  const universe = resumeUniverse === undefined ? built : { ...built, id: resumeUniverse };

  const borrowerClient = await createHandleClient(curatorWallet, network);

  console.log("sepolia curve epoch — the real thing, on a public network\n");
  console.log(`  RPC        ${rpc.redacted}`);
  console.log(`  gateway    ${gateway}`);
  console.log(`  engine     ${curve.NoxCurveEngine}`);
  console.log(`  curator    ${curator.address} (also the borrower)`);
  for (const [i, a] of providerAccounts.entries()) {
    console.log(`  provider ${i}  ${a.address}`);
  }
  console.log(
    `  balance    ${formatEther(await publicClient.getBalance({ address: curator.address }))} ETH`,
  );
  console.log(
    `  mode       ${resumeUniverse === undefined ? "full run" : "RESUME — verification only"}\n`,
  );

  if (resumeUniverse === undefined) {
    // ── Fund the providers ───────────────────────────────────────────────────────────────────
    for (const [i, account] of providerAccounts.entries()) {
      const balance = await publicClient.getBalance({ address: account.address });
      if (balance >= PROVIDER_FUNDING) {
        console.log(`  provider ${i} already funded (${formatEther(balance)} ETH)`);
        continue;
      }
      const hash = await curatorWallet.sendTransaction({
        to: account.address,
        value: PROVIDER_FUNDING - balance,
      });
      await publicClient.waitForTransactionReceipt({ hash });
      console.log(`  funded provider ${i} with ${formatEther(PROVIDER_FUNDING - balance)} ETH`);
    }

    // ── The universe: 1 market, 2 rates, privacy floor 2 ─────────────────────────────────────
    const grid = draft.markets[0];
    if (grid === undefined) throw new Error("the universe draft has no market");

    await send(
      ctx,
      curatorWallet,
      {
        address: curve.CurveUniverseRegistry,
        abi: universeAbi,
        functionName: "createUniverse",
        args: [
          label,
          draft.maxProviders,
          draft.privacyFloor,
          draft.minTicketAssets,
          draft.cellsPerChunk,
        ],
        account: curator,
        chain: sepolia,
      } as never,
      "createUniverse",
    );
    await send(
      ctx,
      curatorWallet,
      {
        address: curve.CurveUniverseRegistry,
        abi: universeAbi,
        functionName: "addMarket",
        args: [universe.id, grid.spec, grid.ticks, grid.pricesWad],
        account: curator,
        chain: sepolia,
      } as never,
      "addMarket",
    );
    await send(
      ctx,
      curatorWallet,
      {
        address: curve.CurveUniverseRegistry,
        abi: universeAbi,
        functionName: "activateUniverse",
        args: [universe.id],
        account: curator,
        chain: sepolia,
      } as never,
      "activateUniverse",
    );
    console.log(`\n  universe   ${universe.id}`);
    console.log(`             1 market, ${universe.leaves.length} leaves, floor 2\n`);

    // ── Providers: wrap, deposit, submit a mandate, grant the engine ─────────────────────────
    for (const [i, account] of providerAccounts.entries()) {
      const wallet = providerWallets[i];
      const balance = balances[i];
      const mandate = mandates[i];
      if (wallet === undefined || balance === undefined || mandate === undefined) {
        throw new Error(`provider ${i} is not fully configured`);
      }
      const client = await createHandleClient(wallet, network);

      await send(
        ctx,
        wallet,
        {
          address: phase2.TestUnderlyingERC20,
          abi: underlyingAbi,
          functionName: "mint",
          args: [account.address, balance],
          account,
          chain: sepolia,
        } as never,
        "mint",
      );
      await send(
        ctx,
        wallet,
        {
          address: phase2.TestUnderlyingERC20,
          abi: underlyingAbi,
          functionName: "approve",
          args: [phase2.KyrveWrappedAsset, balance],
          account,
          chain: sepolia,
        } as never,
        "approve",
      );
      await send(
        ctx,
        wallet,
        {
          address: phase2.KyrveWrappedAsset,
          abi: assetAbi,
          functionName: "wrap",
          args: [account.address, balance],
          account,
          chain: sepolia,
        } as never,
        "wrap",
      );

      const until = BigInt(Math.floor(Date.now() / 1000) + 3_600);
      await send(
        ctx,
        wallet,
        {
          address: phase2.KyrveWrappedAsset,
          abi: assetAbi,
          functionName: "setOperator",
          args: [phase2.KyrveConfidentialAssetVault, until],
          account,
          chain: sepolia,
        } as never,
        "setOperator",
      );

      const encrypted = await client.encrypt(
        balance,
        "euint256",
        phase2.KyrveConfidentialAssetVault,
      );
      const vaultNonce = await read<bigint>(
        publicClient,
        phase2.KyrveConfidentialAssetVault,
        vaultAbi,
        "nextNonce",
        [account.address],
      );
      await send(
        ctx,
        wallet,
        {
          address: phase2.KyrveConfidentialAssetVault,
          abi: vaultAbi,
          functionName: "deposit",
          args: [encrypted.handle, encrypted.proof, vaultNonce],
          account,
          chain: sepolia,
        } as never,
        "deposit",
      );
      await send(
        ctx,
        wallet,
        {
          address: phase2.KyrveWrappedAsset,
          abi: assetAbi,
          functionName: "setOperator",
          args: [phase2.KyrveConfidentialAssetVault, 0n],
          account,
          chain: sepolia,
        } as never,
        "setOperator(0)",
      );

      const encoded = await encryptMandate(client, phase2.EncryptedMandateBook, mandate);
      const mandateNonce = await read<bigint>(
        publicClient,
        phase2.EncryptedMandateBook,
        mandateAbi,
        "nextNonce",
        [account.address],
      );
      await send(
        ctx,
        wallet,
        {
          address: phase2.EncryptedMandateBook,
          abi: mandateAbi,
          functionName: "submitMandate",
          args: [universe.id, encoded.struct, encoded.proofs, mandateNonce],
          account,
          chain: sepolia,
        } as never,
        "submitMandate",
      );

      const mandateId = await read<Hex>(
        publicClient,
        phase2.EncryptedMandateBook,
        mandateAbi,
        "mandateIdFor",
        [account.address, universe.id],
      );
      const h = await read<{
        totalBudget: Handle;
        marketCaps: Handle[];
        minRateIndexes: Handle[];
        enabledFlags: Handle[];
        collateralFamilyCaps: Handle[];
        maturityBucketCaps: Handle[];
        maxDurationIndex: Handle;
        allocationWeight: Handle;
      }>(publicClient, phase2.EncryptedMandateBook, mandateAbi, "handlesOf", [mandateId, 1]);
      const balanceHandle = await read<Handle>(
        publicClient,
        phase2.KyrveConfidentialAssetVault,
        vaultAbi,
        "confidentialAvailableOf",
        [account.address],
      );

      const mandateHandles: Handle[] = [
        h.totalBudget,
        ...h.marketCaps,
        ...h.minRateIndexes,
        ...h.enabledFlags,
        ...h.collateralFamilyCaps,
        ...h.maturityBucketCaps,
        h.maxDurationIndex,
        h.allocationWeight,
      ];

      // 35 mandate handles to the engine, the balance to the engine AND the ledger. Only the owner
      // can make these — `INoxCompute.allow` is gated on the caller already holding access.
      await sendBatch(
        ctx,
        account,
        (nonce) => [
          ...mandateHandles.map((handle, k) =>
            grantHandleAccess(wallet, network, handle, curve.NoxCurveEngine, { nonce: nonce + k }),
          ),
          grantHandleAccess(wallet, network, balanceHandle, curve.NoxCurveEngine, {
            nonce: nonce + mandateHandles.length,
          }),
          grantHandleAccess(wallet, network, balanceHandle, curve.ReservationLedger, {
            nonce: nonce + mandateHandles.length + 1,
          }),
        ],
        `provider ${i} ACL grants`,
      );

      console.log(
        `  provider ${i} sealed: ${mandateHandles.length + 2} grants, mandate ${mandateId.slice(0, 10)}…`,
      );
    }

    // ── Borrower ─────────────────────────────────────────────────────────────────────────────
    const encodedRequest = await encryptRequest(
      borrowerClient,
      phase2.ConfidentialRequestBook,
      request,
    );
    const requestNonce = await read<bigint>(
      publicClient,
      phase2.ConfidentialRequestBook,
      requestAbi,
      "nextNonce",
      [curator.address],
    );
    await send(
      ctx,
      curatorWallet,
      {
        address: phase2.ConfidentialRequestBook,
        abi: requestAbi,
        functionName: "submitRequest",
        args: [
          universe.id,
          encodedRequest.struct,
          encodedRequest.proofs,
          86_400n,
          true,
          `0x${"00".repeat(32)}`,
          requestNonce,
        ],
        value: 10n ** 15n,
        account: curator,
        chain: sepolia,
      } as never,
      "submitRequest",
    );

    const newRequestId = await read<Hex>(
      publicClient,
      phase2.ConfidentialRequestBook,
      requestAbi,
      "liveRequest",
      [curator.address, universe.id],
    );
    const rh = await read<{
      desiredAssets: Handle;
      minimumAssets: Handle;
      maxRateIndexes: Handle[];
      enabledFlags: Handle[];
      preferredMaturityIndex: Handle;
    }>(publicClient, phase2.ConfidentialRequestBook, requestAbi, "handlesOf", [newRequestId]);
    const requestHandles: Handle[] = [
      rh.desiredAssets,
      rh.minimumAssets,
      ...rh.maxRateIndexes,
      ...rh.enabledFlags,
      rh.preferredMaturityIndex,
    ];

    await sendBatch(
      ctx,
      curator,
      (nonce) =>
        requestHandles.map((handle, k) =>
          grantHandleAccess(curatorWallet, network, handle, curve.NoxCurveEngine, {
            nonce: nonce + k,
          }),
        ),
      "borrower ACL grants",
    );
    console.log(
      `  borrower sealed: ${requestHandles.length} grants, request ${newRequestId.slice(0, 10)}…\n`,
    );

    // ── Open, seal, prepare ──────────────────────────────────────────────────────────────────
    await send(
      ctx,
      curatorWallet,
      {
        address: curve.QuoteEpochController,
        abi: epochAbi,
        functionName: "openEpoch",
        args: [universe.id, newRequestId, 86_400n],
        account: curator,
        chain: sepolia,
      } as never,
      "openEpoch",
    );
    const openedEpochId = await read<Hex>(
      publicClient,
      curve.QuoteEpochController,
      epochAbi,
      "epochIdFor",
      [universe.id, newRequestId],
    );

    for (const [i, account] of providerAccounts.entries()) {
      const wallet = providerWallets[i];
      if (wallet === undefined) throw new Error(`provider ${i} has no wallet`);
      const mandateId = await read<Hex>(
        publicClient,
        phase2.EncryptedMandateBook,
        mandateAbi,
        "mandateIdFor",
        [account.address, universe.id],
      );
      const nonce = await read<bigint>(publicClient, curve.NoxCurveEngine, engineAbi, "nextNonce", [
        account.address,
      ]);
      await send(
        ctx,
        wallet,
        {
          address: curve.NoxCurveEngine,
          abi: engineAbi,
          functionName: "sealProviderSnapshot",
          args: [openedEpochId, mandateId, 1, nonce],
          account,
          chain: sepolia,
        } as never,
        `sealProviderSnapshot ${i}`,
      );
    }

    const engineNonce = await read<bigint>(
      publicClient,
      curve.NoxCurveEngine,
      engineAbi,
      "nextNonce",
      [curator.address],
    );
    await send(
      ctx,
      curatorWallet,
      {
        address: curve.NoxCurveEngine,
        abi: engineAbi,
        functionName: "sealRequestSnapshot",
        args: [openedEpochId, engineNonce],
        account: curator,
        chain: sepolia,
      } as never,
      "sealRequestSnapshot",
    );
    await send(
      ctx,
      curatorWallet,
      {
        address: curve.NoxCurveEngine,
        abi: engineAbi,
        functionName: "prepareEpoch",
        args: [openedEpochId],
        account: curator,
        chain: sepolia,
      } as never,
      "prepareEpoch",
    );
    console.log(`  epoch      ${openedEpochId}\n`);

    // ── Stages ───────────────────────────────────────────────────────────────────────────────
    const runStage = async (stage: number, method: string): Promise<void> => {
      const progress = await read<{ total: number }>(
        publicClient,
        curve.QuoteEpochController,
        epochAbi,
        "progressOf",
        [openedEpochId, stage],
      );
      for (let chunk = 0; chunk < Number(progress.total); chunk += 1) {
        const args = method.startsWith("publish") ? [openedEpochId] : [openedEpochId, chunk];
        await send(
          ctx,
          curatorWallet,
          {
            address: curve.NoxCurveEngine,
            abi: engineAbi,
            functionName: method,
            args,
            account: curator,
            chain: sepolia,
          } as never,
          `${method}[${chunk}]`,
        );
      }
      await send(
        ctx,
        curatorWallet,
        {
          address: curve.NoxCurveEngine,
          abi: engineAbi,
          functionName: "advanceStage",
          args: [openedEpochId],
          account: curator,
          chain: sepolia,
        } as never,
        `advance past ${method}`,
      );
      console.log(`  ${method.padEnd(22)} ${progress.total} chunk(s)`);
    };

    await runStage(STAGE.CacheProviders, "cacheProviderChunk");
    await runStage(STAGE.Accumulate, "accumulateLeafChunk");
    await runStage(STAGE.FinalizeLeaves, "finalizeLeafChunk");
    await runStage(STAGE.ReduceWinner, "reduceWinnerChunk");
    await runStage(STAGE.PublishWinner, "publishWinner");

    // ── Prove the winner, so stage F can index the winning leaf publicly ─────────────────────
    const winnerHandles = await read<{ marketIndex: Handle; rateIndex: Handle }>(
      publicClient,
      curve.NoxCurveEngine,
      engineAbi,
      "publishedOf",
      [openedEpochId],
    );
    const provenMarket = await borrowerClient.publicDecrypt(winnerHandles.marketIndex, POLL);
    const provenRate = await borrowerClient.publicDecrypt(winnerHandles.rateIndex, POLL);
    await send(
      ctx,
      curatorWallet,
      {
        address: curve.NoxCurveEngine,
        abi: engineAbi,
        functionName: "proveWinner",
        args: [
          openedEpochId,
          Number(provenMarket.value),
          Number(provenRate.value),
          provenMarket.decryptionProof,
          provenRate.decryptionProof,
        ],
        account: curator,
        chain: sepolia,
      } as never,
      "proveWinner",
    );
    console.log(`  proveWinner            market ${provenMarket.value}, rate ${provenRate.value}`);

    await runStage(STAGE.Allocate, "allocateChunk");
    await runStage(STAGE.PublishAggregate, "publishAggregate");
  }

  // ── Read back, AFTER every stage has run ───────────────────────────────────────────────────
  //
  // The first version of this script read `publishedOf` ONCE, before stage F, and reused it. Four
  // of the five handles were already set by `publishWinner`, so four decrypted correctly and only
  // `aggregateFill` was still the UNDEFINED handle — whose embedded chain id is 0, so the gateway
  // answered `unknown_chain: chain_id 0 not configured` rather than anything naming the real
  // mistake. Reading after the stages is the fix; reading it here, once, is why it stays fixed.
  const requestId = await read<Hex>(
    publicClient,
    phase2.ConfidentialRequestBook,
    requestAbi,
    "liveRequest",
    [curator.address, universe.id],
  );
  const epochId = await read<Hex>(
    publicClient,
    curve.QuoteEpochController,
    epochAbi,
    "epochIdFor",
    [universe.id, requestId],
  );

  const published = await read<{
    marketIndex: Handle;
    rateIndex: Handle;
    floorPassed: Handle;
    quoteReady: Handle;
    aggregateFill: Handle;
  }>(publicClient, curve.NoxCurveEngine, engineAbi, "publishedOf", [epochId]);

  const market = await borrowerClient.publicDecrypt(published.marketIndex, POLL);
  const rate = await borrowerClient.publicDecrypt(published.rateIndex, POLL);
  const floor = await borrowerClient.publicDecrypt(published.floorPassed, POLL);
  const ready = await borrowerClient.publicDecrypt(published.quoteReady, POLL);
  const aggregate = await borrowerClient.publicDecrypt(published.aggregateFill, POLL);

  // ── Verify through the read-only verifier, with real gateway proofs ────────────────────────
  const verified = await read<{
    marketIndex: bigint;
    rateIndex: bigint;
    privacyFloorPassed: boolean;
    quoteReady: boolean;
    aggregateFillAmount: bigint;
    graphRoot: Hex;
  }>(publicClient, curve.CurveResultVerifier, abiOf("CurveResultVerifier"), "verifyQuote", [
    epochId,
    market.decryptionProof,
    rate.decryptionProof,
    floor.decryptionProof,
    ready.decryptionProof,
    aggregate.decryptionProof,
  ]);

  // ── Compare against the plaintext reference model ──────────────────────────────────────────
  const expected = computeCurve(
    universe,
    providerAccounts.map<Provider>((account, i) => {
      const mandate = mandates[i];
      const balance = balances[i];
      if (mandate === undefined || balance === undefined)
        throw new Error(`provider ${i} fixture missing`);
      return { address: account.address, mandate, balance };
    }),
    request,
  );

  const agree =
    Number(verified.marketIndex) === expected.published.selectedMarketIndex &&
    Number(verified.rateIndex) === expected.published.selectedRateIndex &&
    verified.privacyFloorPassed === expected.published.privacyFloorPassed &&
    verified.quoteReady === expected.published.quoteReady &&
    verified.aggregateFillAmount === expected.published.aggregateFillAmount;

  console.log(`\n  epoch      ${epochId}`);
  console.log(
    `  verified   market ${verified.marketIndex}, rate ${verified.rateIndex}, floor ${verified.privacyFloorPassed}, ready ${verified.quoteReady}, aggregate ${verified.aggregateFillAmount}`,
  );
  console.log(
    `  reference  market ${expected.published.selectedMarketIndex}, rate ${expected.published.selectedRateIndex}, floor ${expected.published.privacyFloorPassed}, ready ${expected.published.quoteReady}, aggregate ${expected.published.aggregateFillAmount}`,
  );
  console.log(`  match      ${agree}`);

  if (!agree) {
    throw new Error(
      "the Sepolia result does NOT match the plaintext reference model. Running this on a public " +
        "network is the whole point, so this is a failure rather than a discrepancy to note.",
    );
  }

  // ── Evidence. The aggregate is public by construction; no private value is recorded. ───────
  const evidence = {
    $comment:
      "A real confidential curve epoch on Ethereum Sepolia, against the HOSTED iExec Nox stack. " +
      "The aggregate below is one of the five values the engine deliberately publishes; no " +
      "private value is recorded here or anywhere else.",
    measuredAt: new Date().toISOString(),
    chainId: CHAIN_ID,
    gateway,
    epochId,
    universeId: universe.id,
    requestId,
    engine: curve.NoxCurveEngine,
    shape: {
      providers: 2,
      markets: 1,
      rates: 2,
      leaves: universe.leaves.length,
      cells: 2 * universe.leaves.length,
    },
    published: {
      selectedMarketIndex: Number(verified.marketIndex),
      selectedRateIndex: Number(verified.rateIndex),
      privacyFloorPassed: verified.privacyFloorPassed,
      quoteReady: verified.quoteReady,
      aggregateFillAmount: verified.aggregateFillAmount.toString(),
    },
    graphRoot: verified.graphRoot,
    matchesPlaintextReferenceModel: agree,
    // NOT the epoch's cost. A `--resume` verification spends nothing, so this is zero on a resumed
    // run and would be a lie if it were called `gasUsed`. The epoch's real cost is measured from
    // wallet balances by `scripts/test/sepolia-epoch-cost.ts`.
    gasUsedThisRun: ctx.gas.toString(),
    resumed: resumeUniverse !== undefined,
    verdict:
      "PASS — the full pipeline ran on a public network against hosted services, the five results " +
      "verified through CurveResultVerifier with real gateway proofs, and every published value " +
      "matched the plaintext reference model exactly.",
  };

  const payload = `${stableStringify(evidence)}\n`;
  assertNoSecrets(payload, "evidence/phase3/sepolia-epoch.json");
  mkdirSync(repoPath("evidence/phase3"), { recursive: true });
  writeFileSync(repoPath("evidence/phase3/sepolia-epoch.json"), payload);

  /**
   * In settlement mode, the same epoch is recorded again with the GATEWAY PROOFS, so
   * `scripts/test/sepolia-settlement.ts` can activate it without paying for a second epoch.
   *
   * The proofs are public artifacts: each is a gateway signature over a handle and a value the engine
   * deliberately published. Recording one discloses nothing that `allowPublicDecryption` has not
   * already made readable by anyone, and `assertNoSecrets` inspects the file before it is written.
   */
  if (settlementUniverse) {
    const settlementEvidence = {
      $comment:
        "A real confidential curve epoch on Ethereum Sepolia over a SETTLEMENT-GRADE universe — one " +
        "whose market is a deployed Midnight market and whose grid prices are TickLib.tickToPrice. " +
        "Carries the five gateway proofs so the quote can be activated without re-running the epoch. " +
        "Every value is public; no private value is recorded here or anywhere else.",
      measuredAt: new Date().toISOString(),
      chainId: CHAIN_ID,
      epochId,
      universeId: universe.id,
      requestId,
      graphRoot: verified.graphRoot,
      published: {
        selectedMarketIndex: Number(verified.marketIndex),
        selectedRateIndex: Number(verified.rateIndex),
        privacyFloorPassed: verified.privacyFloorPassed,
        quoteReady: verified.quoteReady,
        aggregateFillAmount: verified.aggregateFillAmount.toString(),
      },
      proofs: {
        market: market.decryptionProof,
        rate: rate.decryptionProof,
        floor: floor.decryptionProof,
        ready: ready.decryptionProof,
        aggregate: aggregate.decryptionProof,
      },
      matchesPlaintextReferenceModel: agree,
    };
    const settlementPayload = `${stableStringify(settlementEvidence)}\n`;
    assertNoSecrets(settlementPayload, "evidence/phase4/sepolia-epoch.json");
    mkdirSync(repoPath("evidence/phase4"), { recursive: true });
    writeFileSync(repoPath("evidence/phase4/sepolia-epoch.json"), settlementPayload);
    console.log("  recorded in evidence/phase4/sepolia-epoch.json (with gateway proofs)");
  }

  if (ctx.gas > 0n) console.log(`\n  ${ctx.gas} gas spent by this run`);
  console.log(
    `  balance    ${formatEther(await publicClient.getBalance({ address: curator.address }))} ETH`,
  );
  console.log("  recorded in evidence/phase3/sepolia-epoch.json\n");
}

main().catch((error: unknown) => {
  console.error(
    `\nsepolia-curve-epoch FAILED: ${error instanceof Error ? error.message : String(error)}`,
  );
  process.exitCode = 1;
});
