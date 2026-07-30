/**
 * Prices the Phase 6 Sepolia sequence against the live network, PER ROLE, before anything is signed.
 *
 * ════════════════════════════════════════════════════════════════════════════════════════════
 * WHAT IS DIFFERENT FROM EVERY EARLIER BUDGET
 * ════════════════════════════════════════════════════════════════════════════════════════════
 *
 * "Is it funded?" used to be one question about one wallet. With the roles separated it is four
 * questions about four wallets, and the aggregate answer can be yes while the real answer is no: a
 * deployer holding the entire balance cannot activate a quote, because `activate` is `onlyKeeper`
 * and the keeper is a different address. A sequence that starts with an underfunded keeper stops
 * partway with provider capital locked until someone cancels it, which is precisely the failure
 * `docs/phase5/PHASE-6-PREREQUISITES.md` P6-0 warned about.
 *
 * So every component below is attributed to the role that will actually send it, and the verdict is
 * per role. An aggregate is printed too, and it is explicitly NOT the check.
 *
 * ════════════════════════════════════════════════════════════════════════════════════════════
 * WHAT IS ESTIMATED AND WHAT IS MEASURED, NEVER CONFLATED
 * ════════════════════════════════════════════════════════════════════════════════════════════
 *
 *   ESTIMATED   the four new Phase 6 contract creations, by `eth_estimateGas` against the live
 *               network with the real bytecode and the real constructor arguments.
 *   MEASURED    everything else, from `evidence/phase5/funding-budget.json` (the Phase 5 sequence
 *               executed at 58,546,465 gas) and `evidence/phase6/*.json` (the local runs against
 *               the real Nox stack). Each component says which it is.
 *
 * The 35% safety margin is the same floor Phase 3 under-predicted by 27% against and Phase 5 by 18%.
 * Two samples are not a distribution, so it stays at 35%.
 *
 * Read-only. It sends nothing and prints no secret.
 */

import { existsSync, mkdirSync, writeFileSync } from "node:fs";

import { createPublicClient, encodeDeployData, formatEther, http } from "viem";
import { sepolia } from "viem/chains";

import { assertNoSecrets, safeErrorMessage, sepoliaRpc } from "../lib/env.js";
import { type RoleName, resolveRoles } from "../lib/roles.js";
import { readJson, repoPath, stableStringify } from "../lib/shell.js";

const DEFAULT_SAFETY_MARGIN = 0.35;
/** Every role that sends transactions in this sequence. The others are destinations. */
const PAYERS = ["deployer", "keeper", "curator", "operator"] as const;
type Payer = (typeof PAYERS)[number];

interface Component {
  readonly name: string;
  readonly payer: Payer;
  readonly gas: number;
  readonly kind: "estimated" | "measured";
  readonly source: string;
  /**
   * Evidence that this component has ALREADY been executed, relative to the repository root.
   *
   * THE VERDICT IS ABOUT WHAT REMAINS, NOT ABOUT THE WHOLE SEQUENCE. Once layer A is deployed, its
   * 28M gas is spent and the deployer's balance is lower by exactly that — pricing it again reports
   * the deployer as short by the amount it correctly spent, which is a stop condition firing on
   * success. Each component names the file that proves it landed.
   */
  readonly doneWhen?: string;
}

interface RoleVerdict {
  readonly role: Payer;
  /** Gas still to be spent by this role. The whole-sequence figure is `gasTotal`. */
  readonly gas: number;
  readonly gasTotal: number;
  readonly requiredEth: string;
  readonly balanceEth: string;
  readonly funded: boolean;
  readonly shortfallEth: string;
}

interface Sample {
  readonly recordedAt: string;
  readonly phase: "phase6";
  readonly scope: string;
  readonly components: readonly Component[];
  /** Gas still to be spent. The whole sequence, including what has landed, is `wholeSequenceGas`. */
  readonly estimatedGas: number;
  readonly wholeSequenceGas: number;
  readonly baseFeePerGasWei: string;
  readonly priorityFeePerGasWei: string;
  readonly effectiveGasPriceWei: string;
  readonly safetyMargin: number;
  readonly predictedCostEth: string;
  readonly predictedCostWithMarginEth: string;
  readonly perRole: readonly RoleVerdict[];
  readonly funded: boolean;
  readonly actualCostEth: string | null;
  readonly predictionErrorPercent: number | null;
}

