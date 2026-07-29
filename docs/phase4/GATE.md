# Phase 4 gate — quote activation and Midnight settlement

`pnpm verify:phase4`

Phase 4 turns one verified confidential curve result into one executable Midnight offer and settles
it exactly, or not at all. This file records what is proven, what is not, and what a reader should
not conclude from either.

---

## What is proven

### On Ethereum Sepolia, against unmodified Midnight and the hosted iExec gateway

One real quote, activated and settled. `evidence/phase4/sepolia-settlement.json`.

| | |
|---|---|
| epoch | `0x782496e10f71189f2a8fcb8591108c2c02b18cebeb9ef455dac64735395b2c7e` |
| quote | `0x383d8e08331fdb87bc081a0ab765fbaf10872392fac47e206b901202edb1c5d5` |
| series vault | `0x787E88E249fdff3d675Ad6e5ada811d4E1FF09c0` |
| published aggregate | 299,999,999 — the sum of reserved allocations |
| exact units | 300,000,599 |
| buyer assets | 299,999,998 |
| unreserved residue | 1 |
| credit created by this fill | 300,000,599 |
| debt created by this fill | 300,000,599 |
| group consumed | 300,000,599 |
| quote status | `Consumed` |
| activation | [`0x623e0dc0…`](https://sepolia.etherscan.io/tx/0x623e0dc052fab93ff0d12267ef8ab84fe8ece25ccb04e08a7dc323afb1883080) |
| settlement | [`0x0962faa7…`](https://sepolia.etherscan.io/tx/0x0962faa7c99998be8f35a6ba3c36b667d1d66b846d29177656589301e6ec2ff2) |

The epoch matched the plaintext reference model exactly. Five gateway proofs verified through
`KyrvePublicResultVerifier` against the sealed graph. A partial fill was refused at
`KyrveSeriesVault.onBuy` with group consumption still zero. A replay was refused.

Credit and debt are recorded as DELTAS across the settlement block, not absolutes: they are cumulative
positions in a shared market and this borrower already held 3,000,000 units of debt from Phase 1's
integration run. Delta S-8.

### The Sepolia deployment

| Contract | Address |
|---|---|
| `KyrveQuoteRegistry` | `0x07348f7542af233db32d36d3afec1e9737fe6b50` |
| `KyrveSettlementRatifier` | `0xc12a62211d0e5e7d64b5d2064dec12eb8f477ac2` |
| `KyrvePublicResultVerifier` | `0x6b78231811309a308c0bb12f35787f9b590ad553` |
| `QuoteActivator` | `0xbec8b5cb3b4b71daad486eb1d1419523bb49ae78` |
| `KyrveQuoteExpiryController` | `0xebff49b6fbe4db4320220927bd0d2c52c7310393` |
| `KyrveSeriesFactory` | `0xe3759533040bc041eb011511bc24116064eb31df` |
| `KyrveSeriesVault` (instance) | `0x787E88E249fdff3d675Ad6e5ada811d4E1FF09c0` |

Deployment id `0x3cb6089353ff748827d16ccdec7506aeba2f624093e6a0546a67683aa5a679df`, recomputed from
`(chainId, registry, midnight)` rather than trusted. 7,343,172 gas, 0.00787 ETH, 15/15 wiring checks
read back from chain state, three one-shot bindings read back. **7/7 verified on Etherscan V2**,
including the vault instance, which is enumerated from the factory's own chain state.

The Phase 3 curve layer was redeployed alongside it, because lowering the chunk-width bound changed
`CurveUniverseRegistry`'s runtime bytecode. 11,580,178 gas, 0.01209 ETH, 11/11 wiring checks. The
prior records are kept as `curve-superseded-phase3.json` and `curve-etherscan-superseded-phase3.json`.

### Against real, unmodified Morpho Midnight, locally

**122 Foundry tests pass**, 69 of them new. Nothing on the protocol path is mocked. The full attack
table is in `docs/phase4/SECURITY.md`; in summary: exact fill settles, partial and oversized fills
revert, a rejected fill leaves no consumption, credit, debt, tokens or allowance, replay and every
offer-field substitution revert by name, both re-entrancy paths fail, hostile `approve` behaviours
fail closed, cancellation is real at the protocol level, and the expiry boundary is exact on both
sides.

`CurveLayerStub` stands in for the confidential layer there, and only because it compiles at a
different solc and needs a live Nox stack Foundry cannot drive. **Nothing it returns is evidence
about confidentiality.** Its own file says so.

### Against the real Nox stack AND real Midnight, on one chain

`confidential/test/90-quote-settlement.ts` — **17 demonstrations, one connected lifecycle**, at 192
cells per chunk. Real handles, a real KMS, a real runner, real gateway proofs; Midnight deployed from
the exact artifacts `forge build` produced.

Not seventeen isolated tests: the quote that rejects a partial fill is the quote that settles, which
is the quote that rejects the replay. Epoch → published aggregate matching the reference model →
public decryption → proof and graph binding → activation → wrong taker refused → partial fill refused
→ rollback → oversized refused → exact fill → credit and debt → exact token movement → consumption →
replay refused → cancellation → permissionless expiry and recovery → six substitutions refused →
tampered proof refused.

### In a real Chromium

`confidential/test/91-settlement-browser.ts` — **9 steps, all passing**, driving the settlement band
in the terminal. Epoch, handles fetched only after their producing stage, proofs verified, activation
by a real signed transaction, partial fill refused with the refusal named, rollback proven, exact fill
settled, credit/debt/tokens/consumption read back from chain state, replay refused.

The band shows the selected market, the selected rate, the executable aggregate fill, the maturity,
the borrower, the expiry, the proof-verification state, the activation state, the settlement state and
the resulting public credit and debt, with transaction links when a record carries an explorer. Every
number on it is read from chain state; the served record describes an epoch, never a quote.

### The Osaka limits

`confidential/test/09-osaka.ts` measures both, on both sides of each boundary: CLZ executes (S-1), and
a single transaction may not exceed 2^24 = 16,777,216 gas (S-2). `confidential/test/08-chunk-width.ts`
proves the registry accepts 192 and refuses 193 and 256 by name.

At 192 cells the full 16 × 128 universe re-measures at a peak of **14,984,397 gas** — 1,792,819 under
the cap — and the launch epoch is **25 transactions** rather than 22. `pnpm verify:gas-cap` is a
passing regression gate and names `cacheProviderChunk` as tight.

### The cross-compiler boundary

The settlement layer calls the confidential layer at 0.8.34 → 0.8.36, declaring the five entry points
rather than importing them, because the two compiler pins are mutually exclusive (Q-1).
`verify:curve-abi` compares selectors AND return shapes recursively. `verify:basenames` refuses two
compiled sources sharing a basename, which Foundry resolves by silently dropping one artifact.

---

## What is NOT proven, stated plainly

- **A curve reservation is not a capital lock.** The vault settles from PUBLIC funding and mints no
  confidential series ownership. Prerequisite P4-2 is open on purpose; delta S-6.
- **No 16 × 128 epoch has run on a public network.** It now fits the Osaka cap, but fitting is a
  measurement and not an execution. The Sepolia epoch is four cells.
- **Nothing is claimed about gas indistinguishability.** The settlement path has no confidential
  branch, so the measurement answers a narrower question and says so. Refusal gas is *unavailable* on
  the local node and is recorded as `null`, never as zero. `docs/phase4/SECURITY.md`.
- **`cacheProviderChunk` is 10.7% under the cap.** It fits today, on a local measurement, and testnet
  gas remains UNVERIFIED (AS-1).
- **One key holds all three roles on Sepolia.** Keeper, operator and curator are separate immutable
  constructor arguments; separating the keys is a deployment away and needs no code.
- **The borrower can still cancel a sealed request's bond.** Carried from Phase 3.

---

## Reproducing

```
pnpm install --frozen-lockfile
forge build
pnpm --filter @kyrve/confidential build
pnpm verify:phase4
```

The confidential settlement suite needs Docker and multi-gigabyte images. Without it the gate reports
**NOT VERIFIED** and exits non-zero rather than reporting green over an unexercised confidentiality
path.
