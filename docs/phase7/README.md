# Phase 7 — the web product

Nineteen routes, three journeys, one design system, and a verification surface that recomputes rather
than displays. Nothing was deployed to Cloudflare.

Run `pnpm verify:phase7`. Read `PHASE-8-PREREQUISITES.md` before starting deployment — P8-0 names the
two things this phase was asked for and did not deliver.

---

## Layout

```
apps/web/src/
  App.tsx              the route table. Nineteen paths, each with a title and a description
  router/router.tsx    a segment matcher, real anchors, and the document title
  layout/Shell.tsx     masthead, navigation, footer, disclosure. No cobalt, anywhere
  lib/
    lifecycle.ts       the closed state vocabulary
    records.ts         the served record, normalised into layers
    artefact.ts        the downloadable verification, and its four verdicts
    redact.ts          client-side URL redaction, because viem formats URLs into errors
    context.tsx        reading and signing, deliberately separate
  routes/              one file per route
  components/          the pieces routes share
scripts/verify/web.ts  every route, in a real Chromium, against the built bundle
scripts/phase7/gate.ts the gate
```

---

## Five things that are easy to get wrong here

**A typed route is a different code path from a clicked one.** `/app/series/0x…` entered in the
address bar reaches the server, not the router — so the failure is the server's history fallback and
is invisible from inside the application, because clicking never exercises it. `appType: "spa"` gives
dev and preview a fallback, no route holds client-only state, and `verify:web` enters all nineteen
directly rather than navigating to them.

**"Loading" is not a state.** Kyrve's latency comes from a confidential computation with no callback.
`lib/lifecycle.ts` is a closed union, so a fourteenth ad-hoc state fails to compile rather than
shipping as a string nobody wrote copy for. The four terminal states are not interchangeable, and
`unavailable` is the one that gets collapsed by accident — a page reporting a timed-out node as
"failed" has told the reader the protocol refused them.

**Layer A and layer B stay separate records.** `records.ts` normalises the served JSON into a LIST of
issuance stacks and offers no accessor for "the" series. Asking for one without saying which is the
bug `scripts/lib/layer.ts` exists to prevent, and a route parameter this deployment does not know
renders as "not on this deployment" rather than falling back.

**viem serialises the request URL into every transport error.** That reached stdout twice in Phase 6
(U-F1). In a browser it reaches the DOM, and from there a screenshot and a support channel.
`lib/redact.ts` is a deliberate second implementation of `scripts/lib/env.ts`'s rule, because that
module reads `process.env` and cannot enter a bundle.

**A verification page that renders the record has verified nothing.** Every check states a fact, reads
the chain, and compares. Demonstration 24 proves it the only way it can be proven: the served record
is rewritten with a false series id and the page has to turn that row red on its own.

---

## The four verdicts

| Verdict | Means |
|---|---|
| `verified` | a fact was stated, the chain was read for it, and they agree |
| `failed` | a fact was stated, the chain was read for it, and they disagree |
| `unavailable` | the check could not run. Not a pass and not a fail (P7-4) |
| `reported-not-verified` | something a **record** asserts that this browser did not check |

The fourth exists because Phase 6 shipped without static analysis over the confidential layer, and
P7-1 requires Phase 7 not to let a green page imply otherwise. An artefact with three labels has
nowhere to put "the record says 43 contracts are verified on Etherscan and this page did not call
Etherscan" — so it would be dropped, which hides it, or listed as verified, which misstates who
checked.

---

## Brand

The dark header renders the lowercase `kyrve` wordmark **set as text** in Ivory. The approved symbol
master is authored for light surfaces — 0.0% of its opaque pixels clear 4.5:1 against Onyx, at a
median of 1.30:1 — and `brand.json` forbids recolouring it, plating it, or rendering it on Onyx. The
interim ends when the reversed master is delivered and passes acceptance.

The positive master still ships, unmodified, as the favicon, the Open Graph card and the CTA panel.
Those are light surfaces composited by the browser and by the sharing platform, not by Kyrve. The
gate refuses a build that references the symbol master anywhere in the application source.

Assets are served from the repository's `public/`, where `pnpm brand:verify` checks their hashes —
never copied into the app first, because a derivative of a derivative cannot be re-derived.

---

## What this phase does not claim

- **`verify:web` is not an accessibility audit**, and says so on every run.
- **No Cloudflare resource was created.** The Workers compile under `--dry-run`, which publishes
  nothing and needs no authentication.
- **The confidential layer has no static-analysis coverage**, and adding a browser and a set of
  Workers did not change that — they get none of Slither's detectors either.
- **The roll is minimal.** One intent against one supply between two series. The interface shows no
  maturity ladder, no roll-to-any-series control and no queue, because none exists.
