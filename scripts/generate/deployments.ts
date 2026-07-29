/**
 * Emits the deployment record that Workers embed at build time.
 *
 * A Worker has no filesystem, so it cannot read a per-environment `manifest.json` from disk at runtime. Rather
 * than have each Worker hardcode addresses — which drift silently — the manifests are compiled
 * into one typed module with a content hash per environment.
 *
 * The hash is what makes the embedded copy checkable: `/config` on every Worker reports it, and
 * `verify:deployment` can compare what a running Worker believes against what the repository
 * actually holds. A Worker running a stale bundle becomes visible instead of merely wrong.
 *
 * Deterministic: sorted keys, no timestamp. `verify:generated` asserts regeneration is a no-op.
 */

import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";

import { parseDeploymentManifest } from "../../packages/config/src/index.js";
import { readJson, repoPath, stableStringify } from "../lib/shell.js";

const ENVIRONMENTS = ["local", "sepolia"] as const;

interface EmbeddedDeployment {
  readonly environment: string;
  readonly chainId: number;
  readonly deploymentBlock: string;
  readonly manifestHash: string;
  readonly contracts: Record<string, string>;
  readonly markets: Array<{ key: string; id: string; rateGridHash: string }>;
  readonly midnightRelease: string;
  readonly midnightCommit: string;
  readonly verifiedSourceCount: number;
}

function build(environment: string): EmbeddedDeployment | null {
  const path = repoPath(`deployments/${environment}/manifest.json`);
  if (!existsSync(path)) return null;

  const raw = readJson<unknown>(path);
  const manifest = parseDeploymentManifest(raw);

  // Hash the canonical serialisation, so formatting changes do not move the hash but content does.
  const manifestHash = `sha256:${createHash("sha256").update(stableStringify(raw)).digest("hex")}`;

  return {
    environment: manifest.environment,
    chainId: manifest.chainId,
    deploymentBlock: manifest.deploymentBlock,
    manifestHash,
    contracts: Object.fromEntries(
      Object.entries(manifest.contracts)
        .map(([name, record]) => [name, record.address] as const)
        .sort(([a], [b]) => (a < b ? -1 : 1)),
    ),
    markets: manifest.markets.map((m) => ({
      key: m.key,
      id: m.id,
      rateGridHash: m.rateGridHash,
    })),
    midnightRelease: manifest.pins.midnightRelease,
    midnightCommit: manifest.pins.midnightCommit,
    verifiedSourceCount: Object.values(manifest.contracts).filter(
      (c) => c.verifiedSource === "verified",
    ).length,
  };
}

function main(): void {
  const deployments: Record<string, EmbeddedDeployment> = {};
  for (const environment of ENVIRONMENTS) {
    const record = build(environment);
    if (record !== null) deployments[environment] = record;
  }

  const body = `/**
 * GENERATED FILE — do not edit by hand. Run \`pnpm generate\`.
 *
 * The deployment record Workers embed. A Worker has no filesystem and cannot read a manifest at
 * runtime, so this module is compiled into the bundle. Each environment carries a manifestHash,
 * which every Worker reports at /config — a Worker running a stale bundle is therefore detectable
 * rather than silently wrong.
 *
 * TIMESTAMP POLICY: none, deliberately. See any generated ABI module.
 */

export interface EmbeddedDeployment {
  readonly environment: string;
  readonly chainId: number;
  readonly deploymentBlock: string;
  readonly manifestHash: string;
  readonly contracts: Readonly<Record<string, string>>;
  readonly markets: ReadonlyArray<{ key: string; id: string; rateGridHash: string }>;
  readonly midnightRelease: string;
  readonly midnightCommit: string;
  readonly verifiedSourceCount: number;
}

export const DEPLOYMENTS: Readonly<Record<string, EmbeddedDeployment>> = ${JSON.stringify(deployments, null, 2)} as const;

export const DEPLOYMENT_ENVIRONMENTS = ${JSON.stringify(Object.keys(deployments))} as const;

/** Throws rather than returning undefined: a Worker with no deployment must fail loudly. */
export function embeddedDeployment(environment: string): EmbeddedDeployment {
  const record = DEPLOYMENTS[environment];
  if (record === undefined) {
    throw new Error(
      \`no embedded deployment for "\${environment}". Available: \${DEPLOYMENT_ENVIRONMENTS.join(", ")}. \` +
        "Deploy it and run \`pnpm generate\` so the record is compiled into the bundle.",
    );
  }
  return record;
}
`;

  writeFileSync(repoPath("packages/generated/src/deployments.ts"), body);

  // `scripts/generate/abis.ts` wipes and rewrites src/, so it must run FIRST and this appends
  // afterwards. Re-running is safe: the export is added only if it is not already present.
  const indexPath = repoPath("packages/generated/src/index.ts");
  const exportLine =
    'export {\n  DEPLOYMENT_ENVIRONMENTS,\n  DEPLOYMENTS,\n  embeddedDeployment,\n  type EmbeddedDeployment,\n} from "./deployments.js";\n';
  const index = readFileSync(indexPath, "utf8");
  if (!index.includes('from "./deployments.js"')) {
    writeFileSync(indexPath, index + exportLine);
  }

  console.log(`embedded ${Object.keys(deployments).length} deployment(s)`);
  for (const [name, record] of Object.entries(deployments)) {
    console.log(
      `  ${name.padEnd(10)} chain ${String(record.chainId).padEnd(9)} ` +
        `${Object.keys(record.contracts).length} contracts, ${record.markets.length} markets, ` +
        `${record.verifiedSourceCount} verified  ${record.manifestHash.slice(0, 22)}`,
    );
  }
}

main();
