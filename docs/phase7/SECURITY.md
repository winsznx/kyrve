# Phase 7 security

The phase that put a browser in front of the protocol. The boundary did not move; the number of
places it can be crossed by accident went up.

---

## 1 · The three origins the page contacts, measured

`70-browser-flow.ts` records every request the page makes and asserts the set of origins:

```
http://127.0.0.1:8545     Ethereum RPC
http://127.0.0.1:<port>   Nox handle gateway
http://127.0.0.1:5173     the application's own server
Kyrve components contacted : 0 — the application origin received no body
browser storage written    : 0 keys
```

The gateway is where decryption necessarily happens and is not a Kyrve component. **No Kyrve server
receives a body at all**, and nothing is written to `localStorage`, `sessionStorage` or IndexedDB.
This is the measurement, not the promise.

Decrypted values live in one module-level `Map` in `lib/session.ts` and nowhere else. `lock()` deletes
them rather than marking them stale, so a screenshot taken a moment later cannot contain a private
balance.

---

## 2 · What locking is not

Locking clears decrypted values from memory. **It revokes nothing.** The wallet keeps every ACL grant
it held, because Nox has no `removeAdmin` and no `removeViewer`.

That sentence renders beside the lock button, and the Phase 2 browser suite asserts the product says
it. It regressed once during this phase — the control moved into the masthead and the sentence did
not follow — and the suite caught it. See F7-2.

The same vocabulary applies to capsules, and it is fixed by P7-3: **live access ended**, **future
snapshots disabled**, **this historical snapshot remains available**. Never "revoked", never "no
longer readable". `verify:web` fails the build on any of those phrases appearing on any route.

---

## 3 · The client-side redaction, and why it is a second implementation

viem's error formatting includes the full request URL. U-F1 is what that cost in Phase 6: an Alchemy
API key reached stdout twice, from two different scripts.

A browser hits the identical failure through the identical library and lands it somewhere worse — a
transport error rendered into the DOM is a credential in a screenshot. `apps/web/src/lib/redact.ts`
reduces every URL in a displayed message to scheme and host, then truncates. Every failure detail on
every screen goes through it before it reaches the DOM.

It is a deliberate copy of `scripts/lib/env.ts`'s rule rather than a shared module: that one reads
`process.env` and loads a `.env` file, and importing it would drag Node into the bundle.

**It does not claim to be a general sanitiser.** It narrows one measured hole. The structural rule —
no decrypted value reaches a log, a metric or a URL — is still carried by `verify:privacy-scan`.

---

## 4 · No private value reaches a URL

Every route parameter is a public identifier: a series id, a quote id, a capsule id. Never an amount,
never a handle paired with a plaintext, never a decrypted value.

A URL is the one piece of page state that lands in history, in a referrer header and in a screenshot,
so this is a structural rule rather than a habit — and it is why route parameters are the only way a
page addresses a subject.

---

## 5 · The downloadable artefact is checked before it is produced

A verification file is meant to be **sent to someone**. One carrying a private amount is a leak with a
checksum.

`downloadArtefact` serialises first and then refuses the result if it contains any value this browser
has decrypted, or a URL at all. A positive allow-list is not possible — a check's measured values are
legitimately arbitrary public hex — so the check is negative and runs against the live decrypted set.

`lib/session.ts` exposes `revealedValues()` for that one purpose, with a comment saying so. Nothing
else may call it, and `verify:privacy-scan` treats any other caller as a finding.

---

## 6 · The Worker attack surface is unchanged and unanalysed

Phase 7 created no Cloudflare resource and gave no Worker a key. `verify:phase7` proves the first by
checking that every binding still carries the placeholder id, and the second is true because no
`wrangler secret put` was run.

What has **not** changed since P7-2, and is Phase 8's problem:

- a Worker secret is a hot wallet — anyone with deploy rights can exfiltrate it, so value ceilings and
  target allowlists belong on chain;
- `console.log`, the tail consumer, metric labels and `observability` traces are four disclosure
  surfaces `verify:privacy-scan` does not read;
- only the **keeper's** work is delegable. Never a Worker holding the curator or the deployer.

---

## 7 · Static analysis: the gap, restated

The confidential contract layer has **no static-analysis coverage**. crytic-compile cannot be made to
drive solc 0.8.36, reproduced in delta U-5.

Phase 7 added a browser and four Workers. TypeScript in `workerd` gets none of Slither's detectors
either, and the compensating evidence for a Worker is not the same list as for Solidity. The gate
prints `UNVERIFIED BY SLITHER` on every successful run so the gap cannot become invisible through
familiarity, and `/proof/deployment` carries it as a `reported-not-verified` check so it reaches the
downloadable artefact too.

---

## 8 · What a decryption proof is

An EIP-712 signature by the Nox KMS attesting that a handle decrypts to a value. Verified against
`modules/Compute.sol::validateDecryptionProof` it is a **pure signature check**: no ACL, no nonce, no
expiry, no caller binding. A proof once issued is replayable by anyone forever and says nothing about
which computation the value belongs to.

It is **not a zero-knowledge proof** and no surface in this product calls it one. `/proof` states this
in prose, and every downloadable artefact carries the sentence in its header.

What makes a proof mean something is the binding — the handle registered for a role of a sealed epoch,
or recorded in a capsule, or in an order. The proof pages check the binding **first** and the
signature second.
