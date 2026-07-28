---
description: Privacy boundaries, key handling, and the public/private contract
---

# Security and privacy

## The boundary is the product

Every value is exactly one of: **private now and after settlement**, **private now but public on
activation**, **public from submission**, or **public only on unwrap/redemption**. Any code or UI
that moves a value across that line must name the change at the point of action, before signing.

## Decrypted values

Decryption happens **only** in the authorised client. Never send a decrypted value to a server,
log line, metric label, database column, analytics event, error message, notification, or support
tool. Server components index handles, proofs, statuses, public amounts and receipts only.

## Confidential failure is not a public oracle

A private balance shortfall, provider exclusion, rate mismatch or exposure breach contributes
encrypted zero or leaves private state unchanged. Public reverts are reserved for public failures
(invalid proof, expired request, wrong chain, unregistered market, replayed quote, unauthorised
taker, altered offer, partial fill, unauthorised callback caller).

## Irreversible Nox grants

Verified against `sdk/Nox.sol@0.2.4`: there is **no** `removeViewer`, **no** `removeAdmin`, and
**no** way to un-set `allowPublicDecryption`. Only `disallowTransient` exists.

- Treat every viewer grant and every public-decryption mark as **permanent**.
- Transient access carries full persistent-grant power — any contract handed a transient handle can
  permanently publish it. Only pass transient handles to reviewed Kyrve contracts.
- Capsules use fresh snapshot handles. Auditors never receive access to live portfolio handles.
- The UI must never say "access revoked" for a handle a viewer could already decrypt. Use "live
  access ended", "future snapshots disabled", "this historical snapshot remains available".

## Decryption proofs are replayable

`validateDecryptionProof` is a pure signature check — no ACL, no nonce, no expiry, no caller
binding. Once issued, a proof is replayable by anyone forever. Kyrve must therefore bind the
*handle* to the specific request's operation graph; never treat "a valid proof exists" as proof that
the value belongs to this quote.

## Keys

Never commit key material. An Ethereum key in a Cloudflare Worker secret is a **hot wallet**:
anyone with deploy rights can exfiltrate it. Cap its balance and enforce value ceilings and target
allowlists **on-chain**, not in the Worker.

## ERC-7984 operators

An operator has **no per-amount allowance** — it can move the entire confidential balance, and an
operator on a wrapper can unwrap a holder's whole balance to any address. Always set a short,
explicit `until`. Never grant an unbounded-lifetime operator.
