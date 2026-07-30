# Phase 6 — market operations

Separated operational authority, frozen selective disclosure, confidential secondary transfer, and
confidential migration between maturities.

> One quote. The curve stays private. The ownership too — and now it can move without becoming public.

Run `pnpm verify:phase6`. Current verdict: **CONDITIONAL PASS** — 21 gates, 0 failed, 1 skipped by
construction. See [`GATE.md`](GATE.md).

---

## What changed, in one paragraph

Phase 5 took custody. **This is the first phase where the same capital moves between parties**, and the
first where Kyrve hands a third party a permanent, irrevocable right to read something. A holder's claim
leaves them for another holder in Cross; a claim leaves one series for another in Roll; an auditor receives
a frozen snapshot in Capsule that no expiry can take back. Before any of that shipped, seven operational
roles were pulled apart into seven addresses and the separation was made a **deployment-time** property
rather than a modifier someone could forget — `KyrveRoleRegistry`'s constructor rejects a zero holder and
every duplicate pair, on chain. The phase then ran the whole Phase 3–5 lifecycle **twice**, because a roll
between a series and itself makes every conservation identity trivially true and one custody vault serves
exactly one series.

---

## The four features

**Roles.** Seven addresses, seven documented authorities, rotation and loss and compromise recorded per
role. Proven by what the keys did rather than by what a deploy script intended: `pnpm roles:reconcile`
walks 121 receipts from chain and attributes each to its actual signer. Four roles signed nothing, for four
different reasons. [`ROLES.md`](ROLES.md).

**Capsule.** A frozen snapshot handle, addressed to one recipient, bound to a chain, a deployment, a series
and a block. Never a live balance — the two are structurally different handles, and delta R-6 is why that
was proven with the defence removed rather than assumed.

**Cross.** Encrypted exit and entry orders, private netting, and a public residual **only** when netting is
insufficient — published by its owner, once, irreversibly. No public order book. A failed match contributes
encrypted zero rather than a public reason.

**Roll.** Confidential migration between maturities, priced by a conversion derived from two public numbers
and reproducible by anyone. Both legs are transfers out of escrow, so **neither series' supply moves by a
single unit** — a claim a burn-and-mint roll could not make.

---

## What this phase claims, and what it does not

**Claimed:** the mechanism works on a public network between two series that share no contract. Nothing is
simulated and neither series is stood in for.

**Not claimed:** production-scale Roll throughput. One intent, one supply. The expensive part of a larger
roll is repeating the whole confidential issuance stack per maturity (delta U-1), not an unimplemented
feature. `pnpm verify:phase6` prints this on every run.

**Open:** the confidential layer has no static-analysis coverage. `crytic-compile` cannot be made to drive
solc 0.8.36 in this environment (delta U-5, exact reproduction). The gate reports `UNVERIFIED BY SLITHER`
every run and can never report PASS for it.

---

## Files

| file | what it is |
|---|---|
| [`GATE.md`](GATE.md) | what ran, what it cost, and the gates that exist because something went wrong |
| [`ROLES.md`](ROLES.md) | the seven roles, their authority, rotation, loss and compromise |
| [`SECURITY.md`](SECURITY.md) | the findings register, what is enforced structurally, and what stands in for Slither |
| [`PRD-DELTA.md`](PRD-DELTA.md) | U-1 … U-11 — where reality and the PRD disagree |
| [`PHASE-7-PREREQUISITES.md`](PHASE-7-PREREQUISITES.md) | read before Cloudflare or final web work |

---

## Three things that are easy to get wrong and were

**A bare `try/catch` proves nothing.** The first complete Sepolia roll reported that over-unwinding a
residual was refused. It was — with `IntentNotOpen`, because the intent had already completed and the call
died at the state guard without reaching the ceiling. Both refusals now assert the error **by name**, and
the gate re-checks the decoded names in the evidence record. Delta U-10.

**`SupplyState.Open` is public; remaining inventory is not.** A supply drained by an earlier netting stays
Open forever, because the contract cannot say otherwise without leaking a balance — and netting leaves
floor-division dust, so even a nonzero escrow may move nothing. Two Sepolia runs netted zero and passed
every public check. Delta U-9.

**A verification page that renders a record has verified nothing.** Demonstration 24 serves the page a
record with a **false series id** and requires it to turn that row red on its own, showing both values. The
CLI and the browser are deliberately capable of contradicting each other; otherwise running both proves no
more than running one.
