#!/usr/bin/env python3
"""
Productionize the four approved Kyrve brand assets.

Re-runnable and deterministic: same sources in, byte-identical exports out. `pnpm brand:verify`
checks the results and `docs/brand/VALIDATION.md` records them.

THE ONE THING THAT MATTERS MOST HERE — PREMULTIPLIED RESAMPLING.

The approved logo and symbol are 95% transparent, and the RGB channel inside those transparent
pixels carries leftover grey (~#4b4b4c) from the render. A naive RGBA resize blends RGB without
weighting by alpha, so that grey bleeds into every edge. Measured on this artwork at 32px: a mean
difference of 57.9/255 across 68 semi-transparent edge pixels — a visible halo at exactly the sizes
a favicon is seen at.

So every downscale premultiplies, resamples, then un-premultiplies. The full-resolution PNG also
has its transparent-pixel RGB cleaned by bleeding the nearest opaque colour outward, so a
downstream tool that resamples naively cannot reintroduce the halo.

NOT DONE HERE, DELIBERATELY: no SVG. The artwork carries soft radial glow and gradient fills that
cannot be faithfully reconstructed as editable vector paths, and auto-tracing a raster edge and
calling the result a production SVG would be a lie about what the file is.
"""

from __future__ import annotations

import hashlib
import io
import json
import subprocess
import sys
from pathlib import Path

import numpy as np
from PIL import Image

sys.path.insert(0, str(Path(__file__).resolve().parent))
from build import SYMBOL_PADDING, bleed_edges, trim  # noqa: E402
from imaging import premultiplied_resize  # noqa: E402

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / "public" / "brand"

SOURCES = {
    "logo": ROOT / "kyrve-logo-source.png",
    "symbol": ROOT / "kyrve-favicon-source.png",
    "og": ROOT / "kyrve-og-source.png",
    "cta": ROOT / "kyrve-cta-source.png",
}

FAVICON_SIZES = [16, 32, 48, 180, 192, 512]
ICO_SIZES = [16, 24, 32, 48, 64, 128, 256]


def sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()




def write_ico(frames: list[Image.Image], path: Path) -> None:
    """
    Write a multi-resolution ICO by hand, embedding a PNG per frame.

    Pillow's ICO writer downscales from the base image using its own resampler, which would throw
    away the premultiplied frames prepared above — and passing an already-small base silently
    produced a single 16x16 entry, which is what happened on the first attempt here.
    """
    import struct

    encoded = []
    for frame in frames:
        buf = io.BytesIO()
        frame.save(buf, "PNG", optimize=True)
        encoded.append(buf.getvalue())

    header = struct.pack("<HHH", 0, 1, len(frames))
    offset = len(header) + 16 * len(frames)
    directory, payload = b"", b""
    for frame, blob in zip(frames, encoded):
        # 256 is encoded as 0 in the directory; ICO has one byte per dimension.
        w = 0 if frame.width >= 256 else frame.width
        h = 0 if frame.height >= 256 else frame.height
        directory += struct.pack("<BBBBHHII", w, h, 0, 0, 1, 32, len(blob), offset)
        payload += blob
        offset += len(blob)

    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(header + directory + payload)


def save_png(im: Image.Image, path: Path) -> None:
    """PNG with no ancillary chunks: no text, no timestamp, no colour profile to shift."""
    path.parent.mkdir(parents=True, exist_ok=True)
    im.save(path, "PNG", optimize=True)


def save_webp(path_in: Path, path_out: Path, *, lossless: bool, quality: int) -> None:
    """cwebp, because Pillow's encoder gives no control over alpha filtering or metadata."""
    argv = ["cwebp", "-quiet", "-metadata", "none", str(path_in), "-o", str(path_out)]
    if lossless:
        # -z 9 is maximum lossless effort; -alpha_filter best preserves the mark's soft edges.
        argv[1:1] = ["-lossless", "-z", "9", "-alpha_filter", "best"]
    else:
        argv[1:1] = ["-q", str(quality), "-m", "6", "-sharp_yuv"]
    subprocess.run(argv, check=True, capture_output=True)


USE = {
    "logo/kyrve-logo.png": "Full lockup master. Placement in documents and decks.",
    "logo/kyrve-logo.webp": "Full lockup for the web.",
    "logo/kyrve-symbol.png": "Symbol master, trimmed. Application header.",
    "logo/kyrve-symbol.webp": "Symbol for the web.",
    "favicon/favicon.ico": "Legacy browser tab icon. 7 frames, 16-256px.",
    "favicon/favicon-16.png": "Browser tab, 1x.",
    "favicon/favicon-32.png": "Browser tab, 2x. Taskbar.",
    "favicon/favicon-48.png": "Windows site icon.",
    "favicon/favicon-180.png": "Source for the Apple touch icon.",
    "favicon/apple-touch-icon.png": "iOS home screen.",
    "favicon/favicon-192.png": "Web app manifest, standard density.",
    "favicon/favicon-512.png": "Web app manifest, install prompt and splash.",
    "social/kyrve-og.png": "Social card master at approved source resolution.",
    "social/kyrve-og.webp": "Social card master for the web.",
    "social/kyrve-og-1200x630.png": "Open Graph and Twitter card. The exact size crawlers require.",
    "social/kyrve-og-1200x630.webp": "Open Graph card for crawlers that accept WebP.",
    "cta/kyrve-cta.png": "Call-to-action panel master, native aspect.",
    "cta/kyrve-cta.webp": "Call-to-action panel for the web.",
}


