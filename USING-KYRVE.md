# How to use Kyrve

Every page in the deployed application, what it is for, and what to do on it.

**Live:** https://kyrve.timjosh507.workers.dev · Ethereum Sepolia (chain 11155111)

Written by reading the deployed pages. Where a page reports something as absent, this guide says so
rather than describing what it would show if it were there.

---

## Before anything

**You need a browser extension wallet** on Ethereum Sepolia — MetaMask, Zerion, Rabby, Coinbase.
There is no QR code: Kyrve dropped WalletConnect because it contacted two third-party origins on
every page load, and the terminal is meant to contact exactly two things, the Nox gateway and the
chain.

**You need Sepolia ETH** for gas, and nothing else. The test token has an open mint and the
interface will mint it for you.

**Nothing is persisted.** Reloading ends your session and you reconnect. That is deliberate: a page
that reopened a session on load would silently reopen one for somebody who had just locked it to
clear a decrypted balance off the screen.

**Public pages need no wallet at all.** The entire verification surface, the settlement evidence and
every address on every page work while disconnected. Only your own confidential values need a signer.

---

## The four confidentiality states

These appear throughout and always mean the same thing.

| State | Means |
|---|---|
| **encrypted and unavailable** | A value exists and you hold no grant on it. Shown as redacted structure, never as a zero. |
| **available to decrypt** | You hold a grant. Nothing has been decrypted yet. |
| **decrypted locally** | Plaintext, in this browser's memory only. Never sent anywhere. |
| **intentionally public** | Published on chain, permanently, and the page says when that happened. |

---

## Getting in

### `/` — the landing page

The argument, and one real settled quote with four encrypted rows and one public number. The
transaction link under it goes to the actual Sepolia settlement.

**Do:** click **Enter the terminal**.

### `/app/start` — onboarding, four steps

1. **Choose your role.** *Provide capital*, *Request capital*, or *Verify*. This changes what you are
   shown first. It grants nothing and hides nothing, and every page stays reachable whichever you
   pick. Change it any time from the session block at the foot of the left rail.
2. **Connect your wallet.** It must be the wallet that signs. Every encrypted input is bound to its
   direct caller, so there is no read-only mode and no relayer that can stand in for one.
3. **Check readiness.** Five live checks: network, wallet, confidential runtime, market, role. The
   third one asks the Nox gateway whether it is reachable rather than assuming it.
4. **Begin.** Drops you into the first thing your role actually does.

You can skip the wallet at step 2 and still use every public page.

---

## The left rail

Eleven destinations in four groups. On a narrow window the rail collapses and four destinations move
to a bar at the bottom of the screen.

| Group | Pages |
|---|---|
| — | Overview |
| **Capital** | Add capital · Lending terms · Request a quote |
| **Market** | Activity · Private matching · Review a quote |
| **Holdings** | Positions · Move maturity · Disclosures |
| **Evidence** | Verify the deployment |

At its foot: your role, connection state, address, how many decrypted values are held in this
browser, and the controls to lock, switch account, switch network or end the session.

**Locking is not revocation.** It clears decrypted values from memory. It withdraws no grant,
because Nox has no way to withdraw one.

---

## Provider journey

### `/app/fund` — Add capital · *"Confidential balance"*

Moves a public ERC-20 balance into a confidential ERC-7984 one.

**What is public:** the amount you wrap. It is a plain `uint256` in calldata and it is public
permanently. That is unavoidable and it is the honest cost of entering the confidential layer from a
public token. Everything after it is encrypted.

**Do:**
1. **Test tokens** card — mint yourself tUSDC. The token has a permissionless `mint`, so any reviewer
   can fund themselves.
2. **Wrap** — enter an amount and click through. **Three wallet prompts**: mint, approve, wrap.
3. **Private balance** — click *Decrypt confidential balance locally*. Decryption happens in your
   browser. No Kyrve server, log, metric or database receives the result.

**Watch for:** the wrapper wraps the market's own loan token, not merely a token named "test". Two
different test tokens exist on this chain and only one is the market's; using the wrong one produces
a balance the application cannot see.

### `/app/mandates` — Lending terms · *"Lending mandate"*

How much you will lend, into which markets, at what minimum rate. All encrypted.

**Every submission carries 35 handles** whether you enable one market or eight. The unused slots hold
encrypted zeros, so the shape of your strategy is not readable from the transaction size.

**Do:** fill in total budget, per-market caps and minimum rate indexes, then **Seal encrypted
mandate**. The page lists exactly what becomes public the moment you sign — your address, the
universe id, the epoch, a schema version, the block timestamp, and a commitment over the handle
references. Not over any value.

**A mandate is an offer, not a reservation.** Capacity is reserved only when an epoch runs and
selects a leaf, and that reservation moves real capital out of your confidential balance in one
subtraction, inside the same contract that holds the coverage backing it.

You can replace or retire a mandate later. Retiring has no undo.

### `/app/series` — Positions · *"Series"*

What a settled quote leaves behind: a public credit position at Midnight, and confidential claims on
it. The credit is public; who owns how much of it is not, and cannot be derived from this page.

Shows the series id, maturity, the Midnight market, the series vault that acts as the maker, and the
settled quote. From here you can verify the series from chain state or transfer out of it.

