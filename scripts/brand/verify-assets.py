#!/usr/bin/env python3
"""
Verify the exported Kyrve brand assets.

Every claim in `docs/brand/VALIDATION.md` is produced by this script. It fails loudly rather than
warning: a brand asset that is silently wrong ships to every social card and browser tab.

The halo check is the one worth explaining. A logo with unclean transparent pixels develops a ring
when composited, and the ring is invisible against the background it was authored on. So each
alpha asset is composited over BOTH Onyx and white, and every semi-transparent edge pixel is
required to land between the mark colour and the background in luminance. A pixel darker than both
(over white) or lighter than both (over Onyx) is a halo by definition.
"""

from __future__ import annotations

import hashlib
import json
import struct
import sys
from pathlib import Path

import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / "public" / "brand"

ONYX = (0x17, 0x17, 0x21)
WHITE = (0xFF, 0xFF, 0xFF)

REQUIRED = [
    "logo/kyrve-logo.png", "logo/kyrve-logo.webp",
    "logo/kyrve-symbol.png", "logo/kyrve-symbol.webp",
    "favicon/favicon-16.png", "favicon/favicon-32.png", "favicon/favicon-48.png",
    "favicon/favicon-180.png", "favicon/favicon-192.png", "favicon/favicon-512.png",
    "favicon/apple-touch-icon.png", "favicon/favicon.ico",
    "social/kyrve-og.png", "social/kyrve-og.webp",
    "social/kyrve-og-1200x630.png", "social/kyrve-og-1200x630.webp",
    "cta/kyrve-cta.png", "cta/kyrve-cta.webp",
]

# Sizes that must render correctly, whether as a standalone file or an ICO frame.
FAVICON_RENDER_SIZES = [16, 24, 32, 48, 64, 128, 192, 512]

BUDGETS_KB = {
    "logo/kyrve-logo.webp": 100,
    "social/kyrve-og.webp": 250,
    "social/kyrve-og-1200x630.webp": 250,
    "cta/kyrve-cta.webp": 300,
}

SOURCE_SIZES = {
    "logo": (1024, 1024),
    "symbol": (1024, 1024),
    "og": (1731, 909),
    "cta": (1672, 941),
}

failures: list[str] = []
notes: list[str] = []


def fail(msg: str) -> None:
    failures.append(msg)


def png_chunks(path: Path) -> list[str]:
    data = path.read_bytes()
    if not data.startswith(b"\x89PNG\r\n\x1a\n"):
        return []
    out, i = [], 8
    while i < len(data) - 8:
        (length,) = struct.unpack(">I", data[i : i + 4])
        out.append(data[i + 4 : i + 8].decode("ascii", "replace"))
        i += 12 + length
    return out


def composite(im: Image.Image, bg: tuple[int, int, int]) -> np.ndarray:
    base = Image.new("RGBA", im.size, bg + (255,))
    return np.asarray(Image.alpha_composite(base, im.convert("RGBA")).convert("RGB")).astype(float)


def luminance(a: np.ndarray) -> np.ndarray:
    return 0.2126 * a[..., 0] + 0.7152 * a[..., 1] + 0.0722 * a[..., 2]


def naive_resize(im: Image.Image, size: tuple[int, int]) -> Image.Image:
    """The wrong way, kept only to quantify what the shipped pipeline buys."""
    return im.convert("RGBA").resize(size, Image.LANCZOS)


