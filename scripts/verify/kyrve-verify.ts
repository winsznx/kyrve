/**
 * Kyrve Verify — recomputes what Kyrve claims, from chain state.
 *
 * ════════════════════════════════════════════════════════════════════════════════════════════
 * WHAT IT REFUSES TO TRUST
 * ════════════════════════════════════════════════════════════════════════════════════════════
 *
 * The manifests. `deployments/<env>/*.json` and `evidence/<phase>/*.json` are files: they can be
 * regenerated, hand-edited, or left describing a deployment that was replaced. Every number this
 * tool reports is read from the chain or derived from a locally compiled artifact. The records are
 * used for exactly one thing — knowing WHICH addresses, epochs and quotes to ask about — and every
 * claim they make is then compared against what the chain said.
 *
 * A disagreement is a FAILURE, never a note. A record asserting a settled quote against a registry
 * that has never heard of it is worse than no record at all.
 *
 * ════════════════════════════════════════════════════════════════════════════════════════════
 * WHAT A NOX GATEWAY PROOF IS, AND WHAT IT IS NOT
 * ════════════════════════════════════════════════════════════════════════════════════════════
 *
 * **A Nox decryption proof is NOT a zero-knowledge proof and this tool never calls it one.** It is
 * an EIP-712 signature by the Nox KMS attesting that a handle decrypts to a value. Verified against
 * the source (`modules/Compute.sol::validateDecryptionProof`, nox-protocol-contracts 0.2.4) it is a
 * pure signature check: no ACL, no nonce, no expiry and no caller binding, so a proof once issued is
 * replayable by anyone forever and says nothing about which computation the value belongs to.
 *
 * What makes it mean something is the BINDING — the handle registered in `CurveGraphRegistry` for a
 * role of a sealed epoch, or recorded in a capsule, or in a Cross order. Verify checks the binding
 * first and the signature second, in that order, so an unbound handle is refused before its proof is
 * looked at.
 *
 * ════════════════════════════════════════════════════════════════════════════════════════════
 * EXIT CODES — MACHINE READABLE
 * ════════════════════════════════════════════════════════════════════════════════════════════
 *
 *   0  PASS         every applicable check agreed with chain state
 *   1  FAIL         at least one check disagreed. The JSON names which and why
 *   2  UNAVAILABLE  nothing failed, but a check could not run — no record, no node, no deployment
 *   3  USAGE        the arguments do not name a runnable verification
 *
 * A run with unavailable checks and no failures is `2`, never `0`. "I could not check" and "I
 * checked and it holds" are different answers and a verifier that conflated them would be useless
 * in exactly the situation a verifier exists for.
 */

import { existsSync, mkdirSync, writeFileSync } from "node:fs";

import { type Address, createPublicClient, type Hex, http, keccak256 } from "viem";
import { hardhat, sepolia } from "viem/chains";

import { assertNoSecrets, safeErrorMessage, sepoliaRpc } from "../lib/env.js";
import { layerPaths } from "../lib/layer.js";
import { readJson, repoPath, stableStringify } from "../lib/shell.js";

export const EXIT = { PASS: 0, FAIL: 1, UNAVAILABLE: 2, USAGE: 3 } as const;

type Status = "pass" | "fail" | "unavailable";
type Environment = "local" | "sepolia";

export interface Finding {
  readonly id: string;
  readonly title: string;
  readonly status: Status;
  /** One sentence a human can act on. Never a stack trace. */
  readonly detail: string;
  /** Every value this check read from chain, so the conclusion can be re-derived by hand. */
  readonly evidence: Readonly<Record<string, string>>;
}

export interface VerificationReport {
  readonly tool: "kyrve-verify";
  readonly version: 1;
  readonly environment: Environment;
  readonly chainId: number;
  readonly blockNumber: string;
  readonly verifiedAt: string;
  readonly proofSemantics: string;
  readonly findings: readonly Finding[];
  readonly summary: {
    readonly passed: number;
    readonly failed: number;
    readonly unavailable: number;
    readonly verdict: "PASS" | "FAIL" | "UNAVAILABLE";
    readonly exitCode: number;
  };
}

const PROOF_SEMANTICS =
  "A Nox decryption proof is an EIP-712 signature by the Nox KMS attesting that a handle decrypts " +
  "to a value. It is NOT a zero-knowledge proof. validateDecryptionProof is a pure signature check " +
  "with no ACL, no nonce, no expiry and no caller binding, so a proof is replayable by anyone " +
  "forever; what binds a value to a computation is the handle registered in CurveGraphRegistry, a " +
  "capsule, or a Cross or Roll order — checked here BEFORE any signature is considered.";

const LOCAL_RPC = "http://127.0.0.1:8545";
const ZERO = "0x0000000000000000000000000000000000000000";

// ── Minimal ABIs. Declared inline rather than imported so a generated-ABI regression cannot make
//    this tool agree with a build that no longer matches the chain. ──────────────────────────────
const fn = (
  name: string,
  inputs: readonly { type: string }[],
  outputs: readonly { type: string }[],
) => ({ type: "function", name, stateMutability: "view", inputs, outputs }) as const;

const B32 = [{ type: "bytes32" }] as const;
const ADDR = [{ type: "address" }] as const;
const U256 = [{ type: "uint256" }] as const;

