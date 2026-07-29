# Gas side channel — V-24 / T-1 investigation

**Verdict: the Day 0 finding was a measurement artifact. There is no predicate-driven gas leak in
the evidence, and there never was — but the claim of gas indistinguishability still must not be
made.** Both halves of that sentence matter.

Raw data: [`evidence/phase1/gas-side-channel.json`](../../evidence/phase1/gas-side-channel.json).
Reproduce: `cd spikes/nox && npx hardhat test test/05-gas-side-channel.ts` (needs Docker).

---

## What Day 0 concluded, and why it could not

Day 0 ran five "scenarios" through `NoxIndistinguishable.contribute`, observed **four distinct gas
values with a 2,974 spread**, and recorded V-24 as **FAIL, open** with THREAT-MODEL T-1 warning that
"an observer with many samples could potentially distinguish outcomes".

That conclusion could not be supported by that experiment, for a reason visible in its own inputs:

| Day 0 scenario | amount | eligible |
|---|---:|---:|
| eligible | 1000 | 1 |
| rate-ineligible | 1000 | **0** |
| underfunded | 0 | 1 |
| cap-constrained | 1000 | **0** |
| market-disabled | 1000 | **0** |

Three of the five scenarios supply **identical inputs**. `rate-ineligible`, `cap-constrained` and
`market-disabled` are one case wearing three labels. Any gas difference between them is by
construction not predicate-driven, because there is no predicate difference to drive it.

So the "four distinct values" measured two things at once — the predicate, and everything else that
varies between sequential transactions — and attributed all of it to the predicate.

Day 0 was right to refuse the indistinguishability claim. It was wrong about the cause.

## The controlled experiment

Three parts, each isolating one effect the original conflated.

### A. Noise floor — one identical input, repeated six times

```
139406, 142368, 142368, 142380, 142380, 142380
spread 2974 gas across 3 distinct values
calldata: 548 bytes, constant
```

**The 2,974 spread reproduces exactly, on inputs where nothing varies.** The first call is ~2,974
gas cheaper than every subsequent one — the signature of a cold-to-warm storage transition on the
accumulator slot, not of a private predicate.

This alone accounts for the entire Day 0 finding.

### B. Predicate — eligible and rejected interleaved

Interleaving matters: if eligible cases always ran first, position and predicate would be
confounded exactly as they were in Day 0.

```
eligible : 139418, 142368, 142380   (spread 2962)
rejected : 142380, 142368, 142380   (spread 12)
groups fully separated by gas: false
```

The eligible group's low value is its **first** transaction. Its other two sit inside the rejected
group's range. **Gas tracks position, not the predicate.** Separation: none.

### C. Rejection reason — flag-false versus zero-amount

Two genuinely different rejection causes, which Day 0 never varied independently:

```
flag-false : 139418, 142380, 142368   (spread 2962)
zero-amount: 142368, 142380, 142380   (spread 12)
rejection reason separable by gas: false
```

Not separable.

## Verdict

| Measure | Result |
|---|---:|
| noise floor, identical inputs | **2,974 gas** |
| predicate gap, eligible vs rejected | **0 gas** |
| rejection reason separable | **no** |

A gap smaller than the spread observed on identical inputs cannot be attributed to the predicate.
The predicate gap is zero.

**`NO LEAK ABOVE THE NOISE FLOOR`.**

## The residual, stated plainly

A stable **12 gas** jitter appears in every group regardless of predicate: values cluster at 142,368
and 142,380. Calldata length is constant at 548 bytes, so this is not length. It is almost certainly
**zero-byte composition** — calldata costs 4 gas per zero byte and 16 per non-zero, and each
encrypted input is a fresh ciphertext with a different byte distribution. A 12-gas difference is
three zero bytes.

That is ciphertext randomness. It is uncorrelated with the plaintext by design, and it appears
identically in eligible and rejected groups.

## What this does NOT establish

The honest limits, because this is the kind of result it would be easy to overclaim:

- **Small sample.** Three transactions per group, six for the noise floor. Enough to show the
  predicate gap is zero against a 2,974 noise floor; not enough to bound a sub-10-gas effect.
- **Toy contract.** `NoxIndistinguishable` performs one `select` and one `add`. The real curve
  engine performs five operations per cell across a multi-transaction epoch, and its storage
  access pattern is different.
- **Local stack only.** Testnet gas accounting is unverified (AS-1).
- **Gas is one channel.** Timing, handle count and transaction ordering are not measured here.

## Consequence for the threat model

T-1 is **reclassified from OPEN-FAIL to NOT-SUPPORTED-BY-EVIDENCE**, with the residual above.

Kyrve **still must not claim gas indistinguishability.** Nothing here proves the absence of a leak;
it proves the Day 0 evidence never showed one. The correct public statement remains: Kyrve does not
claim gas indistinguishability, and the confidential-failure guarantee rests on public status, log
count and event topic being identical — which Day 0 did prove, and which this run reconfirms.

The Phase 2 obligation is unchanged: when the real curve engine exists, repeat this experiment
against it, with position controlled for and a sample large enough to bound the residual.
