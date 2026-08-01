# Feedback on the iExec Nox tools

Written after building Kyrve, a confidential fixed-income liquidity network, on Nox over seven
phases. Everything below came out of a real build against the real stack. Where a point cost us
time, the file and the delta that records it are named so the claim can be checked.

We shipped on Nox and would choose it again. The feedback is specific because generic praise is not
useful to anyone.

---

## What worked well

**The Hardhat plugin boots a real stack.** `@iexec-nox/nox-hardhat-plugin` bringing up NoxCompute,
the KMS, the ingestor, the runner and the gateway in Docker is the single best thing about the
developer experience. Every test we wrote runs against real handles and real gateway proofs. We
never had to mock a confidential path, which matters because a mocked NoxCompute is a mocked
confidentiality guarantee.

**Handles compose across contracts.** Passing an `euint256` from one contract to another and
computing on it without unwrapping is the feature that made our architecture possible. The curve
engine, the custody vault and the series token each hold part of a computation and none of them ever
sees a plaintext.

**`fromExternal` binding is the right default.** Binding an input proof to owner, application
contract, chain id and an expiry removes a whole class of replay bug before anyone writes a line.
The direct-caller requirement is strict and we agree with it.

**ERC-7984 works.** Confidential balances behaved as documented across wrapping, transfers, minting
and burning. We built confidential ownership of a public credit position on top of it and did not
hit a surprise.

---

## What cost us the most time

### 1. The arithmetic surface is smaller than it first appears, and the gaps are not listed together

`sdk/Nox.sol` gives `add sub mul div safeAdd safeSub safeMul safeDiv eq ne lt le gt ge select
transfer mint burn` plus conversions. What is absent matters more, and we found each absence one at a
time by writing code that did not compile:

- no `and`, `or`, `not` or `xor`, and `select` has no `ebool` overload, so booleans cannot be
  combined at all. Every predicate has to be mapped to an `euint16` of 0 or 1 through `select`, then
  multiplied, then compared. That is two extra operations per predicate and it is not obvious until
  you need your third condition.
- no `min`, `max`, `rem`, `mod`, shifts or bitwise operations.
- `mul` has no plaintext overload, so a constant has to be wrapped to a handle first.
- no fused `mulDiv`, so `a * b / c` is a `safeMul` then a `safeDiv` and you have to bound the
  intermediate yourself so it cannot overflow.

**Suggestion.** A single page titled "operations that do not exist and what to write instead" would
have saved us most of a day. The arithmetisation pattern for booleans in particular deserves a
worked example in the docs, because everyone building anything conditional will need it.

### 2. Silent failure on safe operations is the sharpest edge in the whole SDK

`safeSub` returns `(ebool success, T result)`. On failure `success` is an encrypted false **and the
result is an encrypted zero**, and the transaction succeeds. You cannot branch on `success` in
Solidity because it is a ciphertext.

This is defensible and it is also the easiest way to ship a bug that nobody can see. An encrypted
zero flowing into an allocation looks exactly like a legitimate allocation of zero. We had to thread
success flags through `select` on every path and add tests that specifically look for a silent zero.

Unsafe `div` by zero saturating to the type maximum instead of reverting is the same shape of
problem.

**Suggestion.** Put this at the top of the arithmetic documentation rather than in a note. A short
section called "your computation can fail without telling you" with the threading pattern would
prevent real losses in production systems.

### 3. Handles are deterministic in their operands, which creates an aliasing trap

Two logically distinct quantities computed identically from identical inputs are **one handle** with
**one permanent ACL entry**. We hit this designing selective disclosure: two capsules over one
balance came back byte-identical, so granting the second recipient would have granted the first as
well.

We proved it by removing our isolation defence and watching the handles collide. The fix is mixing
the recipient into the isolation domain, which is straightforward once you know. Knowing is the hard
part.

**Suggestion.** Document handle derivation as a first-class property with a worked example of the
collision. Anyone building per-user disclosure will hit this and may not notice, because the code
works and the grant is simply wider than intended.

### 4. ACL grants are permanent and the documentation is quiet about the consequences

There is no `removeViewer`, no `removeAdmin`, and no way to un-set `allowPublicDecryption`. Only
`disallowTransient` exists.

This shaped our product language everywhere. We can never say "access revoked" for a handle somebody
could already decrypt, so our interface says "live access ended", "future snapshots disabled" and
"this historical snapshot remains available". Transient access is also a full grant in practice,
since any contract handed a transient handle can permanently publish it.

**Suggestion.** A page on irreversibility, covering what it means for user-facing copy, would help
teams avoid shipping an interface that lies about what a grant does. This is a product problem as
much as a technical one.

### 5. Readiness polling is undocumented and the SDK default is too short

