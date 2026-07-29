/**
 * The settlement layer talks to the confidential layer across a COMPILER BOUNDARY. This checks the
 * two agree.
 *
 * ════════════════════════════════════════════════════════════════════════════════════════════
 * WHY A CHECK AND NOT AN IMPORT
 * ════════════════════════════════════════════════════════════════════════════════════════════
 *
 * `contracts/kyrve` compiles at solc 0.8.34, matching the pinned Midnight substrate so its runtime
 * bytecode stays byte-comparable. `confidential/contracts` compiles at 0.8.36, because the pinned
 * iExec Nox protocol contracts declare `^0.8.35`. Those two pins are mutually exclusive (Phase 2
 * delta Q-1), so the settlement layer declares the five entry points it calls in
 * `contracts/kyrve/interfaces/ICurveLayer.sol` rather than importing them.
 *
 * A cross-compiler CALL needs no shared source — only a matching ABI. Which means a field
 * reordered or retyped on either side produces a call that encodes cleanly, decodes cleanly, and
 * returns one number where another was meant. Nothing would revert. `graphRoot` would arrive as
 * `universeHash`, or an aggregate would arrive as a market index.
 *
 * So this compares the two ABIs directly:
 *
 *   SELECTOR   proves the function name and every input type match, exactly.
 *   OUTPUTS    proves the return shape matches, recursively through tuples — which the selector
 *              does NOT cover, and which is where a reordered struct field would hide.
 *
 * A missing artifact is a FAILURE, not a skip. Reporting PASS over an empty comparison is the
 * failure mode this repository exists to close.
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

/** Each locally declared interface, and the deployed contract it must match. */
const PAIRS: readonly { readonly declared: string; readonly real: string }[] = [
  { declared: "ICurveResultVerifier", real: "CurveResultVerifier" },
  { declared: "ICurveGraphRegistry", real: "CurveGraphRegistry" },
  { declared: "INoxCurveEngine", real: "NoxCurveEngine" },
  { declared: "IQuoteEpochController", real: "QuoteEpochController" },
  { declared: "ICurveUniverseRegistry", real: "CurveUniverseRegistry" },
];

function readJsonFile<T>(path: string): T {
  return JSON.parse(readFileSync(path, "utf8")) as T;
}

function foundryArtifact(name: string): Artifact {
  const path = repoPath(join("out", "ICurveLayer.sol", `${name}.json`));
  if (!existsSync(path)) {
    throw new Error(
      `no Foundry artifact for ${name} at ${path}. Run \`forge build\` first — comparing an ` +
        "empty ABI would report agreement between two things neither of which was read.",
    );
  }
  return readJsonFile<Artifact>(path);
}

function hardhatArtifact(name: string): Artifact {
  const path = repoPath(
    join("confidential", "artifacts", "contracts", `${name}.sol`, `${name}.json`),
  );
  if (!existsSync(path)) {
    throw new Error(
      `no Hardhat artifact for ${name} at ${path}. Run ` +
        "`pnpm --filter @kyrve/confidential exec hardhat compile` first.",
    );
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
    const declared = functionsOf(foundryArtifact(pair.declared));
    const real = functionsOf(hardhatArtifact(pair.real));

    if (declared.size === 0) {
      problems.push(`${pair.declared} declares no functions; the comparison would be vacuous`);
      continue;
    }

    for (const [sig, fn] of declared) {
      const match = real.get(sig);
      if (match === undefined) {
        problems.push(
          `${pair.real} has no \`${sig}\`. The settlement layer would call a function that does ` +
            "not exist, and the call would revert without a reason.",
        );
        continue;
      }

      const declaredOutputs = outputSignature(fn);
      const realOutputs = outputSignature(match);
      if (declaredOutputs !== realOutputs) {
        problems.push(
          `${pair.real}.${sig} returns ${realOutputs}, but ICurveLayer declares ${declaredOutputs}. ` +
            "The selector matches, so this would decode silently into the wrong fields.",
        );
      }
      compared += 1;
    }
  }

  if (problems.length > 0) {
    for (const problem of problems) console.error(`  ${problem}`);
    throw new Error(
      `${problems.length} ABI mismatch(es) between contracts/kyrve/interfaces/ICurveLayer.sol and ` +
        "the compiled confidential layer",
    );
  }

  console.log(
    `ICurveLayer matches the confidential layer: ${compared} function(s) across ${PAIRS.length} ` +
      "interfaces, selectors and return shapes both",
  );
}

main();
