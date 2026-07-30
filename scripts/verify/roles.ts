/**
 * Recomputes the operational role model FROM CHAIN STATE.
 *
 * ════════════════════════════════════════════════════════════════════════════════════════════
 * WHAT IT REFUSES TO TRUST
 * ════════════════════════════════════════════════════════════════════════════════════════════
 *
 * Not the manifest. `deployments/<env>/series.json` records a `keeper`, an `operator`, a `curator`
 * and a `residueBeneficiary`, and a manifest is a file — it can be regenerated, hand-edited, or
 * left describing a deployment that was replaced. Every address below is read from the deployed
 * contract's own immutable getter, and the manifest is used only to know WHICH contracts to ask.
 *
 * The manifest's own claims are then compared against what the chain said, and a disagreement is a
 * failure rather than a note. A record that says the roles are separate while the chain says they
 * are one address is worse than no record.
 *
 * ════════════════════════════════════════════════════════════════════════════════════════════
 * THE THREE QUESTIONS
 * ════════════════════════════════════════════════════════════════════════════════════════════
 *
 *   1. Does each enforcing contract point at the address the record claims?
 *   2. Are the addresses the CHAIN returned pairwise distinct?
 *   3. If a `KyrveRoleRegistry` is deployed, does its declaration agree with all of them, and is it
 *      bound to this deployment rather than another?
 *
 * Question 2 is the one that matters and it is asked of chain values only. Through Phase 5 the
 * answer on Sepolia was no — four roles, one key — and this check reports that as a failure rather
 * than as a footnote, because that is what it was.
 */

import { existsSync } from "node:fs";

import { type Address, createPublicClient, http } from "viem";
import { hardhat, sepolia } from "viem/chains";

import { sepoliaRpc } from "../lib/env.js";
import { readJson, repoPath } from "../lib/shell.js";

const LOCAL_RPC = "http://127.0.0.1:8545";

type Environment = "local" | "sepolia";

/** One role authority, and the contract getter that actually enforces it. */
interface RoleSource {
  readonly role: string;
  readonly contract: string;
  readonly getter: string;
  /** The manifest field this getter should agree with. */
  readonly recordField: string;
}

const SOURCES: readonly RoleSource[] = [
  { role: "keeper", contract: "QuoteActivator", getter: "KEEPER", recordField: "keeper" },
  { role: "keeper", contract: "SeriesAllocator", getter: "KEEPER", recordField: "keeper" },
  {
    role: "operator",
    contract: "KyrveQuoteExpiryController",
    getter: "OPERATOR",
    recordField: "operator",
  },
  { role: "curator", contract: "KyrveSeriesToken", getter: "CURATOR", recordField: "curator" },
  { role: "curator", contract: "KyrveSeriesFactory", getter: "CURATOR", recordField: "curator" },
  {
    role: "residueBeneficiary",
    contract: "SeriesResidueAccount",
    getter: "DECLARED_BENEFICIARY",
    recordField: "residueBeneficiary",
  },
  {
    role: "deployer",
    contract: "SeriesOwnershipRegistry",
    getter: "DEPLOYER",
    recordField: "deployer",
  },
];

const ADDRESS_ABI = (getter: string) =>
  [
    {
      type: "function",
      name: getter,
      stateMutability: "view",
      inputs: [],
      outputs: [{ type: "address" }],
    },
  ] as const;

interface SeriesRecord {
  readonly chainId: number;
  readonly deployer: Address;
  readonly keeper: Address;
  readonly operator: Address;
  readonly curator: Address;
  readonly residueBeneficiary: Address;
  readonly deploymentId: `0x${string}`;
  readonly contracts: Record<string, { readonly address: Address }>;
  readonly roleRegistry?: Address;
}

interface Check {
  readonly name: string;
  readonly ok: boolean;
  readonly detail: string;
}

