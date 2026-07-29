# Phase 2 — confidential assets, mandates and requests

Phase 1 built the public substrate: an unmodified Morpho Midnight replica, four markets, and the
proof that exact fill can be enforced. Phase 2 builds the **private half** — the encrypted balances,
the encrypted mandates and the encrypted borrower requests that the curve engine will later quote
over.

Everything here runs against the real iExec Nox stack. No mocked confidentiality path exists in this
repository.

## Start here

| Question | Where |
|---|---|
| Did Phase 2 pass, and on what evidence? | [`GATE.md`](GATE.md) |
| Where were the PRD and the SDKs wrong? | [`PRD-DELTA.md`](PRD-DELTA.md) |
| What is defended, and what is not? | [`SECURITY.md`](SECURITY.md) |
| What must Phase 3 read before starting? | [`PHASE-3-PREREQUISITES.md`](PHASE-3-PREREQUISITES.md) |

## One command

```bash
pnpm verify:phase2
```

22 gates: the real Nox suite, contract tests, local deployment, the browser flow, security scans,
the secret scan, generated-file checks, the privacy scan, and Sepolia read verification. A skipped
gate never counts as a pass, and a run without Docker exits non-zero with the verdict
`NOT VERIFIED` rather than a green summary that proves nothing.

## Layout

```
confidential/              Hardhat project — solc 0.8.36, the real Nox stack
  contracts/               the five production contracts plus three test-only probes
  test/                    50 tests: demonstrations, attacks, gas, browser flow
  nox-stack/               the pinned off-chain stack, vendored and hash-locked
apps/web/                  the local confidential terminal
packages/nox/              the ONLY module permitted to depend on iExec Nox
scripts/verify/            privacy-scan, nox-stack, confidential, etherscan-confidential
scripts/phase2/gate.ts     verify:phase2
```

## Why the confidential layer is a separate compilation unit

`@iexec-nox/nox-protocol-contracts@0.2.4` declares `pragma solidity ^0.8.35` across every source.
The Midnight substrate is pinned at solc **0.8.34** so its runtime bytecode stays byte-comparable
with the pinned release. Those constraints cannot both be met in one project, so the confidential
layer gets solc **0.8.36** and its own Hardhat project while `contracts/` stays on the Foundry
profile. `evmVersion` remains `osaka` on both, so one artifact deploys locally and on Sepolia.

And it is Hardhat rather than Foundry because every Nox primitive is an external call into
NoxCompute, whose results are computed off chain by the KMS, ingestor and runner. Foundry cannot
drive that stack, and etching a fake NoxCompute would be exactly the mocked confidentiality path the
rules forbid.

Recorded as delta [Q-1](PRD-DELTA.md).

## The three findings worth reading even if nothing else is

**[Q-5] Nox handles are deterministic in their operands.** Two logically distinct encrypted
quantities computed the same way from the same inputs are one handle sharing one **permanent** ACL
entry. An earlier vault draft leaked the protocol aggregate to the first depositor this way. It was
caught by a test, not by review, and it is the single most important constraint on the Phase 3 curve
engine.

**[Q-2] Input proofs carry no nonce and no consumption marker.** `validateInputProof` checks chain
id, type, length, expiry, app and owner — and nothing else. A proof stays replayable by its own owner
against its own app until it expires. Replay protection is entirely the application's job; the PRD
assumed Nox provided it.

**[Q-4] `@iexec-nox/handle` ignores the account its client was built with.** On any node exposing
more than one account, every proof is minted for account zero and every holder is refused their own
balance. `@kyrve/nox` binds the account explicitly.

## What Phase 2 deliberately does not contain

No curve engine, no quote activation, no series, no Cross, no Roll, and no Cloudflare resource of any
kind. The vault's reserver is deployed **unset**, so every reservation entry point reverts publicly
until Phase 3 wires the curve engine into it.
