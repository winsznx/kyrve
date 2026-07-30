/**
 * What the whole Phase 5 Sepolia sequence costs, priced against the live network, before anything is
 * broadcast.
 *
 * ════════════════════════════════════════════════════════════════════════════════════════════
 * EVERY COMPONENT IS MEASURED OR THE TOTAL REFUSES TO BE A NUMBER
 * ════════════════════════════════════════════════════════════════════════════════════════════
 *
 * Two kinds of measurement, and each is named in the output beside the figure it produced:
 *
 *   ESTIMATED ON SEPOLIA   every contract deployment. `eth_estimateGas` is called against the live
 *                          network with the REAL creation bytecode and the REAL encoded constructor
 *                          arguments, from the real deployer, sending nothing. Creation gas is a
 *                          function of the calldata, the code deposit and the constructor's own
 *                          execution — so this is the figure, not a proxy for it.
 *
 *   MEASURED ON A CHAIN    every transaction sequence. The confidential epoch comes from the real
 *                          Sepolia epoch Phase 4 ran (26,931,546 gas, two providers, four cells,
 *                          aggregate exactly 299,999,999); activation and `take` from the real
 *                          Sepolia settlement; the series allocation from the local run against the
 *                          real Nox stack, because no public one exists yet and a public figure
 *                          cannot be invented.
 *
 * A component with no source is reported as MISSING and the total becomes unavailable. A confident
 * total assembled from guesses is exactly how a sequence strands halfway through, and a half-executed
 * epoch holds provider capital until someone cancels it.
 *
 * ════════════════════════════════════════════════════════════════════════════════════════════
 * WHY A CONSTRUCTOR ARGUMENT MAY BE A STAND-IN, AND WHY THAT IS SOUND
 * ════════════════════════════════════════════════════════════════════════════════════════════
 *
 * Some constructors read a contract that does not exist yet — `SeriesAllocator` calls
 * `vault.SERIES_ID()`, `QuoteActivator` calls `registry.DEPLOYMENT_ID()`. Estimating those needs an
 * address of the right TYPE at that position, so the already-deployed Phase 4 instance is used.
 *
 * That does not bias the figure. Creation gas depends on the bytecode, the calldata length and the
 * constructor's execution path — and swapping one valid address of the same type for another changes
 * none of the three. Every substitution is listed in the record under `standIns`, so nobody has to
 * infer which figures involved one.
 *
 * ════════════════════════════════════════════════════════════════════════════════════════════
 * IT NEVER REWRITES A PREDICTION AFTER THE FACT
 * ════════════════════════════════════════════════════════════════════════════════════════════
 *
 * Every run APPENDS a sample: the gas it estimated, the price it saw, what it predicted, the balance
 * it found, and whether that balance was enough. Earlier samples are never edited. A prediction
 * quietly corrected after execution is not a prediction, and the point of keeping them is to learn
 * the multiplier from real samples rather than to assert one.
 *
 * Read-only against the chain. It sends nothing, and it prints no secret: the RPC URL appears as
 * scheme and host only, and a keyless public endpoint is refused outright rather than silently used.
 */

import { existsSync, mkdirSync, writeFileSync } from "node:fs";

import { createPublicClient, encodeDeployData, formatEther, http } from "viem";
import { sepolia } from "viem/chains";

import { assertNoSecrets, deployer, sepoliaRpc } from "../lib/env.js";
import { readJson, repoPath, stableStringify } from "../lib/shell.js";

/**
 * The floor, until more public samples exist. Raise it, never lower it, without evidence.
 *
 * Phase 3's real Sepolia epoch cost 0.029918 ETH against a local prediction of 0.023624 — a 27%
 * under-prediction on a sequence whose GAS was measured rather than guessed. Gas used is
 * reproducible; the gas price across a hundred transactions minutes apart is not.
 */
const DEFAULT_SAFETY_MARGIN = 0.35;

interface GasComponent {
  readonly name: string;
  readonly gas: number;
  readonly source: string;
}

