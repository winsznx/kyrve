# Phase 6 gate

`pnpm verify:phase6` — **21 passed, 0 failed, 1 skipped.** Verdict: **CONDITIONAL PASS**.

The one skip is `Slither over the confidential layer`, and it is skipped by construction rather than by
circumstance. It can never report PASS: marking it so would assert static-analysis coverage that does not
exist, and marking it FAIL would assert a defect nobody found. Delta U-5 carries the exact reproduction.

Two lines print on every run that reaches a verdict, and they are the phase's two honest caveats:

> **THE ROLL IS MINIMAL, AND THAT IS THE CLAIM.** One intent against one supply between two series that
> share no contract. No production-scale throughput is proven or asserted.

> **UNVERIFIED BY SLITHER** — the confidential layer has NO static-analysis coverage. The compensating
> evidence is real but it is not the same thing, and this line prints every run so the gap cannot become
> invisible by familiarity.

---

## What ran on Ethereum Sepolia

**Two complete confidential issuance stacks, sharing zero contracts.** A roll between a series and itself
makes every conservation identity trivially true, and delta U-1 establishes that one custody vault serves
exactly one series — `bindSettler` is one-shot and the settler holds its series, token, registry, vault and
market as immutables. So layer B is not a second quote against layer A's contracts. It is a second engine,
epoch controller, graph registry, custody vault, ledger, settlement layer, series token and solvency
verifier. The gate asserts **zero shared addresses** across 19 contracts each.

| | layer A | layer B |
|---|---|---|
| series | `0x07af68de01aa80ca39…` | `0x4066880587d1792630…` |
| engine | `0xb2be4575c78b8f6be1bc84d54ece9f0da643010a` | `0x44581a06f2e514bbc86e1f3f9cf9f1707475663f` |
| custody vault | `0xcd4161de15c52da9e5f51dbe4488a5020604d6f2` | `0x2542b110b56f13a63f5fcfc165af5272c741b0a4` |
| series token | `0x61fcb2a7623bb15622b1303d0bf819247078f178` | `0xd085176a07a3764fad5b872f2b05cb34f931d314` |
| role registry | `0xe3c19460afc9d37d1e322a1862dc0241cbde3765` | `0x987e8f34e56e49cc9925e12a7d73b38c7cc716be` |
| epoch | `0xe514e64950c0074cd42bcf7302355fe00ee04c9c92c0f0f4a0f825ddc0d74428` | `0x85771a10b8e599c80f12de842886e7c4582ff96200fc38900ecdb2399bd15e28` |
| quote | `0x89a5a9748966fa8cfc4a0e25e5cbc73e620fcb57f5f9912d6884d07b516f3649` | `0x74236d47e071f62d06ddac84f82ed439b7b895add8b97b726052626331fefe9e` |

The market layer, deployed once and spanning both:

```
KyrveCapsuleVault  0x488d9d4348e6de9aad8750eda035968f09bfd896
KyrveCrossBook     0xbfae69cee2c1a26e213041475bdfcdcb9ca827ad
KyrveRollBook      0x3c1e083c538ecaba5cd449e4393755dcc8bdfc8e
```

**43/43 contracts verified on Etherscan V2**, across both compiler pins.

### Each layer, independently

Both epochs published an aggregate of **299,999,999** matching the plaintext reference model exactly, and
both settled at **300,000,599** credit and debt from a position of zero in their own vault. Each refused a
partial fill, refused a replay, and refused a duplicate allocation. Layer A cost 27,197,686 gas and layer B
27,422,554.

### The three features

**Capsule** `0x52e32992b85f20857edf0e492531fa4bc4ac423f18e150270a55df50b6e70a86`, origin digest
`0x3f10b02fbfa9418b4630b84f03e0bbf287391611c20b4579b17ed59ea9ceef16`.

**Cross** — a partial fill with dust, `matchOrders` at 994,501 gas, and 4/4 conservation identities.

**Roll** — intent `0x860202e0…` against supply `0x7ee961ac…`, 2,532,584 gas across 11 transactions:

- conversion **1.063831914893624112**, recomputed from two live chain reads and matching the book;
- value conserved under that declared conversion;
- **both** series' live supply handles byte-identical across the roll — nothing minted, nothing burned;
- a retried netting at a stale index refused as **`StaleNetIndex`**;
- an over-unwind refused as **`ResidualExceeded`**;
- the residual unwound halfway, stopped, and finished from chain state alone.