interface SeriesRecord {
  readonly chainId: number;
  readonly deployer: Address;
  readonly keeper: Address;
  readonly operator: Address;
  readonly curator: Address;
  readonly residueBeneficiary: Address;
  readonly deploymentId: Hex;
  readonly seriesId: Hex;
  readonly seriesVault: Address;
  readonly marketId: Hex;
  readonly midnight: Address;
  readonly loanToken: Address;
  readonly contracts: Record<string, { readonly address: Address; readonly runtimeHash: Hex }>;
  readonly roleRegistry?: Address | undefined;
  readonly capsuleVault?: Address | undefined;
  readonly crossBook?: Address | undefined;
  readonly rollBook?: Address | undefined;
}

function pass(
  id: string,
  title: string,
  detail: string,
  evidence: Record<string, string>,
): Finding {
  return { id, title, status: "pass", detail, evidence };
}
function fail(
  id: string,
  title: string,
  detail: string,
  evidence: Record<string, string>,
): Finding {
  return { id, title, status: "fail", detail, evidence };
}
function unavailable(id: string, title: string, detail: string): Finding {
  return { id, title, status: "unavailable", detail, evidence: {} };
}

/** Every check this tool knows how to run, in the order a reader should read them. */
export const CHECKS = [
  "deployment-identity",
  "source-and-bytecode",
  "roles",
  "public-result-proof",
  "quote-activation",
  "exact-settlement",
  "confidential-supply",
  "vault-coverage",
  "residue-policy",
  "capsule",
  "cross",
  "roll",
] as const;

export type CheckId = (typeof CHECKS)[number];

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const environment: Environment =
    args[0] === "local" ? "local" : args[0] === "sepolia" ? "sepolia" : "sepolia";
  const requested = args.slice(1).filter((a) => !a.startsWith("--"));
  const selected: readonly CheckId[] =
    requested.length === 0
      ? CHECKS
      : (requested.filter((r) => (CHECKS as readonly string[]).includes(r)) as CheckId[]);

  if (requested.length > 0 && selected.length !== requested.length) {
    console.error(`\nunknown check. Known checks:\n  ${CHECKS.join("\n  ")}\n`);
    process.exit(EXIT.USAGE);
  }

  // The deployment record follows KYRVE_EVIDENCE_TAG, exactly as the evidence does. Reading layer
  // A's contracts while checking layer B's epoch would let a passing layer A silently satisfy a
  // layer B check — the one failure `scripts/lib/layer.ts` exists to prevent.
  const layerFiles = layerPaths();
  const recordPath = repoPath(
    environment === "sepolia" ? layerFiles.deployment : `deployments/${environment}/series.json`,
  );
  if (!existsSync(recordPath)) {
    console.error(`\nno deployment record at ${recordPath}\n`);
    process.exit(EXIT.UNAVAILABLE);
  }
  const record = readJson<SeriesRecord>(recordPath);

  /**
   * The Phase 6 market layer is its own record, because `KyrveRollBook` cannot exist until a second
   * layer does and a series that deployed with no market layer is a coherent state. Merged here so
   * the checks read one shape, and absent rather than fabricated when the file is not there.
   */
  const marketPath = repoPath(`deployments/${environment}/market.json`);
  const market = existsSync(marketPath)
    ? readJson<{
        seriesId?: Hex;
        targetSeriesId?: Hex;
        contracts: Record<string, { readonly address: Address }>;
      }>(marketPath)
    : null;

  /**
   * The Capsule vault and the Cross book are deployed over ONE series. There is a single
   * `market.json`, so merging them into whichever layer is being checked would hand layer B layer
   * A's capsule vault, and the binding check would then correctly report that the vault serves a
   * different series — a FAIL that means "you attached the wrong contract", not "the binding is
   * broken". The Roll book spans both by construction and is attached either way.
   */
  const ownsMarketLayer =
    market?.seriesId !== undefined &&
    market.seriesId.toLowerCase() === record.seriesId.toLowerCase();
  const marketAt = (name: string): Address | undefined =>
    name === "KyrveRollBook" || ownsMarketLayer ? market?.contracts[name]?.address : undefined;
  const layer: SeriesRecord = {
    ...record,
    ...(marketAt("KyrveCapsuleVault") === undefined
      ? {}
      : { capsuleVault: marketAt("KyrveCapsuleVault") }),
    ...(marketAt("KyrveCrossBook") === undefined ? {} : { crossBook: marketAt("KyrveCrossBook") }),
    ...(marketAt("KyrveRollBook") === undefined ? {} : { rollBook: marketAt("KyrveRollBook") }),
  };

  const rpc = environment === "sepolia" ? sepoliaRpc() : { url: LOCAL_RPC, redacted: LOCAL_RPC };
  const client = createPublicClient({
    chain: environment === "sepolia" ? sepolia : hardhat,
    transport: http(rpc.url),
  });

  let chainId: number;
  let blockNumber: bigint;
  try {
    chainId = await client.getChainId();
    blockNumber = await client.getBlockNumber();
  } catch (error) {
    console.error(`\nthe node at ${rpc.redacted} is unreachable — ${String(error)}\n`);
    process.exit(EXIT.UNAVAILABLE);
  }

  console.log(`\nkyrve-verify — ${environment} — chain ${chainId} — block ${blockNumber}\n`);

  const findings: Finding[] = [];
  const wanted = new Set<string>(selected);

  // ── 1. deployment identity ────────────────────────────────────────────────────────────────
  if (wanted.has("deployment-identity")) {
    findings.push(await checkDeploymentIdentity(client, record, chainId));
  }

  // ── 2. source and bytecode ────────────────────────────────────────────────────────────────
  if (wanted.has("source-and-bytecode")) {
    findings.push(await checkBytecode(client, record));
  }

  // ── 3. roles ──────────────────────────────────────────────────────────────────────────────
  if (wanted.has("roles")) {
    findings.push(await checkRoles(client, record));
  }

  // ── 4. the public result, and its binding ─────────────────────────────────────────────────
  if (wanted.has("public-result-proof")) {
    findings.push(await checkPublicResult(client, record, environment));
  }

  // ── 5. quote activation ───────────────────────────────────────────────────────────────────
  if (wanted.has("quote-activation")) {
    findings.push(await checkActivation(client, record, environment));
  }

  // ── 6. exact settlement ───────────────────────────────────────────────────────────────────
  if (wanted.has("exact-settlement")) {
    findings.push(await checkSettlement(client, record, environment));
  }

  // ── 7. confidential supply equals the published aggregate ─────────────────────────────────
  if (wanted.has("confidential-supply")) {
    findings.push(await checkSupply(client, record, environment));
  }

  // ── 8. the vault's public credit covers the claims ────────────────────────────────────────
  if (wanted.has("vault-coverage")) {
    findings.push(await checkCoverage(client, record));
  }

  // ── 9. residue policy ─────────────────────────────────────────────────────────────────────
  if (wanted.has("residue-policy")) {
    findings.push(await checkResidue(client, record));
  }

  // ── 10-12. the Phase 6 surfaces ───────────────────────────────────────────────────────────
  if (wanted.has("capsule")) findings.push(await checkCapsule(client, layer));
  if (wanted.has("cross")) findings.push(await checkCross(client, layer));
  if (wanted.has("roll")) findings.push(await checkRoll(client, layer));

  // ── Report ────────────────────────────────────────────────────────────────────────────────
  const passed = findings.filter((f) => f.status === "pass").length;
  const failed = findings.filter((f) => f.status === "fail").length;
  const skipped = findings.filter((f) => f.status === "unavailable").length;
  const verdict = failed > 0 ? "FAIL" : skipped > 0 ? "UNAVAILABLE" : "PASS";
  const exitCode = failed > 0 ? EXIT.FAIL : skipped > 0 ? EXIT.UNAVAILABLE : EXIT.PASS;

  for (const finding of findings) {
    const mark = finding.status === "pass" ? "PASS" : finding.status === "fail" ? "FAIL" : "N/A ";
    console.log(`  ${mark}  ${finding.id.padEnd(22)} ${finding.title}`);
    console.log(`        ${finding.detail}`);
    for (const [key, value] of Object.entries(finding.evidence)) {
      console.log(`          ${key.padEnd(28)} ${value}`);
    }
  }

  const report: VerificationReport = {
    tool: "kyrve-verify",
    version: 1,
    environment,
    chainId,
    blockNumber: blockNumber.toString(),
    verifiedAt: new Date().toISOString(),
    proofSemantics: PROOF_SEMANTICS,
    findings,
    summary: { passed, failed, unavailable: skipped, verdict, exitCode },
  };

  const payload = `${stableStringify(report)}\n`;
  assertNoSecrets(payload, `evidence/phase6/verification-${environment}.json`);
  mkdirSync(repoPath("evidence/phase6"), { recursive: true });
  writeFileSync(repoPath(`evidence/phase6/verification-${environment}.json`), payload);

  console.log(
    `\n  ${passed} passed, ${failed} failed, ${skipped} unavailable` +
      `\n  VERDICT: ${verdict} (exit ${exitCode})` +
      `\n  written to evidence/phase6/verification-${environment}.json\n`,
  );
  process.exit(exitCode);
}