def write_manifest(report: dict[str, object]) -> None:
    """Generate the manifest from the build itself. A hand-transcribed hash table goes stale."""
    lines = [
        "# Kyrve asset manifest",
        "",
        "Generated by `scripts/brand/build-assets.py`. Do not edit by hand — rebuild instead.",
        "Policy lives in [`KYRVE-BRAND-LOCK.md`](KYRVE-BRAND-LOCK.md); measured results live in",
        "[`VALIDATION.md`](VALIDATION.md); the machine-readable form is [`brand.json`](../../brand.json).",
        "",
        "## Approved sources",
        "",
        "Retained unmodified at the repository root. Every shipped file derives from one of these four;",
        "nothing is exported from a derivative of a derivative.",
        "",
        "| Source | Dimensions | Mode | Bytes | SHA-256 |",
        "| --- | --- | --- | ---: | --- |",
    ]
    for name, meta in sorted(report["sources"].items()):
        lines.append(
            f"| `{meta['file']}` | {meta['width']}x{meta['height']} | {meta['mode']} | "
            f"{meta['bytes']:,} | `{meta['sha256']}` |"
        )

    lines += [
        "",
        "## Production exports",
        "",
        "| File | Dimensions | Bytes | Use | SHA-256 |",
        "| --- | --- | ---: | --- | --- |",
    ]
    for rel, meta in sorted(report["exports"].items()):
        key = rel.removeprefix("public/brand/")
        dims = f"{meta.get('width', '?')}x{meta.get('height', '?')}"
        lines.append(
            f"| [`{key}`](../../{rel}) | {dims} | {meta['bytes']:,} | "
            f"{USE.get(key, '')} | `{meta['sha256'][:32]}...` |"
        )

    lines += [
        "",
        "Full derivative hashes are in [`brand.json`](../../brand.json), where",
        "`scripts/brand/verify-assets.py` re-checks every one of them against the bytes on disk.",
        "",
        "## Not shipped, deliberately",
        "",
        "**No SVG.** The approved artwork carries soft radial glow and gradient fills whose geometry",
        "cannot be faithfully reconstructed as editable vector paths. Auto-tracing the raster edge and",
        "shipping the result as a production SVG would misstate what the file is. A true vector master",
        "would have to come from the original design source, not from these rasters.",
        "",
        "**No recoloured dark-canvas variant.** See the open decision in",
        "[`KYRVE-BRAND-LOCK.md`](KYRVE-BRAND-LOCK.md#open-decision-the-approved-master-is-a-light-background-asset).",
        "",
    ]
    (ROOT / "docs" / "brand" / "ASSET-MANIFEST.md").write_text("\n".join(lines))


