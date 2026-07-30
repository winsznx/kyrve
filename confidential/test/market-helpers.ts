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
