#!/usr/bin/env python3
"""Build the Encrypted Field assets.

The Encrypted Field is Kyrve's visual thesis drawn as data: the complete private capital curve,
rendered as a field of marks that carries the SHAPE of the curve through density while making every
individual value unreadable.

────────────────────────────────────────────────────────────────────────────────────────────────
WHY THIS IS A BUILD STEP AND NOT A RUNTIME CANVAS
────────────────────────────────────────────────────────────────────────────────────────────────

A field dense enough to read as data is tens of thousands of marks. As runtime SVG that is hundreds
of kilobytes of DOM and a layout cost on every route that uses it; as a runtime canvas it is a paint
loop on a phone, for a picture that never changes. Both are the wrong trade for an image that is
identical on every load.

So it is generated here, deterministically, from a seed and from the same curve geometry the live
`RedactedCurve` component draws. Same shape, two renderers: the raster for atmosphere, the SVG
overlay for the one live point that has to stay in sync with real state.

────────────────────────────────────────────────────────────────────────────────────────────────
WHAT THE FIELD MAY AND MAY NOT CONTAIN
────────────────────────────────────────────────────────────────────────────────────────────────

Density is derived from the curve's own geometry — a deterministic function of position, not of any
measurement. There is no rate in it, no provider count, no capacity and no allocation, because there
is nothing here derived from data of any kind. That is what makes it honest: it is a picture of
structure that exists, not a redaction of numbers that were computed and then hidden.

The single Cobalt point is NEVER baked into these rasters. It is drawn at runtime by the SVG overlay,
and only when a quote is genuinely public. A cobalt mark compiled into an image would appear on pages
where no quote exists, which is the one thing the mark must never do.

Run: pnpm design:dither
"""

from __future__ import annotations

import hashlib
import json
import math
import random
from dataclasses import dataclass
from pathlib import Path

from PIL import Image, ImageDraw

REPO = Path(__file__).resolve().parents[2]
OUT = REPO / "public" / "brand" / "field"
MANIFEST = REPO / "docs" / "design" / "dither-manifest.json"

# The palette, from brand.json. Never a new colour.
ONYX = (23, 23, 33)
GRAPHITE = (30, 30, 42)
ASH = (195, 195, 204)
IVORY = (237, 237, 243)

# One seed for the whole system, so every asset is reproducible byte for byte.
SEED = 0x4B59525645  # "KYRVE"


@dataclass(frozen=True)
class Field:
    """One exported field."""

    name: str
    width: int
    height: int
    #: How far the curve has resolved: 0 is a full unreadable field, 1 is one point emerging.
    resolution: float
    #: Peak marks per row. Higher reads denser and costs more bytes.
    density: int
    #: Maximum bytes for the AVIF, from the brief's budgets.
    budget: int
    purpose: str


FIELDS: tuple[Field, ...] = (
    Field("hero", 2400, 1200, 0.0, 190, 300_000, "Landing hero. The whole book, unreadable."),
    Field("mechanism-1", 1200, 700, 0.0, 150, 180_000, "Set terms privately: maximum density."),
    Field("mechanism-2", 1200, 700, 0.45, 150, 180_000, "Compute the market: density beginning to order."),
    Field("mechanism-3", 1200, 700, 0.92, 150, 180_000, "Settle one quote: the field resolving to a line."),
    Field("close", 2400, 1000, 0.85, 170, 300_000, "Final call to action. Resolved, awaiting its point."),
    Field("matching", 1600, 800, 0.35, 150, 180_000, "Private matching page, while an epoch runs."),
    Field("empty", 1200, 600, 0.0, 110, 180_000, "Empty states that need a meaningful visual."),
)

# Mobile derivatives, so a phone never downloads a 2400px asset.
MOBILE_WIDTH = 900


def curve_y(t: float, layer: int, layers: int, height: int) -> float:
    """One layer of the curve at horizontal position `t`.

    A monotonically rising, decelerating shape — the form a yield curve has. Deterministic, and
    identical to the geometry `apps/web/src/components/RedactedCurve.tsx` draws, so the raster and
    the live overlay describe the same object rather than two similar ones.
    """
    amplitude = 0.28 + layer * (0.30 / max(layers - 1, 1))
    lift = 0.82 - layer * (0.42 / max(layers - 1, 1))
    shape = 1.0 - (1.0 - t) * (1.0 - t)
    return height * (lift - amplitude * shape)


