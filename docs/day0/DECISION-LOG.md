# Decision log

| # | Decision | Alternatives rejected | Why | Reversible? |
|---|---|---|---|---|
| DL-1 | Pin Midnight as a **git submodule** at `dbd8d3d5` | vendored copy; npm package | Reproducible, tamper-evident, and a pin change is its own commit | yes |
| DL-2 | Kyrve contracts licensed **GPL-2.0-or-later** | MIT/Apache | They import GPL Midnight interfaces and link `ConstantsLib`; conservative and compatible | costly — would need clean-room interfaces |
| DL-3 | Enforce exact fill in **`onBuy`**, not the ratifier | ratifier-only | `isRatified` is `view` and never receives `units` — it *cannot* enforce size | no, architectural |
| DL-4 | Derive `units` by **rounding down** | rounding up; nearest | Guarantees the maker never overdraws the reservation; dust ≤ 2 wei | no, invariant §19.2 |
| DL-5 | **Arithmetise** eligibility with cached `select` | indicator + multiply chain | Nox has no boolean ops; cached select halves cost (146,865 → 76,402) | yes, an optimisation |
| DL-6 | **Hierarchical multi-transaction epoch** | monolithic single transaction; reduced universe | Monolithic needs 300.8M gas. Decomposition keeps the full 16×128 universe | no, forced by measurement |
| DL-7 | Epoch, not transaction, is the **atomic unit** | per-transaction atomicity | Follows from DL-6; stages are idempotent and checkpointed | no |
| DL-8 | **R2 history + D1 projection** (Option B) | external PostgreSQL (Option A); D1-only | D1 caps at 10 GB and is single-threaded; all-Cloudflare keeps one operational surface | yes — Option A remains viable |
| DL-9 | **Durable Object** for nonce allocation | Workflow-only; optimistic nonces | Workflows retry; `eth_sendRawTransaction` is not idempotent | yes |
| DL-10 | Target **Workers Paid** | Free plan | 50 subrequests/invocation cannot cover one block of indexing | yes |
| DL-11 | Pin `sepolia.drpc.org` for `eth_getLogs` | publicnode; 1rpc | publicnode rejects it as archive; 1rpc caps at 50 blocks | yes |
| DL-12 | v1.1 as a **normative amendment**, not a regenerated PRD | full rewrite | v1.0 is 4,272 lines/282 sections; a rewrite would hide 20 corrections in an unreviewable diff | yes |
| DL-13 | Reclaim **Docker build cache** to unblock the stack | delete images; delete user files | Build cache is regenerable by definition; images and volumes untouched | n/a, executed |
| DL-14 | Do **not** claim gas indistinguishability | assert it from status/log parity | 4 distinct gas values measured; asserting it would be false | n/a |
| DL-15 | Treat the BUSL grant as **empty** | assume a grant exists | ENS resolves with no contenthash and no text records across 17 keys | no — factual |