def main() -> None:
    report: dict[str, object] = {"sources": {}, "exports": {}}

    for name, path in SOURCES.items():
        with Image.open(path) as im:
            report["sources"][name] = {
                "file": path.name,
                "width": im.width,
                "height": im.height,
                "mode": im.mode,
                "sha256": sha256(path),
                "bytes": path.stat().st_size,
            }

    # ---------------------------------------------------------------- logo and symbol
    logo = bleed_edges(Image.open(SOURCES["logo"]).convert("RGBA"))
    save_png(logo, OUT / "logo" / "kyrve-logo.png")
    save_webp(OUT / "logo" / "kyrve-logo.png", OUT / "logo" / "kyrve-logo.webp", lossless=True, quality=100)

    # The symbol master is trimmed: the approved source frames a 437x301 mark inside 1024x1024,
    # which is 87% empty. An asset meant to be placed cannot carry that much dead canvas. The mark
    # geometry itself is untouched — this is a crop and re-pad, never a redraw.
    symbol = trim(bleed_edges(Image.open(SOURCES["symbol"]).convert("RGBA")), SYMBOL_PADDING)
    save_png(symbol, OUT / "logo" / "kyrve-symbol.png")
    save_webp(OUT / "logo" / "kyrve-symbol.png", OUT / "logo" / "kyrve-symbol.webp", lossless=True, quality=100)

    # ---------------------------------------------------------------- reversed master
    # Built only when the commissioned reversed master exists. It is a SEPARATE approved asset for
    # dark surfaces, never a recolour of the positive one, and it is deliberately not required:
    # `verify-assets.py` reports PENDING rather than passing when it is absent.
    reversed_source = ROOT / "kyrve-symbol-reversed-source.png"
    if reversed_source.exists():
        reversed_symbol = trim(
            bleed_edges(Image.open(reversed_source).convert("RGBA")), SYMBOL_PADDING
        )
        save_png(reversed_symbol, OUT / "logo" / "kyrve-symbol-reversed.png")
        save_webp(
            OUT / "logo" / "kyrve-symbol-reversed.png",
            OUT / "logo" / "kyrve-symbol-reversed.webp",
            lossless=True,
            quality=100,
        )

    # ---------------------------------------------------------------- favicons
    # Square canvas centred on the trimmed symbol, so every size crops identically.
    side = max(symbol.size)
    square = Image.new("RGBA", (side, side), (0, 0, 0, 0))
    square.paste(symbol, ((side - symbol.width) // 2, (side - symbol.height) // 2))

    for size in FAVICON_SIZES:
        # Never upscale: the master is 437px+, every target is smaller.
        assert size <= side, f"{size}px would upscale from a {side}px master"
        save_png(premultiplied_resize(square, (size, size)), OUT / "favicon" / f"favicon-{size}.png")

    save_png(premultiplied_resize(square, (180, 180)), OUT / "favicon" / "apple-touch-icon.png")

    write_ico(
        [premultiplied_resize(square, (s, s)) for s in ICO_SIZES],
        OUT / "favicon" / "favicon.ico",
    )

    # ---------------------------------------------------------------- social and cta
    og = Image.open(SOURCES["og"]).convert("RGB")
    save_png(og, OUT / "social" / "kyrve-og.png")
    save_webp(OUT / "social" / "kyrve-og.png", OUT / "social" / "kyrve-og.webp", lossless=False, quality=86)

    # Exactly 1200x630. The source is 1731x909 (aspect 1.904290) against a target of 1.904762 —
    # a 0.025% difference, roughly 0.16px over the full height. Resized directly rather than
    # cropped: discarding a row of real pixels to chase a sub-pixel aspect error is the worse trade.
    og_card = og.resize((1200, 630), Image.LANCZOS)
    save_png(og_card, OUT / "social" / "kyrve-og-1200x630.png")
    save_webp(
        OUT / "social" / "kyrve-og-1200x630.png",
        OUT / "social" / "kyrve-og-1200x630.webp",
        lossless=False,
        quality=86,
    )

    cta = Image.open(SOURCES["cta"]).convert("RGB")
    save_png(cta, OUT / "cta" / "kyrve-cta.png")
    save_webp(OUT / "cta" / "kyrve-cta.png", OUT / "cta" / "kyrve-cta.webp", lossless=False, quality=86)

    for path in sorted(OUT.rglob("*")):
        if path.is_file():
            with_size = path.relative_to(ROOT).as_posix()
            entry: dict[str, object] = {"bytes": path.stat().st_size, "sha256": sha256(path)}
            if path.suffix in {".png", ".webp", ".ico"}:
                try:
                    with Image.open(path) as im:
                        entry["width"], entry["height"] = im.size
                        entry["mode"] = im.mode
                except Exception:
                    pass
            report["exports"][with_size] = entry

    (ROOT / "docs" / "brand").mkdir(parents=True, exist_ok=True)
    (ROOT / "scripts" / "brand" / "build-report.json").write_text(
        json.dumps(report, indent=2, sort_keys=True) + "\n"
    )

    # The policy in brand.json is hand-authored and preserved; only the asset block is regenerated,
    # so a rebuild refreshes hashes without ever silently rewriting a brand decision.
    lock_path = ROOT / "brand.json"
    lock = json.loads(lock_path.read_text())
    lock["assets"] = {
        "sources": {
            name: {
                "file": meta["file"],
                "width": meta["width"],
                "height": meta["height"],
                "mode": meta["mode"],
                "bytes": meta["bytes"],
                "sha256": meta["sha256"],
            }
            for name, meta in sorted(report["sources"].items())
        },
        "derivatives": dict(sorted(report["exports"].items())),
    }
    lock_path.write_text(json.dumps(lock, indent=2) + "\n")
    # biome owns JSON formatting in this repository. Regenerating the file and then leaving it in
    # Python's style would put `pnpm lint` and `pnpm brand:build` in a permanent fight.
    subprocess.run(
        ["pnpm", "exec", "biome", "format", "--write", str(lock_path)],
        check=True, capture_output=True, cwd=ROOT,
    )

    write_manifest(report)

    print(f"{len(report['exports'])} files written to public/brand/")
    for rel, meta in sorted(report["exports"].items()):
        dims = f"{meta.get('width','?')}x{meta.get('height','?')}"
        print(f"  {rel:52} {dims:>11}  {meta['bytes']:>8,} B")


if __name__ == "__main__":
    main()
