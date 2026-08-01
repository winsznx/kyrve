# How to use Kyrve

Kyrve turns encrypted lending terms and encrypted borrowing requirements into one executable
quote. The selected market, rate and aggregate become public when the quote is activated. The rest
of the curve, provider allocations, limits and beneficial ownership remain private.

**Live app:** https://kyrve.timjosh507.workers.dev

The network badge in the application is the source of truth for the deployment you have opened.
The public Sepolia deployment uses chain `11155111`. A local stack uses chain `31337`.

## Before you begin

You can browse the public parts of Kyrve without a wallet. A wallet is required only when you need
to sign, encrypt an input, or decrypt a value that has been granted to you.

Use an Ethereum wallet extension on the network shown in the app. On Sepolia, you need Sepolia ETH
for gas. The local stack supplies a local account for the browser flow.

Kyrve does not restore an ended wallet session after a refresh. Ending a session and locking it
clear locally decrypted values from browser memory. Neither action withdraws a Nox grant that the
wallet already holds.

## Privacy states

| State | What it means |
|---|---|
| **Encrypted** | The value exists, but is not readable on the page. It is never displayed as zero. |
| **Available to decrypt** | Your wallet has a grant, but no plaintext has been requested yet. |
| **Decrypted locally** | Plaintext held only in this browser's memory. |
| **Public** | A value published on chain. It remains public permanently. |

## Getting started

Open `/app/start` and follow four steps.

1. **Choose your workspace.** Choose **Provide capital**, **Request capital**, or **Verify**. A role
   changes the guidance and task order. It grants nothing and hides no route.
2. **Connect your wallet.** Connect the wallet that will sign the encrypted actions. You may
   continue without a wallet to use public pages. Select **Choose a different role** on this step
   whenever you need to return to the role cards.
3. **Check your connection.** Kyrve reports the network, wallet, configured confidential runtime,
   market availability and role. A check explains what will not work but does not block public use.
4. **Begin.** Go to the role's first valid task or open the workspace.

The **Working as** menu remains available in the account control. It lets you switch role at any
time, or choose a role again and restart onboarding. Changing or ending a wallet session does not
change your selected role.

## Navigation and account controls

Desktop navigation is grouped by the job it supports.

The labels below are exactly what the rail shows. Where a page's own title differs, it is given in
brackets — a reader hunting the sidebar for a page title would not find it otherwise.

| Group | Rail labels |
|---|---|
| — | Overview |
| Set up | Add capital (*Add private capital*) · Lending terms (*Set lending terms*) · Request a quote (*Request capital*) |
| Monitor | Activity (*What has happened*) · Private matching · Review a quote |
| Manage | Positions (*Settled positions*) · Move maturity · Disclosures (*Share a frozen disclosure*) |
| Verify | Verify the deployment (*Verify this deployment*) |

On a smaller screen, the persistent bottom bar has four destinations: **Home**, **Activity**,
**Positions**, and **Verify**. The full desktop navigation remains available at wider widths.

The account control shows the current role and connection state. When connected, it provides the
account and network controls supplied by the wallet, **Lock and clear** for decrypted values, and
**End session**. Locking and ending a session do not revoke prior grants.

## The workspace

### `/app` - Your workspace

The workspace starts with one current step. It then shows the small set of tasks relevant to the
selected role, followed by public deployment facts.

Before you connect, the workspace explains what can still be inspected: deployment verification,
settled records, and the privacy boundary around a wallet connection. It does not invent a private
balance or a matching result.

## Provide capital

### `/app/fund` - Add private capital

Wrap public loan tokens into a confidential ERC-7984 balance.

The amount you wrap is public in the transaction permanently. The confidential balance created
afterwards is encrypted. Connect your wallet to mint local test tokens where available, approve the
wrapper, wrap, and decrypt your own resulting balance locally.

Only wrap the market's configured loan token. A token with the same symbol is not necessarily the
asset the market uses.

### `/app/mandates` - Set lending terms

Submit the confidential terms that describe what you are prepared to lend, into which markets, and
at what minimum rate. The form names the public fields before you sign. The lending limits and rates
are encrypted in the browser before submission.

A mandate is not a capital reservation. Capital is reserved only when matching selects a result.
You can later replace or retire a mandate. Retiring is permanent.

### `/app/series` - Settled positions

Lists settled credit positions. A position records public settlement facts and offers the connected
provider a way to read their own confidential claim. From an individual position you can verify the
series, create a disclosure when a Capsule vault is available, or transfer it when a Cross book is
available.

### `/app/roll` - Move maturity

A roll transfers a confidential claim from one settled series to another. It requires two complete
series with the required market components. If the deployment does not have them, the page clearly
reports that there is no valid source and target pair. It does not show an empty maturity ladder.

### `/app/capsules` - Share a frozen disclosure

A capsule freezes one value at one block and gives one recipient access to that frozen snapshot. It
never grants the recipient access to the live value.

The recipient's grant is permanent. A capsule expiry controls whether the capsule still asserts its
facts. It does not make a historical snapshot unreadable.

### `/app/cross/:seriesId` - Transfer a position

This page exists for a specific settled series. A Cross order moves a confidential claim between two
parties without showing either balance publicly. If no Cross book is deployed for that series, Kyrve
reports the capability as unavailable rather than presenting an unusable order form.

## Request capital

### `/app/request` - Request capital

Submit a borrower request. The ETH bond is public. Your desired amount, minimum acceptable amount
and maximum rates are encrypted before the request leaves the browser. Connect the wallet that will
sign the request.

### `/app/curve` - Private matching

This is the public status surface for the encrypted matching run. It shows a deliberately redacted
field, not a chart with invented values. Only a selected quote becomes readable. If no matching run
has published a quote, the page says so and links to the mandate and request steps that must happen
first.

Measured operation costs and their limits are available under **Technical measurements**. They are
kept behind the workflow state so the status of matching is not buried beneath implementation detail.

### `/app/quotes` - Review a quote

Shows the quote record after matching has produced a real result. Verifying a candidate does not
reveal the rest of the curve. Activating one quote is the irreversible moment when the market, rate
and aggregate become public.

The resulting offer can settle only for the approved borrower and at the exact units. Partial fills
are refused by the series vault.

## Monitor activity

### `/app/activity` - What has happened

Activity is derived from public chain reads, not stored notifications. It shows the current role's
workflow first, followed by the events that this deployment can confirm for the connected wallet.
An empty activity view means the chain has no recorded activity for that wallet on this deployment.

## Verification

### `/proof` - Verify this deployment

Verification needs no wallet. Each page reads the deployment's chain in the browser and compares it
with the served deployment record. The record supplies identifiers but never determines the verdict.

The verification index links to deployment, series, quote and capsule checks. It also keeps the
important limits available without allowing them to obscure the checks a reviewer came to run.

| Verdict | Meaning |
|---|---|
| **Recomputed** | This browser read the chain and the expected values agree. |
| **Failed** | This browser read the chain and the values disagree. |
| **Not deployed here** | This deployment has no such component. |
| **Reported, not verified** | The record makes the claim, but this browser did not verify it. |

Verification is a recomputation at one named block. It is not an audit. Nox decryption proofs are
EIP-712 signatures from the Nox KMS. They are not zero-knowledge proofs.

## Local run

```bash
pnpm install
pnpm stack:local
pnpm demo:phase7
pnpm verify:phase7
```

`pnpm stack:local` starts the local chain, Nox services, settlement stacks, Workers and built web
application. It reports ready only after its health checks answer. `pnpm demo:phase7` drives the
real browser flow against that local stack.
