#!/usr/bin/env python3
"""
Alpha-correct resampling, shared by the brand builder and the brand verifier.

It lives in its own module because both need the exact same maths: the builder to produce the
shipped favicons, the verifier to evaluate a candidate reversed master at every required size. Two
copies would drift, and the drift would be invisible — the verifier would pass artwork the builder
renders differently.
"""

from __future__ import annotations

import numpy as np
from PIL import Image


def _resize_channel(channel: np.ndarray, size: tuple[int, int]) -> np.ndarray:
    """Resample a single float channel, keeping full precision through the filter."""
    return np.asarray(
        Image.fromarray(channel.astype(np.float32), "F").resize(size, Image.LANCZOS), dtype=float
    )


def premultiplied_resize(im: Image.Image, size: tuple[int, int]) -> Image.Image:
    """
    Resize RGBA correctly: weight RGB by alpha, resample, divide back out — entirely in float.

    The float part is not fussiness. An earlier version did the same maths but round-tripped
    through uint8 between the premultiply and the resize; un-premultiplying then divided that
    quantization by a small alpha and amplified it, blowing channels out to 255 and leaving edge
    pixels like [56, 240, 255]. Measured against ground truth it was 12x WORSE than doing nothing,
    which is how it was caught. In float it is correct and beats naive resampling everywhere it
    matters, most visibly against white.
    """
    a = np.asarray(im.convert("RGBA"), dtype=float) / 255.0
    alpha = a[..., 3]
    premultiplied = [_resize_channel(a[..., i] * alpha, size) for i in range(3)]
    alpha_resized = _resize_channel(alpha, size)
    safe = np.clip(alpha_resized, 1e-6, None)
    rgb = np.stack([c / safe for c in premultiplied], axis=-1)
    out = np.dstack([np.clip(rgb, 0, 1) * 255, np.clip(alpha_resized, 0, 1) * 255])
    return Image.fromarray(out.round().astype(np.uint8), "RGBA")
