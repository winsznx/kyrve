/**
 * Phase 6 harness: the secondary-market layer over a settled Phase 5 series.
 *
 * Cross and Roll both operate on claims that ALREADY EXIST, so everything here builds on top of a
 * completed ownership allocation rather than beside it. Nothing in this file mints a claim, and
 * nothing here can: `KyrveSeriesToken.mintClaim` is `onlyAllocator` and takes a handle, so a market
 * helper that wanted to fabricate inventory would have to go through a real epoch to get it.
 */

import assert from "node:assert/strict";

import type { Handle } from "@kyrve/nox";

import type { CurveHarness } from "./curve-helpers.js";
import { clientFor, mine, ROLE_INDEX, SUITE_POLL } from "./helpers.js";
import type { SeriesLayer } from "./series-helpers.js";
import type { SettlementHarness } from "./settlement-helpers.js";

const WAD = 10n ** 18n;
const BPS = 10_000n;

/** `KyrveCrossBook.Side`, in enum order. */
export const SIDE = { Exit: 0, Entry: 1 } as const;
/** `KyrveCrossBook.OrderState`, in enum order. */
export const ORDER_STATE = { None: 0, Open: 1, Cancelled: 2, Settled: 3 } as const;

export interface CrossBook {
  readonly book: any;
  readonly priceWad: bigint;
  readonly feeBps: bigint;
  readonly feeBeneficiary: `0x${string}`;
  readonly keeper: any;
  readonly deploymentGas: bigint;
}

/**
 * Deploys one Cross book over one series at one declared price.
 *
 * The fee beneficiary is the RESIDUE BENEFICIARY role, not the curator and not the keeper. A fee
 * that accrued to an operational key would be a role that can silently redirect provider value,
 * which is exactly what `docs/phase6/ROLES.md` forbids — and the address is an `immutable`, so no
 * key can change it after the first order exists.
 */
export async function deployCrossBook(
  h: CurveHarness,
  s: SettlementHarness,
  series: SeriesLayer,
  options: { readonly priceWad: bigint; readonly feeBps?: number } = { priceWad: WAD },
): Promise<CrossBook> {
  const feeBps = BigInt(options.feeBps ?? 0);
  const feeBeneficiary = h.wallets[ROLE_INDEX.residueBeneficiary].account.address as `0x${string}`;
  const keeper = h.wallets[ROLE_INDEX.keeper];
  const deploymentId = (await s.registry.read.DEPLOYMENT_ID()) as `0x${string}`;

  const book = await h.connection.viem.deployContract("KyrveCrossBook", [
    series.seriesId,
    deploymentId,
    series.token.address,
    h.asset.address,
    options.priceWad,
    Number(feeBps),
    feeBeneficiary,
    keeper.account.address,
    h.controller.address,
  ]);

  return { book, priceWad: options.priceWad, feeBps, feeBeneficiary, keeper, deploymentGas: 0n };
}

/**
 * The plaintext reference model for one Cross match.
 *
 * Every division rounds DOWN, in the direction that leaves the remainder with the party who
 * supplied it — the same rule Midnight's `units -> buyerAssets` follows and for the same reason: a
 * rounding that could go the other way is a rounding under which the counterparty can owe more than
 * they committed.
 */
export function modelMatch(
  sellerQty: bigint,
  buyerAssets: bigint,
  priceWad: bigint,
  feeBps: bigint,
): {
  readonly capacity: bigint;
  readonly matched: bigint;
  readonly cost: bigint;
  readonly fee: bigint;
  readonly net: bigint;
  readonly sellerLeft: bigint;
  readonly buyerLeft: bigint;
} {
  const capacity = (buyerAssets * WAD) / priceWad;
  const matched = sellerQty < capacity ? sellerQty : capacity;
  const cost = (matched * priceWad) / WAD;
  const fee = (cost * feeBps) / BPS;
  return {
    capacity,
    matched,
    cost,
    fee,
    net: cost - fee,
    sellerLeft: sellerQty - matched,
    buyerLeft: buyerAssets - cost,
  };
}

/**
 * Deploys a SECOND, independent confidential layer beside the harness's own.
 *
 * ════════════════════════════════════════════════════════════════════════════════════════════
 * WHY THIS HAS TO EXIST, AND WHAT IT DISCOVERED
 * ════════════════════════════════════════════════════════════════════════════════════════════
 *
 * A Kyrve deployment supports exactly ONE series, and nothing before Phase 6 needed to notice.
 * `KyrveCustodyVault.bindSettler` is one-shot; the settler is a `SeriesAllocator`; a
 * `SeriesAllocator` holds `SERIES_ID`, `TOKEN`, `OWNERSHIP`, `VAULT` and `MARKET_ID` as immutables.
 * So a second series needs a second allocator, which needs a second custody vault it can be the
 * settler of — and `NoxCurveEngine` holds the custody vault as an `immutable`, so a second vault
 * needs a second engine, and `bindEngine` is one-shot on the epoch controller, the graph registry
 * and the reservation ledger.
 *
 * That is the same cascade `scripts/deploy/series.ts` documents for a new engine, arrived at from
 * the other direction. Attempting the second series without it fails with
 * `SettlerAlreadyBound`, which is the correct refusal and says nothing about the cause — this
 * comment is the cause.
 *
 * A roll needs two series, so a roll needs two layers. What they SHARE is deliberate and is what
 * makes the fixture honest: one emergency controller, one wrapped asset, one mandate book, one
 * request book, one universe registry and one Midnight substrate. Providers hold their mandates in
 * the same book and both series redeem in the same loan token, which is what
 * `KyrveRollBook`'s constructor checks.
 */
