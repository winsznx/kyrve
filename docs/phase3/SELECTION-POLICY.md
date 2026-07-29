# The selection policy

How one leaf is chosen from up to 128, when only one term of the ordering can be evaluated in the
clear.

---

## The seven criteria, and which of them are orderings

PRD §9.3 as corrected by Phase 1:

| # | Criterion | Public? | How it is enforced |
|---|---|---|---|
| 1 | cheapest borrowing acceptable to the borrower | **public** | rate index, in the rank |
| 2 | sufficient capacity | encrypted | **not an ordering** — an exclusion |
| 3 | privacy floor passed | encrypted | **not an ordering** — an exclusion |
| 4 | closest maturity preference | **encrypted** | the one term added under encryption |
| 5 | public market priority | **public** | in the rank tail |
| 6 | deterministic market-index tie-break | **public** | in the rank tail |
| 7 | deterministic rate-index tie-break | **public** | already the leading term |

Criteria 2 and 3 look like ordering terms and are not. A leaf without capacity, or below the privacy
floor, carries **encrypted zero** out of stage D. It is then pushed above every reachable rank and
can never win, however attractive its rate. Treating them as ordering terms would mean comparing
them under encryption on every leaf; treating them as exclusions costs one `select` each.

That leaves exactly one criterion — the borrower's maturity preference — that has to be added under
encryption. Everything else is public, and the whole point of publishing the rate grid is that this
is possible at all.

---

## The rank is positional, and the widths are the proof

```
score = rateIndex * 512  +  maturityDistance * 128  +  tail(publicPriority, marketIndex)
        ^ criterion 1        ^ criterion 4              ^ criteria 5, 6, 7
                             the only encrypted term
```

Each field is wider than everything below it can reach, so no lower criterion can ever outrank a
higher one:

| Field | Range | Widest value below it |
|---|---|---|
| tail = `(priority << 4) \| marketIndex`, 7 bits | 0..119 | — |
| maturity distance × 128 | 0, 128, 256, 384 | 119 |
| rate index × 512 | 0..7,680 | 384 + 119 = 503 |

Largest reachable score: `15*512 + 3*128 + 119 = 8,183`. `CURVE_RANK_CEILING` is **8,192**, above
every reachable rank and comfortably inside `euint16` — which is what lets the whole reduction run at
16-bit width, 13% cheaper per `select` than 256-bit.

Note 119, not 127. The tail's two fields do not fill all seven bits, and an earlier version of this
document said 8,191 by assuming they did. The bound was still correct; the arithmetic behind it was
not, which is exactly the kind of claim that stops being checked. `packages/curve/test/constants.test.ts`
now derives all three bounds rather than asserting them.

The registry refuses a `publicPriority` above 7 for the same reason: three bits, and a larger value
would wrap into the market-index bits and silently reorder the universe while every other check
passed.

---

## Why higher tick means cheaper, and why it is enforced rather than documented

Midnight's `tickToPrice` is monotonically non-decreasing and capped at par, so a **higher tick is a
higher price is cheaper borrowing**. Rate index 0 is therefore the cheapest borrowing and the highest
tick, matching `docs/phase1/RATE-GRIDS.md`.

Getting this backwards would invert the selection policy — quoting the most expensive available rate
while reporting it as the cheapest — and **every test would still pass**, because the engine would be
consistently wrong. So `CurveUniverseRegistry.addMarket` rejects a grid whose ticks or prices do not
strictly descend, and `packages/curve/test/universe.test.ts` exercises each refusal with a fixture
that violates exactly that one property.

The two sides of the rate window follow from the same direction:

- a **lender** wants a high rate, so a provider is eligible when `leafRateIndex >= providerMinimum`;
- a **borrower** wants a low rate, so a leaf is acceptable when `leafRateIndex <= borrowerMaximum`.

---

## Where each comparison happens, and why it is exact

| Comparison | Where | Why there |
|---|---|---|
| provider's minimum rate | stage C, **per cell** | it depends on both the provider and the leaf |
| borrower's maximum rate | stage D, **per leaf** | it depends only on the leaf |
| privacy floor | stage D, per leaf | it depends on the leaf's accumulated count |
| desired size cap | stage D, per leaf | |
| borrower's minimum size | stage D, per leaf, **after the cap** | |

Applying the borrower's rate ceiling to the leaf TOTAL is arithmetically identical to applying it to
every cell, because it does not vary by provider — and it costs a sixteenth as much. That equivalence
is worth stating because it is the sort of optimisation that is easy to get subtly wrong.

The order of the last two is load-bearing and the reverse is a real bug. Cap at the desired size
first, then test the borrower's stated minimum against the capped amount. Testing the minimum against
the *uncapped* capacity accepts a leaf whose fill, once capped, falls below what the borrower said
they would accept. `packages/curve/test/reference.test.ts` covers exactly that case: capacity 1,500,
desired 600, minimum 700 — no quote, and the other order would wrongly produce one.

---

## Ties, and why the tie-break is a property of the operator

The fold uses a strict `lt` and walks leaves in index order, so a later leaf never displaces an
equal-scoring earlier one. Ties therefore go to the **lowest leaf index**, deterministically.

That is not a rule written somewhere and remembered — it is a consequence of the comparison operator.
Changing `lt` to `le` on chain would silently reverse it, and the reference model would diverge, which
is what the test is for.

---

## What the borrower is not told

The runner-up is **never materialised**. The fold carries only the running best, so the second-best
leaf does not exist as a handle and cannot be published by accident. A borrower who is quoted rate
index 3 learns nothing about whether index 0 existed, had capacity, or lost to the privacy floor.

That is the point of the product, and it is structural rather than a rule someone has to remember.

---

## The dust, and why the aggregate is published after allocation

Every pro-rata share is floored by `safeDiv`, so the reservations sum to slightly less than the
winning leaf's fill. Publishing the fill would publish a number the reservations then fail to match,
by up to one unit per contributing provider.

So the published aggregate is **the sum of what was reserved**, computed after stage F and published
in stage G. "Reservations sum to the public aggregate" is then true by construction rather than by
luck, and the residue is an explicit, bounded dust term: strictly less than the number of
contributing providers.

`dustResidue = fill − aggregate` is kept as a handle for Phase 4's §19.8 dust account. It is granted
to **nobody** and published **never** — it would otherwise disclose the winning leaf's total capacity,
which is private.
