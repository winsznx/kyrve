---
description: Verified Nox capabilities, hard limits, and integration rules
globs: ["contracts/**", "packages/nox/**", "apps/web/**"]
---

# iExec Nox integration

Pinned versions in `source-lock.json`. Use `/nox-docs` for anything not listed here, and prefer
package source over documentation prose.

## The complete arithmetic surface

Verified against `sdk/Nox.sol@0.2.4`. This is everything that exists:

`add sub mul div safeAdd safeSub safeMul safeDiv eq ne lt le gt ge select transfer mint burn
toEbool toEuint16 toEuint256 toEint16 toEint256 fromExternal publicDecrypt` + ACL functions.

**Types: `ebool`, `euint16`, `euint256`, `eint16`, `eint256`. Nothing else** — no euint8/32/64/128,
no `eaddress`, no encrypted bytes.

**Does not exist — do not write code assuming it does:**
- `and` / `or` / `not` / `xor` — and `select` has **no `ebool` overload**, so booleans cannot be
  combined directly. Arithmetise: map each predicate to `euint16` 0/1 via `select`, multiply, then
  compare. Budget one op per conversion and one per combination.
- `min` / `max` / `rem` / `mod` / shifts / bitwise ops.
- `mul` with a plaintext operand — wrap the plaintext to a handle first.
- A fused `mulDiv`. `a * b / c` needs a separate `safeMul` then `safeDiv`; bound the intermediate
  so it cannot overflow `euint256`.
- Any batch entry point. **Every primitive is a separate external call.** Cost scales linearly with
  op count — budget it explicitly and split work across transactions.

## Silent failure modes

- Safe ops return `(ebool success, T result)`. On failure `success` is encrypted `false` **and the
  result is encrypted zero**. The transaction still succeeds. `success` is a ciphertext — you cannot
  branch on it in Solidity; thread it through `select`.
- Unsafe `div` by zero **does not revert**; it saturates to the type maximum.
- Unsafe `add`/`sub`/`mul` wrap silently.

Never let a silent zero become an allocation. Thread every success flag.

## Input binding

`Nox.fromExternal` binds the proof to owner, app contract, chain id, and a 3600 s expiry. The wallet
that encrypts **must be the direct caller** of the contract calling `fromExternal`. Never route a
user's proof through a relayer, paymaster, Safe module, batch router or server signer. Gas may be
reimbursed after the fact; the direct caller cannot change.

For multi-contract flows, validate once at the entry contract then propagate with `allowTransient`.

## ACL

`allowThis` / `allow` are persistent; `allowTransient` lasts one transaction. See
`.claude/rules/security.md` — **all persistent grants are irreversible**.

## Async lifecycle

On-chain calls return a result handle immediately; the actual computation is off-chain and
asynchronous. **There is no callback into your contract.** Readiness is discovered by polling
`POST {gateway}/v0/public/handles/status` — an endpoint used by the Hardhat plugin but absent from
the SDK and the docs, so treat it as unstable and wrap it.

The SDK's built-in retry gives up after roughly 7 seconds. Write a real polling loop with backoff.

## Networks

Ethereum Sepolia (11155111), Arbitrum Sepolia (421614), Hardhat local (31337). **No mainnet exists.**
The two testnets run different contract versions and different KMS keys — do not assume portability.
