# Kyrve

Confidential fixed-income liquidity network. Encrypted lender mandates and borrower requirements
become **one** executable Morpho Midnight offer, while the full yield curve, provider allocations,
exposure limits, rejected alternatives and beneficial ownership stay private.

> One quote. The curve stays private.

@AGENTS.md

## Immutable source documents

These three files are the source of truth. **Never edit them.** Record every required correction in
`docs/day0/PRD-DELTA.md` instead.

| File | Authority |
|---|---|
| `hack.md` | Hackathon and submission requirements |
| `design.md` | Visual and interaction design — rewritten for Kyrve under explicit owner instruction; see `docs/phase1/PRD-DELTA.md` P-6. Immutable again from that point. |
| `kyrve-production-prd.md` | Product and architecture |

Where the PRD and verified reality disagree, **reality wins and the delta gets recorded** — do not
silently code around a PRD error, and do not "fix" the PRD by editing it.

## Non-negotiables

**Verify against official sources.** Never assert a version, address, function signature, licence or
protocol behaviour from memory. Package source and repository source outrank documentation prose;
live chain state outranks both. Every claim carries a URL, file path, or commit SHA. `UNVERIFIED` is
a valid and valuable answer — a confident guess is not.

**No fake data.** Mocked contract responses, simulated handles, fabricated protocol positions and
frontend-only balances are never acceptable as evidence that something works. Mocks belong in unit
tests of Kyrve's own logic, never on the protocol path and never in a demo or proof page.

**Decrypted values stay client-side.** Decryption happens in the authorised client. No server, log,
metric label, database column, analytics event or error message ever receives a decrypted value.

**Every public/private boundary is explicit.** Any code or UI that changes what becomes public must
say so at the point of action. See `.claude/rules/security.md`.

**Tests before commits.** `forge test` passes before any contracts commit. Nothing is "done" without
executable evidence.

**Exact dependency pins.** No `^`, no `~`, no ranges — anywhere. When a package changes, update
`source-lock.json` and `docs/day0/SOURCE-LOCK.md` in the same commit.

**`wrangler.jsonc` is the source of truth for Cloudflare deployment.** The authoritative reference
for config keys is `node_modules/wrangler/config-schema.json`, not the docs prose.

**Branches and focused commits.** Never commit to `main`. Conventional commits, one logical change
each. **Never add `Co-Authored-By` trailers.** Never commit secrets, keys, RPC credentials or
funded-wallet material.

## Verified ground truth

Do not re-derive these; they are locked in `source-lock.json` with reproduction commands.

- Ethereum Sepolia is on the **Osaka** fork, so the pinned release's `evm_version = "osaka"` deploys
  unmodified.
- Morpho Midnight pinned at release `2026-07-23`, commit `dbd8d3d5`, solc `0.8.34`.
- `IRatifier.isRatified` is `view` and **never receives `units`** — exact-fill must be enforced in
  the maker's `onBuy` callback. This is proven in `contracts/integration/test/ExactFill.t.sol`.
- For a buy offer the maker pays `floor(units * tickToPrice(tick) / 1e18)`, **independent of the
  settlement fee**.
- Midnight requires `isAuthorized[offer.maker][offer.ratifier]` before it will call the ratifier.
- Nox has **no** encrypted `and`/`or`/`not`/`xor`, and `select` has no `ebool` overload. Boolean
  composition must be arithmetised.
- Nox viewer grants and public-decryption marks are **permanent** — there is no `removeViewer`.
- A Nox handle is deterministic in its operands, so two logically distinct quantities computed
  identically are **one handle with one permanent ACL entry**. Isolate anything granted or published.
- The Nox Hardhat node allows **unlimited contract size** and cannot be made not to — NoxCompute
  itself exceeds EIP-170. `pnpm verify:contract-size` is the only thing that catches an oversize
  contract before a deployment does.
- The handle gateway returns a decrypted plaintext at its **natural width**, not ABI-padded.

## Layout

```
contracts/kyrve/        Kyrve protocol contracts (GPL-2.0-or-later)
contracts/integration/  Tests against real, unmodified Midnight
vendor/midnight/        Pinned Midnight submodule - never edit
docs/day0/              Validation evidence, source lock, PRD delta
.claude/rules/          Detailed rules, path-scoped
```

## Detailed rules

@.claude/rules/contracts.md
@.claude/rules/nox.md
@.claude/rules/morpho-midnight.md
@.claude/rules/cloudflare.md
@.claude/rules/security.md
@.claude/rules/testing.md
@.claude/rules/git.md
@.claude/rules/frontend.md