async function main(): Promise<void> {
  const environment: Environment = process.argv[2] === "sepolia" ? "sepolia" : "local";
  const isSepolia = environment === "sepolia";
  const recordPath = repoPath(`deployments/${environment}/series.json`);

  console.log(`\nverify:roles — ${environment}\n`);

  if (!existsSync(recordPath)) {
    console.log(`  no deployment record at deployments/${environment}/series.json — nothing to`);
    console.log("  verify. Deploy the layer first.\n");
    process.exitCode = 1;
    return;
  }

  const record = readJson<SeriesRecord>(recordPath);
  const rpc = isSepolia ? sepoliaRpc() : { url: LOCAL_RPC, redacted: LOCAL_RPC };
  const client = createPublicClient({
    chain: isSepolia ? sepolia : hardhat,
    transport: http(rpc.url),
  });

  const checks: Check[] = [];
  /** role -> the addresses the CHAIN returned for it. */
  const onChain = new Map<string, Address[]>();

  for (const source of SOURCES) {
    const entry = record.contracts[source.contract];
    if (entry === undefined) {
      checks.push({
        name: `${source.contract}.${source.getter}()`,
        ok: false,
        detail: "the record names no such contract",
      });
      continue;
    }

    let actual: Address;
    try {
      actual = (await client.readContract({
        address: entry.address,
        abi: ADDRESS_ABI(source.getter),
        functionName: source.getter as never,
      })) as Address;
    } catch (error) {
      checks.push({
        name: `${source.contract}.${source.getter}()`,
        ok: false,
        detail: `read failed — ${error instanceof Error ? error.message : String(error)}`,
      });
      continue;
    }

    const claimed = (record as unknown as Record<string, Address>)[source.recordField];
    const agrees = claimed !== undefined && claimed.toLowerCase() === actual.toLowerCase();
    checks.push({
      name: `${source.contract}.${source.getter}()`,
      ok: agrees,
      detail: agrees
        ? `${actual} — matches the record's ${source.recordField}`
        : `chain says ${actual}, record says ${claimed}`,
    });

    const list = onChain.get(source.role) ?? [];
    list.push(actual);
    onChain.set(source.role, list);
  }

  // ── One address per role, according to the chain ───────────────────────────────────────────
  const resolved = new Map<string, Address>();
  for (const [role, addresses] of onChain) {
    const unique = [...new Set(addresses.map((a) => a.toLowerCase()))];
    const consistent = unique.length === 1;
    checks.push({
      name: `${role} is one address across every contract that enforces it`,
      ok: consistent,
      detail: consistent ? (addresses[0] as string) : `disagreement: ${unique.join(", ")}`,
    });
    if (consistent && addresses[0] !== undefined) resolved.set(role, addresses[0]);
  }

  // ── THE QUESTION THIS SCRIPT EXISTS FOR ────────────────────────────────────────────────────
  const roles = [...resolved.keys()];
  let collapsed = 0;
  for (let i = 0; i < roles.length; i += 1) {
    for (let j = i + 1; j < roles.length; j += 1) {
      const first = roles[i] as string;
      const second = roles[j] as string;
      const a = resolved.get(first) as Address;
      const b = resolved.get(second) as Address;
      if (a.toLowerCase() === b.toLowerCase()) {
        collapsed += 1;
        checks.push({
          name: `${first} and ${second} are different addresses`,
          ok: false,
          detail: `both are ${a} — one key holds both authorities`,
        });
      }
    }
  }
  if (collapsed === 0) {
    checks.push({
      name: `${roles.length} enforced roles are pairwise distinct on chain`,
      ok: true,
      detail: roles.join(", "),
    });
  }

  // ── Account kind, live ─────────────────────────────────────────────────────────────────────
  for (const [role, address] of resolved) {
    const code = await client.getCode({ address });
    const kind = code !== undefined && code !== "0x" ? "contract" : "EOA";
    checks.push({ name: `${role} account kind`, ok: true, detail: `${address} is a ${kind} now` });
  }

  // ── The declaration, if one was deployed ───────────────────────────────────────────────────
  if (record.roleRegistry !== undefined) {
    const registryAbi = [
      {
        type: "function",
        name: "holders",
        stateMutability: "view",
        inputs: [],
        outputs: [{ type: "address[7]" }],
      },
      {
        type: "function",
        name: "DEPLOYMENT_ID",
        stateMutability: "view",
        inputs: [],
        outputs: [{ type: "bytes32" }],
      },
    ] as const;

    const declared = (await client.readContract({
      address: record.roleRegistry,
      abi: registryAbi,
      functionName: "holders",
    })) as readonly Address[];
    const boundTo = (await client.readContract({
      address: record.roleRegistry,
      abi: registryAbi,
      functionName: "DEPLOYMENT_ID",
    })) as `0x${string}`;

    const sameDeployment = boundTo.toLowerCase() === record.deploymentId.toLowerCase();
    checks.push({
      name: "KyrveRoleRegistry is bound to THIS deployment",
      ok: sameDeployment,
      detail: sameDeployment
        ? boundTo
        : `registry says ${boundTo}, layer is ${record.deploymentId}`,
    });

    // enum order: deployer, keeper, operator, curator, emergencyAuthority, residueBeneficiary, auditor
    const order = [
      "deployer",
      "keeper",
      "operator",
      "curator",
      "emergencyAuthority",
      "residueBeneficiary",
      "auditor",
    ];
    for (let i = 0; i < order.length; i += 1) {
      const role = order[i] as string;
      const enforced = resolved.get(role);
      if (enforced === undefined) continue;
      const declaredHolder = declared[i] as Address;
      const agrees = declaredHolder.toLowerCase() === enforced.toLowerCase();
      checks.push({
        name: `declared ${role} equals the enforced ${role}`,
        ok: agrees,
        detail: agrees ? declaredHolder : `declared ${declaredHolder}, enforced ${enforced}`,
      });
    }
  } else {
    checks.push({
      name: "KyrveRoleRegistry is deployed for this layer",
      ok: false,
      detail: "the record names no roleRegistry — the role model is not declared on chain",
    });
  }

  const passed = checks.filter((c) => c.ok).length;
  for (const check of checks) {
    console.log(`  ${check.ok ? "PASS" : "FAIL"}  ${check.name}\n        ${check.detail}`);
  }
  console.log(`\n  ${passed}/${checks.length} passed\n`);

  if (passed !== checks.length) process.exitCode = 1;
}

main().catch((error: unknown) => {
  console.error(
    `\nverify:roles failed — ${error instanceof Error ? error.message : String(error)}\n`,
  );
  process.exitCode = 1;
});