// ═══════════════════════════════════════════════════════════════════════════════════════════
// The checks
// ═══════════════════════════════════════════════════════════════════════════════════════════

async function checkDeploymentIdentity(
  client: ReturnType<typeof createPublicClient>,
  record: SeriesRecord,
  chainId: number,
): Promise<Finding> {
  const id = "deployment-identity";
  const title = "the layer on chain is the layer the record describes";
  const registry = record.contracts["KyrveQuoteRegistry"];
  if (registry === undefined)
    return unavailable(id, title, "the record names no KyrveQuoteRegistry");

  const evidence: Record<string, string> = {};
  try {
    const onChainDeploymentId = (await client.readContract({
      address: registry.address,
      abi: [fn("DEPLOYMENT_ID", [], B32)],
      functionName: "DEPLOYMENT_ID",
    })) as Hex;
    const onChainMidnight = (await client.readContract({
      address: registry.address,
      abi: [fn("MIDNIGHT", [], ADDR)],
      functionName: "MIDNIGHT",
    })) as Address;

    evidence["deploymentId (chain)"] = onChainDeploymentId;
    evidence["deploymentId (record)"] = record.deploymentId;
    evidence["midnight (chain)"] = onChainMidnight;
    evidence["chainId"] = String(chainId);

    if (onChainDeploymentId.toLowerCase() !== record.deploymentId.toLowerCase()) {
      return fail(
        id,
        title,
        "the registry's DEPLOYMENT_ID is not the one the record claims",
        evidence,
      );
    }
    if (onChainMidnight.toLowerCase() !== record.midnight.toLowerCase()) {
      return fail(
        id,
        title,
        "the registry points at a different Midnight than the record",
        evidence,
      );
    }
    if (record.chainId !== chainId) {
      return fail(
        id,
        title,
        `the record is for chain ${record.chainId}, the node is chain ${chainId}`,
        evidence,
      );
    }
    return pass(
      id,
      title,
      "deployment id, Midnight address and chain all agree with the chain",
      evidence,
    );
  } catch (error) {
    return fail(id, title, `reading the registry failed — ${short(error)}`, evidence);
  }
}