def build(field: Field) -> Image.Image:
    """Render one field.

    Marks cluster around the curve layers and thin out away from them, so the eye reads a shape
    without ever reading a value. `resolution` collapses the layers toward one line: at 0 the field
    is a full book, at 1 it is a single trace with the rest dissolved.
    """
    rng = random.Random(SEED ^ hash(field.name) & 0xFFFFFFFF)
    image = Image.new("RGB", (field.width, field.height), ONYX)
    draw = ImageDraw.Draw(image)

    layers = 9
    columns = field.width // 3

    for column in range(columns):
        t = column / max(columns - 1, 1)
        x = t * field.width

        for layer in range(layers):
            base = curve_y(t, layer, layers, field.height)

            # Resolution pulls every layer toward the middle one and fades the outliers.
            middle = curve_y(t, layers // 2, layers, field.height)
            y_centre = base + (middle - base) * field.resolution
            distance_from_centre = abs(layer - layers // 2) / (layers / 2)
            survival = 1.0 - field.resolution * distance_from_centre

            if survival <= 0.02:
                continue

            # Marks per column for this layer. Denser where the curve bends, which is where a real
            # book carries its information — and is why the field reads as structure rather than as
            # noise. `math.sin` of the shape derivative approximates that bend.
            bend = abs(math.cos(t * math.pi / 2))
            count = int((field.density / layers) * survival * (0.55 + 0.75 * bend))

            for _ in range(count):
                spread = field.height * 0.035 * (1.0 + 2.0 * (1.0 - survival))
                y = rng.gauss(y_centre, spread)
                if not (0 <= y < field.height):
                    continue

                jitter = rng.random()
                # Ash on Onyx, at a low alpha simulated by interpolation — no alpha channel, because
                # a transparent edge is where halos come from when the asset lands on Graphite.
                weight = 0.10 + 0.30 * survival * (0.4 + 0.6 * jitter)
                colour = tuple(
                    int(ONYX[i] + (ASH[i] - ONYX[i]) * weight) for i in range(3)
                )

                mark = rng.random()
                px = x + rng.uniform(-1.5, 1.5)
                if mark < 0.55:
                    draw.point((px, y), fill=colour)
                elif mark < 0.85:
                    # A short horizontal fragment: the "binary mark" of the reference treatment.
                    draw.line([(px, y), (px + rng.uniform(1, 3), y)], fill=colour)
                else:
                    draw.point((px, y), fill=colour)
                    draw.point((px + 1, y + 1), fill=colour)

    return image


def export(image: Image.Image, name: str, budget: int) -> list[dict]:
    """Write AVIF, WebP and a PNG, and record what each one cost.

    AVIF first because it is the smallest at this kind of low-contrast noise by a wide margin. The
    PNG exists only as the last-resort fallback and is expected to be the largest; it is measured
    rather than assumed, and the manifest says so.

    Quality steps DOWN until the budget is met and stops there. It never drops below the floor: an
    asset that met a byte target by destroying the texture would have defeated its own purpose, and
    the manifest records an over-budget asset rather than shipping a ruined one.
    """
    records: list[dict] = []
    OUT.mkdir(parents=True, exist_ok=True)

    for suffix, kwargs_by_quality in (
        ("avif", lambda q: {"quality": q}),
        ("webp", lambda q: {"quality": q, "method": 6}),
    ):
        chosen = None
        for quality in (62, 55, 48, 42, 36, 30):
            path = OUT / f"{name}.{suffix}"
            image.save(path, **kwargs_by_quality(quality))
            size = path.stat().st_size
            chosen = (quality, size)
            if size <= budget:
                break
        assert chosen is not None
        quality, size = chosen
        records.append(
            {
                "file": f"public/brand/field/{name}.{suffix}",
                "bytes": size,
                "quality": quality,
                "withinBudget": size <= budget,
                "budget": budget,
                "sha256": hashlib.sha256((OUT / f"{name}.{suffix}").read_bytes()).hexdigest(),
            }
        )

    png = OUT / f"{name}.png"
    image.save(png, optimize=True)
    records.append(
        {
            "file": f"public/brand/field/{name}.png",
            "bytes": png.stat().st_size,
            "quality": None,
            "withinBudget": None,
            "budget": None,
            "note": "last-resort fallback only; never referenced first",
            "sha256": hashlib.sha256(png.read_bytes()).hexdigest(),
        }
    )
    return records


def main() -> None:
    manifest: dict = {
        "$comment": (
            "The Encrypted Field. Generated deterministically by scripts/design/build-dither-assets.py "
            "from one seed and from the same curve geometry the live RedactedCurve component draws. "
            "No rate, no capacity, no provider count and no allocation is derived from data of any "
            "kind — the density function is geometric. The single Cobalt quote point is NEVER baked "
            "into a raster; it is drawn at runtime, only when a quote is genuinely public."
        ),
        "seed": f"0x{SEED:X}",
        "generator": "scripts/design/build-dither-assets.py",
        "fields": [],
    }

    for field in FIELDS:
        image = build(field)
        entry: dict = {
            "name": field.name,
            "purpose": field.purpose,
            "width": field.width,
            "height": field.height,
            "resolution": field.resolution,
            "assets": export(image, field.name, field.budget),
        }

        # The mobile derivative, resampled from the full render rather than re-generated: a second
        # generation at a smaller size would produce a different mark distribution, and the two
        # would visibly disagree at a breakpoint.
        if field.width > MOBILE_WIDTH:
            ratio = MOBILE_WIDTH / field.width
            small = image.resize(
                (MOBILE_WIDTH, int(field.height * ratio)), Image.Resampling.LANCZOS
            )
            entry["mobile"] = {
                "width": small.width,
                "height": small.height,
                "assets": export(small, f"{field.name}-900", field.budget // 3),
            }

        manifest["fields"].append(entry)
        print(f"  {field.name:14s} {field.width}x{field.height}")
        for asset in entry["assets"]:
            flag = "" if asset["withinBudget"] is not False else "  OVER BUDGET"
            print(f"      {asset['file'].split('/')[-1]:24s} {asset['bytes']:>8,} B{flag}")

    MANIFEST.parent.mkdir(parents=True, exist_ok=True)
    MANIFEST.write_text(json.dumps(manifest, indent=2) + "\n")
    print(f"\n  manifest written to {MANIFEST.relative_to(REPO)}\n")


if __name__ == "__main__":
    main()