There is no callback into your contract when an off-chain computation finishes. Readiness is
discovered by polling `POST {gateway}/v0/public/handles/status`, an endpoint the Hardhat plugin uses
and which does not appear in the SDK or the documentation. We found it by reading plugin source.

The SDK's built-in retry gives up after roughly seven seconds, which is far shorter than a real
epoch takes.

**Suggestion.** Document the status endpoint as a supported API, or expose it through the SDK as a
first-class `waitForHandle` with configurable backoff. Right now every serious integration has to
write the same polling loop against an endpoint that is not promised to be stable.

### 6. The local node is more permissive than any real chain, in three ways

Each of these let a broken thing pass locally and fail later:

- **Unlimited contract size.** Our curve engine compiled to 25,040 bytes of runtime code, 464 over
  EIP-170. The full local suite passed. Sepolia refused the deployment. We now measure every
  artifact against EIP-170 in CI because the node will never tell us.
- **The default network is an OP chain at Isthmus.** CLZ is an invalid opcode there. Everything
  deployed, a whole epoch completed, and then a Midnight call died with a bare `invalid opcode` and
  no other information. We had to reconfigure the plugin's node to an L1 at Osaka. This one cost
  hours because the failure names nothing about its cause.
- **The node clock outruns wall clock** until every gateway proof looks expired.
  `allowBlocksWithSameTimestamp` fixes it, and finding that required knowing what to suspect.

**Suggestion.** Ship the plugin defaulting to an L1 at a recent fork, or warn loudly when a
contract exceeds EIP-170. A local environment that is more permissive than production is a local
environment that hides your bugs until the worst moment.

### 7. The gateway returns plaintext at its natural width

A published `euint16` comes back as two bytes, not ABI-padded to 32. `abi.decode` reverts with no
reason string. We wrote a small helper to handle it, but the failure gives you nothing to search
for.

**Suggestion.** One sentence in the decryption documentation would cover this completely.

### 8. Decryption proofs are replayable and this deserves more emphasis

`validateDecryptionProof` is a pure signature check. No ACL, no nonce, no expiry, no caller binding.
A proof once issued is replayable by anyone forever and says nothing about which computation the
value belongs to.

We bind every handle to a specific request's operation graph before we look at a proof, so "a valid
proof exists" never means "this value belongs to this quote". Reading the module source is how we
learned we needed to.

**Suggestion.** State plainly in the docs that a decryption proof authenticates a value and not its
provenance, and that binding is the integrator's responsibility. Also worth saying clearly that these
are signatures over a released plaintext and not zero-knowledge proofs, since the word "proof"
invites the wrong assumption. We are careful to say this on every surface of our product.

### 9. Input proofs carry no nonce and no consumption marker

Nothing stops the same proof being submitted twice. We added one-shot handle consumption and a
per-owner nonce on every entry point.

**Suggestion.** This is a common enough requirement that a reference base contract, or a note
pointing at the pattern, would help. Every integration handling value will need it.

### 10. No static analysis reaches solc 0.8.36

`crytic-compile` cannot be made to drive the compiler that `nox-protocol-contracts@0.2.4` requires.
Our confidential contract layer therefore has no Slither coverage. We report it as unverified on
every gate run rather than folding it into a pass, but the gap is real and it is not ours to close.

**Suggestion.** Working with the crytic maintainers on solc support, or publishing a documented
workaround, would remove a genuine security blind spot for every project on Nox.

---

## Smaller notes

- **Cost is linear in operation count and there is no batch entry point.** Every primitive is a
  separate external call. Our launch epoch is 25 transactions and roughly 301 million gas. We can
  live with that, and we had to discover the shape of it by measuring. Published per-primitive gas
  figures would let teams size a design before building it.
- **The two testnets run different contract versions and different KMS keys.** We assumed
  portability at first. Saying so prominently would help.
- **The gateway's Docker host port is assigned at startup** and is only visible from inside the
  Hardhat process. Everything else in our stack has to be told. A documented way to discover it
  would simplify orchestration.
- **`partial` is a reserved keyword in recent solc.** Not a Nox issue, but it bit us while writing
  Nox contracts and cost a confusing few minutes.

---

## Would we build on Nox again

Yes. The core idea works, composability holds, and the Hardhat plugin gave us a real stack to test
against from day one. Most of what cost us time was documentation rather than the protocol, which is
the better problem to have.

The two changes with the highest impact, if we could pick only two:

1. **A page on silent failure**, covering encrypted-zero results from safe operations and the
   threading pattern that handles them.
2. **A page on handle determinism and permanent grants**, with the aliasing collision shown as a
   worked example.

Both are documentation. Neither requires a protocol change. Together they would remove the two
sharpest edges we found.
