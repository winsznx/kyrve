/**
 * Reproducible ABI and typed-binding generation.
 *
 * DETERMINISM IS THE POINT. `pnpm verify:generated` regenerates and asserts `git diff` is empty,
 * so a stale binding is a build failure rather than a runtime surprise. Two consequences shape
 * this file:
 *
 *   - **No timestamp is emitted.** A generation timestamp would change every artifact on every
 *     run without any source change, which would make the diff check meaningless. The header
 *     instead carries the source commit and a content hash, which change only when the input does.
 *   - **The artifact directory is rebuilt first.** Foundry leaves artifacts for deleted contracts
 *     behind, so generating from a stale `out/` would emit bindings for contracts that no longer
 *     exist. This was a real occurrence: `KyrveSeriesVault` and `KyrveQuoteRegistry` artifacts
 *     survived their rename.
 *
 * Only contracts on the explicit allowlist are generated. A glob would silently pull in test
 * helpers, scripts and forge-std internals.
 */

import { createHash } from "node:crypto";
import { mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";

import { repoPath, run, stableStringify } from "../lib/shell.js";

interface Target {
  /** Solidity contract name, and the exported binding name. */
  readonly name: string;
  /** Where the source lives, recorded in the header so a reader can find it. */
  readonly source: string;
  readonly note: string;
}

const TARGETS: readonly Target[] = [
  {
    name: "Midnight",
    source: "vendor/midnight/src/Midnight.sol",
    note: "The pinned, unmodified Morpho Midnight core. BUSL-1.1; see LICENSE.",
  },
  {
    name: "IMidnight",
    source: "vendor/midnight/src/interfaces/IMidnight.sol",
    note: "Full Midnight interface including take, touchMarket, setConsumed and setIsAuthorized.",
  },
  {
    name: "IRatifier",
    source: "vendor/midnight/src/interfaces/IRatifier.sol",
    note: "isRatified is view and receives no units — it cannot enforce fill size.",
  },
  {
    name: "IBuyCallback",
    source: "vendor/midnight/src/interfaces/ICallbacks.sol",
    note: "onBuy is the only place actual fill size reaches maker code.",
  },
  {
    name: "KyrveProtocolRegistry",
    source: "contracts/registry/KyrveProtocolRegistry.sol",
    note: "On-chain anchor for the supported Midnight and Nox deployment.",
  },
  {
    name: "KyrveDeploymentVerifier",
    source: "contracts/registry/KyrveDeploymentVerifier.sol",
    note: "Read-only verification of a live deployment against the registry.",
  },
  {
    name: "KyrveOsakaProbe",
    source: "contracts/registry/KyrveOsakaProbe.sol",
    note: "Permanent on-chain CLZ proof that the host chain executes Osaka.",
  },
  {
    name: "KyrveExactFillVault",
    source: "contracts/integration/KyrveExactFillVault.sol",
    note: "Exact-fill regression harness. NOT the production series vault.",
  },
  {
    name: "KyrveQuoteRatifier",
    source: "contracts/integration/KyrveQuoteRatifier.sol",
    note: "Authenticates the exact activated offer and the approved taker.",
  },
  {
    name: "TestERC20",
    source: "contracts/integration/TestERC20.sol",
    note: "Test token with an unrestricted mint. Local and labelled testnet replica only.",
  },
  {
    name: "FixedPriceOracle",
    source: "contracts/integration/FixedPriceOracle.sol",
    note: "Constant-price oracle for the deterministic test substrate.",
  },
];

/**
 * Interfaces Phase 2 will need that are NOT generated here, recorded so their absence is a
 * documented gap rather than an oversight.
 */
const DEFERRED = [
  {
    name: "INoxCompute / Nox SDK",
    reason:
      "@iexec-nox/* is not a dependency of the root workspace. Only packages/nox may depend on " +
      "Nox (A-15), and its TypeScript side deliberately avoids the beta SDK. Generated when " +
      "Phase 2 introduces the confidential contracts.",
  },
  {
    name: "ERC-7984 confidential token",
    reason:
      "@iexec-nox/nox-confidential-contracts is exercised in spikes/nox, which is excluded from " +
      "the workspace as frozen Day 0 evidence. Generated when Phase 2 builds the series token.",
  },
] as const;

interface ForgeArtifact {
  abi: unknown[];
  bytecode?: { object?: string };
  deployedBytecode?: { object?: string };
}

function findArtifact(name: string): ForgeArtifact {
  const outDir = repoPath("out");
  for (const dir of readdirSync(outDir)) {
    const file = `${outDir}/${dir}/${name}.json`;
    try {
      return JSON.parse(readFileSync(file, "utf8")) as ForgeArtifact;
    } catch {
      // Not in this directory; keep looking.
    }
  }
  throw new Error(
    `no forge artifact for ${name}. Run \`forge build\` first, and check the contract still exists.`,
  );
}

function identifier(name: string): string {
  return `${name.replace(/^I(?=[A-Z])/, "I").replace(/[^A-Za-z0-9]/g, "")}Abi`;
}

function render(target: Target, abi: unknown[], commit: string, contentHash: string): string {
  return `/**
 * GENERATED FILE — do not edit by hand.
 *
 * Contract:  ${target.name}
 * Source:    ${target.source}
 * Note:      ${target.note}
 *
 * Command:   pnpm generate
 * Verify:    pnpm verify:generated  (regenerates and asserts \`git diff\` is empty)
 * Commit:    ${commit}
 * Content:   sha256:${contentHash}
 *
 * TIMESTAMP POLICY: none is emitted, deliberately. A generation timestamp would change this file
 * on every run with no source change, which would make the diff check above worthless. The commit
 * and content hash change only when the input actually changes.
 */

export const ${identifier(target.name)} = ${JSON.stringify(abi, null, 2)} as const;
`;
}

function main(): void {
  // Rebuild from scratch: Foundry keeps artifacts for deleted contracts, and generating from a
  // stale out/ would emit bindings for contracts that no longer exist.
  rmSync(repoPath("out"), { recursive: true, force: true });
  rmSync(repoPath("cache"), { recursive: true, force: true });
  run("forge", ["build"]);

  const commit = run("git", ["rev-parse", "HEAD"]).stdout.trim();
  const srcDir = repoPath("packages/generated/src");
  rmSync(srcDir, { recursive: true, force: true });
  mkdirSync(srcDir, { recursive: true });

  const index: string[] = [];
  const manifest: Record<string, { source: string; abiEntries: number; contentHash: string }> = {};

  for (const target of TARGETS) {
    const artifact = findArtifact(target.name);
    const abi = artifact.abi;
    const contentHash = createHash("sha256").update(JSON.stringify(abi)).digest("hex");
    const fileName = `${target.name}.ts`;

    writeFileSync(`${srcDir}/${fileName}`, render(target, abi, commit, contentHash));
    index.push(`export { ${identifier(target.name)} } from "./${target.name}.js";`);
    manifest[target.name] = {
      source: target.source,
      abiEntries: abi.length,
      contentHash: `sha256:${contentHash}`,
    };
  }

  const indexHeader = `/**
 * GENERATED FILE — do not edit by hand. Run \`pnpm generate\`.
 *
 * ${TARGETS.length} contract ABIs, generated from the pinned Midnight release and Kyrve's own
 * contracts at commit ${commit}.
 *
 * Deliberately NOT generated yet:
${DEFERRED.map((d) => ` *   - ${d.name}: ${d.reason}`).join("\n")}
 */

`;
  writeFileSync(`${srcDir}/index.ts`, indexHeader + index.sort().join("\n") + "\n");

  writeFileSync(
    repoPath("packages/generated/abi-manifest.json"),
    stableStringify({
      $comment:
        "GENERATED by `pnpm generate`. Lists every generated ABI with its source and content hash. " +
        "No timestamp: see the timestamp policy in any generated file.",
      commit,
      contracts: manifest,
      deferred: DEFERRED,
    }),
  );

  console.log(`generated ${TARGETS.length} ABIs at commit ${commit}`);
  for (const [name, entry] of Object.entries(manifest)) {
    console.log(
      `  ${name.padEnd(26)} ${String(entry.abiEntries).padStart(3)} entries  ${entry.contentHash.slice(0, 22)}`,
    );
  }
  console.log(
    `  ${DEFERRED.length} interface groups deferred to Phase 2, recorded in abi-manifest.json`,
  );
}

main();
