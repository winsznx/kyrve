/**
 * Registers one frozen universe on Ethereum Sepolia, for a named market.
 *
 * ════════════════════════════════════════════════════════════════════════════════════════════
 * WHY THIS IS ITS OWN SCRIPT
 * ════════════════════════════════════════════════════════════════════════════════════════════
 *
 * `deploy:series` needs an ACTIVE universe before it can pick a market and create a series vault,
 * and `sepolia-curve-epoch` creates a universe as part of running an epoch. That is fine while there
 * is one layer. Phase 6's layer B needs a universe on a DIFFERENT market before its layer exists, so
 * the two cannot be the same step — hence this, which does the universe and nothing else.
 *
 * ════════════════════════════════════════════════════════════════════════════════════════════
 * THE CURATOR HERE IS THE LEGACY ONE, AND THAT IS A REAL CONSTRAINT
 * ════════════════════════════════════════════════════════════════════════════════════════════
 *
 * `CurveUniverseRegistry` is deliberately never redeployed — it holds every registered universe and
 * rate grid — and its `curator` is an `immutable` set when Phase 3 deployed it: the deployer's
 * address. So Phase 6's separated curator CANNOT register a universe, and this script signs as the
 * deployer.
 *
 * That is exactly the row `docs/phase6/ROLES.md` records under rotation: "existing universes keep
 * the old curator: `CurveUniverseRegistry.curator` is immutable and the registry is deliberately not
 * redeployed." It is stated here at the point it bites rather than left to be discovered.
 *
 * ════════════════════════════════════════════════════════════════════════════════════════════
 * FROZEN ON ACTIVATION
 * ════════════════════════════════════════════════════════════════════════════════════════════
 *
 * `activateUniverse` is one-way. Every published rate grid, privacy floor and chunk width is
 * committed to at that moment, and a quote written against a mutable universe would let the curator
 * move the goalposts under a sealed epoch. Nothing here can be edited afterwards.
 */

import { mkdirSync, writeFileSync } from "node:fs";

import { buildUniverse } from "@kyrve/curve";
import { encodeMarket } from "@kyrve/midnight";
import { tickToPrice } from "@kyrve/quote-math";
import {
  type Address,
  createPublicClient,
  createWalletClient,
  formatEther,
  type Hex,
  http,
  keccak256,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { sepolia } from "viem/chains";

import {
  assertBroadcastArmed,
  assertNoSecrets,
  deployer,
  safeErrorMessage,
  sepoliaRpc,
} from "../lib/env.js";
import { readJson, repoPath, stableStringify } from "../lib/shell.js";

const CHAIN_ID = 11_155_111;
/** The same two ticks the Phase 4 and Phase 5 universes use, so the grids stay comparable. */
const TICKS = [6000, 5968];

const UNIVERSE_ABI = [
  {
    type: "function",
    name: "createUniverse",
    stateMutability: "nonpayable",
    // `cellsPerChunk` is uint32, not uint16. An earlier draft had uint16, which is a DIFFERENT
    // selector — the call reached no function at all and reverted with no reason, which reads
    // identically to a rejected argument.
    inputs: [
      { type: "string" },
      { type: "uint16" },
      { type: "uint16" },
      { type: "uint256" },
      { type: "uint32" },
    ],
    outputs: [{ type: "bytes32" }],
  },
  {
    type: "function",
    name: "addMarket",
    stateMutability: "nonpayable",
    inputs: [
      { type: "bytes32" },
      {
        type: "tuple",
        components: [
          { name: "marketId", type: "bytes32" },
          { name: "marketStructHash", type: "bytes32" },
          { name: "maturity", type: "uint64" },
          { name: "collateralFamily", type: "uint16" },
          { name: "maturityBucket", type: "uint16" },
          { name: "tickSpacing", type: "uint32" },
          { name: "settlementFeeFloorWad", type: "uint256" },
          { name: "publicPriority", type: "uint16" },
        ],
      },
      // int24[], not uint32[] — the grid carries signed Midnight ticks.
      { type: "int24[]" },
      { type: "uint256[]" },
    ],
    outputs: [{ type: "uint16" }],
  },
  {
    type: "function",
    name: "activateUniverse",
    stateMutability: "nonpayable",
    inputs: [{ type: "bytes32" }],
    outputs: [{ type: "bytes32" }],
  },
  {
    type: "function",
    name: "isActive",
    stateMutability: "view",
    inputs: [{ type: "bytes32" }],
    outputs: [{ type: "bool" }],
  },
  {
    type: "function",
    name: "leafCount",
    stateMutability: "view",
    inputs: [{ type: "bytes32" }],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function",
    name: "curator",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "address" }],
  },
] as const;

