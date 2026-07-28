---
name: morpho-docs
description: Look up verified Morpho Midnight protocol behaviour, interfaces, tick math, fees, callbacks and deployment addresses. Use whenever a Midnight interface, signature, constant or protocol behaviour is needed, and before writing any code that touches Midnight.
---

# Morpho Midnight source lookup

**The pinned source outranks the docs.** Documentation describes intent; the pinned release
describes what will execute. Where they disagree, the pinned release wins and the discrepancy gets
recorded in `docs/day0/PRD-DELTA.md`.

Pinned: release `2026-07-23`, commit `dbd8d3d54d324a03df9f06d3c77d50a7bd1e09a0`, vendored at
`vendor/midnight`.

## Procedure

1. **Check `.claude/rules/morpho-midnight.md` first.** Facts already verified are listed there —
   do not re-derive them.

2. **Read the pinned source.** It is on disk; prefer it to any network call.
   ```bash
   ls vendor/midnight/src vendor/midnight/src/interfaces vendor/midnight/src/libraries
   git -C vendor/midnight describe --tags --exact-match   # must print 2026-07-23
   ```
   Interfaces in `src/interfaces/`, math in `src/libraries/`, reference ratifiers in
   `src/ratifiers/`, reference callbacks in `src/periphery/`, and the core in `src/Midnight.sol`.

3. **Read `vendor/midnight/AGENTS.md`** before reasoning about anything in `certora/`. It contains a
   precise CVL primer whose semantics differ from Solidity in ways that are easy to get wrong.

4. **Read the tests.** `vendor/midnight/test/` shows the protocol's own intended usage —
   `TakeTest`, `TakeAmountsTest`, `SettlementFeeTest`, `TickLibTest`, `BaseTest` are the highest-value
   ones. `test/ticks_exact.json` holds exact tick fixtures.

5. **Only then consult the docs.** Start at `https://docs.morpho.org/llms.txt` to locate the right
   page, fetch that specific Markdown page, and use `https://docs.morpho.org/llms-full.txt` only when
   genuinely broad context is needed. Useful pages:
   `/developers/midnight/concepts/tick-structure`, `/developers/midnight/concepts/fees`,
   `/developers/midnight/concepts/multi-market-offers`, `/learn/concepts/midnight/offers`,
   `/developers/contracts/addresses`.

6. **Check upstream only to detect drift**, never to take a fact from:
   ```bash
   gh api repos/morpho-org/midnight/releases --paginate | jq -r '.[].tag_name'
   ```
   If a newer release exists, that is a **decision**, not an automatic upgrade — changing the pin
   means re-running the differential and attack suites and updating `source-lock.json`.

## Rules

- Verify every interface and behaviour against the **exact pinned release**, never `main`.
- Never modify anything under `vendor/midnight`.
- Quote real code with a file path and line number. Never paraphrase a signature from memory.
- Morpho publishes no official Midnight deployment on Ethereum Sepolia. Kyrve deploys its own
  unmodified replica and must always label it as such.
- If behaviour is undocumented, read the source and then **prove it with a test** rather than
  asserting it.
