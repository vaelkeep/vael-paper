"""Plates drawn from data.

A language model cannot make a picture, but it can write down seven numbers.
An article that carries a ``chart:`` block in its frontmatter gets a plate
drawn here, in the paper's own style — ink on cream, a heavy line or solid
bars, hairline grid, no lettering — and the file is placed in ``images/`` as
if the generator had supplied it. The reading of the chart belongs in the
caption, which is where a newspaper puts it anyway.

The spec, all of it optional but ``values``::

    chart:
      kind: line            # line | bars
      values: [8, 9, 14, 22, 38, 55, 72, 80, 74]
      target: 50            # a reference line; bars at or above it are filled
      max: 100              # top of the scale (default: a little above the peak)
      aspect: 16:9          # or 4:3, 3:2
      tick_every: 3         # a heavier tick every n values

Rendering is deterministic for a given spec, and the spec's hash is written
into the PNG, so a plate is redrawn only when the numbers change.
"""

from __future__ import annotations

import hashlib
import json
import math
import random
from pathlib import Path
from typing import Any

from PIL import Image, ImageDraw, ImageFilter
from PIL.PngImagePlugin import PngInfo

INK = (26, 23, 20)
PAPER = (250, 247, 240)
GREY = (110, 104, 94)
FAINT = (185, 178, 166)
FILL = (222, 215, 202)

ASPECTS = {"16:9": (1600, 900), "3:2": (1500, 1000), "4:3": (1200, 900)}
KINDS = {"line", "bars"}
SPEC_KEY = "vael:chart"


class ChartError(ValueError):
    """The spec cannot be drawn. The message says why, for the printer's mark."""


def normalise_spec(raw: Any) -> dict[str, Any]:
    """Validate a spec into the exact form the renderer draws. Raises ChartError."""
    if not isinstance(raw, dict):
        raise ChartError("chart must be a mapping with at least `values`")
    values = raw.get("values") if "values" in raw else raw.get("series")
    if not isinstance(values, list) or len(values) < 2:
        raise ChartError("chart.values must be a list of at least two numbers")
    try:
        nums = [float(v) for v in values]
    except (TypeError, ValueError) as exc:
        raise ChartError(f"chart.values must all be numbers ({exc})") from None
    if len(nums) > 200:
        raise ChartError("chart.values has more than 200 points; that is not a plate")

    kind = str(raw.get("kind") or "line").strip().lower()
    if kind not in KINDS:
        raise ChartError(f"chart.kind must be one of {sorted(KINDS)}, not {kind!r}")

    aspect = str(raw.get("aspect") or ("4:3" if kind == "bars" else "16:9")).strip()
    if aspect not in ASPECTS:
        raise ChartError(f"chart.aspect must be one of {sorted(ASPECTS)}, not {aspect!r}")

    def number(name: str) -> float | None:
        if raw.get(name) is None:
            return None
        try:
            return float(raw[name])
        except (TypeError, ValueError):
            raise ChartError(f"chart.{name} must be a number") from None

    target = number("target")
    top = number("max")
    peak = max(nums + ([target] if target is not None else []))
    if top is None:
        top = peak * 1.12 if peak > 0 else 1.0
    if top <= 0:
        raise ChartError("chart.max must be positive")

    tick_every = raw.get("tick_every")
    tick = int(tick_every) if isinstance(tick_every, (int, float)) and tick_every >= 1 else None

    return {
        "kind": kind,
        "values": nums,
        "target": target,
        "max": top,
        "aspect": aspect,
        "tick_every": tick,
    }


def spec_hash(spec: dict[str, Any]) -> str:
    return hashlib.sha256(json.dumps(spec, sort_keys=True).encode()).hexdigest()[:16]


def _halftone(im: Image.Image) -> Image.Image:
    """A faint, seeded grain so the plate reads as printed rather than drawn."""
    px = im.load()
    w, h = im.size
    rng = random.Random(7)
    for y in range(h):
        for x in range(w):
            if rng.random() < 0.04:
                r, g, b = px[x, y]
                d = rng.randint(-14, 14)
                px[x, y] = (
                    max(0, min(255, r + d)),
                    max(0, min(255, g + d)),
                    max(0, min(255, b + d)),
                )
    return im.filter(ImageFilter.GaussianBlur(0.4))


def draw(spec: dict[str, Any]) -> Image.Image:
    w, h = ASPECTS[spec["aspect"]]
    im = Image.new("RGB", (w, h), PAPER)
    d = ImageDraw.Draw(im)
    left, right, top, bottom = 110, w - 60, 70, h - 110
    values: list[float] = spec["values"]
    scale = spec["max"]
    n = len(values)

    def y_of(v: float) -> float:
        return bottom - (bottom - top) * max(0.0, min(v, scale)) / scale

    if spec["kind"] == "line":
        for frac in (0.25, 0.5, 0.75):
            y = bottom - (bottom - top) * frac
            d.line([(left, y), (right, y)], fill=FAINT, width=4)
        if spec["target"] is not None:
            y = y_of(spec["target"])
            d.line([(left, y), (right, y)], fill=INK, width=6)
        pts = [(left + (right - left) * i / (n - 1), y_of(v)) for i, v in enumerate(values)]
        d.polygon(pts + [(right, bottom), (left, bottom)], fill=FILL)
        d.line(pts, fill=INK, width=16, joint="curve")
        # Where the line first crosses the target, a vertical rule marks it.
        if spec["target"] is not None:
            for i, v in enumerate(values):
                if v >= spec["target"]:
                    x = left + (right - left) * i / (n - 1)
                    d.line([(x, top), (x, bottom)], fill=GREY, width=6)
                    break
        for i in range(n):
            x = left + (right - left) * i / (n - 1)
            d.line([(x, bottom), (x, bottom + 18)], fill=INK, width=5)
            if spec["tick_every"] and i % spec["tick_every"] == 0:
                d.rectangle([x - 5, bottom + 30, x + 5, bottom + 40], fill=GREY)
    else:
        bw = (right - left) / n
        for i, v in enumerate(values):
            x0 = left + i * bw + bw * 0.18
            x1 = left + (i + 1) * bw - bw * 0.18
            filled = spec["target"] is None or v >= spec["target"]
            d.rectangle([x0, y_of(v), x1, bottom], fill=INK if filled else FILL, outline=INK, width=6)
        if spec["target"] is not None:
            ty = y_of(spec["target"])
            for x in range(int(left), int(right), 30):
                d.line([(x, ty), (x + 15, ty)], fill=GREY, width=7)

    d.line([(left, bottom), (right, bottom)], fill=INK, width=9)
    d.line([(left, top), (left, bottom)], fill=INK, width=9)
    return _halftone(im)


def stored_hash(path: Path) -> str | None:
    try:
        with Image.open(path) as im:
            return im.info.get(SPEC_KEY)
    except Exception:
        return None


def ensure_plate(spec: dict[str, Any], path: Path) -> bool:
    """Draw the plate at ``path`` unless one for this exact spec is already there.

    Returns True when a file was written.
    """
    digest = spec_hash(spec)
    if path.exists() and stored_hash(path) == digest:
        return False
    path.parent.mkdir(parents=True, exist_ok=True)
    meta = PngInfo()
    meta.add_text(SPEC_KEY, digest)
    draw(spec).save(path, optimize=True, pnginfo=meta)
    return True
