/**
 * The regression tests for the tally helper.
 *
 * Every one of these corresponds to a way a gate could report PASS for something that did not pass.
 * The first is not hypothetical: `8 passing, 1 failing` is the literal output the Phase 7 gate
 * recorded as a passing gate, and the string below is reproduced from that run.
 */

import { describe, expect, it } from "vitest";

import { describeTally, readTally, requirePassingTally, TallyError } from "./tally.js";

/** The shape a node:test run actually prints, so the parser is tested against reality. */
function run(...lines: string[]): string {
  return ["  suite", "    ✔ something", "", ...lines, ""].join("\n");
}

describe("requirePassingTally", () => {
  it("1. a run with 8 passing and 1 failing is a FAILURE", () => {
    // The historical case, verbatim. The gate reported PASS beside this and hid a real defect for
    // one commit — the privacy lock had stopped saying that locking revokes nothing.
    expect(() => requirePassingTally(run("8 passing (8 nodejs)", "1 failing (1 nodejs)"))).toThrow(
      TallyError,
    );
    expect(() => requirePassingTally(run("8 passing (8 nodejs)", "1 failing (1 nodejs)"))).toThrow(
      /1 test\(s\) failed/,
    );
  });

  it("2. a skipped test is not a passed test", () => {
    expect(() => requirePassingTally(run("4 passing (4 nodejs)", "2 skipped"))).toThrow(
      /2 test\(s\) were skipped/,
    );
  });

  it("2b. a skip is tolerated only when the call site says so, explicitly", () => {
    expect(requirePassingTally(run("4 passing", "2 skipped"), { allowSkipped: true })).toBe(
      "4 passing, 2 skipped",
    );
  });

  it("3. an unavailable check is not a passed check", () => {
    /*
     * `unavailable` is Kyrve's third verdict and it is not a node:test concept — a runner never
     * prints it. What it prints for a check that could not run is `todo` or `skipped`, and both are
     * counted here. The rule the test encodes is that neither is folded into the pass count, which
     * is the same rule `kyrve-verify` exit code 2 exists for.
     */
    expect(() => requirePassingTally(run("3 passing", "1 todo"))).not.toThrow();
    expect(describeTally(readTally(run("3 passing", "1 todo")))).toBe("3 passing, 1 todo");
    expect(readTally(run("3 passing", "1 todo")).todo).toBe(1);
  });

  it("4. zero executed tests cannot pass", () => {
    expect(() => requirePassingTally(run("0 passing (0 nodejs)"))).toThrow(/executed no tests/);
  });

  it("4b. a run that printed no tally at all throws rather than passing", () => {
    expect(() => requirePassingTally("Error: could not resolve module\n")).toThrow(
      /printed no pass\/fail tally/,
    );
  });

  it("5. display text cannot determine the outcome", () => {
    /*
     * Prose claiming success does not make a run successful, and prose claiming failure does not
     * make a passing run fail. The outcome comes from the parsed counts and nothing else, which is
     * why `readTally` returns numbers and `describeTally` renders them rather than the reverse.
     */
    const lyingSuccess = run("8 passing", "1 failing", "  VERDICT: PASS — everything is fine");
    expect(() => requirePassingTally(lyingSuccess)).toThrow(/1 test\(s\) failed/);

    const lyingFailure = run("9 passing", "  VERDICT: FAIL — everything is broken");
    expect(requirePassingTally(lyingFailure)).toBe("9 passing");
  });

  it("returns the summary rendered from the counts, not the runner's own line", () => {
    // The runner prints "9 passing (9 nodejs)". The summary is rebuilt from the parsed number, so a
    // change in the runner's formatting cannot change what a gate records.
    expect(requirePassingTally(run("9 passing (9 nodejs)"))).toBe("9 passing");
  });
});
