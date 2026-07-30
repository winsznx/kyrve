/**
 * `pnpm demo:phase7` — the connected lifecycle, and an honest coverage matrix over it.
 *
 * ════════════════════════════════════════════════════════════════════════════════════════════
 * A ROUTE EXISTING IS NOT A DEMONSTRATED USER ACTION
 * ════════════════════════════════════════════════════════════════════════════════════════════
 *
 * Every step below is marked covered only by an assertion that a wallet did something through the
 * product and the protocol answered. Nothing is marked covered because a page renders, and nothing
 * is marked covered because a contract has a function.
 *
 * The matrix is printed on every run and the command exits non-zero if any required step is not
 * covered, so a step that quietly stops being exercised fails the command rather than disappearing
 * from a list nobody re-reads.
 *
 * ════════════════════════════════════════════════════════════════════════════════════════════
 * WHERE EACH STEP RUNS, AND WHY IT IS NOT ALL IN ONE PLACE
 * ════════════════════════════════════════════════════════════════════════════════════════════
 *
 * The Capsule and auditor steps run against the LIVE `stack:local` instance, in three browser
 * contexts, because that is what this phase was missing and because they need a stack that outlives
 * one test process.
 *
 * The other browser steps are the four suites that already prove them, and they bring their own
 * stack — the Nox plugin's `test` override starts and stops one per run, which is exactly what makes
 * them reproducible. Running them here against a live stack would mean either two chains fighting
 * over port 8545 or rewriting four passing suites to take an injected stack.
 *
 * So this command REFUSES to run the suites while a stack is up, and says why. That is the honest
 * shape of the constraint rather than a claim that everything shares one process.
 */

import { existsSync, mkdirSync, writeFileSync } from "node:fs";

import { repoPath, run } from "../lib/shell.js";
import { readLiveManifest } from "../stack/manifest.js";
import { type CapsuleEvidence, runCapsuleFlow } from "./capsule.js";

type Where = "live-stack" | "suite";

interface Step {
  readonly n: number;
  readonly what: string;
  readonly where: Where;
  /** The suite that proves it, when it is not the live-stack flow. */
  readonly suite?: string;
  /** Reads the evidence and says whether the step is genuinely covered. */
  readonly covered: (state: State) => boolean;
}

interface State {
  readonly capsule: CapsuleEvidence | undefined;
  readonly suites: ReadonlySet<string>;
}

/** Read back after a suite runs, so "covered" comes from the suite's own recorded evidence. */
function evidenceSays(file: string, keys: readonly string[]): boolean {
  const path = repoPath(`evidence/${file}`);
  if (!existsSync(path)) return false;
  try {
    const record = JSON.parse(run("cat", [path]).stdout) as Record<string, unknown>;
    return keys.every((key) => record[key] === true);
  } catch {
    return false;
  }
}

const STEPS: readonly Step[] = [
  {
    n: 1,
    what: "provider funds a confidential balance",
    where: "suite",
    suite: "70-browser-flow.ts",
    covered: (state) => state.suites.has("70-browser-flow.ts"),
  },
  {
    n: 2,
    what: "provider submits an encrypted mandate",
    where: "suite",
    suite: "70-browser-flow.ts",
    covered: (state) => state.suites.has("70-browser-flow.ts"),
  },
  {
    n: 3,
    what: "borrower submits an encrypted request",
    where: "suite",
    suite: "70-browser-flow.ts",
    covered: (state) => state.suites.has("70-browser-flow.ts"),
  },
  {
    n: 4,
    what: "the curve epoch completes",
    where: "suite",
    suite: "91-settlement-browser.ts",
    covered: (state) => state.suites.has("91-settlement-browser.ts"),
  },
  {
    n: 5,
    what: "one public quote appears",
    where: "suite",
    suite: "91-settlement-browser.ts",
    covered: (state) => state.suites.has("91-settlement-browser.ts"),
  },
  {
    n: 6,
    what: "a partial fill is refused",
    where: "suite",
    suite: "91-settlement-browser.ts",
    covered: (state) => state.suites.has("91-settlement-browser.ts"),
  },
  {
    n: 7,
    what: "exact settlement succeeds",
    where: "suite",
    suite: "91-settlement-browser.ts",
    covered: (state) => state.suites.has("91-settlement-browser.ts"),
  },
  {
    n: 8,
    what: "provider receives confidential series ownership",
    where: "suite",
    suite: "101-series-browser.ts",
    covered: () => evidenceSays("phase5/browser-ownership.json", ["decryptedInBrowser"]),
  },
  {
    n: 9,
    what: "provider creates a Capsule, through the interface",
    where: "live-stack",
    covered: (state) => state.capsule?.capsuleId !== undefined,
  },
  {
    n: 10,
    what: "the auditor decrypts the frozen snapshot, and only that",
    where: "live-stack",
    covered: (state) =>
      state.capsule?.auditorDecryptedSnapshot === true &&
      state.capsule.auditorRefusedLiveBalance === true &&
      state.capsule.snapshotUnchangedByLiveChange === true,
  },
  {
    n: 11,
    what: "a Cross match completes",
    where: "suite",
    suite: "120-cross.ts",
    covered: (state) => state.suites.has("120-cross.ts"),
  },
  {
    n: 12,
    what: "a Roll completes between two series",
    where: "suite",
    suite: "130-roll.ts",
    covered: (state) => state.suites.has("130-roll.ts"),
  },
  {
    n: 13,
    what: "the proof pages verify the lifecycle, and disagree with a record that lies",
    where: "suite",
    suite: "130-roll.ts",
    covered: (state) => state.suites.has("130-roll.ts"),
  },
  {
    n: 14,
    what: "another wallet cannot decrypt private values",
    where: "live-stack",
    covered: (state) =>
      state.capsule?.auditorRefusedLiveBalance === true &&
      state.capsule.outsiderRefusedCapsule === true,
  },
  {
    n: 15,
    what: "refreshing restores public state without restoring private state",
    where: "live-stack",
    covered: (state) =>
      state.capsule?.refreshKeptPublicAndDroppedPrivate === true &&
      state.capsule.disconnectClearedPlaintext === true,
  },
];