async function checkBytecode(
  client: ReturnType<typeof createPublicClient>,
  record: SeriesRecord,
): Promise<Finding> {
  const id = "source-and-bytecode";
  const title = "every deployed contract still holds the code the record recorded";
  const evidence: Record<string, string> = {};
  let compared = 0;

  for (const [name, entry] of Object.entries(record.contracts)) {
    const code = await client.getCode({ address: entry.address });
    if (code === undefined || code === "0x") {
      evidence[name] = `${entry.address} has NO CODE`;
      return fail(id, title, `${name} has no code at its recorded address`, evidence);
    }
    const actual = keccak256(code);
    if (actual.toLowerCase() !== entry.runtimeHash.toLowerCase()) {
      evidence[name] = `chain ${actual} != record ${entry.runtimeHash}`;
      return fail(
        id,
        title,
        `${name}'s runtime code does not hash to what the record claims`,
        evidence,
      );
    }
    compared += 1;
  }

  evidence["contracts compared"] = String(compared);
  return pass(
    id,
    title,
    `${compared} contracts hold runtime code hashing to exactly what the record states`,
    evidence,
  );
}

async function checkRoles(
  client: ReturnType<typeof createPublicClient>,
  record: SeriesRecord,
): Promise<Finding> {
  const id = "roles";
  const title = "the operational roles are separate addresses, on chain";
  const sources = [
    { role: "keeper", contract: "QuoteActivator", getter: "KEEPER" },
    { role: "operator", contract: "KyrveQuoteExpiryController", getter: "OPERATOR" },
    { role: "curator", contract: "KyrveSeriesFactory", getter: "CURATOR" },
    {
      role: "residueBeneficiary",
      contract: "SeriesResidueAccount",
      getter: "DECLARED_BENEFICIARY",
    },
    { role: "deployer", contract: "SeriesOwnershipRegistry", getter: "DEPLOYER" },
  ] as const;

  const evidence: Record<string, string> = {};
  const holders = new Map<string, Address>();
  for (const source of sources) {
    const entry = record.contracts[source.contract];
    if (entry === undefined)
      return unavailable(id, title, `the record names no ${source.contract}`);
    const holder = (await client.readContract({
      address: entry.address,
      abi: [fn(source.getter, [], ADDR)],
      functionName: source.getter as never,
    })) as Address;
    holders.set(source.role, holder);
    evidence[source.role] = holder;
  }

  const collapsed: string[] = [];
  const roles = [...holders.keys()];
  for (let i = 0; i < roles.length; i += 1) {
    for (let j = i + 1; j < roles.length; j += 1) {
      const a = holders.get(roles[i] as string) as Address;
      const b = holders.get(roles[j] as string) as Address;
      if (a.toLowerCase() === b.toLowerCase()) collapsed.push(`${roles[i]} == ${roles[j]}`);
    }
  }

  if (collapsed.length > 0) {
    evidence["collapsed pairs"] = collapsed.join(", ");
    return fail(
      id,
      title,
      `${collapsed.length} role pair(s) are the same address — one key holds both authorities`,
      evidence,
    );
  }

  if (record.roleRegistry !== undefined) {
    const declared = (await client.readContract({
      address: record.roleRegistry,
      abi: [fn("holders", [], [{ type: "address[7]" }])],
      functionName: "holders",
    })) as readonly Address[];
    evidence["KyrveRoleRegistry"] = record.roleRegistry;
    evidence["declared holders"] = declared.join(", ");
  }

  return pass(id, title, `${roles.length} enforced roles are pairwise distinct on chain`, evidence);
}

