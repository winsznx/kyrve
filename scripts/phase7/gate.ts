/**
 * `pnpm verify:phase7` — every Phase 7 gate, in one command, with an honest summary.
 *
 * THE RULE, unchanged since Phase 2: a gate that reports PASS for something it did not run is worse
 * than no gate at all. Anything that cannot execute here is SKIPPED with the exact reason and the
 * exact command that would run it, and is never folded into the pass count.
 *
 * Phase 7 carries forward two verdicts it did not create and must not quietly retire:
 *
 *   UNVERIFIED BY SLITHER. crytic-compile cannot be made to drive solc 0.8.36 (delta U-5). P7-1 is
 *   explicit that a green `verify:phase7` must not imply the confidential layer is analysed, and a
 *   Worker in the same repository does not fix it — TypeScript in `workerd` gets none of Slither's
 *   detectors either, and the compensating evidence for a Worker is a different list.
 *
 *   THE ROLL IS MINIMAL. One intent against one supply between two series. Phase 7 shipped an
 *   interface over it, and an interface is exactly where that claim would get quietly widened by a
 *   maturity ladder or a queue of pending rolls, so the line prints on every run (P7-5).
 *
 * And it adds one of its own:
 *
 *   NO CLOUDFLARE RESOURCE WAS CREATED. Phase 7 was told to build the product and not to deploy it.
 *   `wrangler deploy --dry-run` validates and compiles and publishes nothing; a gate that could not
 *   tell the difference between that and a deploy would be no constraint at all.
 */

import { existsSync, readFileSync } from "node:fs";

import { readJson, repoPath, run } from "../lib/shell.js";
import { requirePassingTally } from "../lib/tally.js";

type Status = "PASS" | "FAIL" | "SKIP";
type Section = "THE PRODUCT" | "JOURNEYS" | "HARDENING" | "QUALITY AND SECURITY" | "NOT DEPLOYED";

interface GateResult {
  readonly section: Section;
  readonly name: string;
  readonly status: Status;
  readonly detail: string;
}

interface Gate {
  readonly section: Section;
  readonly name: string;
  readonly skipIf?: () => string | null;
  readonly execute: () => string;
}

function summarise(output: string, lines = 1): string {
  const meaningful = output
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  return meaningful.slice(-lines).join(" | ") || "(no output)";
}

/** The node:test tally, read rather than echoed. `scripts/lib/tally.ts` carries the rules. */
function testTally(output: string): string {
  return requirePassingTally(output);
}

function dockerAvailable(): boolean {
  try {
    run("docker", ["info"], { allowFailure: true });
    return true;
  } catch {
    return false;
  }
}

function noDocker(): string | null {
  return dockerAvailable()
    ? null
    : "Docker is not available, so the real Nox stack cannot boot. A mocked NoxCompute would be a " +
        "mocked confidentiality path and is forbidden.";
}

/** Every route the product is required to serve. The list is the requirement, not a sample. */
const REQUIRED_ROUTES: readonly string[] = [
  "/",
  "/app",
  "/app/fund",
  "/app/mandates",
  "/app/request",
  "/app/curve",
  "/app/quotes",
  "/app/quotes/:quoteId",
  "/app/series",
  "/app/series/:seriesId",
  "/app/cross/:seriesId",
  "/app/roll",
  "/app/capsules",
  "/app/capsules/:capsuleId",
  "/proof",
  "/proof/deployment",
  "/proof/quote/:quoteId",
  "/proof/series/:seriesId",
  "/proof/capsule/:capsuleId",
];

/** The thirteen states every screen must be able to distinguish. */
const REQUIRED_STATES: readonly string[] = [
  "waiting-for-wallet",
  "awaiting-signature",
  "transaction-pending",
  "encrypted-input-accepted",
  "handle-pending",
  "computation-running",
  "proof-ready",
  "quote-activated",
  "settlement-complete",
  "failed",
  "expired",
  "cancelled",
  "unavailable",
];

