/**
 * The confidential layer talks to the SETTLEMENT layer across the same compiler boundary, in the
 * other direction. This checks the two agree.
 *
 * ════════════════════════════════════════════════════════════════════════════════════════════
 * WHY THIS EXISTS BESIDE `curve-abi.ts` RATHER THAN INSIDE IT
 * ════════════════════════════════════════════════════════════════════════════════════════════
 *
 * `curve-abi.ts` checks `contracts/kyrve/interfaces/ICurveLayer.sol` — declared at 0.8.34, describing
 * contracts compiled at 0.8.36. Phase 5 added the mirror: `SeriesAllocator` and
 * `AggregateSolvencyVerifier` live at 0.8.36 and CALL the settlement layer, so
 * `confidential/contracts/interfaces/ISettlementLayer.sol` declares that surface at 0.8.36 against
 * contracts compiled at 0.8.34.
 *
 * The direction is reversed, so the artifact roots are reversed, which is the whole reason this is a
 * second file rather than another entry in the first one's table.
 *
 * WHAT A MISMATCH WOULD COST HERE, CONCRETELY. `QuoteExecution` packs three `uint128`s, two `uint40`s,
 * an enum and three addresses. Reorder one and `exactUnits` decodes as `expectedBuyerAssets` — both
 * plausible values of the same magnitude — so `SeriesAllocator` would check the vault's credit against
 * the wrong number and mint claims anyway. Nothing would revert.
 *
 * So this compares the two ABIs directly:
 *
 *   SELECTOR   proves the function name and every input type match, exactly.
 *   OUTPUTS    proves the return shape matches, recursively through tuples — which the selector does
 *              NOT cover, and which is where a reordered struct field would hide.
 *
 * A missing artifact is a FAILURE, not a skip. Reporting PASS over an empty comparison is the failure
 * mode this repository exists to close.
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { repoPath } from "../lib/shell.js";

interface AbiParameter {
  readonly name?: string;
  readonly type: string;
  readonly components?: readonly AbiParameter[];
}

interface AbiFunction {
  readonly type: string;
  readonly name?: string;
  readonly inputs?: readonly AbiParameter[];
  readonly outputs?: readonly AbiParameter[];
}

interface Artifact {
  readonly abi: readonly AbiFunction[];
}

/** Each interface the confidential layer declares, and the Foundry contract it must match. */
const PAIRS: readonly { readonly declared: string; readonly real: string }[] = [
  { declared: "IKyrveQuoteRegistry", real: "KyrveQuoteRegistry" },
  { declared: "IKyrveSeriesVault", real: "KyrveSeriesVault" },
];

function readJsonFile<T>(path: string): T {
  return JSON.parse(readFileSync(path, "utf8")) as T;
}

/** The DECLARED side: an interface inside the confidential layer's own compilation unit. */
function declaredArtifact(name: string): Artifact {
  const path = repoPath(
    join(
      "confidential",
      "artifacts",
      "contracts",
      "interfaces",
      "ISettlementLayer.sol",
      `${name}.json`,
    ),
  );
  if (!existsSync(path)) {
    throw new Error(
      `no Hardhat artifact for ${name} at ${path}. Run ` +
        "`pnpm --dir confidential exec hardhat compile` first — comparing an empty ABI would report " +
        "agreement between two things neither of which was read.",
    );
  }
  return readJsonFile<Artifact>(path);
}

/** The REAL side: the Foundry-compiled settlement contract that will actually be called. */
function realArtifact(name: string): Artifact {
  const path = repoPath(join("out", `${name}.sol`, `${name}.json`));
  if (!existsSync(path)) {
    throw new Error(`no Foundry artifact for ${name} at ${path}. Run \`forge build\` first.`);
  }
  return readJsonFile<Artifact>(path);
}

/** The canonical type string, expanded recursively so a reordered tuple field is visible. */
function canonical(parameter: AbiParameter): string {
  if (!parameter.type.startsWith("tuple")) return parameter.type;
  const suffix = parameter.type.slice("tuple".length);
  const inner = (parameter.components ?? []).map(canonical).join(",");
  return `(${inner})${suffix}`;
}

function signature(fn: AbiFunction): string {
  return `${fn.name ?? ""}(${(fn.inputs ?? []).map(canonical).join(",")})`;
}

function outputSignature(fn: AbiFunction): string {
  return `(${(fn.outputs ?? []).map(canonical).join(",")})`;
}

function functionsOf(artifact: Artifact): Map<string, AbiFunction> {
  const byName = new Map<string, AbiFunction>();
  for (const entry of artifact.abi) {
    if (entry.type !== "function" || entry.name === undefined) continue;
    byName.set(signature(entry), entry);
  }
  return byName;
}

function main(): void {
  const problems: string[] = [];
  let compared = 0;

  for (const pair of PAIRS) {
    const declared = functionsOf(declaredArtifact(pair.declared));
    const real = functionsOf(realArtifact(pair.real));

    if (declared.size === 0) {
      problems.push(`${pair.declared} declares no functions; the comparison would be vacuous`);
      continue;
    }

    for (const [sig, fn] of declared) {
      const match = real.get(sig);
      if (match === undefined) {
        problems.push(
          `${pair.real} has no \`${sig}\`. The confidential layer would call a function that does ` +
            "not exist, and the call would revert without a reason.",
        );
        continue;
      }

      const declaredOutputs = outputSignature(fn);
      const realOutputs = outputSignature(match);
      if (declaredOutputs !== realOutputs) {
        problems.push(
          `${pair.real}.${sig} returns ${realOutputs}, but ISettlementLayer declares ${declaredOutputs}. ` +
            "The selector matches, so this would decode silently into the wrong fields.",
        );
      }
      compared += 1;
    }
  }

  if (problems.length > 0) {
    for (const problem of problems) console.error(`  ${problem}`);
    throw new Error(
      `${problems.length} ABI mismatch(es) between ` +
        "confidential/contracts/interfaces/ISettlementLayer.sol and the compiled settlement layer",
    );
  }

  console.log(
    `ISettlementLayer matches the settlement layer: ${compared} function(s) across ${PAIRS.length} ` +
      "interfaces, selectors and return shapes both",
  );
}

main();