async function checkPublicResult(
  client: ReturnType<typeof createPublicClient>,
  record: SeriesRecord,
  environment: Environment,
): Promise<Finding> {
  const id = "public-result-proof";
  const title = "every published handle is the one the sealed graph registered for its role";
  const evidencePath = repoPath(layerPaths().epoch);
  if (environment !== "sepolia" || !existsSync(evidencePath)) {
    return unavailable(id, title, "no recorded epoch to verify against for this environment");
  }

  const epoch = readJson<{
    epochId: Hex;
    engine: Address;
    graphRoot: Hex;
    published: Record<string, string>;
  }>(evidencePath);
  const graph = record.contracts["CurveGraphRegistry"];
  const engine = record.contracts["NoxCurveEngine"];
  if (graph === undefined || engine === undefined) {
    return unavailable(id, title, "the record names no graph registry or engine");
  }

  const evidence: Record<string, string> = { epochId: epoch.epochId };
  try {
    const sealed = (await client.readContract({
      address: graph.address,
      abi: [fn("isSealed", B32, [{ type: "bool" }])],
      functionName: "isSealed",
      args: [epoch.epochId],
    })) as boolean;
    evidence["graph sealed"] = String(sealed);
    if (!sealed) return fail(id, title, "the epoch's operation graph is not sealed", evidence);

    const root = (await client.readContract({
      address: graph.address,
      abi: [fn("rootOf", B32, B32)],
      functionName: "rootOf",
      args: [epoch.epochId],
    })) as Hex;
    evidence["graphRoot (chain)"] = root;
    evidence["graphRoot (record)"] = epoch.graphRoot;
    if (root.toLowerCase() !== epoch.graphRoot.toLowerCase()) {
      return fail(id, title, "the sealed graph root is not the one the record claims", evidence);
    }

    // The published set, read from the ENGINE, then each entry checked against the GRAPH's
    // registration for that role. A handle the graph never registered is refused here, before any
    // gateway is asked — which is the whole point of the binding.
    const published = (await client.readContract({
      address: engine.address,
      abi: [
        {
          type: "function",
          name: "publishedOf",
          stateMutability: "view",
          inputs: B32,
          outputs: [
            {
              type: "tuple",
              components: [
                { name: "marketIndex", type: "bytes32" },
                { name: "rateIndex", type: "bytes32" },
                { name: "floorPassed", type: "bytes32" },
                { name: "quoteReady", type: "bytes32" },
                { name: "aggregateFill", type: "bytes32" },
              ],
            },
          ],
        },
      ],
      functionName: "publishedOf",
      args: [epoch.epochId],
    })) as Record<string, Hex>;

    const roleOrder = ["marketIndex", "rateIndex", "floorPassed", "quoteReady", "aggregateFill"];
    for (let role = 0; role < roleOrder.length; role += 1) {
      const key = roleOrder[role] as string;
      const handle = published[key] as Hex;
      if (handle === undefined || /^0x0+$/.test(handle)) {
        evidence[key] = "MISSING";
        return fail(
          id,
          title,
          `the published set has no handle for role ${role} (${key})`,
          evidence,
        );
      }
      const expected = (await client.readContract({
        address: graph.address,
        abi: [fn("expectedResultHandle", [{ type: "bytes32" }, { type: "uint8" }], B32)],
        functionName: "expectedResultHandle",
        args: [epoch.epochId, role],
      })) as Hex;
      evidence[key] = handle;
      if (expected.toLowerCase() !== handle.toLowerCase()) {
        return fail(
          id,
          title,
          `the published ${key} handle is not the one the graph registered`,
          evidence,
        );
      }
    }

    return pass(
      id,
      title,
      "the graph is sealed, its root matches, and all five published handles are bound to their roles",
      evidence,
    );
  } catch (error) {
    return fail(id, title, `reading the curve layer failed — ${short(error)}`, evidence);
  }
}

async function checkActivation(
  client: ReturnType<typeof createPublicClient>,
  record: SeriesRecord,
  environment: Environment,
): Promise<Finding> {
  const id = "quote-activation";
  const title = "the quote exists in the registry and is bound to this deployment";
  const path = repoPath(layerPaths().activation);
  if (environment !== "sepolia" || !existsSync(path)) {
    return unavailable(id, title, "no recorded activation to verify against for this environment");
  }
  const activation = readJson<{ quoteId: Hex; epochId: Hex }>(path);
  const registry = record.contracts["KyrveQuoteRegistry"];
  if (registry === undefined)
    return unavailable(id, title, "the record names no KyrveQuoteRegistry");

  const evidence: Record<string, string> = { quoteId: activation.quoteId };
  try {
    const execution = (await client.readContract({
      address: registry.address,
      abi: [
        {
          type: "function",
          name: "executionOf",
          stateMutability: "view",
          inputs: B32,
          // The FULL struct, in declaration order. An abbreviated tuple decodes garbage: viem
          // reads the words positionally, so a missing leading field shifts every later one and
          // the failure surfaces as an unrelated range error rather than as a mismatch.
          outputs: [
            {
              type: "tuple",
              components: [
                { name: "offerHash", type: "bytes32" },
                { name: "marketId", type: "bytes32" },
                { name: "exactUnits", type: "uint128" },
                { name: "expectedBuyerAssets", type: "uint128" },
                { name: "maxPendingFee", type: "uint128" },
                { name: "expiry", type: "uint40" },
                { name: "activatedAt", type: "uint40" },
                { name: "status", type: "uint8" },
                { name: "taker", type: "address" },
                { name: "vault", type: "address" },
                { name: "ratifier", type: "address" },
              ],
            },
          ],
        },
      ],
      functionName: "executionOf",
      args: [activation.quoteId],
    })) as Record<string, unknown>;

    const status = Number(execution["status"]);
    evidence["status"] = String(status);
    evidence["vault"] = String(execution["vault"]);
    evidence["exactUnits"] = String(execution["exactUnits"]);
    evidence["expectedBuyerAssets"] = String(execution["expectedBuyerAssets"]);

    if (status === 0)
      return fail(id, title, "the registry has never heard of this quote", evidence);
    if (String(execution["vault"]).toLowerCase() !== record.seriesVault.toLowerCase()) {
      return fail(id, title, "the quote's maker vault is not this series' vault", evidence);
    }
    // 2 = Consumed. A quote the record calls settled must be consumed rather than merely executable.
    if (status !== 2) {
      return fail(id, title, `the quote is in status ${status}, not Consumed`, evidence);
    }
    return pass(
      id,
      title,
      "the quote is Consumed, against this series' vault, at the recorded size",
      evidence,
    );
  } catch (error) {
    return fail(id, title, `reading the quote registry failed — ${short(error)}`, evidence);
  }
}

