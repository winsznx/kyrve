/**
 * The Phase 4 harness: the confidential curve engine and REAL unmodified Morpho Midnight, on ONE
 * chain, with the real Nox stack behind both.
 *
 * ════════════════════════════════════════════════════════════════════════════════════════════
 * WHY THE SETTLEMENT CONTRACTS ARE DEPLOYED FROM FOUNDRY ARTIFACTS
 * ════════════════════════════════════════════════════════════════════════════════════════════
 *
 * `contracts/kyrve` and the vendored Midnight core compile at solc **0.8.34** with
 * `via_ir`, `optimizer_runs = 466`, `bytecode_hash = "none"` and `evm_version = "osaka"`, matching
 * the pinned Midnight release so runtime bytecode stays byte-comparable (PRD v1.1 A-1). The
 * confidential project compiles at **0.8.36**. Recompiling either under the other's settings would
 * produce different bytecode from what is deployed and verified on Sepolia, so the repository would
 * stop describing what is actually on chain.
 *
 * So this deploys the EXACT artifacts `forge build` produced — same bytes, same compiler, same
 * settings — onto the Nox Hardhat node. "Unmodified local Midnight" is then literally true: the
 * deployed code is the code Foundry compiled from the pinned submodule, not a re-compilation of it.
 *
 * ════════════════════════════════════════════════════════════════════════════════════════════
 * WHAT THIS HARNESS PROVES THAT THE FOUNDRY SUITE CANNOT
 * ════════════════════════════════════════════════════════════════════════════════════════════
 *
 * The Foundry suite answers "given a verified result, does settlement behave?" against a stub.
 * This answers the question the stub cannot: does a REAL encrypted epoch — real handles, real
 * gateway proofs, real ACL — produce a public result that really settles through real Midnight?
 * Nothing on either path is mocked.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  buildUniverse,
  type MarketGrid,
  type MarketSpec,
  UNIT,
  type Universe,
  type UniverseDraft,
} from "@kyrve/curve";
import { encodeMarket, encodeOffer, OFFER_ABI } from "@kyrve/midnight";
import type { Handle } from "@kyrve/nox";
import { deriveQuoteSize } from "@kyrve/quote";
import { tickToPrice } from "@kyrve/quote-math";
import { decodeAbiParameters, getContract, keccak256, parseEventLogs } from "viem";

import type { CurveHarness, PollOptions } from "./curve-helpers.js";
import { clientFor, mine, SUITE_POLL } from "./helpers.js";

/** Where `forge build` writes. One artifact per source file basename. */
function foundryArtifact(name: string): { abi: readonly unknown[]; bytecode: `0x${string}` } {
  const path = new URL(`../../out/${name}.sol/${name}.json`, import.meta.url);
  const artifact = JSON.parse(readFileSync(path, "utf8")) as {
    abi: readonly unknown[];
    bytecode: { object: string };
  };
  const object = artifact.bytecode.object;
  assert.ok(
    object !== undefined && object.length > 2,
    `${name} has no creation bytecode; run \`forge build\` before this suite`,
  );
  return { abi: artifact.abi, bytecode: object as `0x${string}` };
}

/**
 * Deploys one Foundry-compiled contract onto the Nox Hardhat node.
 *
 * Returns a viem contract bound to both a public and a wallet client, so the call surface matches
 * what `connection.viem.deployContract` returns for the confidential contracts and test code does
 * not have to remember which project a contract came from.
 */
export async function deployFoundry(
  h: CurveHarness,
  name: string,
  args: readonly unknown[],
  walletIndex = 0,
): Promise<any> {
  const { abi, bytecode } = foundryArtifact(name);
  const wallet = h.wallets[walletIndex];

  const hash = await wallet.deployContract({ abi, bytecode, args, account: wallet.account });
  const receipt = await mine(h, hash);
  assert.ok(receipt.contractAddress, `${name} deployment produced no address`);

  return getContract({
    address: receipt.contractAddress as `0x${string}`,
    abi,
    client: { public: h.publicClient, wallet },
  });
}

export interface SettlementHarness {
  /** The Foundry-built substrate: real Midnight, real markets, real tokens. */
  readonly fixture: any;
  readonly midnight: any;
  readonly usdc: any;
  readonly weth: any;
  /** Kyrve's settlement layer, wired exactly as it deploys. */
  readonly registry: any;
  readonly ratifier: any;
  readonly resultVerifier: any;
  readonly activator: any;
  readonly expiryController: any;
  readonly factory: any;
  readonly keeper: any;
  readonly operator: `0x${string}`;
  readonly curator: any;
}