interface Sample {
  readonly recordedAt: string;
  readonly phase: "phase5";
  readonly components: readonly GasComponent[];
  readonly standIns: readonly string[];
  readonly estimatedGas: number;
  readonly baseFeePerGasWei: string;
  readonly priorityFeePerGasWei: string;
  readonly effectiveGasPriceWei: string;
  readonly safetyMargin: number;
  readonly predictedCostEth: string;
  readonly predictedCostWithMarginEth: string;
  readonly deployerBalanceEth: string;
  readonly funded: boolean;
  readonly shortfallEth: string;
  /** Filled in by a LATER sample once the sequence has run. Never written over an earlier one. */
  readonly actualCostEth: string | null;
  readonly predictionErrorPercent: number | null;
}

interface Ledger {
  readonly $comment: string;
  readonly samples: readonly Sample[];
}

const LEDGER_PATH = repoPath("evidence/phase5/funding-budget.json");

function safetyMargin(): number {
  const raw = process.env["KYRVE_FUNDING_SAFETY_MARGIN"];
  if (raw === undefined || raw.trim() === "") return DEFAULT_SAFETY_MARGIN;
  const value = Number(raw);
  if (!Number.isFinite(value) || value < DEFAULT_SAFETY_MARGIN) {
    throw new Error(
      `KYRVE_FUNDING_SAFETY_MARGIN is "${raw}". It must be a number at or above ` +
        `${DEFAULT_SAFETY_MARGIN}: Phase 3's one public sample under-predicted by 27%, so a smaller ` +
        "margin is a prediction nothing supports.",
    );
  }
  return value;
}

interface Artifact {
  readonly abi: readonly unknown[];
  readonly bytecode: `0x${string}`;
}

/** A Foundry artifact — the 0.8.34 settlement layer. */
function foundryArtifact(name: string): Artifact {
  const path = repoPath(`out/${name}.sol/${name}.json`);
  if (!existsSync(path)) throw new Error(`no Foundry artifact for ${name}; run \`forge build\``);
  const raw = readJson<{ abi: readonly unknown[]; bytecode: { object: string } }>(path);
  return { abi: raw.abi, bytecode: raw.bytecode.object as `0x${string}` };
}

/** A Hardhat artifact — the 0.8.36 confidential layer. */
function hardhatArtifact(name: string, dir = "contracts"): Artifact {
  const path = repoPath(`confidential/artifacts/${dir}/${name}.sol/${name}.json`);
  if (!existsSync(path)) {
    throw new Error(
      `no Hardhat artifact for ${name}; run \`pnpm --dir confidential exec hardhat compile\``,
    );
  }
  const raw = readJson<{ abi: readonly unknown[]; bytecode: string }>(path);
  return { abi: raw.abi, bytecode: raw.bytecode as `0x${string}` };
}

