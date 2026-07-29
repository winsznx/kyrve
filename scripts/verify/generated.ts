/**
 * Regenerates every generated artifact and asserts the working tree is unchanged.
 *
 * This is the check that makes "generated" mean something. Without it, a binding can drift from
 * the contract it claims to describe and nothing notices until a call reverts on chain.
 *
 * It also proves the generator is deterministic: if any generated file carried a timestamp or an
 * unsorted map, this would fail on the second run.
 */

import { run } from "../lib/shell.js";

const GENERATED_PATHS = [
  "packages/generated/src",
  "packages/generated/abi-manifest.json",
  "deployments/rate-grids.json",
  "docs/phase1/RATE-GRIDS.md",
  "packages/quote-math/test/fixtures",
  "packages/midnight/test/fixtures",
];

function diff(): string {
  return run("git", ["diff", "--stat", "--", ...GENERATED_PATHS], {
    allowFailure: true,
  }).stdout.trim();
}

function untracked(): string {
  return run("git", ["ls-files", "--others", "--exclude-standard", "--", ...GENERATED_PATHS], {
    allowFailure: true,
  }).stdout.trim();
}

function main(): void {
  const before = diff();
  if (before.length > 0) {
    console.error(
      "verify:generated FAILED — generated files were already modified before regeneration.\n" +
        "Commit or discard them first, so this check measures the generator rather than the worktree:\n" +
        before,
    );
    process.exitCode = 1;
    return;
  }

  console.log("regenerating ABIs...");
  run("pnpm", ["exec", "tsx", "scripts/generate/abis.ts"]);
  console.log("regenerating rate grids...");
  run("pnpm", ["exec", "tsx", "scripts/generate/rate-grids.ts"]);
  console.log("regenerating quote-math and market fixtures...");
  run("forge", ["script", "contracts/script/ExportQuoteMathFixtures.s.sol"]);
  run("forge", ["script", "contracts/script/ExportMarketFixtures.s.sol"]);
  run("forge", ["script", "contracts/script/ExportTakeFixtures.s.sol"]);

  const after = diff();
  const extra = untracked();

  if (after.length > 0 || extra.length > 0) {
    console.error("\nverify:generated FAILED — regeneration changed committed output.\n");
    if (after.length > 0) console.error(`  modified:\n${after}\n`);
    if (extra.length > 0) console.error(`  untracked:\n${extra}\n`);
    console.error(
      "  Either a source change was not regenerated, or the generator is not deterministic.\n" +
        "  Run `pnpm generate` and commit the result.",
    );
    process.exitCode = 1;
    return;
  }

  console.log(
    `\nverify:generated PASS — ${GENERATED_PATHS.length} generated paths byte-identical after regeneration`,
  );
}

main();