The last three are the ones worth reading twice. The gate re-checks the **decoded error names** in the
evidence record, so a record hand-edited to `staleNetIndexRefused: true` does not satisfy it.

---

## What the campaign cost, measured from receipts

`pnpm roles:reconcile` walks every transaction hash the campaign recorded, pulls the receipt, and
attributes `gasUsed * effectiveGasPrice` to the address that actually signed. Summing what each script
reported would have reconciled the records against themselves.

| | receipts | gas | ETH |
|---|---:|---:|---:|
| Phase 6 | 103 | 91,080,115 | 0.09654 |
| superseded Phase 3/5 | 18 | 28,318,988 | 0.03037 |
| **total walked** | **121** | **119,399,103** | **0.12691** |

Two things the walk cannot see, reported rather than folded in:

- **54,620,240 gas** of real epoch work is listed as REPORTED BY THE RECORD and explicitly not confirmed,
  because the curve-epoch driver records an aggregate `gasUsedThisRun` with no per-transaction hashes.
- The abandoned synthetic epoch of delta U-8 reads as **zero**, because `gasUsedThisRun` is per invocation
  and the surviving record is a resumed run that did no new work. Its true cost is not recoverable from
  these records and **no number is invented for it**.

Per role, and why four of them are silent for four different reasons, is in `docs/phase6/SECURITY.md` §3.

---

## What passed

| section | gates |
|---|---|
| Role separation | ROLES.md documents seven roles with rotation, loss, compromise and account kind; the registry refuses every collapsed pair on chain (19 Foundry tests); `verify:roles sepolia` reads both deployed registries — 24/24 |
| Capsule | demonstrations 1–7 against real Nox and real Midnight — 11 passing |
| Cross | demonstrations 8–15 — 12 passing |
| Roll | demonstrations 16–24, across two real confidential stacks — 10 passing |
| Kyrve Verify | layer a 12/12; layer b 10 pass + 2 N/A |
| Quality and security | the four attacks nothing else covers — 6 passing; basenames; EIP-170; EIP-7825; secrets; privacy scan; Slither over the settlement layer — 0 High/Medium across 7 deployed paths |
| Sepolia | two independent stacks; 43/43 Etherscan; one Capsule; one Cross; one minimal Roll; per-role reconciliation with no separation violation |

---

## The gates that exist because something went wrong

Every one of these was written after the thing it checks had already happened.

**The refusals are re-checked by decoded error name.** The first complete Sepolia roll reported that
over-unwinding a residual was refused. It was — with `IntentNotOpen(id, 3)`, because the intent had
completed and the call died at the state guard without ever reaching the ceiling. A bare `try/catch` had
asserted a defence that never fired. U-F7, delta U-10.

**Kyrve Verify runs per layer, and the deployment record follows the tag.** It read `evidence/phase5/`
while checking Phase 6 contracts and reported four failures against a quote the role-separated registry has
never heard of. U-F5.

**Layer A and layer B evidence cannot substitute for each other.** `KYRVE_EVIDENCE_TAG` threads through
every path, and `verify:phase6` runs both. A successful layer A flow silently satisfying a layer B check is
the failure `scripts/lib/layer.ts` exists to prevent.

**An epoch must be settlement-grade.** Layer A's first epoch ran without `KYRVE_SETTLEMENT_UNIVERSE=true`,
completed perfectly through all six stages, and then died at `activateQuote` with `MarketNotCreated()`. The
gas is spent and unrecoverable. Delta U-8 added the guard; the records are kept as
`*-synthetic-abandoned.json` rather than deleted, because this repository records what happened.

**No thrown error may carry an RPC credential.** An Alchemy key reached stdout twice, from two different
scripts, because viem's error formatting includes the request URL and 36 scripts had a top-level
`console.error(error)`. U-F1.

---

## What this gate does not claim

- **Not production Roll throughput.** One intent, one supply, two series. The expensive part of a larger
  roll is repeating the whole confidential issuance stack per maturity (U-1), not an unimplemented feature.
- **Not static-analysis coverage of the confidential layer.** U-F12, open.
- **Not gas indistinguishability**, for any Phase 6 path. U-F13.
- **Not that the Nox gateway never sees plaintext.** It does, on the way in. U-F14.
- **Not zero-knowledge proofs.** Gateway proofs are signatures over a released plaintext, and are named
  that way in the CLI, the browser artefact and the Verify band's own footnote. U-F15.
- **Not a maturity redemption.** The Roll's conversion opens redemption early, against credit Midnight has
  already recorded rather than a completed withdrawal. U-F9, delta U-11.
