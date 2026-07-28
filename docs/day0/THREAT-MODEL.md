# Threat model

Updated 2026-07-28 with observed runtime behaviour. Threats are ranked by exploitability.

## T-1 · Gas-side channel on confidential failure — OPEN

Status, log count and event topic are identical across eligible, rate-ineligible, underfunded,
cap-constrained and market-disabled contributions. **Gas is not.** Four distinct values with a
2,974 gas spread (2.1%) were measured.

The variation is plausibly attributable to calldata zero-byte counts and cold/warm storage rather
than the private predicate — **but that was not proven.** An observer with many samples could
potentially distinguish outcomes.

*Mitigation for Phase 1:* a dedicated constant-gas review of every confidential entry point, with a
test that asserts identical gas across predicate values on identical calldata shapes. Until then,
do not claim gas indistinguishability.

## T-2 · Gateway key compromise is total confidentiality compromise — ACCEPTED

`NoxCompute` is a UUPS proxy whose upgrader can rotate the gateway signer, KMS key and proof
expiry. A single gateway key forges every input proof and every decryption proof, and decrypts
everything. iExec's own audit response records this as by design.

*Mitigation:* disclose it in the trust-assumption surface (PRD §20.1). It is not something Kyrve can
engineer around.

## T-3 · Irreversible grants and transient escalation — CONFIRMED AT RUNTIME

`addViewer` and `allowPublicDecryption` were both observed flipping false → true with **no inverse
in the ABI**. Additionally, a contract handed a *transient* handle can mint **persistent** admins or
permanently publish it.

*Mitigation:* only pass transient handles to reviewed Kyrve contracts. Auditors receive fresh
snapshot handles, never live portfolio handles. The UI must never say "access revoked".

## T-4 · Decryption-proof replay — CONFIRMED BY SOURCE

`validateDecryptionProof` is a pure signature check: no ACL, no nonce, no expiry, no caller binding.
A valid proof proves only *"the gateway attests handle H decrypts to V"*, never *"V belongs to this
quote"*.

*Mitigation:* `QuoteActivator` must verify H is the handle derived from **this request's** sealed
operation graph. This makes PRD §11.12 consensus-critical, not merely evidentiary.

## T-5 · Silent encrypted zero becoming an allocation — DESIGNED AGAINST

Safe operations return `(ebool success, T result)` and set result to encrypted zero on failure while
the transaction still succeeds. Unsafe `div` saturates on ÷0; `add`/`sub`/`mul` wrap.

*Mitigation, implemented in the spike:* `allocate` threads **both** the `safeMul` and `safeDiv`
success flags through `select`, so a silent zero cannot be mistaken for a real allocation.

## T-6 · ERC-7984 operator blast radius — CONFIRMED AT RUNTIME

No allowance function exists in the ABI. An operator can move the entire confidential balance and,
on a wrapper, unwrap a holder's whole balance to any address. Expiry **is** enforced.

*Mitigation:* always set a short explicit `until`. Never grant an unbounded-lifetime operator.

## T-7 · Keeper double-submission — DESIGNED AGAINST

Workflows retry steps by default (5 attempts, exponential backoff) and
`eth_sendRawTransaction` is not idempotent.

*Mitigation, implemented in the spike:* a Durable Object serialises nonce allocation per signing
key, allocated **before** the submitting step; `NonRetryableError` for terminal reverts.

## T-8 · Hot-wallet exfiltration — OPEN, POLICY

A key in a Worker secret is a hot wallet: anyone with deploy rights can exfiltrate it with a
one-line change. Cloudflare makes no custody or non-extractability claim.

*Mitigation:* cap the balance; enforce per-transaction value ceilings and target allowlists
**on-chain**, not in the Worker; restrict deploy permissions.

## T-9 · Public-RPC dependency — NEW, OPERATIONAL

`eth_getLogs` behaviour differs sharply between public providers: publicnode rejects it as archive,
1rpc caps at 50 blocks, drpc serves 200. An indexer silently degrades if the provider changes policy.

*Mitigation:* pin the provider, monitor for policy errors, and treat range limits as configuration.

## T-10 · Quote probing / curve extraction — UNCHANGED

Repeated activations could let an observer infer curve shape from published winners.

*Mitigation:* short quote lifetime, rate limiting, and the privacy floor — which was proven to
contribute encrypted zero rather than a public reason.