async function checkSettlement(
  client: ReturnType<typeof createPublicClient>,
  record: SeriesRecord,
  environment: Environment,
): Promise<Finding> {
  const id = "exact-settlement";
  const title = "Midnight consumed exactly the quoted units, and no more";
  const path = repoPath(layerPaths().activation);
  if (environment !== "sepolia" || !existsSync(path)) {
    return unavailable(id, title, "no recorded settlement to verify against for this environment");
  }
  const activation = readJson<{ quoteId: Hex }>(path);
  const registry = record.contracts["KyrveQuoteRegistry"];
  if (registry === undefined)
    return unavailable(id, title, "the record names no KyrveQuoteRegistry");

  const evidence: Record<string, string> = { quoteId: activation.quoteId };
  try {
    const execution = (await client.readContract({
      address: registry.address,
      abi: [
        {
          type: "function",
          name: "executionOf",
          stateMutability: "view",
          inputs: B32,
          // The FULL struct, in declaration order. An abbreviated tuple decodes garbage: viem
          // reads the words positionally, so a missing leading field shifts every later one and
          // the failure surfaces as an unrelated range error rather than as a mismatch.
          outputs: [
            {
              type: "tuple",
              components: [
                { name: "offerHash", type: "bytes32" },
                { name: "marketId", type: "bytes32" },
                { name: "exactUnits", type: "uint128" },
                { name: "expectedBuyerAssets", type: "uint128" },
                { name: "maxPendingFee", type: "uint128" },
                { name: "expiry", type: "uint40" },
                { name: "activatedAt", type: "uint40" },
                { name: "status", type: "uint8" },
                { name: "taker", type: "address" },
                { name: "vault", type: "address" },
                { name: "ratifier", type: "address" },
              ],
            },
          ],
        },
      ],
      functionName: "executionOf",
      args: [activation.quoteId],
    })) as Record<string, unknown>;

    // Midnight's own group accounting. The quote id IS the group, so this is the protocol's
    // number rather than Kyrve's — the strongest place to read exact fill from.
    const consumed = (await client.readContract({
      address: record.midnight,
      abi: [fn("consumed", [{ type: "address" }, { type: "bytes32" }], U256)],
      functionName: "consumed",
      args: [record.seriesVault, activation.quoteId],
    })) as bigint;

    evidence["status"] = String(execution["status"]);
    evidence["exactUnits (Kyrve)"] = String(execution["exactUnits"]);
    evidence["consumed (Midnight)"] = String(consumed);

    /**
     * A QUOTE THE REGISTRY HAS NEVER HEARD OF MUST NOT PASS THIS CHECK.
     *
     * `executionOf` returns a zeroed struct for an unknown id and Midnight's `consumed` returns 0
     * for a group that never existed, so `0 == 0` and the check reported PASS against a freshly
     * deployed layer carrying no quote at all. Caught by running it — a test that cannot fail
     * proves nothing, and this one was passing for the wrong reason on its first real use.
     */
    if (Number(execution["status"]) === 0) {
      return fail(
        id,
        title,
        "the registry has never heard of this quote — nothing to compare",
        evidence,
      );
    }
    if (consumed !== BigInt(String(execution["exactUnits"]))) {
      return fail(
        id,
        title,
        "Midnight's group consumption is not the quote's exact units",
        evidence,
      );
    }
    return pass(
      id,
      title,
      "Midnight's own group accounting agrees with the quote's exact units, to the unit",
      evidence,
    );
  } catch (error) {
    return fail(id, title, `reading Midnight failed — ${short(error)}`, evidence);
  }
}

async function checkSupply(
  client: ReturnType<typeof createPublicClient>,
  record: SeriesRecord,
  environment: Environment,
): Promise<Finding> {
  const id = "confidential-supply";
  const title = "the series' confidential supply is the published aggregate, not the units";
  const path = repoPath(layerPaths().activation);
  const ownership = record.contracts["SeriesOwnershipRegistry"];
  const token = record.contracts["KyrveSeriesToken"];
  if (ownership === undefined || token === undefined) {
    return unavailable(id, title, "the record names no ownership registry or series token");
  }
  if (environment !== "sepolia" || !existsSync(path)) {
    return unavailable(id, title, "no recorded quote to verify the aggregate against");
  }
  const activation = readJson<{ quoteId: Hex }>(path);

  const evidence: Record<string, string> = {};
  try {
    const binding = (await client.readContract({
      address: ownership.address,
      abi: [
        {
          type: "function",
          name: "bindingOf",
          stateMutability: "view",
          inputs: B32,
          outputs: [
            {
              type: "tuple",
              components: [
                { name: "bound", type: "bool" },
                { name: "closed", type: "bool" },
                { name: "epochId", type: "bytes32" },
                { name: "graphRoot", type: "bytes32" },
                { name: "aggregateFillAmount", type: "uint256" },
                { name: "allocatedCount", type: "uint32" },
                { name: "unwoundCount", type: "uint32" },
              ],
            },
          ],
        },
      ],
      functionName: "bindingOf",
      args: [activation.quoteId],
    })) as Record<string, unknown>;

    const aggregate = BigInt(String(binding["aggregateFillAmount"]));
    evidence["aggregate (ownership binding)"] = String(aggregate);
    evidence["allocatedCount"] = String(binding["allocatedCount"]);
    evidence["closed"] = String(binding["closed"]);

    const publishedHandle = (await client.readContract({
      address: token.address,
      abi: [fn("publishedSupply", [], [{ type: "bytes32" }])],
      functionName: "publishedSupply",
    })) as Hex;
    evidence["publishedSupply handle"] = publishedHandle;

    if (/^0x0+$/.test(publishedHandle)) {
      return fail(id, title, "the series has never published its aggregate supply", evidence);
    }
    if (binding["bound"] !== true) {
      return fail(id, title, "the ownership registry has no binding for this quote", evidence);
    }
    if (binding["closed"] !== true) {
      return fail(id, title, "the quote's allocation was never closed", evidence);
    }

    // The plaintext behind the handle is read by the proof page through the gateway. Here the
    // check is the BINDING and the on-chain accounting: the aggregate the series minted against is
    // the epoch's published aggregate, and it is neither the Midnight units nor the buyer's assets.
    const settlementPath = repoPath("evidence/phase5/sepolia-settlement.json");
    if (existsSync(settlementPath)) {
      const settlement = readJson<Record<string, string>>(settlementPath);
      evidence["units settled"] = String(
        settlement["consumedUnits"] ?? settlement["exactUnits"] ?? "unknown",
      );
      evidence["buyer assets"] = String(settlement["buyerAssets"] ?? "unknown");
    }

    return pass(
      id,
      title,
      `supply is bound to the published aggregate ${aggregate}, over ${binding["allocatedCount"]} sealed claims`,
      evidence,
    );
  } catch (error) {
    return fail(id, title, `reading the series layer failed — ${short(error)}`, evidence);
  }
}

