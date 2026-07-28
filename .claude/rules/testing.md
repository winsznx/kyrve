---
description: What counts as evidence; test layers and gates
globs: ["contracts/**", "test/**", "**/*.t.sol", "**/*.test.ts", "**/*.spec.ts"]
---

# Testing

## What counts as evidence

A claim is proven by **executable output**, not by reasoning. Documentation, plausible argument and
"this should work" are insufficient. Every proof states: the claim, the source, the executable
check, the failure test, the measured result, and the residual risk.

**A test that cannot fail proves nothing.** Every defensive claim needs a paired negative test that
demonstrably fails without the defence. When asserting a revert, confirm you asserted the *right*
revert — a test passing for the wrong reason is worse than no test.

`vm.expectRevert` binds to the next **external** call. Route internal helpers through a public
wrapper or the assertion silently attaches to the wrong call.

## Layers

- **unit** — Kyrve logic, every branch and state transition.
- **integration** — against **real, unmodified** Midnight. Never mock the protocol path.
- **differential** — Kyrve quote math vs the pinned Midnight libraries and real `take` returns,
  across the whole active tick grid and rounding edges.
- **attack** — every case in PRD §30.5. Each must revert for the *specific* expected reason.
- **invariant / fuzz** — the twenty invariants in PRD §30.6.
- **e2e** — no mocked contract responses.

## Gates

- `forge test` passes before any contracts commit.
- Confidential-failure tests must assert that no public reason is emitted — a private rejection must
  never become a public oracle.
- Never delete or skip a failing test to go green. Never suppress a type error to compile.