/**
 * Deploys the whole Phase 4 settlement layer against an existing curve harness.
 *
 * The wiring order is forced by two one-shot bindings and is the same order
 * `scripts/deploy/settlement.ts` uses: registry, ratifier, verifier, activator, expiry controller,
 * then the factory — which needs the activator's address — then `bindFactory` back into the
 * activator. Nothing here is re-bindable and nothing has an owner.
 */
export async function deploySettlement(
  h: CurveHarness,
  options: { keeperIndex?: number; operatorIndex?: number } = {},
): Promise<SettlementHarness> {
  const keeper = h.wallets[options.keeperIndex ?? 9];
  const operatorWallet = h.wallets[options.operatorIndex ?? 8];
  const operator = operatorWallet.account.address as `0x${string}`;

  const anchor = (await h.publicClient.getBlock()).timestamp;
  const fixture = await deployFoundry(h, "LocalMidnightFixture", []);
  await mine(h, await fixture.write.deploy([anchor]));

  const midnightAddress = (await fixture.read.midnight()) as `0x${string}`;
  const midnight = getContract({
    address: midnightAddress,
    abi: foundryArtifact("Midnight").abi,
    client: { public: h.publicClient, wallet: h.wallets[0] },
  });
  const usdc = getContract({
    address: (await fixture.read.usdc()) as `0x${string}`,
    abi: foundryArtifact("TestERC20").abi,
    client: { public: h.publicClient, wallet: h.wallets[0] },
  });
  const weth = getContract({
    address: (await fixture.read.weth()) as `0x${string}`,
    abi: foundryArtifact("TestERC20").abi,
    client: { public: h.publicClient, wallet: h.wallets[0] },
  });

  const registry = await deployFoundry(h, "KyrveQuoteRegistry", [midnightAddress]);
  const ratifier = await deployFoundry(h, "KyrveSettlementRatifier", [
    midnightAddress,
    registry.address,
  ]);
  const resultVerifier = await deployFoundry(h, "KyrvePublicResultVerifier", [
    h.verifier.address,
    h.graph.address,
    h.engine.address,
    h.epochs.address,
  ]);
  const activator = await deployFoundry(h, "QuoteActivator", [
    registry.address,
    resultVerifier.address,
    h.universes.address,
    ratifier.address,
    keeper.account.address,
  ]);
  const expiryController = await deployFoundry(h, "KyrveQuoteExpiryController", [
    registry.address,
    operator,
  ]);

  await mine(h, await registry.write.bindActivator([activator.address]));
  await mine(h, await registry.write.bindExpiryController([expiryController.address]));

  const factory = await deployFoundry(h, "KyrveSeriesFactory", [
    registry.address,
    activator.address,
    expiryController.address,
    h.wallets[0].account.address,
  ]);
  await mine(h, await activator.write.bindFactory([factory.address]));

  return {
    fixture,
    midnight,
    usdc,
    weth,
    registry,
    ratifier,
    resultVerifier,
    activator,
    expiryController,
    factory,
    keeper,
    operator,
    curator: h.wallets[0],
  };
}

/**
 * A universe whose markets ARE the deployed Midnight markets and whose grid prices ARE
 * `TickLib.tickToPrice`.
 *
 * BOTH halves matter and neither is true of the Phase 3 fixture universe, which uses synthetic
 * market ids and a synthetic price curve because nothing in Phase 3 ever presented a leaf to
 * Midnight. `QuoteActivator` checks the leaf price against the pinned library and the market
 * against Midnight's own `IdLib.toId`, so a synthetic universe is refused — correctly.
 *
 * The ticks are chosen high, where `tickToPrice` is strictly descending and comfortably above the
 * market's settlement fee. Near `MAX_TICK` the curve is capped at par and goes flat, which would
 * fail the registry's strictly-descending check; far below it the price falls under the fee and
 * `take` reverts on underflow (PRD v1.1 A-3).
 */
export const SETTLEMENT_TICKS = [6000, 5968] as const;

