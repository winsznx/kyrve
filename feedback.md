# iExec Nox: developer feedback

## Summary

We built Kyrve, a confidential fixed-income liquidity network, on iExec Nox over seven phases. It
turns encrypted lender mandates and one encrypted borrower requirement into a single executable
Morpho Midnight offer while the yield curve, provider allocations, exposure limits, rejected
alternatives and beneficial ownership stay private.

Nox did the hard part well. Ten findings follow, ordered by what each cost us to discover. Almost all
of them are documentation or local-environment defaults rather than protocol problems, which is the
better class of problem to have.

Kyrve records every correction to its own assumptions as a numbered delta. Where a finding below has
one, it is cited so the claim can be checked against the repository rather than taken on trust.

| # | Finding | Severity | Delta |
|---|---|---|---|
| 1 | The local node is more permissive than any real chain | High | R-10, R-12, S-1 |
| 2 | Safe operations fail silently into encrypted zero | High | — |
| 3 | Handles are deterministic, so distinct quantities alias | High | R-6 |
| 4 | Grants are permanent, which is also a copywriting problem | Medium | U-3 |
| 5 | The arithmetic surface is smaller than it first appears | Medium | — |
| 6 | Readiness polling is undocumented and the default is short | Medium | — |
| 7 | Decryption proofs authenticate a value, not its provenance | Medium | R-4 |
| 8 | The gateway returns plaintext at its natural width | Low | R-5 |
| 9 | Input proofs carry no nonce and no consumption marker | Medium | Q-2 |
| 10 | No static analysis reaches solc 0.8.36 | Medium | U-5 |

## Context

Everything below came out of a real build against the real stack. No finding is drawn from reading
documentation alone, and none is hypothetical.

| Component | Pinned at | Note |
|---|---|---|
| Nox protocol contracts | 0.2.4 | requires solc `^0.8.35` |
| Nox Hardhat plugin | pinned | default network had to be changed, see finding 1 |
| Confidential layer compiler | solc 0.8.36 | |
| Settlement layer compiler | solc 0.8.34 | matches the pinned Morpho Midnight release |

Kyrve's confidential contracts and its Midnight settlement contracts sit at two mutually exclusive
compiler pins, so they are separate projects bridged by a declared interface. That constraint
originates with `nox-protocol-contracts` requiring `^0.8.35`, and it is worth knowing about before
designing an integration that touches another pinned protocol.

## Findings

### 1. The local node is more permissive than any real chain

Three separate cases, each of which let a broken thing pass locally and fail later and more
expensively.

**Unlimited contract size.** Our curve engine compiled to 25,040 bytes of runtime code, 464 bytes
over EIP-170. The full local suite passed and Sepolia refused the deployment. The node cannot be
configured to enforce the limit either, because NoxCompute itself exceeds it, so we now measure every
artifact against EIP-170 in CI and treat the node as silent on the question.

**The plugin's default network is an OP chain at Isthmus**, where CLZ is an invalid opcode.
Everything deployed, a whole epoch completed, and then a Midnight call died with a bare
`invalid opcode` and nothing else. Reconfiguring the node to an L1 at Osaka fixed it. This cost hours
precisely because the failure names nothing about its cause. We now run a 250 ms fork check first in
the suite so it cannot cost them again.

**The node clock outruns wall clock** until every gateway proof looks expired.
`allowBlocksWithSameTimestamp` prevents it, and finding that required already suspecting the clock.

*Impact:* a class of deployment failure is converted into a class of local success, which is the most
expensive possible arrangement.

*Recommendation:* default the plugin to an L1 at a recent fork, and warn when a compiled artifact
exceeds EIP-170.

### 2. Safe operations fail silently into encrypted zero

`safeSub` returns `(ebool success, T result)`. On failure `success` is an encrypted false, the result
is an encrypted zero, and the transaction succeeds. Because `success` is a ciphertext, Solidity
cannot branch on it.

The design is defensible: a revert would publish the comparison the operation exists to hide. It is
also the easiest way to ship a loss nobody can see, because an encrypted zero flowing into an
allocation is indistinguishable from a legitimate allocation of zero. Unsafe `div` by zero saturating
to the type maximum rather than reverting is the same shape of problem.