const SUITES = [
  "70-browser-flow.ts",
  "91-settlement-browser.ts",
  "101-series-browser.ts",
  "120-cross.ts",
  "130-roll.ts",
] as const;

async function main(): Promise<void> {
  const live = await readLiveManifest();
  const onlySuites = process.argv.includes("--suites");
  const onlyCapsule = process.argv.includes("--capsule");

  let capsule: CapsuleEvidence | undefined;
  const suites = new Set<string>();

  if (!onlySuites) {
    if (!live.live) {
      throw new Error(
        `the Capsule and auditor flow needs a running local stack: ${live.reason}\n` +
          "  Start one with `pnpm stack:local`, then run this again.",
      );
    }
    console.log(
      `\n  running the Capsule and auditor flow against instance ${live.manifest.instanceId}\n`,
    );
    capsule = await runCapsuleFlow();

    mkdirSync(repoPath("evidence/phase7"), { recursive: true });
    writeFileSync(
      repoPath("evidence/phase7/browser-capsule.json"),
      `${JSON.stringify(
        {
          $comment:
            "The connected Capsule and auditor flow, measured in a real Chromium against the real " +
            "Nox stack and real unmodified Midnight, in three browser contexts with three separate " +
            "signing identities. NO AMOUNT APPEARS HERE, for the same reason none appears in the " +
            "served record: every value was decrypted in a browser by the wallet that held a grant.",
          chainId: live.manifest.chainId,
          stackInstance: live.manifest.instanceId,
          ...capsule,
        },
        null,
        2,
      )}\n`,
    );
  }

  if (!onlyCapsule) {
    if (live.live) {
      throw new Error(
        "a local stack is running, and the four browser suites each start their own chain on port " +
          "8545. Two chains cannot share it.\n" +
          "  Run `pnpm stack:local:stop` first, then `pnpm demo:phase7 --suites`.\n" +
          "  This is a real constraint rather than an oversight: the suites are reproducible " +
          "precisely because each one owns its stack for the length of its run.",
      );
    }
    for (const suite of SUITES) {
      console.log(`\n  running ${suite}\n`);
      run("npx", ["hardhat", "test", `test/${suite}`], { cwd: repoPath("confidential") });
      suites.add(suite);
    }
  }

  report({ capsule, suites }, { onlySuites, onlyCapsule });
}

function report(state: State, mode: { onlySuites: boolean; onlyCapsule: boolean }): void {
  console.log("\n  PHASE 7 — THE CONNECTED LIFECYCLE\n");
  const width = Math.max(...STEPS.map((step) => step.what.length));

  /*
   * NOT REACHED IS NOT COVERED, and this counter is where that could have gone wrong.
   *
   * The first version of this reporter excluded not-reached steps from the missing count, so a
   * `--capsule` run printed COMPLETE with seven steps never executed. That is the same defect as a
   * gate reporting PASS beside a skipped check, in the command whose entire job is to say whether
   * the lifecycle was demonstrated. Both are counted now, and a partial run can only ever report
   * INCOMPLETE.
   */
  let missing = 0;
  let notReached = 0;
  for (const step of STEPS) {
    const covered = step.covered(state);
    const reached = step.where === "live-stack" ? !mode.onlySuites : !mode.onlyCapsule || covered;
    if (!covered) {
      missing += 1;
      if (!reached) notReached += 1;
    }
    const mark = covered ? "yes " : reached ? "NO  " : "n/r ";
    const where = step.where === "live-stack" ? "live stack" : (step.suite ?? "suite");
    console.log(`  ${mark} ${String(step.n).padStart(2)}. ${step.what.padEnd(width)}  ${where}`);
  }

  console.log("");
  if (notReached > 0) {
    console.log(
      `  ${notReached} step(s) were NOT REACHED by this invocation. Not reached is not covered.\n` +
        "  A full demonstration is `pnpm demo:phase7 --capsule` against a live stack, then\n" +
        "  `pnpm stack:local:stop` and `pnpm demo:phase7 --suites`. `pnpm verify:phase7` runs both\n" +
        "  and reads the evidence each leaves, which is how the two halves add up to one claim.\n",
    );
  }

  if (missing > 0) {
    console.log(
      `  VERDICT: INCOMPLETE — ${missing} required step(s) were not demonstrated ` +
        `(${notReached} not reached, ${missing - notReached} reached and failed).\n`,
    );
    process.exitCode = 1;
    return;
  }
  console.log(
    "  VERDICT: COMPLETE — every required step was demonstrated by a real user action.\n",
  );
}

await main();
