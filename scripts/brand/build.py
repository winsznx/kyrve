#!/usr/bin/env python3
"""
Edge-cleaning and trimming, shared by the brand builder and the brand verifier.

Split out of `build-assets.py` for the same reason `imaging.py` was: the verifier must evaluate the
artwork exactly as it will ship. Checking the raw delivered file instead measured a near-transparent
fringe that the shipped export does not have.
"""

from __future__ import annotations

import numpy as np
from PIL import Image

# Clear space around the trimmed symbol, as a fraction of its longest edge. 12% keeps the mark
# from touching a favicon's edge at 16px, where one pixel of bleed is 6% of the icon.
SYMBOL_PADDING = 0.12


def bleed_edges(im: Image.Image, passes: int = 8) -> Image.Image:
    """
    Push opaque colour outward into transparent pixels.

    Removes the stray grey sitting in the alpha=0 region so that any downstream tool which
    resamples without premultiplying still cannot pull a halo into the edges.
    """
    a = np.asarray(im.convert("RGBA")).astype(np.float64)
    rgb, alpha = a[..., :3].copy(), a[..., 3].copy()
    known = alpha > 0
    for _ in range(passes):
        if known.all():
            break
        acc = np.zeros_like(rgb)
        cnt = np.zeros(known.shape, dtype=np.float64)
        for dy, dx in ((1, 0), (-1, 0), (0, 1), (0, -1)):
            s_rgb = np.roll(rgb, (dy, dx), axis=(0, 1))
            s_known = np.roll(known, (dy, dx), axis=(0, 1))
            acc += s_rgb * s_known[..., None]
            cnt += s_known
        fill = (~known) & (cnt > 0)
        rgb[fill] = (acc[fill] / cnt[fill][..., None])
        known = known | fill
    out = np.dstack([rgb, alpha]).round().clip(0, 255).astype(np.uint8)
    return Image.fromarray(out, "RGBA")


def trim(im: Image.Image, padding_ratio: float) -> Image.Image:
    """Trim to the visible bounding box, then re-pad by a fixed ratio of the longest edge."""
    a = np.asarray(im.convert("RGBA"))
    ys, xs = np.nonzero(a[..., 3] > 8)
    box = (int(xs.min()), int(ys.min()), int(xs.max()) + 1, int(ys.max()) + 1)
    cropped = im.crop(box)
    pad = int(round(max(cropped.size) * padding_ratio))
    canvas = Image.new("RGBA", (cropped.width + 2 * pad, cropped.height + 2 * pad), (0, 0, 0, 0))
    canvas.paste(cropped, (pad, pad))
    return canvas