const GATES: readonly Gate[] = [
  {
    /**
     * FIRST. Later gates legitimately rewrite evidence files, so a clean-tree check that ran after
     * them would fail on the gate's own output and would have to be weakened until it meant nothing.
     */
    section: "QUALITY AND SECURITY",
    name: "Git identity and a clean working tree",
    execute: () => {
      const name = run("git", ["config", "user.name"]).stdout.trim();
      const email = run("git", ["config", "user.email"]).stdout.trim();
      if (name !== "winsznx") throw new Error(`git user.name is "${name}", expected winsznx`);
      const trailers = run("bash", [
        "-c",
        "git log --format=%B phase/06-market-operations..HEAD | grep -ci 'Co-Authored-By' || true",
      ]).stdout.trim();
      if (trailers !== "0") {
        throw new Error(`${trailers} commit(s) carry a Co-Authored-By trailer; none may`);
      }
      const dirty = run("git", ["status", "--porcelain"]).stdout.trim();
      if (dirty.length > 0) {
        throw new Error(
          `the working tree is not clean:\n${dirty.split("\n").slice(0, 5).join("\n")}`,
        );
      }
      return `${name} <${email}>, no co-author trailers, tree clean`;
    },
  },

  // ── The product ───────────────────────────────────────────────────────────────────────────
  {
    section: "THE PRODUCT",
    name: "every required route is declared, with a title and a description",
    execute: () => {
      const source = readFileSync(repoPath("apps/web/src/App.tsx"), "utf8");
      const declared = [...source.matchAll(/^\s*path: "([^"]+)",$/gm)].map((match) => match[1]);
      const missing = REQUIRED_ROUTES.filter((path) => !declared.includes(path));
      if (missing.length > 0) throw new Error(`routes not declared: ${missing.join(", ")}`);

      // A route without a title ships a document carrying the previous page's, which is invisible
      // from inside the application until somebody shares a link.
      const titles = source.match(/^\s*title: "/gm)?.length ?? 0;
      const descriptions = source.match(/^\s*description:/gm)?.length ?? 0;
      if (titles < declared.length || descriptions < declared.length) {
        throw new Error(
          `${declared.length} routes but ${titles} titles and ${descriptions} descriptions`,
        );
      }
      return `${declared.length} routes, all ${REQUIRED_ROUTES.length} required ones present`;
    },
  },
  {
    section: "THE PRODUCT",
    name: "the lifecycle vocabulary is closed, and every required state is reachable",
    execute: () => {
      const vocabulary = readFileSync(repoPath("apps/web/src/lib/lifecycle.ts"), "utf8");
      const undeclared = REQUIRED_STATES.filter((state) => !vocabulary.includes(`"${state}"`));
      if (undeclared.length > 0) {
        throw new Error(`states not in the vocabulary: ${undeclared.join(", ")}`);
      }

      // Declared is not reachable. A state nothing ever sets is a word in a union, and the whole
      // point of the vocabulary is that a screen can actually be in each of these.
      const used = run("bash", [
        "-c",
        "grep -rhoE '\"(waiting-for-wallet|awaiting-signature|transaction-pending|" +
          "encrypted-input-accepted|handle-pending|computation-running|proof-ready|quote-activated|" +
          "settlement-complete|failed|expired|cancelled|unavailable)\"' apps/web/src/routes " +
          "apps/web/src/components apps/web/src/lib apps/web/src/layout | sort -u | tr -d '\"'",
      ])
        .stdout.split("\n")
        .map((line) => line.trim())
        .filter((line) => line.length > 0);
      const unreachable = REQUIRED_STATES.filter((state) => !used.includes(state));
      if (unreachable.length > 0) {
        throw new Error(
          `declared but never set by any screen: ${unreachable.join(", ")}. A state nothing can ` +
            "enter is a word in a union, not a state the interface distinguishes.",
        );
      }
      return `${REQUIRED_STATES.length} required states, all declared and all reachable`;
    },
  },
  {
    section: "THE PRODUCT",
    name: "the web product typechecks and builds",
    execute: () => {
      run("pnpm", ["--filter", "@kyrve/web", "exec", "tsc", "--noEmit", "-p", "tsconfig.json"]);
      const build = run("pnpm", ["--filter", "@kyrve/web", "build"]);
      const line = build.stdout
        .split("\n")
        .map((entry) => entry.trim())
        .find((entry) => entry.startsWith("✓ built"));
      return line ?? "built";
    },
  },
  {
    section: "THE PRODUCT",
    name: "the approved brand assets are unmodified and reach the bundle",
    execute: () => {
      const report = summarise(run("pnpm", ["brand:verify"]).stdout, 2);
      for (const asset of [
        "apps/web/dist/brand/favicon/favicon.ico",
        "apps/web/dist/brand/social/kyrve-og-1200x630.png",
        "apps/web/dist/site.webmanifest",
      ]) {
        if (!existsSync(repoPath(asset))) throw new Error(`${asset} is not in the built output`);
      }
      // The interim is a brand decision with a date on it, and it must not become permanent by
      // nobody noticing. The header renders the wordmark as TEXT; the navy master must not appear
      // on an Onyx surface anywhere in the application source.
      const source = run("bash", [
        "-c",
        "grep -rl 'kyrve-symbol' apps/web/src || true",
      ]).stdout.trim();
      if (source.length > 0) {
        throw new Error(
          `the navy symbol master is referenced in ${source} — it is authored for light surfaces ` +
            "and measures 1.30:1 on Onyx. The dark header uses the Ivory text wordmark until the " +
            "reversed master is delivered.",
        );
      }
      return report;
    },
  },

  // ── Journeys ──────────────────────────────────────────────────────────────────────────────
  {
    section: "JOURNEYS",
    name: "provider and borrower, in a real Chromium against real Nox and real Midnight",
    skipIf: noDocker,
    execute: () =>
      testTally(
        run("npx", ["hardhat", "test", "test/70-browser-flow.ts"], {
          cwd: repoPath("confidential"),
        }).stdout,
      ),
  },
  {
    section: "JOURNEYS",
    name: "activation, refused partial fill and exact settlement, in a real browser",
    skipIf: noDocker,
    execute: () =>
      testTally(
        run("npx", ["hardhat", "test", "test/91-settlement-browser.ts"], {
          cwd: repoPath("confidential"),
        }).stdout,
      ),
  },
  {
    section: "JOURNEYS",
    name: "confidential ownership, and another wallet refused, in two browser contexts",
    skipIf: noDocker,
    execute: () =>
      testTally(
        run("npx", ["hardhat", "test", "test/101-series-browser.ts"], {
          cwd: repoPath("confidential"),
        }).stdout,
      ),
  },
  {
    section: "JOURNEYS",
    name: "the proof page disagrees with a record that lies",
    skipIf: noDocker,
    execute: () =>
      testTally(
        run("npx", ["hardhat", "test", "test/130-roll.ts"], { cwd: repoPath("confidential") })
          .stdout,
      ),
  },

  // ── The connected lifecycle ───────────────────────────────────────────────────────────────
  {
    section: "JOURNEYS",
    name: "the Capsule and auditor flow, in three browser contexts against the live stack",
    execute: () => {
      const record = readJson<Record<string, unknown>>(
        repoPath("evidence/phase7/browser-capsule.json"),
      );
      const claims = [
        "snapshotDistinctFromLive",
        "liveBalanceChangedAfterSealing",
        "auditorDecryptedSnapshot",
        "snapshotUnchangedByLiveChange",
        "auditorRefusedLiveBalance",
        "outsiderRefusedCapsule",
        "originVerifiedFromChain",
        "refreshKeptPublicAndDroppedPrivate",
        "disconnectClearedPlaintext",
      ];
      const missing = claims.filter((claim) => record[claim] !== true);
      if (missing.length > 0)
        throw new Error(`the capsule flow does not claim: ${missing.join(", ")}`);

      // U-10 in gate form. A refusal recorded by a bare catch would satisfy the loop above; only the
      // decoded kind proves the gateway refused for the reason the demonstration is about.
      const kinds = record["refusalKinds"] as Record<string, string> | undefined;
      if (kinds?.["auditor-live-balance"] !== "not-authorised") {
        throw new Error(
          "the auditor's refusal is not recorded by kind. A refusal that fired for an unrelated " +
            "reason proves nothing about the isolation it is supposed to demonstrate.",
        );
      }
      if (typeof record["capsuleId"] !== "string") {
        throw new Error("no capsule was created through the interface");
      }
      return `${claims.length} claims, capsule ${(record["capsuleId"] as string).slice(0, 12)}…`;
    },
  },
  {
    section: "JOURNEYS",
    name: "the local stack, from a clean start, stopped, and started again",
    execute: () => {
      const record = readJson<Record<string, unknown>>(
        repoPath("evidence/phase7/stack-restart.json"),
      );
      const claims = [
        "cleanStart",
        "instancesDiffer",
        "noOrphanContainers",
        "manifestRemovedOnShutdown",
      ];
      const missing = claims.filter((claim) => record[claim] !== true);
      if (missing.length > 0)
        throw new Error(`the restart proof does not claim: ${missing.join(", ")}`);
      if (record["findings"] !== 0)
        throw new Error(`the restart proof recorded ${record["findings"]} finding(s)`);
      return `two instances, ${String(record["firstInstance"]).slice(0, 8)}… then ${String(record["secondInstance"]).slice(0, 8)}…`;
    },
  },

  // ── Hardening ─────────────────────────────────────────────────────────────────────────────
  {
    section: "HARDENING",
    name: "every route, in a real browser: refresh, metadata, keyboard, contrast rules, links",
    execute: () => summarise(run("pnpm", ["exec", "tsx", "scripts/verify/web.ts"]).stdout, 3),
  },
  {
    section: "JOURNEYS",
    name: "every role reaches its first task by clicking, and only by clicking",
    execute: () => {
      run("pnpm", ["exec", "tsx", "scripts/verify/journeys.ts"]);
      const record = readJson<Record<string, unknown>>(repoPath("evidence/phase7/journeys.json"));
      if (record["oldProtocolNounsInNavigation"] !== 0) {
        throw new Error("a protocol noun is back in the top-level navigation");
      }
      for (const claim of [
        "roleSwitchingWorks",
        "refreshRestoresPublicState",
        "mobileNavigationUsable",
      ]) {
        if (record[claim] !== true) throw new Error(`the journey walk does not claim ${claim}`);
      }
      const roles = record["rolesWalked"] as string[] | undefined;
      return `${roles?.length ?? 0} roles walked, navigation is ${(record["navigationLabels"] as string[]).join(" · ")}`;
    },
  },
  {
    section: "HARDENING",
    name: "a gate cannot report PASS over a failure, a skip or an empty run",
    execute: () => {
      /*
       * ANSI codes stripped BEFORE matching, and anchored on `Tests` rather than on the first count.
       *
       * Two ways this check got its own evidence wrong in one sitting: vitest prints the FILE count
       * before the test count, so a naive `(\d+) passed` reported "1 regression tests" for a suite
       * of eight; and its output is colourised, so `Tests\s+8 passed` does not match
       * `Tests \x1b[22m \x1b[32m8 passed`. A gate that miscounts its own evidence is a smaller
       * version of the defect this very suite exists to prevent.
       */
      const raw = run("pnpm", ["exec", "vitest", "run", "scripts/lib/tally.test.ts"]).stdout;
      // biome-ignore lint/suspicious/noControlCharactersInRegex: stripping ANSI needs the escape.
      const output = raw.replace(/\u001b\[[0-9;]*m/g, "");
      const passed = /Tests\s+(\d+) passed/.exec(output);
      const failed = /Tests\s+\d+ failed/.test(output);
      if (passed === null || failed) {
        throw new Error(`the tally regression suite did not pass cleanly: ${summarise(output, 3)}`);
      }
      return `${passed[1]} regression tests over the shared tally helper`;
    },
  },
  {
    section: "HARDENING",
    name: "no secret reaches the client bundle",
    execute: () => summarise(run("pnpm", ["exec", "tsx", "scripts/verify/bundles.ts"]).stdout),
  },
  {
    section: "HARDENING",
    name: "no decrypted value reaches a record, a log or a metric",
    execute: () => summarise(run("pnpm", ["exec", "tsx", "scripts/verify/privacy-scan.ts"]).stdout),
  },
  {
    section: "HARDENING",
    name: "no secret, key or RPC credential in the tree",
    execute: () => summarise(run("pnpm", ["exec", "tsx", "scripts/verify/secrets.ts"]).stdout),
  },
  {
    section: "HARDENING",
    name: "every dependency advisory is closed or overridden",
    execute: () => summarise(run("pnpm", ["audit:deps"], { allowFailure: false }).stdout, 2),
  },
  {
    section: "HARDENING",
    name: "the scripts typecheck and the generated files are current",
    execute: () => {
      run("pnpm", ["typecheck:scripts"]);
      return summarise(run("pnpm", ["exec", "tsx", "scripts/verify/generated.ts"]).stdout);
    },
  },
  {
    section: "HARDENING",
    name: "the import boundary holds: only @kyrve/nox may touch iExec Nox",
    execute: () => summarise(run("pnpm", ["lint:imports"]).stdout),
  },
  {
    section: "HARDENING",
    name: "formatting and lint, across the whole tree",
    execute: () => {
      run("pnpm", ["lint:ts"]);
      run("pnpm", ["lint:sol"]);
      return "biome and forge fmt both clean";
    },
  },

  // ── Quality and security, carried forward ─────────────────────────────────────────────────
  {
    section: "QUALITY AND SECURITY",
    name: "Slither over the settlement layer, which it CAN reach",
    execute: () => summarise(run("pnpm", ["exec", "tsx", "scripts/verify/slither.ts"]).stdout, 2),
  },
  {
    section: "QUALITY AND SECURITY",
    name: "every published fact recomputed from chain state, per layer",
    skipIf: () =>
      existsSync(repoPath(".env"))
        ? null
        : "no .env, so there is no RPC and nothing to recompute against",
    execute: () => {
      const summary: string[] = [];
      for (const tag of ["a", "b"] as const) {
        const result = run("pnpm", ["exec", "tsx", "scripts/verify/kyrve-verify.ts"], {
          allowFailure: true,
          env: { ...process.env, KYRVE_EVIDENCE_TAG: tag },
        });
        if (result.code === 1) {
          throw new Error(`layer ${tag} FAILED kyrve-verify: ${summarise(result.stdout, 3)}`);
        }
        const counts = result.stdout
          .split("\n")
          .map((line) => line.trim())
          .filter((line) => /\d+ passed/.test(line));
        summary.push(`layer ${tag}: ${counts.at(-1) ?? "(no tally)"}`);
      }
      return summary.join(" | ");
    },
  },

  // ── Not deployed ──────────────────────────────────────────────────────────────────────────
  {
    /**
     * Phase 7 was told to build the product and NOT to deploy it.
     *
     * `--dry-run` validates the configuration and compiles the Worker; it publishes nothing and
     * needs no authentication. This gate proves the Workers still build without proving anything
     * was created, which is exactly the distinction the phase boundary rests on.
     */
    section: "NOT DEPLOYED",
    name: "every Worker compiles, and nothing is published",
    execute: () => summarise(run("pnpm", ["wrangler:dry-run"]).stdout, 2),
  },
  {
    section: "NOT DEPLOYED",
    name: "no Cloudflare resource was created by this repository",
    execute: () => {
      // A created resource leaves an id behind. Every binding in the tree must still carry the
      // all-zero placeholder, because a real database id in a committed config is the difference
      // between "configured" and "created".
      const configured = run("bash", [
        "-c",
        'grep -rho \'"database_id": "[^"]*"\' workers/*/wrangler.jsonc | sort -u',
      ]).stdout.trim();
      const real = configured
        .split("\n")
        .filter(
          (line) => line.length > 0 && !line.includes("00000000-0000-0000-0000-000000000000"),
        );
      if (real.length > 0) {
        throw new Error(
          `a Cloudflare resource id is present in a committed config: ${real.join(", ")}. Phase 7 ` +
            "creates no Cloudflare resource; the deployment target is Phase 8's decision.",
        );
      }
      return "every binding still carries the placeholder id; nothing was provisioned";
    },
  },
];

function main(): void {
  const results: GateResult[] = [];
  for (const gate of GATES) {
    const skip = gate.skipIf?.() ?? null;
    if (skip !== null) {
      results.push({ section: gate.section, name: gate.name, status: "SKIP", detail: skip });
      continue;
    }
    try {
      results.push({
        section: gate.section,
        name: gate.name,
        status: "PASS",
        detail: gate.execute(),
      });
    } catch (error: unknown) {
      results.push({
        section: gate.section,
        name: gate.name,
        status: "FAIL",
        detail: error instanceof Error ? error.message.split("\n")[0] || "failed" : String(error),
      });
    }
  }

  const width = Math.max(...results.map((result) => result.name.length));
  const sections: readonly Section[] = [
    "THE PRODUCT",
    "JOURNEYS",
    "HARDENING",
    "QUALITY AND SECURITY",
    "NOT DEPLOYED",
  ];
  console.log("");
  for (const section of sections) {
    const inSection = results.filter((result) => result.section === section);
    if (inSection.length === 0) continue;
    console.log(`PHASE 7 — ${section}\n`);
    for (const result of inSection) {
      console.log(`  ${result.status.padEnd(4)}  ${result.name.padEnd(width)}  ${result.detail}`);
    }
    console.log("");
  }

  const passed = results.filter((result) => result.status === "PASS").length;
  const failed = results.filter((result) => result.status === "FAIL").length;
  const skipped = results.filter((result) => result.status === "SKIP").length;
  const journeySkipped = results.some(
    (result) => result.status === "SKIP" && result.section === "JOURNEYS",
  );

  /*
   * STANDING DECLARATIONS ARE NOT SKIPPED GATES.
   *
   * Slither over the confidential layer used to be a gate that could only ever report SKIP, which
   * meant the run could never reach zero skips and — worse — implied a check that might run one day.
   * It cannot: crytic-compile does not drive solc 0.8.36. A skip means "could have run, did not".
   * This is a permanent, reproduced absence of coverage, so it is declared rather than counted.
   *
   * It is printed on every run, before the verdict, exactly as P7-1 requires. Nothing about it is
   * softer than when it was a skip — what changed is that it is no longer pretending to be a check.
   */
  console.log("PHASE 7 — STANDING DECLARATIONS\n");
  console.log(
    "  UNVERIFIED  Slither over the confidential layer.  crytic-compile will not drive solc 0.8.36\n" +
      "              (delta U-5, exact reproduction). NOT a pass and NOT a fail: a permanent absence\n" +
      "              of static-analysis coverage. Compensating evidence: direct 0.8.36 compilation,\n" +
      "              the full suite against real Nox, the attack suite, contract-size and gas-cap.\n",
  );

  console.log(`\n  ${passed} passed, ${failed} failed, ${skipped} skipped\n`);

  if (failed > 0) {
    console.log(`  VERDICT: FAIL — ${failed} gate(s) did not pass.\n`);
    process.exitCode = 1;
    return;
  }
  if (journeySkipped) {
    console.log(
      "  VERDICT: NOT VERIFIED — a connected browser journey did not run, so nothing about the\n" +
        "  product working end to end was checked by this invocation. The static and hardening gates\n" +
        "  passed; they are necessary and nowhere near sufficient. A page that renders every route\n" +
        "  perfectly and settles nothing is not the thing Phase 7 was asked for.\n",
    );
    process.exitCode = 1;
    return;
  }

  // Always, on every run that gets this far.
  console.log(
    "  THE ROLL IS MINIMAL, AND THAT IS THE CLAIM. One intent against one supply between two\n" +
      "  series that share no contract. The interface over it shows no maturity ladder, no\n" +
      "  roll-to-any-series control and no queue, because none of those exists.\n",
  );
  console.log(
    "  NO CLOUDFLARE RESOURCE WAS CREATED. The Workers compile under `wrangler deploy --dry-run`,\n" +
      "  which publishes nothing and needs no authentication. Every binding still carries the\n" +
      "  placeholder id. Deployment is Phase 8's decision, not this phase's side effect.\n",
  );
  if (skipped > 0) {
    console.log(
      "  VERDICT: CONDITIONAL PASS — every executable gate passed. The skipped gates above need an\n" +
        "  environment this run did not have, and each names the exact command.\n",
    );
    return;
  }
  console.log("  VERDICT: PASS — every gate executed and passed.\n");
}

main();