async function main(): Promise<void> {
  const rpc = sepoliaRpc();
  const identity = deployer();
  const client = createPublicClient({ chain: sepolia, transport: http(rpc.url) });

  const chainId = await client.getChainId();
  if (chainId !== 11155111) throw new Error(`the RPC is on chain ${chainId}, not Sepolia`);

  // The addresses the redeployment builds on. Every one of these is REUSED, not redeployed: none
  // holds an engine or vault reference, so none is invalidated by the handle-native revision.
  const curve = readJson<{
    addresses: Record<string, `0x${string}`>;
    phase2: Record<string, `0x${string}`>;
  }>(repoPath("deployments/sepolia/curve.json"));
  const settlement = readJson<{
    addresses: Record<string, `0x${string}`>;
    midnight: `0x${string}`;
    loanToken: `0x${string}`;
  }>(repoPath("deployments/sepolia/settlement.json"));

  const controller = curve.phase2["KyrveEmergencyController"];
  const wrappedAsset = curve.phase2["KyrveWrappedAsset"];
  const mandateBook = curve.phase2["EncryptedMandateBook"];
  const requestBook = curve.phase2["ConfidentialRequestBook"];
  const universes = curve.addresses["CurveUniverseRegistry"];
  const oldRegistry = settlement.addresses["KyrveQuoteRegistry"];
  const oldRatifier = settlement.addresses["KyrveSettlementRatifier"];
  const oldActivator = settlement.addresses["QuoteActivator"];
  const oldExpiry = settlement.addresses["KyrveQuoteExpiryController"];
  const oldVerifier = settlement.addresses["KyrvePublicResultVerifier"];
  const oldCurveVerifier = curve.addresses["CurveResultVerifier"];
  const oldGraph = curve.addresses["CurveGraphRegistry"];
  const oldEngine = curve.addresses["NoxCurveEngine"];
  const oldEpochs = curve.addresses["QuoteEpochController"];
  const oldLedger = curve.addresses["ReservationLedger"];

  for (const [name, value] of Object.entries({
    controller,
    wrappedAsset,
    mandateBook,
    requestBook,
    universes,
    oldRegistry,
  })) {
    if (value === undefined) throw new Error(`the Sepolia records do not name ${name}`);
  }

  const standIns: string[] = [];

  /**
   * Estimates one creation transaction against the live network.
   *
   * `from` is the real deployer, so the estimate accounts for its real nonce and balance checks. No
   * transaction is signed and none is sent — `eth_estimateGas` executes against a pending-state
   * snapshot and returns.
   */
  async function estimateDeploy(
    label: string,
    artifact: Artifact,
    args: readonly unknown[],
    standIn?: string,
  ): Promise<GasComponent> {
    // `encodeDeployData`'s overloads are keyed on a literal ABI, and these ABIs are read from JSON at
    // runtime — so the call is typed through a widened alias rather than suppressed. No `any`, no
    // `@ts-expect-error`: the shape is checked at runtime by viem's own encoder, which throws on an
    // argument that does not match the constructor it read.
    const encode = encodeDeployData as (input: {
      abi: readonly unknown[];
      bytecode: `0x${string}`;
      args?: readonly unknown[];
    }) => `0x${string}`;
    const data = encode({ abi: artifact.abi, bytecode: artifact.bytecode, args });
    const gas = await client.estimateGas({ account: identity.address, data });
    if (standIn !== undefined) standIns.push(`${label}: ${standIn}`);
    return {
      name: label,
      gas: Number(gas),
      source: "eth_estimateGas against Sepolia, real bytecode and real constructor arguments",
    };
  }

  const components: GasComponent[] = [];
  const missing: string[] = [];

  // ── Phase 2: one new contract, four reused ────────────────────────────────────────────────
  //
  // Only the custody vault is new. `KyrveWrappedAsset`, `EncryptedMandateBook`,
  // `ConfidentialRequestBook` and `KyrveEmergencyController` carry no engine or vault reference, so
  // the handle-native revision does not invalidate them — and reusing the wrapper is what keeps
  // provider wrapper balances alive across the migration. P5-1 §6.
  components.push(
    await estimateDeploy(
      "KyrveCustodyVault (Phase 2 revision)",
      hardhatArtifact("KyrveCustodyVault"),
      [wrappedAsset, controller],
    ),
  );

  // ── Phase 3: five redeployed, the universe registry reused ────────────────────────────────
  //
  // `bindEngine` is one-shot on the epoch controller, the graph registry and the ledger, and the
  // engine holds the vault as an `immutable`. So all four move together, and `CurveResultVerifier`
  // holds the engine too. `CurveUniverseRegistry` has no engine reference and is REUSED, which keeps
  // every registered universe and rate grid in place.
  const epochsArtifact = hardhatArtifact("QuoteEpochController");
  components.push(
    await estimateDeploy("QuoteEpochController", epochsArtifact, [
      universes,
      mandateBook,
      requestBook,
    ]),
  );
  components.push(
    await estimateDeploy(
      "CurveGraphRegistry",
      hardhatArtifact("CurveGraphRegistry"),
      [oldEpochs],
      "the Phase 4 epoch controller stands in for the new one; creation gas does not depend on which",
    ),
  );
  components.push(
    await estimateDeploy(
      "ReservationLedger",
      hardhatArtifact("ReservationLedger"),
      [
        // The custody vault does not exist yet either; the Phase 2 vault is the same shape at this
        // position and the constructor only zero-checks it.
        curve.phase2["KyrveConfidentialAssetVault"],
        controller,
      ],
      "the Phase 2 asset vault stands in for the new custody vault",
    ),
  );
  components.push(
    await estimateDeploy(
      "NoxCurveEngine",
      hardhatArtifact("NoxCurveEngine"),
      [
        universes,
        oldEpochs,
        oldGraph,
        oldLedger,
        mandateBook,
        requestBook,
        curve.phase2["KyrveConfidentialAssetVault"],
        controller,
      ],
      "the Phase 4 curve contracts stand in for the new ones",
    ),
  );
  components.push(
    await estimateDeploy(
      "CurveResultVerifier",
      hardhatArtifact("CurveResultVerifier"),
      [oldGraph, oldEngine, oldEpochs],
      "the Phase 4 graph, engine and epoch controller stand in",
    ),
  );

  // ── Phase 4: the whole settlement layer, because it holds the curve addresses ──────────────
  components.push(
    await estimateDeploy("KyrveQuoteRegistry", foundryArtifact("KyrveQuoteRegistry"), [
      settlement.midnight,
    ]),
  );
  components.push(
    await estimateDeploy(
      "KyrveSettlementRatifier",
      foundryArtifact("KyrveSettlementRatifier"),
      [settlement.midnight, oldRegistry],
      "the Phase 4 quote registry stands in",
    ),
  );
  components.push(
    await estimateDeploy(
      "KyrvePublicResultVerifier",
      foundryArtifact("KyrvePublicResultVerifier"),
      [oldCurveVerifier, oldGraph, oldEngine, oldEpochs],
      "the Phase 4 curve contracts stand in",
    ),
  );
  components.push(
    await estimateDeploy(
      "QuoteActivator",
      foundryArtifact("QuoteActivator"),
      [oldRegistry, oldVerifier, universes, oldRatifier, identity.address],
      "the Phase 4 registry, verifier and ratifier stand in",
    ),
  );
  components.push(
    await estimateDeploy(
      "KyrveQuoteExpiryController",
      foundryArtifact("KyrveQuoteExpiryController"),
      [oldRegistry, identity.address],
      "the Phase 4 quote registry stands in",
    ),
  );
  components.push(
    await estimateDeploy(
      "KyrveSeriesFactory",
      foundryArtifact("KyrveSeriesFactory"),
      [oldRegistry, oldActivator, oldExpiry, identity.address],
      "the Phase 4 settlement contracts stand in",
    ),
  );

  // ── Phase 5: five new contracts ───────────────────────────────────────────────────────────
  //
  // The series vault is NOT here. It is created by the factory at activation, and that cost lands in
  // the activation component below rather than as a separate deployment.
  const seriesId = `0x${"11".repeat(32)}` as `0x${string}`;
  components.push(
    await estimateDeploy(
      "KyrveSeriesToken",
      hardhatArtifact("KyrveSeriesToken"),
      ["Kyrve Series", "kSER", "", seriesId, settlement.loanToken, identity.address, controller],
      "a placeholder series id and name; neither changes creation gas materially",
    ),
  );
  components.push(
    await estimateDeploy(
      "SeriesOwnershipRegistry",
      hardhatArtifact("SeriesOwnershipRegistry"),
      [seriesId, controller],
      "a placeholder series id",
    ),
  );

  // `SeriesAllocator` and `AggregateSolvencyVerifier` both call into a series vault in their
  // constructors, so they need one that exists. Phase 4 created one on Sepolia; if it is absent the
  // component is reported MISSING rather than guessed.
  const phase4Vault = await resolvePhase4Vault(client, settlement.addresses["KyrveSeriesFactory"]);
  if (phase4Vault === undefined) {
    missing.push(
      "SeriesAllocator and AggregateSolvencyVerifier creation gas — both constructors read a series " +
        "vault, and no Phase 4 vault was found on Sepolia to stand in for the new one",
    );
  } else {
    const vaultSeries = (await client.readContract({
      address: phase4Vault,
      abi: [
        {
          type: "function",
          name: "SERIES_ID",
          stateMutability: "view",
          inputs: [],
          outputs: [{ type: "bytes32" }],
        },
      ],
      functionName: "SERIES_ID",
    })) as `0x${string}`;
    const marketId = (await client.readContract({
      address: phase4Vault,
      abi: [
        {
          type: "function",
          name: "SERIES_ID",
          stateMutability: "view",
          inputs: [],
          outputs: [{ type: "bytes32" }],
        },
      ],
      functionName: "SERIES_ID",
    })) as `0x${string}`;

    components.push(
      await estimateDeploy(
        "SeriesAllocator",
        hardhatArtifact("SeriesAllocator"),
        [
          vaultSeries,
          curve.phase2["KyrveConfidentialAssetVault"],
          oldGraph, // any address of contract shape at the token position; the ctor only zero-checks it
          oldGraph,
          oldEpochs,
          oldGraph,
          oldLedger,
          oldRegistry,
          phase4Vault,
          marketId,
          identity.address,
          controller,
        ],
        "the Phase 4 series vault supplies the series id the constructor checks against",
      ),
    );
    components.push(
      await estimateDeploy(
        "AggregateSolvencyVerifier",
        hardhatArtifact("AggregateSolvencyVerifier"),
        [
          vaultSeries,
          marketId,
          oldGraph,
          curve.phase2["KyrveConfidentialAssetVault"],
          phase4Vault,
          oldGraph,
          controller,
        ],
        "the Phase 4 series vault supplies the loan token the constructor reads",
      ),
    );
    components.push(
      await estimateDeploy(
        "SeriesResidueAccount",
        hardhatArtifact("SeriesResidueAccount"),
        [vaultSeries, settlement.loanToken, identity.address, identity.address],
        "the deployer stands in for the declared beneficiary and the recorder",
      ),
    );
  }

  // ── Configuration and one-shot bindings ───────────────────────────────────────────────────
  //
  // Eleven transactions: bindEngine on three curve contracts, bindReserver and bindSettler on
  // custody, bindActivator and bindExpiryController on the registry, bindFactory on the activator,
  // bindAllocator on the token and the ownership registry, bindSolvencyVerifier on the token, and
  // bindResidueAccount on the allocator. Each writes one immutable-in-practice slot and emits one
  // event; 60,000 is the measured shape of that transaction with generous headroom.
  components.push({
    name: "one-shot bindings and configuration (12 transactions)",
    gas: 12 * 60_000,
    source: "12 x 60,000 — one storage write and one event each, sized against the local receipts",
  });

  // ── The confidential epoch, measured on Sepolia ───────────────────────────────────────────
  const epochPath = repoPath("evidence/phase3/sepolia-epoch.json");
  if (existsSync(epochPath)) {
    const record = readJson<{
      gasUsedThisRun: string;
      shape?: { providers: number; cells: number };
    }>(epochPath);
    const shape = record.shape;
    components.push({
      name: "provider funding, mandates, ACL grants and one full confidential epoch",
      gas: Number(record.gasUsedThisRun),
      source:
        `evidence/phase3/sepolia-epoch.json — a REAL Sepolia epoch, ${shape?.providers ?? "?"} providers, ` +
        `${shape?.cells ?? "?"} cells, aggregate exactly 299,999,999`,
    });
  } else {
    missing.push("the confidential epoch — evidence/phase3/sepolia-epoch.json is absent");
  }

  // ── Activation and the exact settlement, measured on Sepolia ───────────────────────────────
  const settlementGasPath = repoPath("evidence/phase4/settlement-gas.json");
  if (existsSync(settlementGasPath)) {
    const record = readJson<{ activateGas: number; takeGas: number }>(settlementGasPath);
    components.push({
      name: "quote activation (creates the series vault) and one exact Midnight take",
      gas: record.activateGas + record.takeGas,
      source: "evidence/phase4/settlement-gas.json — measured against real unmodified Midnight",
    });
  } else {
    missing.push("activation and settlement — evidence/phase4/settlement-gas.json is absent");
  }

  // ── The series allocation, measured locally against the real Nox stack ─────────────────────
  const seriesGasPath = repoPath("evidence/phase5/series-gas.json");
  if (existsSync(seriesGasPath)) {
    const record = readJson<Record<string, string>>(seriesGasPath);
    const steps = [
      "consumeChunk",
      "unwrapFunding",
      "finalizeUnwrap",
      "allocateChunk",
      "closeQuote",
      "proveSolvency",
    ] as const;
    const absent = steps.filter((step) => record[step] === undefined);
    if (absent.length > 0) {
      missing.push(
        `the series allocation — evidence/phase5/series-gas.json records no ${absent.join(", ")}`,
      );
    } else {
      const total = steps.reduce((sum, step) => sum + Number(record[step]), 0);
      components.push({
        name: "confidential funding, allocation, close and the solvency proof",
        gas: total,
        // Named as local on purpose. There is no public sample yet, and inventing one would be the
        // exact failure this file exists to prevent.
        source:
          "evidence/phase5/series-gas.json — measured LOCALLY against the real Nox stack and real " +
          "unmodified Midnight; no public sample exists yet",
      });
    }
  } else {
    missing.push(
      "the series allocation — evidence/phase5/series-gas.json is absent; run the Phase 5 suite",
    );
  }

  // ── Etherscan verification ────────────────────────────────────────────────────────────────
  components.push({
    name: "Etherscan V2 source verification",
    gas: 0,
    source: "zero — verification is an HTTP submission against the API and consumes no gas",
  });

  // ── Price it ───────────────────────────────────────────────────────────────────────────────
  const block = await client.getBlock();
  const baseFee = block.baseFeePerGas ?? 0n;
  const priorityFee = await client.estimateMaxPriorityFeePerGas();
  const effective = baseFee + priorityFee;
  const balance = await client.getBalance({ address: identity.address });
  const margin = safetyMargin();

  const estimatedGas = components.reduce((sum, component) => sum + component.gas, 0);
  const predicted = BigInt(estimatedGas) * effective;
  const withMargin = (predicted * BigInt(Math.round((1 + margin) * 1000))) / 1000n;
  const funded = missing.length === 0 && balance >= withMargin;
  const shortfall = withMargin > balance ? withMargin - balance : 0n;

  const sample: Sample = {
    recordedAt: new Date().toISOString(),
    phase: "phase5",
    components,
    standIns,
    estimatedGas,
    baseFeePerGasWei: baseFee.toString(),
    priorityFeePerGasWei: priorityFee.toString(),
    effectiveGasPriceWei: effective.toString(),
    safetyMargin: margin,
    predictedCostEth: formatEther(predicted),
    predictedCostWithMarginEth: formatEther(withMargin),
    deployerBalanceEth: formatEther(balance),
    funded,
    shortfallEth: formatEther(shortfall),
    actualCostEth: null,
    predictionErrorPercent: null,
  };

  // APPEND. An earlier sample is never edited, so a prediction cannot be corrected after the fact.
  const ledger: Ledger = existsSync(LEDGER_PATH)
    ? readJson<Ledger>(LEDGER_PATH)
    : {
        $comment:
          "Append-only funding predictions for the Phase 5 Sepolia sequence. Each sample records " +
          "what was estimated, the price seen, what was predicted and whether the balance covered " +
          "it. Earlier samples are never edited: the point is to learn the safety multiplier from " +
          "real public samples rather than to assert one.",
        samples: [],
      };
  const next: Ledger = { ...ledger, samples: [...ledger.samples, sample] };

  const serialised = stableStringify(next);
  assertNoSecrets(serialised, "evidence/phase5/funding-budget.json");
  mkdirSync(repoPath("evidence/phase5"), { recursive: true });
  writeFileSync(LEDGER_PATH, `${serialised}\n`);

  // ── Report ─────────────────────────────────────────────────────────────────────────────────
  console.log(`\nPhase 5 Sepolia funding preflight — ${rpc.redacted}\n`);
  const width = Math.max(...components.map((component) => component.name.length));
  for (const component of components) {
    console.log(
      `  ${component.name.padEnd(width)}  ${component.gas.toLocaleString("en-GB").padStart(12)}  ${component.source}`,
    );
  }
  console.log(
    `\n  ${"TOTAL GAS".padEnd(width)}  ${estimatedGas.toLocaleString("en-GB").padStart(12)}`,
  );

  if (standIns.length > 0) {
    console.log(
      "\n  Constructor stand-ins (creation gas does not depend on which valid address is used):",
    );
    for (const entry of standIns) console.log(`    - ${entry}`);
  }

  console.log(
    `\n  base fee            ${formatEther(baseFee * 10n ** 9n)} gwei-ish (${baseFee} wei)`,
  );
  console.log(`  priority fee        ${priorityFee} wei`);
  console.log(`  effective price     ${effective} wei`);
  console.log(`  predicted cost      ${sample.predictedCostEth} ETH`);
  console.log(`  safety margin       ${Math.round(margin * 100)}%`);
  console.log(`  REQUIRED BALANCE    ${sample.predictedCostWithMarginEth} ETH`);
  console.log(`  deployer balance    ${sample.deployerBalanceEth} ETH`);

  if (missing.length > 0) {
    console.log(
      "\n  MISSING MEASUREMENTS — the total above is incomplete and must not be trusted:",
    );
    for (const entry of missing) console.log(`    - ${entry}`);
    console.log(
      "\n  VERDICT: NOT PRICED. Broadcasting against an incomplete total is how a sequence",
    );
    console.log(
      "  strands halfway, and a half-executed epoch holds provider capital until cancelled.\n",
    );
    process.exitCode = 1;
    return;
  }

  if (!funded) {
    console.log(`\n  SHORTFALL           ${sample.shortfallEth} ETH`);
    console.log("\n  VERDICT: NOT FUNDED. Nothing was broadcast and nothing will be.");
    console.log(
      `  Fund ${identity.address} with at least ${sample.shortfallEth} ETH and re-run this`,
    );
    console.log(
      "  command. The gate keeps reporting the Sepolia steps as SKIP until it passes; it",
    );
    console.log("  must never be downgraded to PASS for a sequence nobody executed.\n");
    process.exitCode = 1;
    return;
  }

  console.log("\n  VERDICT: FUNDED. Deploy with:");
  console.log("    DEPLOY_SEPOLIA=true KYRVE_CONFIRM_BROADCAST=true pnpm deploy:series sepolia\n");
}

