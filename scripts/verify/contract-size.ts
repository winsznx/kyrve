/**
 * EIP-170: every deployable contract must fit 24,576 bytes of runtime code.
 *
 * ════════════════════════════════════════════════════════════════════════════════════════════
 * WHY THIS CHECK EXISTS
 * ════════════════════════════════════════════════════════════════════════════════════════════
 *
 * `NoxCurveEngine` compiled to 25,040 bytes and Sepolia refused it with
 * `CreateContractSizeLimit`. Nothing local had caught it, because **a Hardhat node allows
 * unlimited contract size**: the entire confidential suite — every demonstration, the attack
 * suite, the full 16 x 128 benchmark — ran green against a contract that could not be deployed to
 * any real chain. Recorded as delta R-10.
 *
 * That is the shape of gap this repository exists to close: a local environment that is more
 * permissive than production turns a hard deployment failure into a silent one, and the only
 * thing that finds it is a check that measures rather than a test that runs.
 *
 * The limit is a PROTOCOL rule, so this is not a style preference and there is no override.
 */

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

import { repoPath } from "../lib/shell.js";

/** EIP-170. Immovable. */
const MAX_RUNTIME_BYTES = 24_576;
/** Below this much headroom the next feature will not fit, which is worth saying before it lands. */
const WARN_HEADROOM_BYTES = 2_048;

interface Measured {
  readonly name: string;
  readonly runtimeBytes: number;
  readonly headroom: number;
}

function collect(root: string, into: Measured[]): void {
  if (!existsSync(root)) return;
  for (const entry of readdirSync(root)) {
    const path = join(root, entry);
    if (statSync(path).isDirectory()) {
      collect(path, into);
      continue;
    }
    if (!entry.endsWith(".json") || entry.endsWith(".dbg.json")) continue;

    const artifact = JSON.parse(readFileSync(path, "utf8")) as {
      contractName?: string;
      deployedBytecode?: string | { object?: string };
      bytecode?: string | { object?: string };
      abi?: unknown[];
    };
    if (artifact.contractName === undefined || artifact.abi === undefined) continue;

    const deployed = artifact.deployedBytecode ?? artifact.bytecode;
    const object = typeof deployed === "string" ? deployed : (deployed?.object ?? "");
    // Interfaces, libraries with only internal functions, and abstract contracts have no runtime
    // code. They cannot be deployed, so the limit does not apply to them.
    if (object.length <= 2) continue;

    const runtimeBytes = (object.length - 2) / 2;
    into.push({
      name: artifact.contractName,
      runtimeBytes,
      headroom: MAX_RUNTIME_BYTES - runtimeBytes,
    });
  }
}

function main(): void {
  const measured: Measured[] = [];
  collect(repoPath("confidential/artifacts/contracts"), measured);

  if (measured.length === 0) {
    throw new Error(
      "no artifacts found. Run `pnpm --filter @kyrve/confidential build` first — this check " +
        "measures compiled output, and reporting PASS over an empty set would be worse than " +
        "reporting nothing.",
    );
  }

  measured.sort((a, b) => b.runtimeBytes - a.runtimeBytes);
  console.log(`contract-size — EIP-170, ${MAX_RUNTIME_BYTES} bytes\n`);

  const over: Measured[] = [];
  const tight: Measured[] = [];
  for (const entry of measured) {
    const status =
      entry.headroom < 0 ? "OVER" : entry.headroom < WARN_HEADROOM_BYTES ? "tight" : "ok";
    if (entry.headroom < 0) over.push(entry);
    else if (entry.headroom < WARN_HEADROOM_BYTES) tight.push(entry);
    console.log(
      `  ${status.padEnd(5)} ${entry.name.padEnd(30)} ${String(entry.runtimeBytes).padStart(6)} bytes` +
        `  ${entry.headroom >= 0 ? `${entry.headroom} to spare` : `${-entry.headroom} OVER`}`,
    );
  }

  console.log("");
  if (over.length > 0) {
    console.error(
      `contract-size FAIL — ${over.length} contract(s) exceed EIP-170 and cannot be deployed to ` +
        "any real chain:\n",
    );
    for (const entry of over) {
      console.error(`  ${entry.name}: ${entry.runtimeBytes} bytes, ${-entry.headroom} over`);
    }
    console.error(
      "\n  A Hardhat node allows unlimited contract size, so the test suite will keep passing.\n" +
        "  Reduce the contract, lower `optimizer.runs` for that file only, or extract a library.\n",
    );
    process.exitCode = 1;
    return;
  }

  console.log(`contract-size PASS — ${measured.length} deployable contracts, all inside EIP-170`);
  if (tight.length > 0) {
    console.log(
      `  ${tight.length} within ${WARN_HEADROOM_BYTES} bytes of the limit: ` +
        `${tight.map((entry) => `${entry.name} (${entry.headroom})`).join(", ")}`,
    );
  }
}

main();
