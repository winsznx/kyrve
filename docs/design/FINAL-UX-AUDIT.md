# Final UX audit

Written before the refinement, from the current product, `design.md`, `brand.json`, the Phase 7 gates
and screenshots, and the two external skills read in `/tmp` (not vendored, not committed).

**Source precedence used throughout:** the owner's instruction, then `design.md`, then Kyrve's product
behaviour and confidentiality model, then the approved brand assets, then the external skills for
structure and method only, then the supplied references for composition and texture only.

---

## What the external skills contribute, and what they do not

Both skills are strong on *method* and carry a concrete visual system that is not Kyrve's. The split
is deliberate and is applied everywhere below.

| Taken | Rejected, and why |
|---|---|
| Section ordering: hero → tagline reveal → problem → mechanism → proof → FAQ → final CTA | Geist/Manrope/Poppins. `design.md` specifies arcadia and arcadiaDisplay with an intermediate weight scale; the type system is the brand |
| One offer, one audience, one primary action; never competing CTAs above the fold | Tailwind spacing and radius scales. Kyrve has its own 4px scale, 12px cards and 32/40px pills |
| The mandatory tagline-reveal section, word-by-word on `IntersectionObserver`, never an unthrottled scroll listener | The dark background set `#000000`/`#181818`/`#1F1F1F`. Onyx `#171721` and Graphite `#1e1e2a` are the approved surfaces |
| Custom cubic easing, staggered entry, reduced-motion alternatives | Gradient heading text. `design.md` forbids gradients; Ivory on Onyx at 15.25:1 is the system |
| "Proof beside the claim it supports" rather than proof buried at the bottom | "True glassmorphism", spotlight borders, tinted shadows. There are no shadows anywhere in Kyrve |
| Benefit-first copy, no vague verbs, CTA as verb plus outcome | Phosphor/Solar icon sets. Kyrve's four confidentiality glyphs are a fixed set and are never substituted |
| The audit checklist shape: typography, surfaces, layout, states, content, omissions | Risk-reversal patterns (free trial, cancel anytime). Kyrve is not a subscription and inventing one would be a fabricated claim |
| Strategic omissions list — back navigation, custom 404, skip link, indexing decision | Testimonials and logo strips. There are none, and manufacturing them is forbidden |

**The single most useful thing in the redesign skill** is its fix-priority order: surfaces, then
states, then layout, then motion, then components, then copy. That ordering is followed here, with
one change — copy moves earlier, because Kyrve's remaining problems are more linguistic than visual.

---

## Diagnosis of the current product

### What is already right and must not be disturbed

- The palette, the no-shadow rule, the one-Cobalt-action rule, the pill radius and the 72px rhythm are
  correct and are mechanically enforced by `pnpm verify:web`.
- The confidentiality-state system — four states, each with a glyph, a label and an explanation — is
  the best thing in the product and is the part no competitor has.
- Redacted structure rather than blur or zeroes. Correct, and load-bearing.
- Role-based navigation with four destinations. The previous correction landed.
- The proof surface recomputes rather than displays, and carries four verdicts including
  `reported-not-verified`. That is unusually honest and should become more visible, not less.

### F1 · The landing page argues in the wrong order and stops too early

It explains the mechanism competently and then ends. There is no tagline moment, no problem
statement in the reader's language, no FAQ, and no proof beside the claims. A reader who is not
already convinced has nowhere to go from "interesting" to "I want an account".

The mechanism section is three cards of near-equal weight. The skill is right that three equal cards
read as a feature list; Kyrve's mechanism is a *sequence* whose whole point is that density resolves
into one point, and the layout currently does not carry that.

**Severity: high.** This is the surface that decides whether anybody opens the terminal.

### F2 · The redacted curve is a shape, not yet a system

`RedactedCurve` draws seven smooth strokes. It is honest and calm and it does not look like
*encrypted data* — it looks like a line chart with the labels removed. The references' dither
treatment is the missing idea: an image made of small marks, where **density** carries the shape and
no individual mark is readable.

There is also no named primitive, no documentation, and no exported asset — so it cannot be used at
atmospheric scale without shipping SVG that costs more than a raster would.

**Severity: high.** It is the product's visual thesis and it is under-built.

### F3 · The wallet is injected-only

`openSession` reads `window.ethereum` or a local key. There is no WalletConnect, no QR, no mobile
deep link, no account or chain switching, and no wrong-network recovery. A visitor on a phone cannot
connect at all.

The deterministic local key path is *correct and must be preserved* — four browser suites depend on
it — but it is currently entangled with the production path rather than sitting behind a boundary.

**Severity: high.** It is the difference between a demo and a product.

### F4 · Copy still carries internal vocabulary in places

"Series", "Capsule", "Cross", "Roll", "mandate" and "epoch" appear in body copy on several pages,
below headings that have been corrected. The label mapping exists but has not been applied all the
way down.

**Severity: medium.** Each instance is small; together they re-establish the impression the last pass
removed.

### F5 · No mobile application shell

The four-destination nav wraps into pills at 360px and remains usable — that is checked — but it is a
desktop pattern shrunk down. There is no bottom navigation, no full-screen workflow sheet, no account
sheet, and signing on a phone puts the reveal warning and the action in different scroll positions.

**Severity: medium-high**, and it is the one that would embarrass a live demo on a handset.

### F6 · Motion is absent

There are no transitions at all. The stylesheet documents that this is deliberate ("there is no
motion"), which was the right call while the product was a set of forms. It is now a narrative, and a
narrative with no entry choreography reads as static rather than as calm.

**Severity: medium.** The fix must not become ambient decoration.

### F7 · Strategic omissions

- No custom 404 styling beyond a text page. It exists and is honest; it is not branded.
- No FAQ anywhere.
- No legal/privacy links in the footer.
- Indexing decision: currently `noindex, nofollow`, which is correct for a testnet demonstration and
  should stay — but it should stay *deliberately*, with the reason recorded.
- No command menu, so a technical reader cannot jump between surfaces without the mouse.

**Severity: low individually.** Collectively they are the difference between "a good prototype" and
"a product somebody shipped".

---

## What this pass will change, in priority order

1. **Encrypted Field** — the dither primitive, documented, deterministic, and exported as AVIF/WebP
   with an SVG overlay for the live point.
2. **Landing rebuild** — eleven sections in the specified order, with the specified copy, the tagline
   reveal, proof beside the claim, and an FAQ.
3. **RainbowKit behind a wallet-session boundary** — production adapter and deterministic test
   adapter, with the test adapter excluded from production builds and checked.
4. **Responsive shell** — mobile bottom navigation, account sheet, workflow sheets.
5. **Copy pass** — the label mapping applied to body copy, not only to headings.
6. **Motion** — staggered entry and the curve resolving, on one custom easing curve, with a
   reduced-motion path.
7. **`pnpm verify:ux-final`** — the gate that keeps all of it true.

## What this pass will not change

Contracts, protocol architecture, data models, proof semantics, working transaction flows, the 19
existing routes, the local stack, or any passing browser demonstration. Every route stays addressable
and every technical proof view stays reachable.