const LEDGER_PATH = repoPath("evidence/phase6/funding-budget.json");

function hardhatArtifact(name: string): { abi: readonly unknown[]; bytecode: `0x${string}` } {
  const path = repoPath(`confidential/artifacts/contracts/${name}.sol/${name}.json`);
  if (!existsSync(path))
    throw new Error(`no Hardhat artifact for ${name}; compile the layer first`);
  const raw = readJson<{ abi: readonly unknown[]; bytecode: string }>(path);
  return { abi: raw.abi, bytecode: raw.bytecode as `0x${string}` };
}

function foundryArtifact(name: string): { abi: readonly unknown[]; bytecode: `0x${string}` } {
  const path = repoPath(`out/${name}.sol/${name}.json`);
  if (!existsSync(path)) throw new Error(`no Foundry artifact for ${name}; run \`forge build\``);
  const raw = readJson<{ abi: readonly unknown[]; bytecode: { object: string } }>(path);
  return { abi: raw.abi, bytecode: raw.bytecode.object as `0x${string}` };
}

async function main(): Promise<void> {
  const rpc = sepoliaRpc();
  if (rpc.isPublicEndpoint) {
    throw new Error("refusing to price against a keyless public endpoint; set ALCHEMY_API_KEY");
  }
  const client = createPublicClient({ chain: sepolia, transport: http(rpc.url) });
  const chainId = await client.getChainId();
  if (chainId !== 11_155_111) throw new Error(`the RPC is on chain ${chainId}, not Sepolia`);

  const roles = resolveRoles("sepolia");
  const series = readJson<{
    seriesId: `0x${string}`;
    marketId: `0x${string}`;
    deploymentId: `0x${string}`;
    seriesVault: `0x${string}`;
    contracts: Record<string, { address: `0x${string}` }>;
    reused: Record<string, `0x${string}`>;
  }>(repoPath("deployments/sepolia/series.json"));

  const from = roles.accounts.deployer.address;
  const at = (name: string): `0x${string}` => {
    const entry = series.contracts[name];
    if (entry === undefined) throw new Error(`series.json names no ${name}`);
    return entry.address;
  };

  /**
   * STAND-INS, NAMED. The Phase 5 addresses stand in for the Phase 6 ones that do not exist yet.
   * Creation gas depends on the bytecode and the argument WIDTHS, not on which address an argument
   * happens to be, so a stand-in of the right type prices the real thing.
   */
  const standIns = [
    "KyrveCapsuleVault, KyrveCrossBook: the deployed Phase 5 series contracts stand in for the " +
      "ones a Phase 6 layer will deploy; every argument is an address or a bytes32 either way",
    "KyrveRollBook: NOT estimated. Its constructor refuses SameSeries, so the single series token " +
      "on chain cannot stand in for both sides and eth_estimateGas fails rather than returning a " +
      "number. Bounded by KyrveCrossBook's live estimate, which over-states by 447 runtime bytes",
    "KyrveRoleRegistry: the seven real role addresses, which is not a stand-in at all",
  ];

  async function estimate(
    name: string,
    layer: "confidential" | "settlement",
    args: readonly unknown[],
  ): Promise<number> {
    const artifact = layer === "confidential" ? hardhatArtifact(name) : foundryArtifact(name);
    const data = encodeDeployData({
      abi: artifact.abi,
      bytecode: artifact.bytecode,
      args,
    } as Parameters<typeof encodeDeployData>[0]);
    const gas = await client.estimateGas({ account: from, data });
    return Number(gas);
  }

  console.log(`\nphase 6 market budget — ${rpc.redacted}\n`);
  console.log("  estimating the four new contract creations against the live network...");

  const controller = series.reused["KyrveEmergencyController"] as `0x${string}`;
  const crossBookGas = await estimate("KyrveCrossBook", "confidential", [
    series.seriesId,
    series.deploymentId,
    at("KyrveSeriesToken"),
    at("KyrveWrappedAsset"),
    970_000_000_000_000_000n,
    25,
    roles.accounts.residueBeneficiary.address,
    roles.accounts.keeper.address,
    controller,
  ]);

  const components: Component[] = [
    {
      name: "KyrveRoleRegistry",
      payer: "deployer",
      gas: await estimate("KyrveRoleRegistry", "settlement", [
        series.deploymentId,
        BigInt(chainId),
        roles.holders,
      ]),
      kind: "estimated",
      source: "eth_estimateGas against Sepolia, real bytecode and the real seven role addresses",
      doneWhen: "deployments/sepolia/series.json",
    },
    {
      name: "KyrveCapsuleVault",
      payer: "deployer",
      gas: await estimate("KyrveCapsuleVault", "confidential", [
        series.seriesId,
        series.marketId,
        series.deploymentId,
        at("KyrveSeriesToken"),
        at("SeriesOwnershipRegistry"),
        at("AggregateSolvencyVerifier"),
        at("SeriesResidueAccount"),
        series.seriesVault,
        roles.accounts.curator.address,
      ]),
      kind: "estimated",
      source: "eth_estimateGas against Sepolia, real bytecode, Phase 5 contracts standing in",
      doneWhen: "deployments/sepolia/market.json",
    },
    {
      name: "KyrveCrossBook",
      payer: "deployer",
      gas: crossBookGas,
      kind: "estimated",
      source: "eth_estimateGas against Sepolia, real bytecode and the real declared price and fee",
      doneWhen: "deployments/sepolia/market.json",
    },
    {
      /**
       * BOUNDED, NOT ESTIMATED, AND THE REASON IS THE CONTRACT DOING ITS JOB.
       *
       * `KyrveRollBook`'s constructor reverts `SameSeries` when source and target are one token, so
       * the one series token on chain cannot stand in for both and `eth_estimateGas` fails outright
       * rather than returning a number. There is no second token yet — that is the whole point of
       * layer B — so this creation genuinely cannot be priced against the live network today.
       *
       * It is bounded by `KyrveCrossBook`'s live estimate instead. The roll book's runtime is 11,317
       * bytes against the cross book's 11,764 (`verify:contract-size`), so the bound OVER-states, and
       * over-stating is the safe direction for a funding decision. Labelled `estimated` with the
       * substitution named rather than presented as a measurement of the thing itself.
       */
      name: "KyrveRollBook",
      payer: "deployer",
      gas: crossBookGas,
      kind: "estimated",
      source:
        "bounded by KyrveCrossBook's live eth_estimateGas — the roll book's constructor refuses " +
        "SameSeries so it cannot be estimated before a second series token exists, and its runtime " +
        "is 447 bytes SMALLER, so this over-states",
      doneWhen: "deployments/sepolia/market.json",
    },

    // ── Measured, from executed public and local runs ────────────────────────────────────────
    {
      name: "layer A: the role-separated series layer, 18 contracts and 12 bindings",
      payer: "deployer",
      gas: 28_318_988,
      kind: "measured",
      source: "evidence/phase5/GATE.md — the Phase 5 Sepolia deployment, executed",
      doneWhen: "deployments/sepolia/series.json",
    },
    {
      name: "layer A: provider funding, mandates, ACL grants and one full confidential epoch",
      payer: "deployer",
      gas: 26_931_546,
      kind: "measured",
      source:
        "evidence/phase5/funding-budget.json — the deployer stands in for providers and the " +
        "borrower on a public network, so this is its cost rather than the keeper's",
      doneWhen: "evidence/phase6/sepolia-epoch-a.json",
    },
    {
      name: "layer A: activation, one exact Midnight take, allocation, close, solvency",
      payer: "keeper",
      gas: 4_284_765,
      kind: "measured",
      source: "evidence/phase5/funding-budget.json — the keeper's own transactions",
      doneWhen: "evidence/phase6/sepolia-allocation-a.json",
    },
    {
      name: "layer A: universe checks and createSeries",
      payer: "curator",
      gas: 1_936_085,
      kind: "measured",
      source: "evidence/phase5/funding-budget.json — createSeries is onlyCurator from Phase 6",
      doneWhen: "deployments/sepolia/series.json",
    },
    {
      name: "Capsule: one ownership capsule and one public capsule",
      payer: "curator",
      gas: 816_394,
      kind: "measured",
      source: "evidence/phase6/capsule-gas.json — measured against the real Nox stack",
      doneWhen: "evidence/phase6/sepolia-capsule.json",
    },
    {
      name: "Cross: submit, submit, match, cancel, publish, settle residual",
      payer: "keeper",
      gas: 3_032_766,
      kind: "measured",
      source: "evidence/phase6/cross-gas.json — measured against the real Nox stack",
      doneWhen: "evidence/phase6/sepolia-cross.json",
    },
    {
      name: "layer B: a SECOND complete layer, for the smallest coherent Roll",
      payer: "deployer",
      gas: 28_318_988,
      kind: "measured",
      source:
        "delta U-1 — one custody vault serves one series, so a roll needs a second complete " +
        "layer. Same shape as layer A, so the same measured figure",
      doneWhen: "deployments/sepolia/series-b.json",
    },
    {
      name: "layer B: providers, mandates, grants and a second confidential epoch",
      payer: "deployer",
      gas: 26_931_546,
      kind: "measured",
      source: "the same Phase 5 measurement — a second epoch is not cheaper than the first",
      doneWhen: "evidence/phase6/sepolia-epoch-b.json",
    },
    {
      name: "layer B: activation, take, allocation, close",
      payer: "keeper",
      gas: 4_284_765,
      kind: "measured",
      source: "evidence/phase5/funding-budget.json",
      doneWhen: "evidence/phase6/sepolia-allocation-b.json",
    },
    {
      name: "layer B: createSeries and the source redemption factor",
      payer: "curator",
      gas: 2_000_000,
      kind: "measured",
      source: "createSeries measured, plus setRedemptionFactor which the roll conversion needs",
      doneWhen: "deployments/sepolia/series-b.json",
    },
    {
      name: "Roll: intent, supply, net, declare, settle, cancel",
      payer: "keeper",
      gas: 2_650_810,
      kind: "measured",
      source: "evidence/phase6/roll-gas.json — measured against the real Nox stack",
      doneWhen: "evidence/phase6/sepolia-roll.json",
    },
    {
      name: "recovery paths: one cancel and one recoverFunding",
      payer: "operator",
      gas: 400_000,
      kind: "measured",
      source: "evidence/phase4 — exercised so the operator's authority is proven, not assumed",
    },
  ];

  const block = await client.getBlock();
  const baseFee = block.baseFeePerGas ?? 1_000_000_000n;
  const priority = await client.estimateMaxPriorityFeePerGas();
  const gasPrice = baseFee + priority;
  const margin = DEFAULT_SAFETY_MARGIN;

  /**
   * REMAINING, not total. A component whose evidence file exists has already been paid for, and
   * pricing it again reports a role as short by exactly what it correctly spent — a stop condition
   * firing on success. The whole-sequence figure is still reported, clearly labelled.
   */
  const isDone = (component: Component): boolean =>
    component.doneWhen !== undefined && existsSync(repoPath(component.doneWhen));
  const remaining = components.filter((component) => !isDone(component));

  const totalGas = remaining.reduce((sum, c) => sum + c.gas, 0);
  const wholeSequenceGas = components.reduce((sum, c) => sum + c.gas, 0);
  const predicted = BigInt(totalGas) * gasPrice;
  const withMargin = (predicted * BigInt(Math.round((1 + margin) * 100))) / 100n;

  console.log(
    "\n  component                                                          payer      gas",
  );
  for (const c of components) {
    console.log(
      `  ${isDone(c) ? "done" : c.kind === "estimated" ? "   ~" : "    "} ` +
        `${c.name.slice(0, 62).padEnd(63)} ${c.payer.padEnd(9)} ${c.gas.toLocaleString()}`,
    );
  }

  const perRole: RoleVerdict[] = [];
  for (const payer of PAYERS) {
    const gas = remaining.filter((c) => c.payer === payer).reduce((s, c) => s + c.gas, 0);
    const gasTotal = components.filter((c) => c.payer === payer).reduce((s, c) => s + c.gas, 0);
    const required = (BigInt(gas) * gasPrice * BigInt(Math.round((1 + margin) * 100))) / 100n;
    const balance = await client.getBalance({
      address: roles.accounts[payer as RoleName].address,
    });
    perRole.push({
      role: payer,
      gas,
      gasTotal,
      requiredEth: formatEther(required),
      balanceEth: formatEther(balance),
      funded: balance >= required,
      shortfallEth: formatEther(balance >= required ? 0n : required - balance),
    });
  }

  console.log(`\n  base fee      ${Number(baseFee) / 1e9} gwei`);
  console.log(`  priority      ${Number(priority) / 1e9} gwei`);
  console.log(
    `  remaining gas ${totalGas.toLocaleString()}  (whole sequence ${wholeSequenceGas.toLocaleString()})`,
  );
  console.log(`  predicted     ${formatEther(predicted)} ETH`);
  console.log(`  with ${Math.round(margin * 100)}%      ${formatEther(withMargin)} ETH\n`);

  console.log("  PER ROLE — this is the check. The aggregate below is not.\n");
  for (const verdict of perRole) {
    console.log(
      `  ${verdict.funded ? "OK  " : "SHORT"} ${verdict.role.padEnd(10)} ` +
        `needs ${verdict.requiredEth.slice(0, 10).padEnd(11)} holds ${verdict.balanceEth.slice(0, 10).padEnd(11)}` +
        (verdict.funded ? "" : `short by ${verdict.shortfallEth}`),
    );
  }

  const funded = perRole.every((v) => v.funded);
  const sample: Sample = {
    recordedAt: new Date().toISOString(),
    phase: "phase6",
    scope:
      "The smallest real coherent public proof: role registry, Capsule, Cross and Roll deployed " +
      "and verified; one real Capsule; one real Cross match; one minimal Roll across TWO real " +
      "series, each with its own complete confidential issuance stack. No production-scale " +
      "throughput is claimed and no part of the second series is simulated.",
    components,
    estimatedGas: totalGas,
    wholeSequenceGas,
    baseFeePerGasWei: baseFee.toString(),
    priorityFeePerGasWei: priority.toString(),
    effectiveGasPriceWei: gasPrice.toString(),
    safetyMargin: margin,
    predictedCostEth: formatEther(predicted),
    predictedCostWithMarginEth: formatEther(withMargin),
    perRole,
    funded,
    actualCostEth: null,
    predictionErrorPercent: null,
  };

  const ledger = existsSync(LEDGER_PATH)
    ? readJson<{ $comment: string; standIns?: readonly string[]; samples: readonly Sample[] }>(
        LEDGER_PATH,
      )
    : {
        $comment:
          "Append-only funding predictions for the Phase 6 Sepolia sequence, attributed PER ROLE. " +
          "Earlier samples are never edited: a prediction quietly corrected after execution is not " +
          "a prediction, and the point is to learn the safety multiplier from real public samples.",
        standIns,
        samples: [] as readonly Sample[],
      };
  const next = { ...ledger, standIns, samples: [...ledger.samples, sample] };
  const payload = `${stableStringify(next)}\n`;
  assertNoSecrets(payload, "evidence/phase6/funding-budget.json");
  mkdirSync(repoPath("evidence/phase6"), { recursive: true });
  writeFileSync(LEDGER_PATH, payload);

  console.log(
    `\n  VERDICT: ${funded ? "FUNDED" : "UNDERFUNDED"} — appended to ${LEDGER_PATH.replace(process.cwd(), ".")}\n`,
  );
  if (!funded) process.exitCode = 1;
}

main().catch((error: unknown) => {
  console.error(`\nsepolia market budget FAILED — ${safeErrorMessage(error)}\n`);
  process.exitCode = 1;
});