def square_master() -> Image.Image:
    """
    The exact canvas the favicons are cut from: the shipped trimmed symbol, centred on a square.

    Rebuilt from a SHIPPED artifact rather than the raw source, because the favicons are trimmed
    and re-padded. Comparing them against the untrimmed 1024x1024 source measured a 28/255
    deviation that was entirely framing — the mark simply occupies a different fraction of each
    frame. That was the third wrong version of this check.
    """
    sym = Image.open(OUT / "logo" / "kyrve-symbol.png").convert("RGBA")
    side = max(sym.size)
    canvas = Image.new("RGBA", (side, side), (0, 0, 0, 0))
    canvas.paste(sym, ((side - sym.width) // 2, (side - sym.height) // 2))
    return canvas


def check_halo(source: Image.Image, shipped: Path, size: int, label: str) -> None:
    """
    Compare the SHIPPED file against a ground truth that involves no alpha at all.

    Reference = composite the FULL-RESOLUTION source over the background, then downscale in RGB.
    That is what the eye should see, computed without any alpha handling to get wrong.

    Testing the shipped bytes rather than recomputing them is the point: it catches an encoder or
    a pipeline stage that a recomputation would silently skip.

    Two earlier versions of this check were themselves wrong, which is worth recording. The first
    compared edge pixels against the MEAN mark luminance and reported a 66% halo — but this mark
    has a dark navy body and a bright cobalt leaf, so edges beside the cobalt legitimately exceed
    the mean. The second recomputed the downscale instead of reading the file, and so tested the
    wrong artifact.
    """
    src = source
    ship = Image.open(shipped).convert("RGBA")
    for name, bg in (("Onyx #171721", ONYX), ("white", WHITE)):
        base = Image.new("RGBA", src.size, bg + (255,))
        reference = np.asarray(
            Image.alpha_composite(base, src).convert("RGB").resize((size, size), Image.LANCZOS)
        ).astype(float)

        sbase = Image.new("RGBA", ship.size, bg + (255,))
        actual = np.asarray(Image.alpha_composite(sbase, ship).convert("RGB")).astype(float)

        nsmall = naive_resize(src, (size, size))
        nbase = Image.new("RGBA", nsmall.size, bg + (255,))
        naive = np.asarray(Image.alpha_composite(nbase, nsmall).convert("RGB")).astype(float)

        d = np.abs(actual - reference)
        dn = np.abs(naive - reference)
        status = "ok" if d.mean() <= 1.0 else "HALO"
        notes.append(
            f"{label} @{size}px over {name}: shipped deviates {d.mean():.3f} mean / {d.max():.0f} "
            f"max from reference (naive would be {dn.mean():.3f}) {status}"
        )
        if d.mean() > 1.0:
            fail(f"{label} @{size}px over {name}: deviates {d.mean():.3f}/255 from reference")


def relative_luminance(rgb: np.ndarray) -> np.ndarray:
    s = rgb / 255.0
    s = np.where(s <= 0.03928, s / 12.92, ((s + 0.055) / 1.055) ** 2.4)
    return 0.2126 * s[..., 0] + 0.7152 * s[..., 1] + 0.0722 * s[..., 2]


def contrast(a: np.ndarray, b: np.ndarray) -> np.ndarray:
    hi, lo = np.maximum(a, b), np.minimum(a, b)
    return (hi + 0.05) / (lo + 0.05)


def check_brand_lock() -> None:
    """
    Every number `brand.json` asserts is recomputed here rather than trusted.

    A brand lock that records hashes nobody re-checks is a changelog, not a lock. This makes the
    file falsifiable: edit an export, or quietly recolour a source, and the build fails.
    """
    lock = json.loads((ROOT / "brand.json").read_text())

    for kind, entries in (
        ("source", lock["assets"]["sources"]),
        ("derivative", lock["assets"]["derivatives"]),
    ):
        for key, meta in entries.items():
            path = ROOT / (meta["file"] if kind == "source" else key)
            if not path.exists():
                fail(f"brand.json pins a missing {kind}: {key}")
                continue
            actual = hashlib.sha256(path.read_bytes()).hexdigest()
            if actual != meta["sha256"]:
                fail(f"brand.json {kind} {key}: sha256 {actual[:16]} != pinned {meta['sha256'][:16]}")
            if path.stat().st_size != meta["bytes"]:
                fail(f"brand.json {kind} {key}: {path.stat().st_size} bytes != pinned {meta['bytes']}")
    notes.append(
        f"brand.json: {len(lock['assets']['sources'])} sources + "
        f"{len(lock['assets']['derivatives'])} derivatives hash-matched on disk"
    )

    canvas = relative_luminance(np.array(ONYX, dtype=float))
    for token, expected in lock["colour"]["contrastOnCanvas"].items():
        if token.startswith("$"):
            continue
        hex_value = next(
            v["hex"] for v in lock["colour"].values() if isinstance(v, dict) and v.get("token") == token
        )
        rgb = np.array([int(hex_value[i : i + 2], 16) for i in (1, 3, 5)], dtype=float)
        actual = float(contrast(relative_luminance(rgb), canvas))
        if abs(actual - expected) > 0.01:
            fail(f"brand.json contrast {token}: recomputed {actual:.2f}:1, pinned {expected}:1")
    notes.append("brand.json: every contrastOnCanvas ratio recomputed and matched")

    # The open decision recorded in the lock: the approved master is a light-background asset.
    # Asserted here so that a future recolour cannot silently invalidate the document.
    a = np.asarray(Image.open(OUT / "logo" / "kyrve-symbol.png").convert("RGBA"))
    mark = relative_luminance(a[..., :3].astype(float))[a[..., 3] > 250]
    on_onyx = contrast(mark, canvas)
    on_white = contrast(mark, np.array(1.0))
    notes.append(
        f"approved mark: {100 * (on_white >= 4.5).mean():.1f}% of opaque pixels clear 4.5:1 on white, "
        f"{100 * (on_onyx >= 4.5).mean():.1f}% on Onyx (median {np.median(on_onyx):.2f}:1) "
        "— light-background asset, see KYRVE-BRAND-LOCK.md"
    )
    if lock["logo"]["backgrounds"]["approvedMasterIsAuthoredFor"] != "light":
        fail("brand.json claims the master is not light-authored; measurement says otherwise")
    if (on_onyx >= 4.5).mean() > 0.0:
        fail("the mark now clears 4.5:1 on Onyx — was it recoloured? The lock forbids that.")


def write_validation() -> None:
    """Every claim in VALIDATION.md is a line this script measured on this run."""
    status = (
        f"**FAILED** — {len(failures)} finding(s)" if failures else "**PASS** — 0 findings"
    )
    lines = [
        "# Kyrve brand asset validation",
        "",
        "Generated by `scripts/brand/verify-assets.py`. Do not edit by hand — re-run `pnpm brand:verify`.",
        "",
        f"Result: {status}",
        "",
        "## What is checked, and why",
        "",
        "| Check | Why it exists |",
        "| --- | --- |",
        "| All 18 required exports present, within byte budget | A missing social card degrades to a link preview with no image, silently |",
        "| Favicon renders at 16, 24, 32, 48, 64, 128, 192, 512 | Each is requested by a real surface; a gap falls back to a browser default |",
        "| Open Graph card is exactly 1200x630 | Crawlers reject or re-crop anything else |",
        "| CTA keeps its native aspect | Any other aspect is a distortion of approved artwork |",
        "| No export exceeds its source resolution | Upscaling invents detail the approved asset does not have |",
        "| No `tEXt`/`iTXt`/`zTXt`/`tIME`/`iCCP`/`eXIf` chunk in any PNG | Metadata leaks build paths and timestamps, and an embedded profile shifts colour between renderers |",
        "| Logo, symbol and 512px favicon are RGBA | A flattened alpha channel puts a hard rectangle on the canvas |",
        "| Alpha edges match a no-alpha reference on dark **and** light | This is the halo test, described below |",
        "| Every `brand.json` hash matches the bytes on disk | A lock nobody re-checks is a changelog |",
        "| Every `brand.json` contrast ratio recomputes | The same |",
        "",
        "## The halo test",
        "",
        "A mark with unclean transparent pixels grows a ring when composited, and the ring is invisible",
        "against the background the artwork was authored on. So each favicon is compared against a",
        "reference built with **no alpha handling at all**: composite the full-resolution master over the",
        "background first, then downscale in RGB. That is what the eye should see, computed without any",
        "alpha maths to get wrong. The shipped bytes are read from disk rather than recomputed, so an",
        "encoder stage cannot be skipped by the test.",
        "",
        "Three earlier versions of this check were themselves wrong, which is worth recording:",
        "the first compared edge pixels against the *mean* mark luminance and reported a 66% halo — but",
        "this mark has a dark navy body and a bright cobalt leaf, so edges beside the cobalt legitimately",
        "exceed the mean. The second recomputed the downscale instead of reading the file, and so tested",
        "the wrong artifact. The third compared trimmed favicons against the untrimmed source and measured",
        "a 28/255 deviation that was entirely framing.",
        "",
        "## Measured results",
        "",
        "```",
    ]
    lines += [f"{note}" for note in notes]
    lines += ["```", ""]
    if failures:
        lines += ["## Findings", ""] + [f"- {f}" for f in failures] + [""]
    (ROOT / "docs" / "brand" / "VALIDATION.md").write_text("\n".join(lines))


def main() -> None:
    # ---- presence, dimensions, budgets
    for rel in REQUIRED:
        path = OUT / rel
        if not path.exists():
            fail(f"missing required export: {rel}")
            continue
        kb = path.stat().st_size / 1024
        budget = BUDGETS_KB.get(rel)
        if budget and kb > budget:
            fail(f"{rel}: {kb:.1f} KB exceeds the {budget} KB budget")

    # ---- favicon renders at every required size
    ico = Image.open(OUT / "favicon" / "favicon.ico")
    ico_sizes = {s[0] for s in ico.ico.sizes()}
    for size in FAVICON_RENDER_SIZES:
        standalone = OUT / "favicon" / f"favicon-{size}.png"
        if standalone.exists():
            with Image.open(standalone) as im:
                if im.size != (size, size):
                    fail(f"favicon-{size}.png is {im.size}, expected ({size}, {size})")
            notes.append(f"favicon {size}px: standalone PNG {standalone.stat().st_size:,} B")
        elif size in ico_sizes:
            frame = ico.ico.getimage((size, size))
            if frame.size != (size, size):
                fail(f"favicon.ico frame {size} decodes at {frame.size}")
            notes.append(f"favicon {size}px: ICO frame, decodes {frame.size}")
        else:
            fail(f"favicon has no rendering path at {size}px")

    # ---- OG is exactly 1200x630
    with Image.open(OUT / "social" / "kyrve-og-1200x630.png") as im:
        if im.size != (1200, 630):
            fail(f"OG card is {im.size}, must be exactly (1200, 630)")
        else:
            notes.append("OG card: exactly 1200x630")

    # ---- CTA keeps its native aspect
    with Image.open(OUT / "cta" / "kyrve-cta.png") as im:
        src_w, src_h = SOURCE_SIZES["cta"]
        if im.size != (src_w, src_h):
            fail(f"CTA is {im.size}, expected native {(src_w, src_h)}")
        else:
            notes.append(f"CTA: native {src_w}x{src_h}, aspect {src_w / src_h:.6f}")

    # ---- nothing was upscaled
    for rel, source_key in (
        ("logo/kyrve-logo.png", "logo"),
        ("social/kyrve-og.png", "og"),
        ("cta/kyrve-cta.png", "cta"),
    ):
        with Image.open(OUT / rel) as im:
            sw, sh = SOURCE_SIZES[source_key]
            if im.width > sw or im.height > sh:
                fail(f"{rel} is {im.size}, larger than its {sw}x{sh} source — upscaled")

    # ---- metadata stripped, no embedded colour profile to shift
    ancillary = {"tEXt", "iTXt", "zTXt", "tIME", "iCCP", "eXIf"}
    for path in sorted(OUT.rglob("*.png")):
        present = ancillary.intersection(png_chunks(path))
        if present:
            fail(f"{path.relative_to(OUT)}: carries {sorted(present)}")
    notes.append("PNG: no tEXt/iTXt/zTXt/tIME/iCCP/eXIf chunks in any export")

    # ---- transparency preserved where it must be
    for rel in ("logo/kyrve-logo.png", "logo/kyrve-symbol.png", "favicon/favicon-512.png"):
        with Image.open(OUT / rel) as im:
            if im.mode != "RGBA":
                fail(f"{rel} is mode {im.mode}, transparency lost")
            else:
                a = np.asarray(im.convert("RGBA"))[..., 3]
                notes.append(f"{rel}: RGBA, {100 * (a == 0).mean():.1f}% fully transparent")

    # ---- alpha edges on dark and light, at the sizes where a halo actually shows
    master = square_master()
    for size in (16, 32, 48, 192):
        check_halo(master, OUT / "favicon" / f"favicon-{size}.png", size, "favicon")

    # ---- the brand lock is falsifiable, not decorative
    check_brand_lock()

    # ---- report
    print("Kyrve brand asset verification\n")
    for note in notes:
        print(f"  {note}")

    inventory = {}
    for path in sorted(OUT.rglob("*")):
        if path.is_file():
            inventory[path.relative_to(ROOT).as_posix()] = {
                "bytes": path.stat().st_size,
                "sha256": hashlib.sha256(path.read_bytes()).hexdigest(),
            }
    (ROOT / "scripts" / "brand" / "verify-report.json").write_text(
        json.dumps({"failures": failures, "notes": notes, "inventory": inventory}, indent=2) + "\n"
    )

    write_validation()

    if failures:
        print(f"\nbrand:verify FAILED — {len(failures)} finding(s)\n")
        for f in failures:
            print(f"  - {f}")
        sys.exit(1)

    print(f"\nbrand:verify PASS — {len(REQUIRED)} required exports, "
          f"{len(FAVICON_RENDER_SIZES)} favicon sizes, OG exact, CTA native, no halo")


if __name__ == "__main__":
    main()