### `/app/capsules` — Disclosures · *"Capsules"*

A capsule freezes one value at one block and grants one recipient the ability to decrypt **that
frozen copy** — never the live handle.

**The grant is permanent.** Nox has no way to withdraw one. What a capsule's expiry governs is
whether the capsule still *asserts*, not whether its recipient can still read the snapshot it froze.
The interface will never tell you access was revoked, because that would be false.

---

## Borrower journey

### `/app/request` — Request a quote · *"Borrower request"*

Deliberately asymmetric. The bond is ETH and its value is visible; the expiry and the exact-fill
requirement have to be agreed by every verifier. What stays encrypted is the part a provider could
quote against: how much you want, the least you would accept, and every maximum rate you would pay.

**19 handles per submission, always** — same padding logic as a mandate.

### `/app/quotes` — Review a quote · *"Quotes"*

One confidential epoch produces one leaf: a market, a rate and an aggregate amount.

**Verifying costs nothing and reveals nothing. Activating is irreversible** — it is the moment those
three become public, and it can happen once per epoch, forever.

The page lists quotes that already settled. Each has its own page where every number is read from
chain state.

**Exact fill is enforced twice** and neither check can do it alone: `isRatified` is a view and never
receives the fill size, and Midnight itself permits a partial fill, so the vault's `onBuy` is the
only place actual size reaches maker code.

---

## Shared pages

### `/app/activity` — *"What has happened"*

Every line is a public fact read from the chain at page load, not a stored notification. Nothing here
is decrypted.

An empty feed means the chain has no record of this wallet acting on this deployment — not that
something failed to load.

### `/app/curve` — Private matching · *"Confidential curve"*

Where it resolves. Eligibility, capacity, the privacy floor and leaf selection are computed entirely
on encrypted values, and exactly one leaf is published. Everything rejected — every other leaf, every
provider allocation, every capacity — stays encrypted.

The redacted chart is drawn from geometry constants, not from any measurement. There is nothing in it
to recover.

**On the current deployment no epoch has finished**, and the page says so rather than rendering
stages that never ran. An epoch is minutes of off-chain computation against a real Nox stack, driven
one stage at a time because every encrypted primitive is a separate transaction. This page cannot
start one. Locally, `pnpm stack:local` brings up everything and the browser demonstration drives a
whole epoch end to end.

### `/app/roll` — Move maturity

**Needs two complete series, and this deployment has one.** One custody vault serves exactly one
series, because `bindSettler` is one-shot and the settler holds its series, token, ownership
registry, vault and market as immutables. A second maturity therefore needs a second engine, epoch
controller, graph registry, ledger and settlement layer.

The page says that rather than showing an empty ladder, because a maturity ladder on a
one-series deployment would describe a system that does not exist.

---

## Verification — `/proof`

The part a reviewer should care about most. **It needs no wallet and no key**, so you can run it
against a deployment you do not control.

Every check states a fact, reads this chain for it, and compares. The deployment record supplies
addresses and identifiers and is **never** the source of a verdict. Where the record and the chain
disagree, the check fails and shows both — the chain is what is true.

### Four verdicts, and two are neither pass nor fail

| Verdict | Means |
|---|---|
| **recomputed** | This browser read the chain and the values agree. |
| **failed** | This browser read the chain and they do not. Both values are shown. |
| **not deployed here** | The contract was never deployed for this layer. Calling that a pass or a failure would be a lie in one direction. |
| **reported, not verified here** | The record asserts it and this browser did not check it. Listed rather than dropped, so it cannot be mistaken for a recomputation. |

### Sub-pages

- **Deployment** — every address checked for deployed code, the compiler pin each layer was built
  with, and the source-verification status the records report. Names the block it checked.
- **Series** — identity, the published aggregate against the live supply handle, public coverage, and
  every market-layer binding.
- **Quote** — terms, offer hash, exact fill and the resulting position.
- **Capsule** — verified by id, from a capsule you hold.

### What these pages are not

A recomputation at one block, by one browser, over the checks each page lists. **Not an audit**, and
it says nothing about any block other than the one named.

Values published through the Nox handle gateway carry decryption proofs — EIP-712 signatures by the
Nox KMS attesting that a handle decrypts to a value. **They are not zero-knowledge proofs and Kyrve
never calls them that.** A proof once issued is replayable by anyone forever and says nothing about
which computation the value belongs to.

---

## What this deployment does not have

Stated plainly so nothing here reads as broken when it is not.

- **No finished epoch.** `/app/curve` and the live half of `/app/quotes` need one. Run the full
  epoch locally with `pnpm stack:local`.
- **One series, so no roll.** `/app/roll` explains why a second needs a whole second stack.
- **No Slither coverage on the confidential layer.** `crytic-compile` will not drive solc 0.8.36.
  Reported as `UNVERIFIED BY SLITHER` on every gate run, never as a pass.

---

## Running it yourself

```bash
pnpm install
pnpm stack:local     # chain, Nox stack, gateway, two issuance stacks, workers, web app
pnpm demo:phase7     # drives the browser demonstration end to end
pnpm verify:phase7   # the phase gate
```

`pnpm stack:local` does not report READY until every health check answers.