async function main(): Promise<void> {
  const marketKey = process.argv[2];
  if (marketKey === undefined || marketKey.startsWith("--")) {
    throw new Error("usage: deploy:universe <market-key>  (e.g. usdc-30d-weth)");
  }
  assertBroadcastArmed();

  const rpc = sepoliaRpc();
  const account = privateKeyToAccount(deployer().privateKey);
  const publicClient = createPublicClient({ chain: sepolia, transport: http(rpc.url) });
  const wallet = createWalletClient({ account, chain: sepolia, transport: http(rpc.url) });

  const onChainId = await publicClient.getChainId();
  if (onChainId !== CHAIN_ID) throw new Error(`the RPC is on chain ${onChainId}, not Sepolia`);

  const markets = readJson<{
    markets: readonly { id: Hex; key: string; market: Record<string, unknown> }[];
  }>(repoPath("deployments/sepolia/markets.json"));
  const chosen = markets.markets.find((entry) => entry.key === marketKey);
  if (chosen === undefined) {
    throw new Error(
      `markets.json records no market keyed ${marketKey}. Known: ` +
        markets.markets.map((m) => m.key).join(", "),
    );
  }

  const curve = readJson<{ addresses: Record<string, Address> }>(
    repoPath("deployments/sepolia/curve.json"),
  );
  const registry = curve.addresses["CurveUniverseRegistry"];
  if (registry === undefined) throw new Error("curve.json names no CurveUniverseRegistry");

  const legacyCurator = (await publicClient.readContract({
    address: registry,
    abi: UNIVERSE_ABI,
    functionName: "curator",
  })) as Address;
  if (legacyCurator.toLowerCase() !== account.address.toLowerCase()) {
    throw new Error(
      `CurveUniverseRegistry.curator is ${legacyCurator} but this run signs as ${account.address}. ` +
        "The universe registry is never redeployed and its curator is an immutable set in Phase 3, " +
        "so Phase 6's separated curator cannot register a universe. docs/phase6/ROLES.md, rotation.",
    );
  }

  const pricesWad = TICKS.map((tick) => tickToPrice(BigInt(tick)));
  const label = `kyrve-sepolia-${marketKey}-${Math.floor(Date.now() / 1000)}`;
  /**
   * The SAME draft shape `sepolia-curve-epoch` builds, field for field.
   *
   * `marketStructHash` is `keccak256(encodeMarket(market))` and not the market id — the id is
   * Midnight's own `IdLib.toId`, which is a CREATE2 hash rather than a hash of the struct, and
   * passing one for the other produces a universe whose leaves no quote can ever authenticate
   * against. `settlementFeeFloorWad` is the static guard; the live check is in `QuoteActivator`
   * against `IMidnight.settlementFee`.
   */
  const draft = {
    label,
    chainId: CHAIN_ID,
    registry,
    maxProviders: 2,
    privacyFloor: 2,
    minTicketAssets: 1_000_000n,
    cellsPerChunk: 4,
    markets: [
      {
        spec: {
          marketId: chosen.id,
          marketStructHash: keccak256(encodeMarket(chosen.market as never)),
          maturity: BigInt((chosen.market as { maturity: string }).maturity),
          collateralFamily: 0,
          maturityBucket: marketKey.includes("30d") ? 0 : 1,
          tickSpacing: 4,
          settlementFeeFloorWad: 10n ** 15n,
          publicPriority: 0,
        },
        ticks: TICKS,
        pricesWad,
      },
    ],
  };
  const universe = buildUniverse(draft as never);

  console.log(`\ndeploy:universe — ${marketKey} — ${rpc.redacted}\n`);
  console.log(`  registry  ${registry}`);
  console.log(`  curator   ${account.address}  (the LEGACY curator; immutable since Phase 3)`);
  console.log(`  market    ${chosen.id}`);
  console.log(`  label     ${label}`);
  console.log(
    `  balance   ${formatEther(await publicClient.getBalance({ address: account.address }))} ETH\n`,
  );

  const send = async (functionName: string, args: readonly unknown[]): Promise<bigint> => {
    const hash = await wallet.writeContract({
      address: registry,
      abi: UNIVERSE_ABI,
      functionName: functionName as never,
      args: args as never,
      account,
      chain: sepolia,
    });
    const receipt = await publicClient.waitForTransactionReceipt({ hash });
    if (receipt.status !== "success") throw new Error(`${functionName} reverted (${hash})`);
    console.log(`  ${functionName.padEnd(18)} ${receipt.gasUsed} gas  ${hash}`);
    return receipt.gasUsed;
  };

  let gas = 0n;
  gas += await send("createUniverse", [
    label,
    draft.maxProviders,
    draft.privacyFloor,
    draft.minTicketAssets,
    draft.cellsPerChunk,
  ]);
  const market = draft.markets[0];
  if (market === undefined) throw new Error("the draft has no market");
  gas += await send("addMarket", [universe.id, market.spec, market.ticks, market.pricesWad]);
  gas += await send("activateUniverse", [universe.id]);

  // Read back from chain, never from the draft.
  const active = (await publicClient.readContract({
    address: registry,
    abi: UNIVERSE_ABI,
    functionName: "isActive",
    args: [universe.id],
  })) as boolean;
  const leaves = (await publicClient.readContract({
    address: registry,
    abi: UNIVERSE_ABI,
    functionName: "leafCount",
    args: [universe.id],
  })) as bigint;
  if (!active) throw new Error(`universe ${universe.id} did not activate`);
  if (leaves === 0n) throw new Error(`universe ${universe.id} carries no leaves`);

  const record = {
    $comment:
      "One frozen universe on Ethereum Sepolia. Registered by the LEGACY curator — " +
      "CurveUniverseRegistry is never redeployed and its curator is an immutable set in Phase 3, " +
      "so Phase 6's separated curator cannot register one. docs/phase6/ROLES.md, rotation.",
    chainId: CHAIN_ID,
    registry,
    curator: account.address,
    marketKey,
    marketId: chosen.id,
    universeId: universe.id,
    label,
    leaves: Number(leaves),
    ticks: TICKS,
    gasUsed: gas.toString(),
    registeredAt: new Date().toISOString(),
  };
  const payload = `${stableStringify(record)}\n`;
  assertNoSecrets(payload, `deployments/sepolia/universe-${marketKey}.json`);
  mkdirSync(repoPath("deployments/sepolia"), { recursive: true });
  writeFileSync(repoPath(`deployments/sepolia/universe-${marketKey}.json`), payload);

  console.log(`\n  universe  ${universe.id}  active, ${leaves} leaves`);
  console.log(`  gas       ${gas}`);
  console.log(`  recorded in deployments/sepolia/universe-${marketKey}.json\n`);
}

main().catch((error: unknown) => {
  console.error(`\ndeploy:universe FAILED: ${safeErrorMessage(error)}\n`);
  process.exitCode = 1;
});
