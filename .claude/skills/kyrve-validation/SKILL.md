---
name: kyrve-validation
description: The repeatable Kyrve evidence gate. Use whenever a load-bearing architectural claim must be proven or disproven, before accepting any assumption into the design, and when recording Day 0 or later phase findings.
---

# The Kyrve validation gate

Documentation and plausible reasoning are **not evidence**. A claim is validated only by executable
output that would have failed had the claim been false.

Apply this gate to every load-bearing assumption. Record each one in `docs/day0/` (or the relevant
phase directory) using the eight fields below, in order. An entry missing a field is not done.

## The eight fields

1. **Claim** — one falsifiable sentence. "Nox supports encrypted division" is testable; "Nox is
   powerful enough" is not.
2. **Source** — the authority, at maximum precision: file path and line, commit SHA, package version
   and integrity hash, or live chain state. Never "the docs say". Package and repository source
   outrank documentation prose; live chain state outranks both.
3. **Executable proof** — the command anyone can re-run, and what it printed. A test, a differential
   comparison, a benchmark, an `eth_call`, a dry-run build.
4. **Failure test** — the paired negative case proving the check can actually fail. Without this, a
   passing test may be passing for the wrong reason. When asserting a revert, assert the *specific*
   revert.
5. **Measured result** — the actual numbers. Gas, latency, byte sizes, rounding error, op counts.
   Not "fast" or "acceptable".
6. **Privacy consequence** — what this makes public, to whom, and when. Which of the four states
   the value lands in: private throughout, private until activation, public from submission, or
   public on unwrap. If none, say "none" explicitly.
7. **Decision** — `PASS`, `CONDITIONAL PASS` (with the exact condition and how it will be
   discharged), or `FAIL` (with the stronger architecture that preserves the full product thesis).
8. **Residual risk** — what is still unproven, and what would falsify the conclusion later.

## Rules

- **Never weaken the product to make a gate pass.** If a direct implementation is impractical, find
  and prove a stronger architecture that preserves the complete thesis. Reducing scope to an MVP,
  deferring a pillar, or reframing the claim are all failures of this gate, not passes.
- **Distinguish proof levels explicitly** in every report: local proof, Sepolia-read proof, and
  production assumption are three different things and must never be blurred.
- **Mocks are never architectural proof.** Fake contract responses, simulated handles, fabricated
  positions and mocked success paths prove nothing about the protocol path.
- **`UNVERIFIED` is a valid result** and more valuable than a confident guess. Carry it forward
  into the residual-risk list rather than resolving it by assumption.
- **Reconcile independent findings yourself.** Sub-agent and third-party reports are input, not
  conclusions. Verify any claim that changes a decision against the primary source before relying
  on it.
- Corrections to the immutable documents go in `docs/day0/PRD-DELTA.md`. Never edit `hack.md`,
  `design.md` or `kyrve-production-prd.md`.
