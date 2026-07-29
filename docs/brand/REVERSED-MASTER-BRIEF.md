# Commissioning brief — Kyrve reversed symbol master

Hand this to whoever draws the reversed master. Everything an automated check will enforce is
stated here, so the asset can be got right the first time.

Policy context is in [`KYRVE-BRAND-LOCK.md`](KYRVE-BRAND-LOCK.md). The acceptance checks are in
`scripts/brand/verify-assets.py` and run as part of `pnpm brand:verify`.

## What is being commissioned

One asset: a **reversed** version of the approved Kyrve symbol, for dark surfaces.

This is the second master in a two-master positive/reversed system. The existing navy master stays
exactly as it is and remains the positive master for light surfaces. The reversed master is a
separate approved asset — **not** a recolour, a filter, an inversion, or a variant generated from
the positive file.

## Why it is needed

The approved positive master is authored for light backgrounds. Measured across all 45,374 opaque
pixels of the symbol:

| Background | Opaque pixels clearing 4.5:1 | Median contrast |
| --- | ---: | ---: |
| White | 100.0% | 13.71:1 |
| Onyx `#171721` (the product canvas) | 0.0% | 1.30:1 |

At 1.30:1 the mark is, for practical purposes, invisible on the application canvas. The dark
presentation that exists today is baked into the OG and CTA rasters on a near-black `#01091a`
field, which is a different surface from the product canvas.

## Required specification

### Colour roles — exactly two, no others

| Role | Colour | Notes |
| --- | --- | --- |
| Structural symbol body — the layered curves | Ivory `#ededf3` | The mass of the mark |
| Selected quote leaf | Cobalt `#5266eb` | The one converged point; unchanged from the positive master |
| Background | fully transparent | alpha 0, including all four corners |

### Geometry — unchanged

The silhouette, proportions and internal structure must match the approved symbol exactly. Only
the colour roles change.

This is checked mechanically: both silhouettes are trimmed to their bounding boxes, normalised to
a common frame, and compared. **Intersection-over-union must be ≥ 0.98.** A redrawn curve, a
re-weighted stroke, or a nudged leaf will fail. Delivering on a different canvas size is fine —
the check compares shape and proportion, not placement.

### Forbidden

- background plate of any kind
- glow
- shadow
- outline or stroke
- geometry changes
- proportion changes
- new decorative elements

"No glow" is checked as well: semi-transparent pixels must hug the silhouette. Anything beyond a
2px antialiasing band reads as glow and fails.

### Delivery

- File: **`kyrve-symbol-reversed-source.png`**, at the repository root, beside the other approved
  masters.
- Format: PNG, RGBA, full resolution, transparent background.
- Resolution: at least 1024px on the longest edge, to match the positive master. Nothing is ever
  upscaled downstream, so the delivered file is the ceiling.
- Do not pre-trim or pre-pad. The build does that with the same 12% clear-space constant the
  positive master uses.

## Acceptance criteria

`pnpm brand:verify` runs all of these automatically once the file is present. It currently reports
`reversed master: PENDING` and will keep doing so until the file lands — it does not pass by
default.

| # | Check | Threshold |
| --- | --- | --- |
| 1 | Silhouette IoU against the approved symbol | ≥ 0.98 |
| 2 | Corner alpha (no plate) | all 0 |
| 3 | Stray semi-transparent pixels outside a 2px band (no glow) | < 0.1% |
| 4 | Opaque pixels outside the two approved colour roles | < 2% |
| 5 | Critical structural pixel contrast at 16, 24, 32, 48, 64, 128, 192px on Onyx `#171721` | ≥ 4.5:1 |
| 6 | Critical structural pixel contrast at those sizes on Graphite `#1e1e2a` | ≥ 4.5:1 |
| 7 | Critical accent (leaf) pixel contrast on both surfaces | ≥ 3.0:1 |

**How 5–7 are measured.** The master is squared, downscaled with the same premultiplied filter the
favicons use, and each pixel is composited over the surface before its contrast is taken — a
half-covered Ivory pixel over Onyx is not Ivory, and grading it as though it were would pass artwork
nobody can read. "Critical" pixels are those at ≥90% of the strongest coverage **within their own
class**: the question is whether the pixels that make up the body read, independently of the leaf
being denser.

Getting this right took four wrong versions, all of which reported a pass on an empty set or a
failure that was really test framing. It is now exercised against five fixtures — one correct, plus
one each with a plate, a glow, altered proportions, and no recolour — and each fails on its own
criterion while the correct one passes.

### One thing the owner should know about criteria 5–7

The instruction was "at least 4.5:1 for critical structural pixels on both surfaces." Taken to
include the cobalt leaf, that is **not satisfiable**:

| Colour | On Onyx `#171721` | On Graphite `#1e1e2a` |
| --- | ---: | ---: |
| Ivory `#ededf3` | 15.25:1 ✅ | 14.13:1 ✅ |
| Cobalt `#5266eb` | **3.78:1** ❌ | **3.50:1** ❌ |

Cobalt cannot reach 4.5:1 against either dark surface without changing the approved accent colour,
which the brand lock forbids. So "critical structural pixels" is implemented as the **Ivory symbol
body**, which matches the owner's own split between "structural symbol body" and "selected quote
leaf". The leaf is held to **3:1**, the WCAG threshold for non-text UI components, which it clears
on both surfaces with margin.

If the intent was different, this is the line to change — but it cannot be met while Cobalt stays
`#5266eb`.

## Until the master is delivered

- Dark application headers use the lowercase **`kyrve` wordmark set as text in Ivory `#ededf3`**.
- The navy positive symbol is **not** rendered on Onyx.
- **No background plate** is added behind it to force contrast.
- The positive master is **not** recoloured.
- The contrast gate is **not** weakened.
- `HEADER_MARK_PENDING_OWNER_DECISION` in `@kyrve/config` stays `true`, and is only flipped after
  the acceptance checks above pass.

Note that the drawn wordmark inside the approved full lockup is navy, so it cannot serve on Onyx
either. Setting `kyrve` as text in Ivory is the only reading of the interim instruction that does
not recolour an approved asset — it is recorded in the brand lock as a narrow, time-boxed
exception to the rule against reconstructing the wordmark in a substitute typeface, and it ends
when this master is accepted.

**Open question for the owner:** this brief covers the symbol only, matching the instruction. The
approved full lockup is stacked — symbol above a drawn `kyrve` wordmark, 490×165 px, separated by a
gap of 11% of the symbol height. If a reversed **full lockup** is also wanted, it should be
commissioned in the same pass; otherwise dark surfaces will have a reversed symbol and no reversed
lockup.