export async function settlementMarketGrid(
  settlement: SettlementHarness,
  fixtureMarketIndex: number,
  spec: Partial<MarketSpec> = {},
): Promise<{ grid: MarketGrid; market: any; marketId: `0x${string}` }> {
  const market = await settlement.fixture.read.market([BigInt(fixtureMarketIndex)]);
  const marketId = (await settlement.fixture.read.marketId([
    BigInt(fixtureMarketIndex),
  ])) as `0x${string}`;

  const ticks = [...SETTLEMENT_TICKS];
  const pricesWad = ticks.map((tick) => tickToPrice(BigInt(tick)));

  for (let i = 1; i < pricesWad.length; i += 1) {
    const previous = pricesWad[i - 1];
    const current = pricesWad[i];
    assert.ok(
      previous !== undefined && current !== undefined && previous > current,
      `the settlement grid must be strictly descending; tick ${ticks[i]} is not`,
    );
  }

  return {
    market,
    marketId,
    grid: {
      spec: {
        marketId,
        marketStructHash: encodeMarketStructHash(market),
        maturity: BigInt(market.maturity),
        collateralFamily: 0,
        maturityBucket: 0,
        tickSpacing: 4,
        // The fixture's 90-day settlement fee is 1e15; every price above is at least 0.99e18.
        settlementFeeFloorWad: 10n ** 15n,
        publicPriority: 0,
        ...spec,
      },
      ticks,
      pricesWad,
    },
  };
}

/**
 * `keccak256(abi.encode(market))`, which is NOT the market id.
 *
 * Midnight's `IdLib.toId` is a CREATE2 address hash over an SSTORE2 deployment of the encoded
 * market; this is the plain struct hash. Both are bound into a quote because they answer different
 * questions — the id says which market Midnight accounts against, the struct hash says which exact
 * bytes were presented to it. The encoder is `@kyrve/midnight`'s, which is checked against ids a
 * real `touchMarket` returned.
 */
export function encodeMarketStructHash(market: any): `0x${string}` {
  return keccak256(encodeMarket(market));
}

/** Mints and supplies enough WETH collateral for `units` of debt at the fixture's 0.77 LLTV. */
export async function supplyCollateral(
  h: CurveHarness,
  settlement: SettlementHarness,
  market: any,
  who: any,
  units: bigint,
): Promise<void> {
  // Generous rather than exact. The health check is Midnight's; this suite is not about it.
  const collateral = (units * 10n ** 18n * 4n) / UNIT;
  await mine(h, await settlement.weth.write.mint([who.account.address, collateral]));
  await mine(
    h,
    await settlement.weth.write.approve([settlement.midnight.address, collateral], {
      account: who.account,
    }),
  );
  await mine(
    h,
    await settlement.midnight.write.supplyCollateral(
      [market, 0n, collateral, who.account.address],
      {
        account: who.account,
      },
    ),
  );
}

/**
 * Creates and activates a universe from explicit market grids, on chain and in the reference model
 * from ONE draft.
 *
 * `createUniverse` in the Phase 3 harness builds its own synthetic markets, which is right for the
 * curve engine and wrong for settlement: the activator checks the market against Midnight's own id
 * derivation and the leaf price against the pinned `TickLib`. This takes the grids the caller
 * built from the deployed markets instead.
 */
export async function createSettlementUniverse(
  h: CurveHarness,
  grids: readonly MarketGrid[],
  options: {
    readonly label?: string;
    readonly maxProviders?: number;
    readonly privacyFloor?: number;
    readonly minTicketAssets?: bigint;
    readonly cellsPerChunk?: number;
  } = {},
): Promise<{ universeId: `0x${string}`; universe: Universe }> {
  const label = options.label ?? `kyrve-settlement-${Date.now()}`;
  const draft: UniverseDraft = {
    label,
    chainId: 31337,
    registry: h.universes.address,
    maxProviders: options.maxProviders ?? 16,
    privacyFloor: options.privacyFloor ?? 2,
    minTicketAssets: options.minTicketAssets ?? UNIT,
    cellsPerChunk: options.cellsPerChunk ?? 64,
    markets: grids,
  };
  const universe = buildUniverse(draft);

  await mine(
    h,
    await h.universes.write.createUniverse(
      [label, draft.maxProviders, draft.privacyFloor, draft.minTicketAssets, draft.cellsPerChunk],
      { account: h.curator.account },
    ),
  );
  for (const grid of grids) {
    await mine(
      h,
      await h.universes.write.addMarket([universe.id, grid.spec, grid.ticks, grid.pricesWad], {
        account: h.curator.account,
      }),
    );
  }
  await mine(
    h,
    await h.universes.write.activateUniverse([universe.id], { account: h.curator.account }),
  );

  const onChainId = await h.universes.read.universeIdFor([label]);
  assert.equal(
    onChainId.toLowerCase(),
    universe.id.toLowerCase(),
    "universe id derivation drifted",
  );
  return { universeId: universe.id, universe };
}

