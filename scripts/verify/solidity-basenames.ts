/**
 * No two compiled Solidity sources may share a file basename.
 *
 * ════════════════════════════════════════════════════════════════════════════════════════════
 * BECAUSE FOUNDRY DROPS ONE OF THEM, SILENTLY, ON A SUCCESSFUL BUILD
 * ════════════════════════════════════════════════════════════════════════════════════════════
 *
 * Foundry writes artifacts to `out/<source-file-basename>/<ContractName>.json`. The directory is
 * keyed on the BASENAME, not on the path — so `contracts/a/Foo.sol` and `contracts/b/Foo.sol` both
 * target `out/Foo.sol/`, and two contracts with the same name inside them target the same JSON file.
 *
 * Proven, not assumed. Phase 4 added a probe contract at `contracts/kyrve/KyrveQuoteRatifier.sol`
 * alongside Phase 1's `contracts/integration/KyrveQuoteRatifier.sol`, ran `forge build --force`, and
 * got:
 *
 *     Compiling 50 files with Solc 0.8.34
 *     Compiler run successful!
 *
 * with the probe's artifact simply absent and the Phase 1 artifact still in its place. No warning, no
 * error, exit code 0. Everything downstream — `verify:contract-size`, `verify:deployed-bytecode`,
 * the ABI generator, every deployment script — then reads an artifact for a contract that is not the
 * one it names.
 *
 * That is the worst shape of failure this repository has: a check that reports success about
 * something it never looked at. So the collision is refused BEFORE compilation rather than diagnosed
 * afterwards.
 *
 * ════════════════════════════════════════════════════════════════════════════════════════════
 * WHY THE PHASE 1 RATIFIER KEEPS ITS NAME
 * ════════════════════════════════════════════════════════════════════════════════════════════
 *
 * `contracts/integration/KyrveQuoteRatifier.sol` is deployed on Ethereum Sepolia and its runtime
 * hash is pinned in `deployments/midnight-bytecode-lock.json`. Renaming or replacing it would make
 * the repository stop describing what is actually on chain. So the production settlement ratifier is
 * `KyrveSettlementRatifier` — a more precise name anyway — and this check is what stops the
 * collision being reintroduced by someone who reads the brief and not the history.
 */

import { readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

import { repoPath } from "../lib/shell.js";

/**
 * The trees Foundry compiles, from `foundry.toml`: `src`, `test` and `script` all resolve under
 * `contracts`, and `libs` brings in the vendored Midnight submodule.
 *
 * `vendor/` is included deliberately. A Kyrve file colliding with a vendored Midnight file is the
 * same failure and is easier to introduce, because nobody browses the submodule.
 */
const COMPILED_ROOTS = ["contracts", "vendor/midnight/src", "vendor/midnight/lib/forge-std/src"];

/**
 * The one collision that exists and is triaged, by its exact pair of paths.
 *
 * `IERC20.sol` appears in the pinned Midnight submodule and again in forge-std, which Midnight
 * vendors. Kyrve cannot rename either — both are pinned upstream sources, and `vendor/` is never
 * edited — and neither needs to be renamed:
 *
 *   - both are INTERFACES. They compile to no runtime code, so no deployable artifact is shadowed
 *     and `verify:contract-size`, `verify:deployed-bytecode` and the ABI generator have nothing to
 *     read from either;
 *   - nothing in Kyrve reads `out/IERC20.sol/` by name. `KyrveSeriesVault` declares its own
 *     `IERC20Funding` precisely because Midnight's `IERC20` omits `approve`.
 *
 * Listed as an exact path pair rather than as a basename pattern: a THIRD `IERC20.sol`, or a Kyrve
 * file colliding with either of these, still fails. This is a triaged finding, not a suppression.
 */
const TRIAGED: readonly { readonly basename: string; readonly paths: readonly string[] }[] = [
  {
    basename: "IERC20.sol",
    paths: [
      "vendor/midnight/src/interfaces/IERC20.sol",
      "vendor/midnight/lib/forge-std/src/interfaces/IERC20.sol",
    ],
  },
];

function triagedFor(basename: string, paths: readonly string[]): boolean {
  const entry = TRIAGED.find((candidate) => candidate.basename === basename);
  if (entry === undefined) return false;
  if (entry.paths.length !== paths.length) return false;
  const sorted = [...paths].sort();
  const expected = [...entry.paths].sort();
  return sorted.every((path, index) => path === expected[index]);
}

interface Source {
  readonly basename: string;
  readonly path: string;
}

function collect(root: string, into: Source[]): void {
  let entries: string[];
  try {
    entries = readdirSync(root);
  } catch {
    return; // A root that does not exist is not a collision.
  }
  for (const entry of entries) {
    const path = join(root, entry);
    if (statSync(path).isDirectory()) {
      collect(path, into);
      continue;
    }
    if (!entry.endsWith(".sol")) continue;
    into.push({ basename: entry, path: relative(repoPath("."), path) });
  }
}

function main(): void {
  const sources: Source[] = [];
  for (const root of COMPILED_ROOTS) collect(repoPath(root), sources);

  if (sources.length === 0) {
    throw new Error(
      "no Solidity sources found under " +
        `${COMPILED_ROOTS.join(", ")}. Reporting PASS over an empty set would be exactly the ` +
        "silent-success failure this check exists to prevent.",
    );
  }

  const byBasename = new Map<string, string[]>();
  for (const source of sources) {
    const paths = byBasename.get(source.basename) ?? [];
    paths.push(source.path);
    byBasename.set(source.basename, paths);
  }

  const shared = [...byBasename.entries()]
    .filter(([, paths]) => paths.length > 1)
    .sort((a, b) => a[0].localeCompare(b[0]));

  const collisions = shared.filter(([basename, paths]) => !triagedFor(basename, paths));
  const triaged = shared.filter(([basename, paths]) => triagedFor(basename, paths));

  console.log(
    `solidity-basenames — ${sources.length} compiled sources across ${COMPILED_ROOTS.length} roots\n`,
  );

  for (const [basename, paths] of triaged) {
    console.log(`  triaged  ${basename}  (${paths.length} vendored interfaces, no runtime code)`);
    for (const path of paths) console.log(`             ${path}`);
  }
  if (triaged.length > 0) console.log("");

  if (collisions.length > 0) {
    console.error(
      `solidity-basenames FAIL — ${collisions.length} basename(s) are shared, and Foundry will ` +
        "silently keep only one artifact per name:\n",
    );
    for (const [basename, paths] of collisions) {
      console.error(`  ${basename}`);
      for (const path of paths) console.error(`    ${path}`);
    }
    console.error(
      "\n  Rename one of them. The artifact directory is keyed on the basename, so no build flag,\n" +
        "  remapping or profile setting changes this — and the build will report success either way.\n" +
        "  Do NOT rename contracts/integration/KyrveQuoteRatifier.sol: it is deployed on Sepolia\n" +
        "  and its runtime hash is pinned in deployments/midnight-bytecode-lock.json.\n",
    );
    process.exitCode = 1;
    return;
  }

  console.log(
    "solidity-basenames PASS — every compiled source has a unique basename, except " +
      `${triaged.length} triaged vendored pair(s) listed above with the reason`,
  );
}

main();
