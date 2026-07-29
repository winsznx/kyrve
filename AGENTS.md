# Kyrve — agent orientation

Kyrve converts encrypted lender mandates and borrower requirements into **one** executable Morpho
Midnight offer while the full yield curve, provider allocations, exposure limits, rejected
alternatives and beneficial ownership stay private.

> One quote. The curve stays private.

Do not guess contract addresses, package versions, or protocol signatures. Everything verified is
locked in [`source-lock.json`](source-lock.json) with reproduction commands in
[`docs/day0/SOURCE-LOCK.md`](docs/day0/SOURCE-LOCK.md).

## Read before acting

| Question | Where |
|---|---|
| What is the product? | `kyrve-production-prd.md` (immutable) |
| What does it look like? | `design.md` (immutable) |
| What must the submission contain? | `hack.md` (immutable) |
| Where is the PRD wrong? | `docs/day0/PRD-DELTA.md` |
| Is this assumption proven? | `docs/day0/VERDICT.md` |
| What are the exact versions? | `source-lock.json` |
| Can we ship this licence? | `docs/day0/LICENSE-MATRIX.md` |

The three immutable documents are never edited. Corrections go to `docs/day0/PRD-DELTA.md`.

## Skills

- `/morpho-docs` — before touching anything on the Midnight settlement path.
- `/nox-docs` — before writing confidential contract or client code.
- `/kyrve-validation` — before accepting any load-bearing architectural assumption.

## Subagents

`protocol-source-auditor` · `nox-primitive-auditor` · `midnight-integration-auditor` ·
`cloudflare-runtime-auditor` · `security-adversary` · `test-evidence-reviewer`

All are read-only. Their reports are **input, not conclusions** — reconcile findings against the
primary source before acting on anything that changes a decision.

## Architecture in one pass

```
encrypted mandates + encrypted request
        -> Nox curve engine (eligibility, capacity, privacy floor, leaf selection)
        -> one publicly decrypted leaf: market, rate, aggregate amount
        -> KyrveQuoteRatifier  (authenticates the exact offer + approved taker)
        -> KyrveSeriesVault.onBuy (enforces exact units and exact assets)
        -> unmodified Morpho Midnight take()
        -> public credit position, confidential ERC-7984 beneficial ownership
```

The two enforcement points are not redundant. `isRatified` is `view` and never receives `units`, so
it **cannot** enforce fill size; `onBuy` is the only place actual fill size reaches maker code.

## Invariants that must never break

1. A confidential failure never produces a public reason.
2. One quote settles at most once, only for the approved taker, only at the exact units.
3. The sum of encrypted allocations equals the Midnight credit received.
4. Aggregate confidential claims never exceed series-vault coverage.
5. No decrypted value ever reaches a server, log, metric or database.

Detailed rules live in `.claude/rules/`, path-scoped. Read `CLAUDE.md` first.

## Phase 2 — the confidential layer

`confidential/` is a separate Hardhat project at solc **0.8.36**, because
`nox-protocol-contracts@0.2.4` requires `^0.8.35` while the Midnight substrate is pinned at 0.8.34
for bytecode comparability. Anything importing `sdk/Nox.sol` belongs there, not in `contracts/`.

Its tests run against the **real** iExec Nox stack in Docker — real handles, real gateway proofs. A
mocked NoxCompute would be a mocked confidentiality path and is forbidden.

Three constraints that are easy to violate and hard to notice:

- **Nox handles are deterministic in their operands.** Two logically distinct encrypted quantities
  computed identically from identical inputs are ONE handle with ONE permanent ACL entry. Prove any
  new aggregate is non-colliding; value inequality is not enough. `docs/phase2/PRD-DELTA.md` Q-5.
- **Input proofs carry no nonce and no consumption marker.** Replay protection is the application's
  job. Use `KyrveConfidentialBase`'s one-shot handle consumption and per-owner nonce on every entry
  point. Q-2.
- **The pause enum has no recovery member, and must never gain one.** Q-6 and PRD invariant 20.

Run `pnpm verify:phase2`. Read `docs/phase2/PHASE-3-PREREQUISITES.md` before starting the curve
engine.
