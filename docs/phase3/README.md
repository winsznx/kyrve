# Phase 3 — the confidential curve engine

Encrypted provider mandates and one encrypted borrower request become **one** publicly decryptable
quote, while the full yield curve, provider allocations, exposure limits, rejected alternatives and
beneficial ownership stay private.

```
encrypted mandates + encrypted request + confidential balances
  -> private eligibility        six terms, arithmetised: Nox has no encrypted and/or/not
  -> private capacity per leaf  2,048 cells at 16 x 128, five operations each
  -> privacy-floor result       below the floor is encrypted ZERO, never a public reason
  -> deterministic leaf         one encrypted term in an otherwise public ordering
  -> encrypted reservations     safe subtraction, conserved, releasable
  -> FIVE public values         market, rate, aggregate, floor boolean, ready boolean
```

## Read in this order

| Question | Where |
|---|---|
| Is the phase done, and what is not? | [`GATE.md`](GATE.md) |
| Why is every granted handle isolated? | [`HANDLE-LINEAGE.md`](HANDLE-LINEAGE.md) |
| How is one leaf chosen? | [`SELECTION-POLICY.md`](SELECTION-POLICY.md) |
| What did the PRD get wrong? | [`PRD-DELTA.md`](PRD-DELTA.md) |
| What must not be repeated in Phase 4? | [`PHASE-4-PREREQUISITES.md`](PHASE-4-PREREQUISITES.md) |
| What is the threat model now? | [`SECURITY.md`](SECURITY.md) |

## The three things most likely to be got wrong

**A handle is not a fresh reference.** It is a pure function of the operator, the operand handles in
order and the output index, so two logically distinct quantities computed identically are ONE handle
with ONE permanent ACL entry. Intermediates collide constantly here and that is harmless, because
nobody is ever granted one. Everything that crosses to a user or the public is isolated first.

**A local Hardhat node is more permissive than any real chain.** It allows unlimited contract size
and its clock outruns wall clock. Both hid a real failure in this phase, and the first cannot be
switched off because NoxCompute itself needs the relaxation.

**A valid gateway proof says nothing about which quote a value belongs to.** It is replayable by
anyone forever. Only the sealed operation graph turns it into authorisation.

## Run it

```bash
pnpm verify:phase3                          # every gate, honest about what it skipped
pnpm --filter @kyrve/confidential test      # 90 tests against the real Nox stack (needs Docker)
pnpm verify:curve sepolia                   # read-only, needs only ALCHEMY_API_KEY
```

## Deployed on Ethereum Sepolia

Six contracts at block 11376471, 11,585,791 gas, 6/6 verified on Etherscan V2. Addresses in
[`GATE.md`](GATE.md) and `deployments/sepolia/curve.json`.

**No curve epoch has run on Sepolia.** That is a funding gap of 0.0196 ETH, priced by
`scripts/test/sepolia-epoch-budget.ts`, not a technical unknown.