async function checkCoverage(
  client: ReturnType<typeof createPublicClient>,
  record: SeriesRecord,
): Promise<Finding> {
  const id = "vault-coverage";
  const title = "the vault's public Midnight credit covers the confidential claims";
  const solvency = record.contracts["AggregateSolvencyVerifier"];
  if (solvency === undefined)
    return unavailable(id, title, "the record names no solvency verifier");

  const evidence: Record<string, string> = {};
  try {
    const coverage = (await client.readContract({
      address: solvency.address,
      abi: [
        fn(
          "publicCoverage",
          [],
          [
            { type: "uint128" },
            { type: "uint128" },
            { type: "uint256" },
            { type: "uint256" },
            { type: "uint256" },
          ],
        ),
      ],
      functionName: "publicCoverage",
    })) as readonly bigint[];

    evidence["midnight credit"] = String(coverage[0]);
    evidence["pending fee"] = String(coverage[1]);
    evidence["vault reserves"] = String(coverage[2]);
    evidence["residue reserves"] = String(coverage[3]);
    evidence["total coverage"] = String(coverage[4]);

    const count = (await client.readContract({
      address: solvency.address,
      abi: [fn("snapshotCount", [], [{ type: "uint32" }])],
      functionName: "snapshotCount",
    })) as number;
    evidence["solvency snapshots"] = String(count);

    if ((coverage[4] ?? 0n) === 0n) {
      return fail(id, title, "the series reports zero public coverage", evidence);
    }
    if (Number(count) === 0) {
      return fail(
        id,
        title,
        "no solvency verdict has ever been published for this series",
        evidence,
      );
    }
    return pass(
      id,
      title,
      `public coverage is ${coverage[4]}, entirely from public terms, over ${count} published verdict(s)`,
      evidence,
    );
  } catch (error) {
    return fail(id, title, `reading the solvency verifier failed — ${short(error)}`, evidence);
  }
}

async function checkResidue(
  client: ReturnType<typeof createPublicClient>,
  record: SeriesRecord,
): Promise<Finding> {
  const id = "residue-policy";
  const title = "the residue has one declared destination and it cannot be changed";
  const residue = record.contracts["SeriesResidueAccount"];
  if (residue === undefined) return unavailable(id, title, "the record names no residue account");

  const evidence: Record<string, string> = {};
  try {
    for (const [key, getter] of [
      ["declared beneficiary", "DECLARED_BENEFICIARY"],
      ["recorder", "RECORDER"],
      ["loan token", "LOAN_TOKEN"],
    ] as const) {
      evidence[key] = String(
        await client.readContract({
          address: residue.address,
          abi: [fn(getter, [], ADDR)],
          functionName: getter as never,
        }),
      );
    }
    for (const [key, getter] of [
      ["total recorded", "totalRecorded"],
      ["total distributed", "totalDistributed"],
      ["unsettled", "unsettledResidue"],
      ["held", "heldBalance"],
    ] as const) {
      evidence[key] = String(
        await client.readContract({
          address: residue.address,
          abi: [fn(getter, [], U256)],
          functionName: getter as never,
        }),
      );
    }

    if (evidence["declared beneficiary"] === ZERO) {
      return fail(id, title, "the residue account has no declared beneficiary", evidence);
    }
    if (
      evidence["declared beneficiary"]?.toLowerCase() !== record.residueBeneficiary.toLowerCase()
    ) {
      return fail(id, title, "the on-chain beneficiary is not the one the record claims", evidence);
    }
    return pass(
      id,
      title,
      "the destination is an immutable declared address and distribute() takes no parameters",
      evidence,
    );
  } catch (error) {
    return fail(id, title, `reading the residue account failed — ${short(error)}`, evidence);
  }
}

