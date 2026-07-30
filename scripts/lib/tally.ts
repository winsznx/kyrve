/**
 * Reading a test run's tally, once, for every gate.
 *
 * ════════════════════════════════════════════════════════════════════════════════════════════
 * THE DEFECT THIS MODULE EXISTS TO REMOVE
 * ════════════════════════════════════════════════════════════════════════════════════════════
 *
 * Both the Phase 6 and Phase 7 gates carried a private copy of a function that extracted the
 * node:test tally and RETURNED IT AS A DISPLAY STRING. The gate then reported PASS with that string
 * beside it, so a run printing `8 passing, 1 failing` was recorded as a passing gate with its own
 * failure visible in its own output.
 *
 * That is the exact defect every gate in this repository exists to prevent, sitting inside the
 * gates. It was found by reading the first real Phase 7 run — not by a test, because there was no
 * test: the helper was two private copies of eleven lines that nothing imported and nothing checked.
 *
 * ════════════════════════════════════════════════════════════════════════════════════════════
 * FIVE RULES, EACH WITH A REGRESSION TEST
 * ════════════════════════════════════════════════════════════════════════════════════════════
 *
 *   1. a run with any failures is a FAILURE, whatever else it printed
 *   2. a skipped test is not a passed test
 *   3. an unavailable check is not a passed check
 *   4. a run that executed nothing cannot pass — "0 passing" is not success
 *   5. the display text cannot determine the outcome. The outcome is derived from parsed COUNTS,
 *      and the string is produced from the same parse rather than being the thing that was parsed
 *
 * Rule 5 is the one that matters structurally. `readTally` returns numbers; `describeTally` renders
 * them. A caller cannot reach the summary without going through the counts, so there is no path on
 * which a gate decides an outcome by looking at prose.
 *
 * `scripts/lib/tally.test.ts` proves all five, including the historical `8 passing, 1 failing` case
 * verbatim.
 */

export interface Tally {
  readonly passing: number;
  readonly failing: number;
  readonly skipped: number;
  /** Present when the runner reported one; some runners do not. */
  readonly todo: number;
}

export class TallyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TallyError";
  }
}

/**
 * Parses a node:test run's counts out of its output.
 *
 * Throws when there is no tally at all. A run that printed no counts either crashed before the
 * runner started or is not a test run — and both are worse than a failing test, because a gate that
 * treated "no output" as "nothing failed" would pass on a command that never executed.
 */
export function readTally(output: string): Tally {
  const lines = output.split("\n").map((line) => line.trim());
  const count = (label: string): number | undefined => {
    for (const line of lines) {
      const match = new RegExp(`^(\\d+) ${label}\\b`).exec(line);
      if (match?.[1] !== undefined) return Number(match[1]);
    }
    return undefined;
  };

  const passing = count("passing");
  const failing = count("failing");
  const skipped = count("skipped");
  const todo = count("todo");

  if (passing === undefined && failing === undefined) {
    throw new TallyError(
      "the test run printed no pass/fail tally. It either crashed before the runner started or is " +
        "not a test run; either way nothing was executed, and a gate must not read that as success.",
    );
  }

  return {
    passing: passing ?? 0,
    failing: failing ?? 0,
    skipped: skipped ?? 0,
    todo: todo ?? 0,
  };
}

/** The human summary, rendered FROM the counts. Never the thing an outcome is derived from. */
export function describeTally(tally: Tally): string {
  const parts = [`${tally.passing} passing`];
  if (tally.failing > 0) parts.push(`${tally.failing} failing`);
  if (tally.skipped > 0) parts.push(`${tally.skipped} skipped`);
  if (tally.todo > 0) parts.push(`${tally.todo} todo`);
  return parts.join(", ");
}

export interface TallyPolicy {
  /**
   * Whether a skipped test is tolerated.
   *
   * Defaults to false. A skipped test is a test that did not run, and a gate reporting PASS over one
   * is asserting something nobody measured — the same category error as reporting PASS over an
   * unavailable check. A suite with a deliberate skip has to say so at the call site.
   */
  readonly allowSkipped?: boolean;
}

/**
 * The tally, or a thrown failure. This is what a gate calls.
 *
 * Returns the display string on success so the gate has something to print, and throws on every
 * outcome that is not unambiguously "everything ran and everything passed". The throw is what makes
 * the gate record FAIL, because a gate's `execute` reports PASS exactly when it returns.
 */
export function requirePassingTally(output: string, policy: TallyPolicy = {}): string {
  const tally = readTally(output);

  if (tally.failing > 0) {
    throw new TallyError(`${tally.failing} test(s) failed — ${describeTally(tally)}`);
  }
  if (tally.skipped > 0 && policy.allowSkipped !== true) {
    throw new TallyError(
      `${tally.skipped} test(s) were skipped — ${describeTally(tally)}. A skipped test did not run, ` +
        "and a gate reporting PASS over one asserts something nobody measured.",
    );
  }
  if (tally.passing === 0) {
    throw new TallyError(
      `the run executed no tests — ${describeTally(tally)}. Zero executed tests cannot pass: an ` +
        "empty run and a successful run are opposite conditions.",
    );
  }

  return describeTally(tally);
}