export async function deployParallelCurveLayer(h: CurveHarness): Promise<CurveHarness> {
  const asDeployer = { account: h.wallets[ROLE_INDEX.deployer].account };

  const custody = await h.connection.viem.deployContract("KyrveCustodyVault", [
    h.asset.address,
    h.controller.address,
  ]);
  const epochs = await h.connection.viem.deployContract("QuoteEpochController", [
    h.universes.address,
    h.mandateBook.address,
    h.requestBook.address,
  ]);
  const graph = await h.connection.viem.deployContract("CurveGraphRegistry", [epochs.address]);
  const ledger = await h.connection.viem.deployContract("ReservationLedger", [
    custody.address,
    h.controller.address,
  ]);
  const engine = await h.connection.viem.deployContract("NoxCurveEngine", [
    h.universes.address,
    epochs.address,
    graph.address,
    ledger.address,
    h.mandateBook.address,
    h.requestBook.address,
    custody.address,
    h.controller.address,
  ]);
  const verifier = await h.connection.viem.deployContract("CurveResultVerifier", [
    graph.address,
    engine.address,
    epochs.address,
  ]);

  await mine(h, await epochs.write.bindEngine([engine.address], asDeployer));
  await mine(h, await graph.write.bindEngine([engine.address], asDeployer));
  await mine(h, await ledger.write.bindEngine([engine.address], asDeployer));
  await mine(h, await custody.write.bindReserver([ledger.address], asDeployer));

  return { ...h, custody, epochs, graph, ledger, engine, verifier };
}

/** Mints public loan tokens to a wallet and wraps them into the confidential asset. */
export async function fundWrapped(
  h: CurveHarness,
  walletIndex: number,
  amount: bigint,
): Promise<`0x${string}`> {
  const wallet = h.wallets[walletIndex];
  const address = wallet.account.address as `0x${string}`;
  await mine(
    h,
    await h.underlying.write.mint([address, amount], {
      account: h.wallets[ROLE_INDEX.deployer].account,
    }),
  );
  await mine(
    h,
    await h.underlying.write.approve([h.asset.address, amount], { account: wallet.account }),
  );
  await mine(h, await h.asset.write.wrap([address, amount], { account: wallet.account }));
  return address;
}

/**
 * Grants a short ERC-7984 operator window, runs one action, then ends the grant.
 *
 * ERC-7984 has NO per-amount allowance, so the window is all-or-nothing over the holder's ENTIRE
 * confidential balance. Grant, act, `until = 0` is the only honest pattern and is what a user
 * interface must show before the grant is signed. The window is computed from the CHAIN's clock,
 * not the wall clock: a suite that warps time leaves the two diverged, and a window from
 * `Date.now()` lands in the chain's past (delta R-12).
 */
export async function withOperatorWindow(
  h: CurveHarness,
  token: any,
  walletIndex: number,
  operator: `0x${string}`,
  action: () => Promise<unknown>,
): Promise<void> {
  const wallet = h.wallets[walletIndex];
  const until = (await h.publicClient.getBlock()).timestamp + 3_600n;
  await mine(h, await token.write.setOperator([operator, until], { account: wallet.account }));
  await action();
  await mine(h, await token.write.setOperator([operator, 0n], { account: wallet.account }));
}

/** Decrypts a handle as one wallet, returning zero for the undefined handle. */
export async function decryptAs(
  h: CurveHarness,
  walletIndex: number,
  handle: Handle,
): Promise<bigint> {
  if (handle === `0x${"00".repeat(32)}`) return 0n;
  const client = await clientFor(h, walletIndex);
  return client.decrypt(handle, SUITE_POLL);
}

/** One wallet's confidential balance in an ERC-7984 token, decrypted as that wallet. */
export async function confidentialBalance(
  h: CurveHarness,
  token: any,
  walletIndex: number,
): Promise<bigint> {
  const address = h.wallets[walletIndex].account.address as `0x${string}`;
  const handle = (await token.read.confidentialBalanceOf([address])) as Handle;
  return decryptAs(h, walletIndex, handle);
}

/**
 * Asserts an event carries no amount-shaped field.
 *
 * A "no public amount" claim is easy to make and easy to break by adding one indexed argument to an
 * event during a refactor. This reads the ABI rather than the emitted log, so it fails at the
 * DECLARATION rather than only on the one path a test happened to exercise.
 */
export function assertEventCarriesNoAmount(abi: readonly unknown[], eventName: string): void {
  const entry = (
    abi as { type: string; name?: string; inputs?: { name: string; type: string }[] }[]
  ).find((item) => item.type === "event" && item.name === eventName);
  assert.ok(entry !== undefined, `the ABI declares no event called ${eventName}`);
  for (const input of entry.inputs ?? []) {
    const looksNumeric = /^uint(8|16|32|64|128|256)?$/.test(input.type);
    const looksLikeAnAmount = /amount|qty|quantity|size|value|proceeds|fee/i.test(input.name);
    assert.ok(
      !(looksNumeric && looksLikeAnAmount),
      `${eventName} declares a numeric field called ${input.name} — a confidential match must ` +
        "emit the same shape whatever it filled",
    );
  }
}