async function checkCapsule(
  client: ReturnType<typeof createPublicClient>,
  record: SeriesRecord,
): Promise<Finding> {
  const id = "capsule";
  const title = "capsules are bound to this chain, deployment and series";
  if (record.capsuleVault === undefined) {
    return unavailable(id, title, "no KyrveCapsuleVault is deployed for this layer yet");
  }
  const evidence: Record<string, string> = { capsuleVault: record.capsuleVault };
  try {
    for (const [key, getter] of [
      ["series", "SERIES_ID"],
      ["deployment", "DEPLOYMENT_ID"],
    ] as const) {
      evidence[key] = String(
        await client.readContract({
          address: record.capsuleVault,
          abi: [fn(getter, [], B32)],
          functionName: getter as never,
        }),
      );
    }
    evidence["capsules issued"] = String(
      await client.readContract({
        address: record.capsuleVault,
        abi: [fn("capsuleCount", [], [{ type: "uint32" }])],
        functionName: "capsuleCount",
      }),
    );

    if (evidence["series"]?.toLowerCase() !== record.seriesId.toLowerCase()) {
      return fail(id, title, "the capsule vault serves a different series", evidence);
    }
    if (evidence["deployment"]?.toLowerCase() !== record.deploymentId.toLowerCase()) {
      return fail(id, title, "the capsule vault is bound to a different deployment", evidence);
    }
    return pass(
      id,
      title,
      "every capsule here is bound to this series and this deployment",
      evidence,
    );
  } catch (error) {
    return fail(id, title, `reading the capsule vault failed — ${short(error)}`, evidence);
  }
}

async function checkCross(
  client: ReturnType<typeof createPublicClient>,
  record: SeriesRecord,
): Promise<Finding> {
  const id = "cross";
  const title = "the Cross book's price, fee and beneficiary are immutable and declared";
  if (record.crossBook === undefined) {
    return unavailable(id, title, "no KyrveCrossBook is deployed for this layer yet");
  }
  const evidence: Record<string, string> = { crossBook: record.crossBook };
  try {
    evidence["price (wad)"] = String(
      await client.readContract({
        address: record.crossBook,
        abi: [fn("PRICE_WAD", [], U256)],
        functionName: "PRICE_WAD",
      }),
    );
    evidence["fee (bps)"] = String(
      await client.readContract({
        address: record.crossBook,
        abi: [fn("FEE_BPS", [], [{ type: "uint16" }])],
        functionName: "FEE_BPS",
      }),
    );
    evidence["fee beneficiary"] = String(
      await client.readContract({
        address: record.crossBook,
        abi: [fn("FEE_BENEFICIARY", [], ADDR)],
        functionName: "FEE_BENEFICIARY",
      }),
    );
    evidence["orders"] = String(
      await client.readContract({
        address: record.crossBook,
        abi: [fn("orderCount", [], [{ type: "uint32" }])],
        functionName: "orderCount",
      }),
    );

    if (Number(evidence["fee (bps)"]) > 100) {
      return fail(id, title, "the declared fee is above the book's own cap", evidence);
    }
    if (evidence["fee beneficiary"] === ZERO) {
      return fail(id, title, "the book has no declared fee beneficiary", evidence);
    }
    return pass(
      id,
      title,
      "price, fee and beneficiary are immutables readable by anyone",
      evidence,
    );
  } catch (error) {
    return fail(id, title, `reading the Cross book failed — ${short(error)}`, evidence);
  }
}

async function checkRoll(
  client: ReturnType<typeof createPublicClient>,
  record: SeriesRecord,
): Promise<Finding> {
  const id = "roll";
  const title = "the Roll conversion is reproducible from two public numbers";
  if (record.rollBook === undefined) {
    return unavailable(id, title, "no KyrveRollBook is deployed for this layer yet");
  }
  const evidence: Record<string, string> = { rollBook: record.rollBook };
  try {
    const sourceToken = (await client.readContract({
      address: record.rollBook,
      abi: [fn("SOURCE_TOKEN", [], ADDR)],
      functionName: "SOURCE_TOKEN",
    })) as Address;
    const targetPrice = (await client.readContract({
      address: record.rollBook,
      abi: [fn("TARGET_PRICE_WAD", [], U256)],
      functionName: "TARGET_PRICE_WAD",
    })) as bigint;
    const factor = (await client.readContract({
      address: sourceToken,
      abi: [fn("redemptionFactorWad", [], U256)],
      functionName: "redemptionFactorWad",
    })) as bigint;

    evidence["source redemption factor"] = String(factor);
    evidence["target price (wad)"] = String(targetPrice);

    if (factor === 0n) {
      return fail(
        id,
        title,
        "the source series has not opened redemption, so no conversion exists",
        evidence,
      );
    }
    const expected = (factor * 10n ** 18n) / targetPrice;
    const onChain = (await client.readContract({
      address: record.rollBook,
      abi: [fn("conversionWad", [], U256)],
      functionName: "conversionWad",
    })) as bigint;
    evidence["conversion (recomputed)"] = String(expected);
    evidence["conversion (chain)"] = String(onChain);

    if (expected !== onChain) {
      return fail(
        id,
        title,
        "the book's conversion is not sourceFactor * WAD / targetPrice",
        evidence,
      );
    }
    return pass(
      id,
      title,
      "the conversion is exactly the two public numbers, recomputed here",
      evidence,
    );
  } catch (error) {
    return fail(id, title, `reading the Roll book failed — ${short(error)}`, evidence);
  }
}

function short(error: unknown): string {
  const text = safeErrorMessage(error);
  return text.split("\n")[0]?.slice(0, 160) ?? "unknown error";
}

main().catch((error: unknown) => {
  console.error(`\nkyrve-verify failed — ${short(error)}\n`);
  process.exit(EXIT.FAIL);
});