/** One epoch's five public results, with the real gateway proofs that attest to them. */
export interface PublicResult {
  readonly marketIndex: number;
  readonly rateIndex: number;
  readonly privacyFloorPassed: boolean;
  readonly quoteReady: boolean;
  readonly aggregateFillAmount: bigint;
  readonly proofs: {
    readonly market: `0x${string}`;
    readonly rate: `0x${string}`;
    readonly floor: `0x${string}`;
    readonly ready: `0x${string}`;
    readonly aggregate: `0x${string}`;
  };
  readonly handles: {
    readonly marketIndex: Handle;
    readonly rateIndex: Handle;
    readonly floorPassed: Handle;
    readonly quoteReady: Handle;
    readonly aggregateFill: Handle;
  };
}

/**
 * Publicly decrypts all five results and keeps the proofs.
 *
 * The handle set is read AFTER `publishAggregate`, which is the whole of delta R-14: read it
 * between the two publishing transactions and the fifth handle is undefined, its embedded chain id
 * is 0, and the gateway answers `unknown_chain: chain_id 0 not configured` on a path where the
 * other four decrypt perfectly.
 */
export async function collectPublicResult(
  h: CurveHarness,
  epochId: `0x${string}`,
  poll: PollOptions = SUITE_POLL,
): Promise<PublicResult> {
  const published = await h.engine.read.publishedOf([epochId]);
  const client = await clientFor(h, 0);

  const market = await client.publicDecrypt(published.marketIndex as Handle, poll);
  const rate = await client.publicDecrypt(published.rateIndex as Handle, poll);
  const floor = await client.publicDecrypt(published.floorPassed as Handle, poll);
  const ready = await client.publicDecrypt(published.quoteReady as Handle, poll);
  const aggregate = await client.publicDecrypt(published.aggregateFill as Handle, poll);

  return {
    marketIndex: Number(market.value),
    rateIndex: Number(rate.value),
    privacyFloorPassed: floor.value === 1n,
    quoteReady: ready.value === 1n,
    aggregateFillAmount: aggregate.value,
    proofs: {
      market: market.decryptionProof,
      rate: rate.decryptionProof,
      floor: floor.decryptionProof,
      ready: ready.decryptionProof,
      aggregate: aggregate.decryptionProof,
    },
    handles: {
      marketIndex: published.marketIndex as Handle,
      rateIndex: published.rateIndex as Handle,
      floorPassed: published.floorPassed as Handle,
      quoteReady: published.quoteReady as Handle,
      aggregateFill: published.aggregateFill as Handle,
    },
  };
}

export interface ActivatedQuote {
  readonly quoteId: `0x${string}`;
  readonly offer: any;
  readonly vault: any;
  readonly market: any;
  readonly marketId: `0x${string}`;
  readonly exactUnits: bigint;
  readonly expectedBuyerAssets: bigint;
  readonly leafIndex: number;
  readonly graphRoot: `0x${string}`;
  /** Gas the activation transaction used. Feeds the Sepolia funding budget. */
  readonly activationGas: bigint;
  /** Gas the public funding transfer used, so the budget covers the whole sequence. */
  readonly fundingGas: bigint;
}

/**
 * Funds a series, activates one quote, and recovers the exact offer from the chain.
 *
 * The offer comes from the `OfferPublished` event rather than from a simulated return value: the
 * offer carries `start = block.timestamp`, so an offer read from a simulation would differ from the
 * mined one in exactly the field the hash covers. The recovered offer is hashed and compared
 * against what the registry stored, which is the same comparison the ratifier will make.
 */
