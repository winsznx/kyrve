# Kyrve — Style Reference
> One quote. The curve stays private.

**Theme:** dark

Kyrve is an institutional fixed-income terminal. A near-black canvas (#171721) holds the whole
interface at a low, even level, and content surfaces sit on it as marginally lighter graphite cards
— separation by value alone, never by shadow. The system is overwhelmingly monochromatic: ivory text
on onyx, with a single vivid cobalt (#5266eb) as the only chromatic note, rationed to one primary
action per page. That restraint is not decoration. It is the product logic made visible: many
confidential curves exist at once, encrypted and unreadable, and exactly one of them resolves into
an executable quote. Everything muted is private. The one cobalt element is the thing that becomes
public. Typography carries the same discipline — a display face at intermediate weight 480, neither
bold nor light, over a body face at 400 — a voice that states a price without raising it. Components
are flat and borderless, structured by the 12px-radius card lift and pill-shaped controls. Price
discovery stays private; settlement is public; the interface must make which is which unmistakable
at every moment.

## Tokens — Colors

| Name | Value | Token | Role |
|------|-------|-------|------|
| Onyx Canvas | `#171721` | `--color-onyx-canvas` | Dominant page background, section and footer canvases |
| Graphite Card | `#1e1e2a` | `--color-graphite-card` | Elevated card and section surfaces — one step lighter than the canvas to create quiet separation |
| Obsidian Button | `#272735` | `--color-obsidian-button` | Secondary button fills, inline form backgrounds, subtle interactive surfaces |
| Slate Border | `#70707d` | `--color-slate-border` | Medium-weight dividers and structural borders between content blocks |
| Mist Border | `#e2e3ed` | `--color-mist-border` | Light hairline borders, ghost-button outlines, input edges — light-on-dark border |
| Ash Text | `#c3c3cc` | `--color-ash-text` | Muted body copy, helper text, secondary labels, units — reduced hierarchy without losing legibility |
| Ivory Text | `#ededf3` | `--color-ivory-text` | Primary text, icons, nav items, ghost-button strokes and text — the dominant foreground color across the system |
| Cobalt | `#5266eb` | `--color-cobalt` | The selected quote and the single primary action. Never decoration, never an icon fill, never a secondary button. |
| Pure White | `#ffffff` | `--color-pure-white` | Text and icon fills on cobalt primary buttons only — never body text |

Measured against the Onyx canvas: Ivory 15.25:1, Ash 10.16:1, Cobalt 3.78:1. Cobalt clears WCAG AA
for large text and for UI component boundaries; it does **not** clear 4.5:1, so it is never used for
body copy. These ratios are recomputed by `pnpm brand:verify`, not transcribed.

## Tokens — Typography

### arcadia — Body and UI typeface — handles navigation, body copy, buttons, inputs, labels, units and supporting text at weight 400 for body and 480 for emphasis. The intermediate weight scale (360, 420, 480) instead of standard (300/400/600) gives the interface a calibrated, instrument-like feel — never bold, never thin, always measured · `--font-arcadia`
- **Substitute:** Inter
- **Weights:** 360, 400, 420, 480
- **Sizes:** 12px, 14px, 16px, 18px, 21px
- **Line height:** 1.00–1.50
- **Letter spacing:** 0.005em at 14px, 0.01em at 12px
- **Role:** Body and UI typeface — handles navigation, body copy, buttons, inputs, labels, units and supporting text at weight 400 for body and 480 for emphasis. The intermediate weight scale (360, 420, 480) instead of standard (300/400/600) gives the interface a calibrated, instrument-like feel — never bold, never thin, always measured

### arcadiaDisplay — Headline and display typeface — used at weight 480 for all heading sizes from 28px through 65px, with 530 reserved for the largest display moments. Tight line-heights (1.1–1.2) and positive letter-spacing (0.01–0.02em) give display copy a wide-set, architectural quality rather than compressed editorial tightness · `--font-arcadiadisplay`
- **Substitute:** Söhne Breit
- **Weights:** 360, 480, 530
- **Sizes:** 21px, 24px, 28px, 32px, 42px, 49px, 65px
- **Line height:** 1.10–1.20
- **Letter spacing:** 0.01em at 42px, 0.015em at 32px, 0.02em at 24px
- **Role:** Headline and display typeface — used at weight 480 for all heading sizes from 28px through 65px, with 530 reserved for the largest display moments. Tight line-heights (1.1–1.2) and positive letter-spacing (0.01–0.02em) give display copy a wide-set, architectural quality rather than compressed editorial tightness

**Numerals are tabular everywhere a number can change.** Rates, amounts, maturities, units and
countdowns must not reflow as they update. A price that jitters as it ticks reads as unreliable, and
in this product the number is the whole point.

### Type Scale

| Role | Size | Line Height | Letter Spacing | Token |
|------|------|-------------|----------------|-------|
| caption | 12px | 1 | 0.12px | `--text-caption` |
| body-sm | 14px | 1 | 0.07px | `--text-body-sm` |
| body | 16px | 1.5 | — | `--text-body` |
| body-lg | 18px | 1.35 | — | `--text-body-lg` |
| subheading | 21px | 1.35 | — | `--text-subheading` |
| heading-sm | 28px | 1.2 | 0.42px | `--text-heading-sm` |
| heading | 32px | 1.15 | 0.48px | `--text-heading` |
| heading-lg | 42px | 1.15 | 0.42px | `--text-heading-lg` |
| display | 65px | 1.1 | — | `--text-display` |

## Tokens — Spacing & Shapes

**Base unit:** 4px

**Density:** spacious

### Spacing Scale

| Name | Value | Token |
|------|-------|-------|
| 4 | 4px | `--spacing-4` |
| 8 | 8px | `--spacing-8` |
| 12 | 12px | `--spacing-12` |
| 16 | 16px | `--spacing-16` |
| 20 | 20px | `--spacing-20` |
| 24 | 24px | `--spacing-24` |
| 32 | 32px | `--spacing-32` |
| 40 | 40px | `--spacing-40` |
| 56 | 56px | `--spacing-56` |
| 72 | 72px | `--spacing-72` |
| 112 | 112px | `--spacing-112` |
| 128 | 128px | `--spacing-128` |

### Border Radius

| Element | Value |
|---------|-------|
| nav | 40px |
| tags | 40px |
| cards | 12px |
| inputs | 32px |
| buttons | 32px |
| default | 4px |

### Layout

- **Page max-width:** 1200px
- **Section gap:** 72px
- **Card padding:** 32px
- **Element gap:** 12px

## Brand

The mark is a layered private-curve form converging into one selected cobalt leaf — the quote point.
Many curves, one quote, drawn. It is not an abstract network glyph and it is never decoration.

Production assets live in [`public/brand/`](public/brand/). Usage rules — clear space, minimum
sizes, permitted lockups, monochrome, forbidden modifications — are in
[`docs/brand/KYRVE-BRAND-LOCK.md`](docs/brand/KYRVE-BRAND-LOCK.md) and are binding.

The wordmark is lowercase **`kyrve`** in product branding. Sentence-case `Kyrve` in prose, legal
text and documentation.

> **Open decision, do not resolve by recolouring.** The approved mark is authored for light
> backgrounds: 100% of its opaque pixels clear 4.5:1 against white, and 0.0% clear it against Onyx,
> at a median of 1.30:1. There is no approved asset for the symbol on the product canvas. Until an
> owner decision is recorded in the brand lock, the header must not silently recolour the mark to
> make it show up. The options are set out in the lock document.

## Confidential state

This is the part of the system that does not exist in any other terminal, and it is load-bearing.
Every value on screen is in exactly one of four states, and each has one consistent icon, one
consistent label, and a plain-language explanation of what it means:

| State | Meaning | Treatment |
|---|---|---|
| **Encrypted and unavailable** | The value exists, and you are not authorised to read it | Ash label, no number, redacted structure |
| **Available to decrypt** | You are authorised; decryption has not happened yet | Ash label with an explicit decrypt affordance |
| **Decrypted locally** | Plaintext, in this browser, in memory only | Ivory value with a persistent local-only marker |
| **Intentionally public** | Published on chain; anyone can read it | Ivory value, no marker — this is the normal case for settled data |

Rules that follow from this and are not negotiable:

- A locked private chart shows a **deliberate redacted structure**. Never zeroes. Never sample data.
  An empty axis implies "no liquidity"; fabricated points are a lie about a confidential system.
- Engaging the privacy lock clears decrypted values from in-memory state immediately.
- A critical reveal warning — anything moving a value from private to public — cannot be collapsed,
  scrolled past or hidden while signing.
- Never display an exact provider count where the count is meant to be private. Show the
  privacy-floor boolean and nothing more.
- The UI never says "access revoked" for a handle a viewer could already decrypt, because Nox grants
  are permanent. Say "live access ended", "future snapshots disabled", or "this historical snapshot
  remains available".

## Components

### Primary CTA Button (Cobalt)
**Role:** The sole chromatic action in the system — the one thing on this page that executes

Filled with #5266eb Cobalt, white text at 16px arcadia weight 400, 32px border-radius (pill), 0px
vertical padding with 20px horizontal padding for inline contexts, 40px vertical padding when
standalone. No border, no shadow. Labels name what happens: `Execute quote`, `Submit request`,
`Publish mandate`, `Request access`. Never `Submit`, never `Continue`, never `Get started`. The
label that appears on the button is the same word that appears in the confirmation.

### Ghost Outline Button
**Role:** Secondary or tertiary action

Transparent background, 1px solid #ededf3 Ivory border, Ivory text at 16px arcadia weight 400, 40px
border-radius (pill). Zero padding top/bottom with 20px horizontal padding. Used for navigation
links and secondary actions — `Decrypt locally`, `View receipt`, `Cancel` — where a filled button
would compete with the primary action.

### Navigation Pill Link
**Role:** Top-bar navigation items with optional dropdown caret

Transparent background, no border, Ivory text at 16px arcadia weight 400, 40px border-radius, 0px
vertical / 20px horizontal padding. Transitions to a solid dark fill on scroll via backdrop-blur.

### Graphite Card
**Role:** Content grouping surface — quote detail, mandate summary, series position, settlement receipt

Background #1e1e2a, 12px border-radius, 32px padding on all sides, no shadow, no border. The
one-step lift from the #171721 canvas creates separation through value contrast rather than
elevation. Cards sit flat on the dark plane.

### Quote Card
**Role:** The single selected executable quote — the one moment the whole product is built around

A Graphite Card whose numbers are set in arcadiaDisplay at 42px weight 480, tabular. Market, rate and
aggregate amount are Ivory because they are public on activation; everything that stays private —
the curve behind them, provider allocations, exposure limits, rejected alternatives — is not shown
here at all rather than shown blurred. Carries the Primary CTA. This is the only card on any page
permitted to hold a cobalt element.

### Redacted Curve
**Role:** The private yield curve, shown as structure without values

Ash strokes at reduced opacity describing the shape of a curve with no readable axis values and no
data labels — deliberate, obviously intentional redaction, never a blur filter over real numbers and
never a placeholder chart. The single resolved point, where a quote has been selected and published,
is drawn in Cobalt. That contrast is the thesis: the curve stays private, the quote does not.

### Confidential Value
**Role:** Any number whose state is not simply public

Inline component pairing the value (or its absence) with the state icon and label from the table
above. Ash for encrypted and for available-to-decrypt; Ivory once decrypted or public. The state is
always rendered — a value with no state marker is a bug, because the reader cannot tell whether they
are looking at plaintext or at a published figure.

### Reveal Warning
**Role:** Named at the point of action, before signing, whenever something becomes public

Graphite Card with a Mist hairline border, Ivory heading naming exactly which values become public
and when, body at 16px. Not dismissible, not collapsible, not scrollable-past while a signature is
pending. Sits directly above the Primary CTA that performs the reveal.

### Access Request Input (Pill, Left-Half)
**Role:** Institutional access request with attached submit button

Transparent background, 1px solid #ededf3 Ivory border on left side only, Ivory text at 16px arcadia
weight 400, border-radius 32px 0px 0px 32px (left-side pill, flat right edge where it meets the
button), 20px left padding. Placeholder text in #c3c3cc Ash. The attached button is the page's
single Cobalt action.

### Hero Section
**Role:** Above-the-fold statement of the thesis

100vw × ~100vh, no padding constraints, centered content stack. Headline in arcadiaDisplay at 65px
weight 480, subtext in arcadia at 18px weight 480. The background is the Redacted Curve field at
low opacity — many faint layered curves on the Onyx canvas with exactly one resolved cobalt point —
not a photograph and not a stock landscape. Content max-width ~640px centered.

### Transparent Top Navigation Bar
**Role:** Primary navigation

Full-width, fixed or sticky, transparent over the hero. Brand mark on the left, subject to the open
decision recorded in the brand lock. Nav links centered — `Markets`, `Mandates`, `Requests`,
`Positions`, `Docs`. `Sign in` text link and the single Cobalt action on the right. Uses
backdrop-blur(8px or 20px) on scroll to create frosted-glass separation.

### Status Line
**Role:** Naming the actual async phase, never one indefinite spinner

Caption at 12px arcadia weight 480 in Ash, naming the real stage: `input proof submitted`,
`event confirmed`, `runner queued`, `output stored`, `decryption ready`. Each phase is a distinct
label. A generic "Loading…" is not acceptable in a system whose latency comes from a confidential
computation the user is entitled to understand.

### Error Surface
**Role:** Distinguishing six genuinely different failures

Graphite Card, Ivory heading, Ash body. The six kinds are never collapsed into one message: public
transaction failure, invalid proof, pending Nox output, public invariant failure, private no-fill,
and service availability. A private no-fill states only that no quote was produced — it must never
reveal which provider or which rule caused it, because a confidential failure that explains itself
is a public oracle.

### Disclaimer Banner
**Role:** Legal and regulatory footnote strip at page bottom

Dark background, small text at 12px arcadia weight 480 with 0.01em letter-spacing, subtle Ivory or
Ash text. Carries the non-production disclosure. Minimal visual weight — present but never
distracting, and never removed.

### Section Container
**Role:** Horizontal content wrapper

Full-width dark canvas (#171721) with inner content constrained to 1200px max-width, 72px vertical
padding. Contains 2- or 3-column grids of Graphite Cards or text+detail splits.

## Do's and Don'ts

### Do
- Use Cobalt #5266eb exclusively for the single primary action per page — never as a decorative accent, icon fill, or secondary button
- Set all cards to #1e1e2a with 12px radius and 32px padding — rely on the one-step value lift from the canvas, not shadows, for separation
- Apply arcadiaDisplay weight 480 (not 600/700) for all headings — the intermediate weight is the system's signature restraint
- Use 32px or 40px pill radius for all interactive controls (buttons, inputs, nav items) — sharp 4px corners are reserved for structural elements only
- Set body text at 16px arcadia weight 400 with 1.5 line-height — this is the density baseline for all content
- Maintain 72px vertical rhythm between major sections — spacious density is part of the institutional feel
- Use ivory #ededf3 on ghost/outline buttons for both border and text — never use a chromatic color for secondary actions
- Set every changeable number in tabular numerals so prices and amounts do not reflow as they update
- Render a confidentiality state on every value that has one, and name what becomes public at the point of action

### Don't
- Do not use multiple bright accent colors — Cobalt is the only chromatic note; introducing greens, reds, or oranges breaks the monochrome discipline
- Do not add drop shadows to cards or components — separation comes from the graphite-on-onyx value difference alone
- Do not use bold weights (700+) for headings — arcadiaDisplay at 480 is the ceiling
- Do not use sharp corners (0–4px) on buttons, inputs, or nav items — the pill shape is non-negotiable
- Do not use #ffffff for body text — always #ededf3 Ivory; pure white on dark creates harsh, cold contrast
- Do not place Cobalt-filled elements next to each other without at least 32px gap — the vivid color creates visual competition when clustered
- Do not use bright or saturated backgrounds for sections — every surface is either #171721 (canvas) or #1e1e2a (card); no mid-gray or colored bands
- Do not draw a private chart as zeroes, as sample data, or as a blur over real values — redaction is explicit structure
- Do not show a decorative chart with no real data source, a placeholder proof, or a fabricated metric
- Do not use bento grids, glassmorphism, neon network art, generic gradients, token bubbles or robot illustrations

## Surfaces

| Level | Name | Value | Purpose |
|-------|------|-------|---------|
| 0 | Onyx Canvas | `#171721` | Base page background — hero, section canvases, footer |
| 1 | Graphite Card | `#1e1e2a` | Elevated content surface — quote cards, position cards, form containers |
| 2 | Obsidian Button | `#272735` | Interactive surface — secondary button fills, inline form attachments |

## Elevation

There are no shadows anywhere in this system. All elevation is communicated through value contrast
alone — the graphite card (#1e1e2a) sits one step lighter than the onyx canvas (#171721), creating
perceptible separation without any drop shadow. The flatness is not a style preference: an interface
that quotes prices should look like an instrument reading, not like paper stacked on a desk.

## Imagery

**No photography.** Kyrve is a terminal, not a lifestyle brand, and there is no aspirational
landscape that honestly represents an encrypted order book.

The visual language is the data itself. The hero and section backgrounds use the Redacted Curve
field — many faint layered curves in Ash on Onyx with one resolved point in Cobalt. Below that,
imagery is product UI at real fidelity, or nothing. Approved brand rasters (`public/brand/social/`,
`public/brand/cta/`) are used for social cards and the call-to-action panel and are not recomposed.

Icon style throughout is minimal line/glyph in Ivory. The four confidential-state icons are a fixed
set and are never substituted, restyled per surface, or given colour to signal severity.

Every chart on every surface is driven by a real data source. A chart with no source does not ship.

## Layout

Full-bleed dark canvas throughout. Hero is 100vw with the redacted curve field behind a centered
headline + subtext + access-request stack (max-width ~640px). Below hero, content flows in 1200px
max-width sections with 72px vertical padding, alternating between text-left/detail-right 2-column
splits and 3-column card grids. Navigation is a transparent top bar overlaid on the hero,
transitioning to a frosted-glass (backdrop-blur) solid dark fill on scroll. Footer is dark and
carries the disclaimer. Vertical rhythm is generous. No sidebar navigation; all navigation lives in
the top bar.

## Agent Prompt Guide

**Quick Color Reference**
- Background (canvas): #171721 Onyx
- Card surface: #1e1e2a Graphite
- Primary text: #ededf3 Ivory
- Muted text: #c3c3cc Ash
- Border: #e2e3ed Mist
- Primary action and the selected quote: #5266eb Cobalt

**Example Component Prompts**

1. Create a quote detail card: background #1e1e2a Graphite, 12px border-radius, 32px padding all sides, no shadow. Heading at 28px arcadiaDisplay weight 480, letter-spacing 0.015em, color #ededf3 Ivory. Rate and amount at 42px arcadiaDisplay weight 480, tabular numerals, color #ededf3 Ivory. Unit labels at 12px arcadia weight 480, color #c3c3cc Ash.

2. Create a primary CTA button: background #5266eb Cobalt, white text at 16px arcadia weight 400, 32px border-radius (pill), no border, no shadow, 12px vertical / 24px horizontal padding. Text names the action — 'Execute quote' — and matches the confirmation wording exactly.

3. Create a ghost/outline button: transparent background, 1px solid #ededf3 Ivory border, #ededf3 text at 16px arcadia weight 400, 40px border-radius, 10px vertical / 20px horizontal padding.

4. Create a hero section: full-bleed (100vw), full-viewport height, background is a redacted curve field — layered Ash strokes at low opacity on #171721 with one resolved point in #5266eb Cobalt, no photography, no gradient wash. Headline at 65px arcadiaDisplay weight 480, line-height 1.1, color #ededf3 Ivory, centered. Subtext at 18px arcadia weight 480, color #c3c3cc Ash, centered, max-width 520px.

5. Create an inline access-request form: flex row, no gap. Input — transparent background, 1px solid #ededf3 Ivory border (left + top + bottom only), #ededf3 text at 16px arcadia weight 400, placeholder in #c3c3cc Ash, border-radius 32px 0 0 32px, 14px vertical / 20px horizontal padding. Button — #5266eb Cobalt fill, white text at 16px arcadia weight 400, border-radius 0 32px 32px 0, 14px vertical / 24px horizontal padding, no border.

6. Create a confidential value row: label at 14px arcadia weight 400 color #c3c3cc Ash on the left; on the right either the value at 16px arcadia weight 480 tabular color #ededf3 Ivory, or the state marker. State marker is a 12px glyph plus a 12px arcadia weight 480 label in #c3c3cc Ash reading one of 'encrypted', 'available to decrypt', 'decrypted locally', 'public'. Never render the row without a state.

7. Create a reveal warning: background #1e1e2a Graphite, 12px border-radius, 32px padding, 1px solid #e2e3ed Mist border. Heading at 21px arcadiaDisplay weight 480 color #ededf3 Ivory naming exactly which values become public and at what moment. Body at 16px arcadia weight 400 color #ededf3 Ivory. Not collapsible, not dismissible. Sits immediately above the primary action.

## Typography Philosophy

Two faces — arcadia for UI and body, arcadiaDisplay for headlines — both on an intermediate weight
axis (360, 420, 480, 530) that avoids the conventional bold/light binary. Heading weight 480 is the
signature: heavier than regular, distinctly lighter than semibold, a voice that asserts without
shouting. Display sizes use tight line-heights (1.1–1.15) with positive letter-spacing
(0.01–0.02em), giving large text an architectural, wide-set quality. Body stays at 16px weight 400
with 1.5 line-height. Numbers are tabular. The effect is measured and instrument-like — never
editorial, never corporate, and never loud about a price it is only reporting.

## Reference points

- **Bloomberg Terminal** — the density and the discipline of never dressing up a number
- **Tradeweb** — institutional fixed-income workflow where the quote is the object of the interface
- **MarketAxess** — request-for-quote flow with the same emphasis on who can see what, and when
- **Linear** — the whisper-weight typography and dark monochrome canvas with a single chromatic action
- **Stripe** — generous spacing and letting exactly one accent colour carry the brand

Kyrve is not consumer fintech and must never be styled as it. There is no onboarding delight, no
celebratory confetti, no growth-marketing gradient. The audience is allocating capital.

## Quick Start

### CSS Custom Properties

```css
:root {
  /* Colors */
  --color-onyx-canvas: #171721;
  --color-graphite-card: #1e1e2a;
  --color-obsidian-button: #272735;
  --color-slate-border: #70707d;
  --color-mist-border: #e2e3ed;
  --color-ash-text: #c3c3cc;
  --color-ivory-text: #ededf3;
  --color-cobalt: #5266eb;
  --color-pure-white: #ffffff;

  /* Typography — Font Families */
  --font-arcadia: 'arcadia', ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
  --font-arcadiadisplay: 'arcadiaDisplay', ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;

  /* Typography — Scale */
  --text-caption: 12px;
  --leading-caption: 1;
  --tracking-caption: 0.12px;
  --text-body-sm: 14px;
  --leading-body-sm: 1;
  --tracking-body-sm: 0.07px;
  --text-body: 16px;
  --leading-body: 1.5;
  --text-body-lg: 18px;
  --leading-body-lg: 1.35;
  --text-subheading: 21px;
  --leading-subheading: 1.35;
  --text-heading-sm: 28px;
  --leading-heading-sm: 1.2;
  --tracking-heading-sm: 0.42px;
  --text-heading: 32px;
  --leading-heading: 1.15;
  --tracking-heading: 0.48px;
  --text-heading-lg: 42px;
  --leading-heading-lg: 1.15;
  --tracking-heading-lg: 0.42px;
  --text-display: 65px;
  --leading-display: 1.1;

  /* Typography — Weights */
  --font-weight-w360: 360;
  --font-weight-regular: 400;
  --font-weight-w420: 420;
  --font-weight-w480: 480;
  --font-weight-w530: 530;

  /* Spacing */
  --spacing-unit: 4px;
  --spacing-4: 4px;
  --spacing-8: 8px;
  --spacing-12: 12px;
  --spacing-16: 16px;
  --spacing-20: 20px;
  --spacing-24: 24px;
  --spacing-32: 32px;
  --spacing-40: 40px;
  --spacing-56: 56px;
  --spacing-72: 72px;
  --spacing-112: 112px;
  --spacing-128: 128px;

  /* Layout */
  --page-max-width: 1200px;
  --section-gap: 72px;
  --card-padding: 32px;
  --element-gap: 12px;

  /* Border Radius */
  --radius-md: 4px;
  --radius-lg: 8px;
  --radius-xl: 12px;
  --radius-3xl: 32px;
  --radius-3xl-2: 40px;

  /* Named Radii */
  --radius-nav: 40px;
  --radius-tags: 40px;
  --radius-cards: 12px;
  --radius-inputs: 32px;
  --radius-buttons: 32px;
  --radius-default: 4px;

  /* Surfaces */
  --surface-onyx-canvas: #171721;
  --surface-graphite-card: #1e1e2a;
  --surface-obsidian-button: #272735;
}
```

### Tailwind v4

```css
@theme {
  /* Colors */
  --color-onyx-canvas: #171721;
  --color-graphite-card: #1e1e2a;
  --color-obsidian-button: #272735;
  --color-slate-border: #70707d;
  --color-mist-border: #e2e3ed;
  --color-ash-text: #c3c3cc;
  --color-ivory-text: #ededf3;
  --color-cobalt: #5266eb;
  --color-pure-white: #ffffff;

  /* Typography */
  --font-arcadia: 'arcadia', ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
  --font-arcadiadisplay: 'arcadiaDisplay', ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;

  /* Typography — Scale */
  --text-caption: 12px;
  --leading-caption: 1;
  --tracking-caption: 0.12px;
  --text-body-sm: 14px;
  --leading-body-sm: 1;
  --tracking-body-sm: 0.07px;
  --text-body: 16px;
  --leading-body: 1.5;
  --text-body-lg: 18px;
  --leading-body-lg: 1.35;
  --text-subheading: 21px;
  --leading-subheading: 1.35;
  --text-heading-sm: 28px;
  --leading-heading-sm: 1.2;
  --tracking-heading-sm: 0.42px;
  --text-heading: 32px;
  --leading-heading: 1.15;
  --tracking-heading: 0.48px;
  --text-heading-lg: 42px;
  --leading-heading-lg: 1.15;
  --tracking-heading-lg: 0.42px;
  --text-display: 65px;
  --leading-display: 1.1;

  /* Spacing */
  --spacing-4: 4px;
  --spacing-8: 8px;
  --spacing-12: 12px;
  --spacing-16: 16px;
  --spacing-20: 20px;
  --spacing-24: 24px;
  --spacing-32: 32px;
  --spacing-40: 40px;
  --spacing-56: 56px;
  --spacing-72: 72px;
  --spacing-112: 112px;
  --spacing-128: 128px;

  /* Border Radius */
  --radius-md: 4px;
  --radius-lg: 8px;
  --radius-xl: 12px;
  --radius-3xl: 32px;
  --radius-3xl-2: 40px;
}
```

---

## Addendum — the style sheet in full

This must be followed to the core, with no deviation. Every section must be beautifully executed;
UX is an explicit judging criterion.

### Kyrve

**One quote. The curve stays private.**

Kyrve is an institutional fixed-income terminal. A near-black canvas (#171721) holds the whole
interface at a low, even level, and content surfaces sit on it as marginally lighter graphite cards
— separation by value alone, never by shadow. The system is overwhelmingly monochromatic: ivory text
on onyx, with a single vivid cobalt (#5266eb) as the only chromatic note, rationed to one primary
action per page. That restraint is the product logic made visible: many confidential curves exist at
once, encrypted and unreadable, and exactly one resolves into an executable quote. Everything muted
is private. The one cobalt element is what becomes public. Typography holds the same discipline — a
display face at intermediate weight 480 over a body face at 400 — a voice that states a price
without raising it. Components are flat and borderless, structured by the 12px-radius card lift and
pill-shaped controls. Price discovery stays private; settlement is public; the interface must make
which is which unmistakable at every moment.

### Color Palette

**Brand**

`Cobalt` · `#5266eb`
The selected quote and the single primary action per page. Never decoration, never an icon fill,
never a secondary button. Two cobalt elements never sit within 32px of each other.

**Neutrals**

`Onyx Canvas` · `#171721`
Dominant page background, section canvases, footer

`Graphite Card` · `#1e1e2a`
Elevated card and section surfaces — one step lighter than the canvas to create quiet separation

`Obsidian Button` · `#272735`
Secondary button fills, inline form backgrounds, subtle interactive surfaces

`Slate Border` · `#70707d`
Medium-weight dividers and structural borders between content blocks

`Ash Text` · `#c3c3cc`
Muted body copy, helper text, secondary labels, units — reduced hierarchy without losing legibility

`Mist Border` · `#e2e3ed`
Light hairline borders, ghost-button outlines, input edges — light-on-dark border

`Ivory Text` · `#ededf3`
Primary text, icons, nav items, ghost-button strokes and text — the dominant foreground color

`Pure White` · `#ffffff`
Text and icon fills on cobalt primary buttons only — never body text

### Typography

**Type Scale** — Major Second (1.125) from 20px base

| Role | Size · Weight · Line height |
|---|---|
| display | 65px · 480 · 1.1 |
| — | 49px · 480 · 1.1 |
| heading-lg | 42px · 480 · 1.15 |
| heading | 32px · 480 · 1.15 |
| heading-sm | 28px · 480 · 1.2 |
| — | 24px · 480 · 1.2 |
| subheading | 21px · 360 · 1.35 |
| body-lg | 18px · 480 · 1.35 |
| body | 16px · 400 · 1.5 |
| body-sm | 14px · 400 · 1.0 |
| caption | 12px · 480 · 1.0 |

**Body — arcadia**
Weights 360, 400, 420, 480 · Sizes 12–21px, 5 values · Line height 1.00–1.50 · Letter spacing
0.005em at 14px, 0.01em at 12px · Fallback Inter.
Body and UI typeface — navigation, body copy, buttons, inputs, labels, units and supporting text at
weight 400 for body and 480 for emphasis. The intermediate weight scale (360, 420, 480) instead of
standard (300/400/600) gives the interface a calibrated, instrument-like feel — never bold, never
thin, always measured.

**Display — arcadiaDisplay**
Weights 360, 480, 530 · Sizes 21–65px, 7 values · Line height 1.10–1.20 · Letter spacing 0.01em at
42px, 0.015em at 32px, 0.02em at 24px · Fallback Söhne Breit.
Headline and display typeface — weight 480 for all heading sizes from 28px through 65px, with 530
reserved for the largest display moments. Tight line-heights and positive letter-spacing give
display copy a wide-set, architectural quality rather than compressed editorial tightness.

Numerals are tabular wherever a number can change.

### Spacing & Shape

| Purpose | Value |
|---|---|
| Density | spacious |
| Base unit | 4px |
| Max width | 1200px |
| Section gap | 72px |
| Card padding | 32px |
| Element gap | 12px |

| Element | Radius |
|---|---|
| default | 4px |
| cards | 12px |
| inputs | 32px |
| buttons | 32px |
| nav | 40px |
| tags | 40px |

### Guidelines

**Do**

- Use Cobalt #5266eb exclusively for the single primary action per page — never as a decorative accent, icon fill, or secondary button
- Set all cards to #1e1e2a with 12px radius and 32px padding — rely on the one-step value lift from the canvas, not shadows, for separation
- Apply arcadiaDisplay weight 480 (not 600/700) for all headings — the intermediate weight is the system's signature restraint
- Use 32px or 40px pill radius for all interactive controls (buttons, inputs, nav items) — sharp 4px corners are reserved for structural elements only
- Set body text at 16px arcadia weight 400 with 1.5 line-height — this is the density baseline for all content
- Maintain 72px vertical rhythm between major sections — spacious density is part of the institutional feel
- Use ivory #ededf3 on ghost/outline buttons for both border and text — never use a chromatic color for secondary actions
- Set every changeable number in tabular numerals
- Render a confidentiality state on every value that has one, and name what becomes public at the point of action, before signing

**Don't**

- Do not use multiple bright accent colors — Cobalt is the only chromatic note; introducing greens, reds, or oranges breaks the monochrome discipline
- Do not add drop shadows to cards or components — separation comes from the graphite-on-onyx value difference alone
- Do not use bold weights (700+) for headings — arcadiaDisplay at 480 is the ceiling
- Do not use sharp corners (0–4px) on buttons, inputs, or nav items — the pill shape is non-negotiable
- Do not use #ffffff for body text — always #ededf3 Ivory; pure white on dark creates harsh, cold contrast
- Do not place Cobalt-filled elements next to each other without at least 32px gap
- Do not use bright or saturated backgrounds for sections — every surface is either #171721 or #1e1e2a; no mid-gray or colored bands
- Do not draw a private chart as zeroes, as sample data, or as a blur over real values
- Do not ship a decorative chart with no real data source, a placeholder proof, or a fabricated metric
- Do not reveal which provider or which rule caused a private no-fill
- Do not use bento grids, glassmorphism, neon network art, generic gradients, token bubbles or robot illustrations