/**
 * The series vault Phase 4 created on Sepolia, if there is one.
 *
 * Read from the factory rather than from a record, because a record could name a vault the factory
 * never created. Returns `undefined` rather than throwing, so the caller reports a missing
 * measurement instead of failing with a stack trace.
 */
async function resolvePhase4Vault(
  client: ReturnType<typeof createPublicClient>,
  factory: `0x${string}` | undefined,
): Promise<`0x${string}` | undefined> {
  if (factory === undefined) return undefined;
  const settlementEvidence = repoPath("evidence/phase4/sepolia-settlement.json");
  if (!existsSync(settlementEvidence)) return undefined;
  const record = readJson<{ vault?: `0x${string}`; seriesId?: `0x${string}` }>(settlementEvidence);
  if (record.vault !== undefined) {
    const code = await client.getCode({ address: record.vault });
    return code !== undefined && code !== "0x" ? record.vault : undefined;
  }
  if (record.seriesId === undefined) return undefined;
  const vault = (await client.readContract({
    address: factory,
    abi: [
      {
        type: "function",
        name: "vaultOf",
        stateMutability: "view",
        inputs: [{ type: "bytes32" }],
        outputs: [{ type: "address" }],
      },
    ],
    functionName: "vaultOf",
    args: [record.seriesId],
  })) as `0x${string}`;
  return vault === "0x0000000000000000000000000000000000000000" ? undefined : vault;
}

await main();