export async function activateQuote(
  h: CurveHarness,
  s: SettlementHarness,
  epoch: {
    epochId: `0x${string}`;
    universeId: `0x${string}`;
    borrower: { requestId: `0x${string}` };
  },
  universe: Universe,
  result: PublicResult,
  markets: readonly { market: any; marketId: `0x${string}` }[],
  options: { lifetime?: bigint; fund?: boolean } = {},
): Promise<ActivatedQuote> {
  const leafIndex = universe.leaves.findIndex(
    (leaf) => leaf.marketIndex === result.marketIndex && leaf.rateIndex === result.rateIndex,
  );
  assert.ok(leafIndex >= 0, "the published (market, rate) pair is not a leaf of this universe");

  const chosen = markets[result.marketIndex];
  assert.ok(chosen !== undefined, `no deployed market for index ${result.marketIndex}`);

  const leaf = universe.leaves[leafIndex];
  assert.ok(leaf !== undefined);
  const size = deriveQuoteSize(
    result.aggregateFillAmount,
    tickToPrice(BigInt(leaf.tick)),
    leaf.tick,
  );

  const seriesId = (await s.factory.read.seriesIdFor([chosen.marketId])) as `0x${string}`;
  let vaultAddress = (await s.factory.read.vaultOf([seriesId])) as `0x${string}`;
  if (vaultAddress === "0x0000000000000000000000000000000000000000") {
    await mine(
      h,
      await s.factory.write.createSeries([chosen.marketId, s.usdc.address, s.operator], {
        account: s.curator.account,
      }),
    );
    vaultAddress = (await s.factory.read.vaultOf([seriesId])) as `0x${string}`;
  }
  const vault = getContract({
    address: vaultAddress,
    abi: foundryArtifactAbi("KyrveSeriesVault"),
    client: { public: h.publicClient, wallet: h.wallets[0] },
  });

  let fundingGas = 0n;
  if (options.fund !== false) {
    const funding = await mine(h, await s.usdc.write.mint([vaultAddress, size.buyerAssets]));
    fundingGas = funding.gasUsed as bigint;
  }

  const graphRoot = (await h.graph.read.rootOf([epoch.epochId])) as `0x${string}`;

  const receipt = await mine(
    h,
    await s.activator.write.activate(
      [
        {
          epochId: epoch.epochId,
          expectedGraphRoot: graphRoot,
          expectedRequestId: epoch.borrower.requestId,
          expectedUniverseId: epoch.universeId,
          market: chosen.market,
          leafIndex: BigInt(leafIndex),
          lifetime: options.lifetime ?? 3_600n,
          maxPendingFee: size.buyerAssets,
        },
        {
          marketProof: result.proofs.market,
          rateProof: result.proofs.rate,
          floorProof: result.proofs.floor,
          readyProof: result.proofs.ready,
          aggregateProof: result.proofs.aggregate,
        },
      ],
      { account: s.keeper.account },
    ),
  );

  const events = parseEventLogs({
    abi: foundryArtifactAbi("QuoteActivator"),
    logs: receipt.logs,
    eventName: "OfferPublished",
  });
  assert.equal(events.length, 1, "activation must publish exactly one offer");
  const published = events[0] as unknown as {
    args: { quoteId: `0x${string}`; offer: `0x${string}` };
  };
  const quoteId = published.args.quoteId;

  const [offer] = decodeAbiParameters([OFFER_ABI], published.args.offer);

  const execution = await s.registry.read.executionOf([quoteId]);
  assert.equal(
    keccak256(encodeOffer(offer as never)).toLowerCase(),
    (execution.offerHash as string).toLowerCase(),
    "the recovered offer must hash to what the registry stored",
  );
  assert.equal(execution.exactUnits, size.units, "units must match the public sizing rule");
  assert.equal(
    execution.expectedBuyerAssets,
    size.buyerAssets,
    "buyer assets must match the public sizing rule",
  );

  return {
    quoteId,
    offer,
    vault,
    market: chosen.market,
    marketId: chosen.marketId,
    exactUnits: size.units,
    expectedBuyerAssets: size.buyerAssets,
    leafIndex,
    graphRoot,
    activationGas: receipt.gasUsed as bigint,
    fundingGas,
  };
}

/**
 * The ABI of any Foundry-compiled source, by name — including INTERFACES.
 *
 * Separate from `foundryArtifact` because that one asserts creation bytecode exists, which an
 * interface has none of. Resolving a revert selector needs `IMidnight`'s error list, so the reader
 * that fetches it must not demand something interfaces cannot have.
 */
export function foundryArtifactAbi(name: string): readonly unknown[] {
  const path = new URL(`../../out/${name}.sol/${name}.json`, import.meta.url);
  const artifact = JSON.parse(readFileSync(path, "utf8")) as { abi: readonly unknown[] };
  assert.ok(
    Array.isArray(artifact.abi),
    `${name} has no ABI; run \`forge build\` before this suite`,
  );
  return artifact.abi;
}