We thread every success flag through `select` and test specifically for a silent zero reaching an
allocation.

*Impact:* the one finding here with a plausible path to real losses in a production system.

*Recommendation:* move this to the top of the arithmetic documentation, with the threading pattern
beside it. It is currently a note next to a method, which is where a developer meets it only after
designing around its absence.

### 3. Handles are deterministic in their operands, so distinct quantities alias

Compute the same operator over the same operands twice and you do not get two handles. You get one,
with one access list, permanently.

We met this designing selective disclosure. Two capsules over one balance came back byte-identical,
which meant granting the second recipient would have granted the first. We did not assume it: we
removed our isolation defence and watched the handles collide, which is delta R-6 and the reason we
now execute the negative case rather than reasoning about it.

The fix is mixing the recipient into the isolation domain, which is straightforward once known.

*Impact:* the code works and the grant is simply wider than intended, so this can ship undetected.

*Recommendation:* document handle derivation as a first-class property, with the collision shown as a
worked example. Anyone building per-user disclosure will hit it.

### 4. Grants are permanent, which is also a copywriting problem

There is no `removeViewer`, no `removeAdmin`, and no way to un-set `allowPublicDecryption`. Only
`disallowTransient` exists. Transient access is a full grant in practice, since any contract handed a
transient handle can permanently publish it.

The consequence we did not anticipate is linguistic. Kyrve can never say "access revoked" about a
handle somebody could already decrypt, because that sentence is false and a user would act on it. Our
interface says "live access ended", "future snapshots disabled" and "this historical snapshot remains
available", and getting there took a pass over every disclosure surface in the product.

*Impact:* teams will ship an interface that misstates what a grant does, in good faith.

*Recommendation:* a page on irreversibility that covers what permanence means for user-facing copy,
not only for contract design.

### 5. The arithmetic surface is smaller than it first appears

`sdk/Nox.sol` provides `add sub mul div safeAdd safeSub safeMul safeDiv eq ne lt le gt ge select
transfer mint burn` plus conversions. What is absent matters more, and we found each absence one at a
time by writing code that would not compile:

- No `and`, `or`, `not` or `xor`, and `select` has no `ebool` overload, so booleans cannot be
  combined at all. Every predicate maps to an `euint16` of 0 or 1 through `select`, then multiplies,
  then compares. That is two extra operations per predicate and it is not obvious until the third
  condition.
- No `min`, `max`, `rem`, `mod`, shifts or bitwise operations.
- `mul` has no plaintext overload, so a constant must be wrapped to a handle first.
- No fused `mulDiv`. `a * b / c` is a `safeMul` then a `safeDiv`, and bounding the intermediate so it
  cannot overflow is the integrator's responsibility.

*Impact:* gas cost, and a design that has to be resized once the real operation count is known.

*Recommendation:* one page listing the operations that do not exist and what to write instead. The
arithmetisation pattern for booleans deserves a worked example on it, because everyone building
anything conditional needs that pattern and currently derives it alone.

### 6. Readiness polling is undocumented and the SDK default is too short

There is no callback into your contract when an off-chain computation finishes. Readiness is
discovered by polling `POST {gateway}/v0/public/handles/status`, an endpoint the Hardhat plugin uses
and which appears in neither the SDK nor the documentation. We found it by reading plugin source, and
we wrap it as unstable because nothing promises it is not.

The SDK's built-in retry gives up after roughly seven seconds, far shorter than a real epoch takes.

*Impact:* every serious integration writes the same polling loop against an endpoint with no
stability guarantee.

*Recommendation:* promote the status endpoint to a supported API, or expose a first-class
`waitForHandle` with configurable backoff.

### 7. Decryption proofs authenticate a value, not its provenance

`validateDecryptionProof` is a pure signature check. No ACL, no nonce, no expiry, no caller binding.
Once issued, a proof is replayable by anyone forever, and it says nothing about which computation the
value belongs to.

Kyrve binds every handle to a specific request's operation graph before it will look at a proof, so
"a valid proof exists" never means "this value belongs to this quote". Reading the module source is
how we learned we needed to.

*Impact:* verifying a proof without having committed to the handle first leaves a replay hole that a
normal test suite cannot reach. No passing run ever supplies a proof for the wrong computation, so
the defect stays invisible until somebody supplies one on purpose.

*Recommendation:* state plainly that the proof covers the value and not its provenance, and that
binding is the integrator's responsibility. It is also worth saying these are signatures over a
released plaintext rather than zero-knowledge proofs; the word "proof" invites the wrong assumption,
and we say so explicitly on every surface of our own product for that reason.

### 8. The gateway returns plaintext at its natural width

A published `euint16` comes back as two bytes rather than ABI-padded to 32. `abi.decode` reverts with
no reason string, which leaves nothing to search for. We wrote a small helper.

*Impact:* minor once diagnosed, and undiagnosable from the error itself.

*Recommendation:* one sentence in the decryption documentation covers this completely.

### 9. Input proofs carry no nonce and no consumption marker

Nothing prevents the same proof being submitted twice. We added one-shot handle consumption and a
per-owner nonce on every entry point.

*Impact:* any integration handling value needs this and is currently inventing it independently.

*Recommendation:* a reference base contract, or a note pointing at the pattern.

### 10. No static analysis reaches solc 0.8.36

`crytic-compile` cannot be made to drive the compiler `nox-protocol-contracts@0.2.4` requires, so
Kyrve's confidential layer has no Slither coverage at all. We report it as `UNVERIFIED BY SLITHER` on
every gate run rather than folding it into a pass, but the gap is real and it is not ours to close.

*Impact:* a security blind spot shared by every project building on Nox, most of which will not know
they have it.

*Recommendation:* solc support upstream with the crytic maintainers, or a documented workaround.

## Minor observations

**Cost is linear in operation count and there is no batch entry point.** Every primitive is a
separate external call. Our launch epoch is 25 transactions and roughly 301 million gas. We can live
with that; what we could not do was predict it, and we sized the design by measuring after the fact.
Published per-primitive gas figures would let a team size a design before building it.

**The two testnets run different contract versions and different KMS keys.** We assumed portability
at first. A prominent statement of this would have been enough.

**The gateway's Docker host port is assigned at startup** and is visible only from inside the Hardhat
process. Everything else in an orchestrated stack has to be told what it is. A documented way to
discover it would simplify that considerably.

**`partial` is a reserved keyword in recent solc.** Not a Nox issue, but it bit us while writing Nox
contracts and cost a confusing few minutes.

## What works well

**The Hardhat plugin boots a real stack.** `@iexec-nox/nox-hardhat-plugin` brings up NoxCompute, the
KMS, the ingestor, the runner and the gateway in Docker, and nothing else in the toolkit did more for
how fast we could work. Every test we wrote runs against real handles and real gateway proofs. We never mocked a
confidential path, which matters because a mocked NoxCompute is a mocked confidentiality guarantee,
and a suite full of those would have told us nothing.

**Handles compose across contracts.** Passing an `euint256` between contracts and computing on it
without unwrapping is the property that made Kyrve's architecture possible at all. The curve engine,
the custody vault and the series token each hold part of one computation and none of them ever sees a
plaintext.

**`fromExternal` binding is the right default.** Binding an input proof to owner, application
contract, chain id and an expiry removes a class of replay bug before anyone writes a line. The
direct-caller requirement is strict, it ruled out relayers and smart accounts for us, and we think it
is correct.

**ERC-7984 behaves as documented.** Confidential balances held up across wrapping, transfers, minting
and burning. We built confidential ownership of a public credit position on top of it and hit no
surprise, which after ten findings is worth stating.

## Conclusion

We would build on Nox again, and the reason is in the shape of the findings rather than their number.
Almost everything that cost us time was documentation or a local-environment default. The protocol
did what it said it would. Missing documentation is recoverable by anyone; a protocol that quietly
does the wrong thing is not, and Nox is not that.

Findings 1 and 2 are the ones we would fix first. They are unrelated to each other, and both are
cases where the system's behaviour is reasonable but the developer meets it too late to design around
it.
