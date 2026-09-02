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
      labels: [6am, 9, noon, 3, 6, 9, midnight]   # under the axis; spread evenly
      show_values: true     # the number above each bar, or at a line's ends and peak
      target: 50            # a reference line; bars at or above it are filled
      min: 0                # bottom of the scale (default 0)
      max: 100              # top of the scale (default: a little above the peak)
      aspect: 16:9          # or 4:3, 3:2
      tick_every: 3         # a heavier tick every n values

Lettering is set in the paper's own face at agate size — labels in
letterspaced capitals, values in figures — from a TrueType copy of Source
Serif 4 shipped with the package, so a plate matches the page it sits on.

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

from PIL import Image, ImageDraw, ImageFilter, ImageFont
from PIL.PngImagePlugin import PngInfo

FONT_PATH = Path(__file__).with_name("fonts") / "SourceSerif4.ttf"

INK = (26, 23, 20)
PAPER = (250, 247, 240)
GREY = (110, 104, 94)
FAINT = (185, 178, 166)
FILL = (222, 215, 202)

ASPECTS = {"16:9": (1600, 900), "3:2": (1500, 1000), "4:3": (1200, 900)}
KINDS = {"line", "bars"}
SPEC_KEY = "vael:chart"
# Bump when the drawing changes, so plates already on disk are redrawn.
RENDER_VERSION = 2
MAX_LABELS = 40
# Plates are shown at roughly a quarter of their pixel size, so lettering
# that should read as agate on the page is drawn four times that here.
LABEL_SIZE = 46
VALUE_SIZE = 50
EDGE = 24


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

    low = number("min") or 0.0
    if low >= top:
        raise ChartError(f"chart.min ({low:g}) must be below chart.max ({top:g})")

    labels_raw = raw.get("labels")
    labels: list[str] = []
    if labels_raw is not None:
        if not isinstance(labels_raw, list) or not labels_raw:
            raise ChartError("chart.labels must be a list of short strings")
        if len(labels_raw) > MAX_LABELS:
            raise ChartError(f"chart.labels has more than {MAX_LABELS} entries; they would overlap")
        labels = [str(x).strip() for x in labels_raw]
        if any(len(x) > 12 for x in labels):
            raise ChartError("chart.labels entries must be twelve characters or fewer")

    return {
        "kind": kind,
        "values": nums,
        "labels": labels,
        "show_values": bool(raw.get("show_values")),
        "target": target,
        "min": low,
        "max": top,
        "aspect": aspect,
        "tick_every": tick,
    }


def spec_hash(spec: dict[str, Any]) -> str:
    payload = json.dumps({"v": RENDER_VERSION, **spec}, sort_keys=True)
    return hashlib.sha256(payload.encode()).hexdigest()[:16]


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


def _font(size: int) -> ImageFont.FreeTypeFont | ImageFont.ImageFont:
    try:
        return ImageFont.truetype(str(FONT_PATH), size)
    except OSError:  # the packaged face is missing; the plate still draws
        return ImageFont.load_default()


def _figure(v: float) -> str:
    """A number the way the paper sets one: thousands separated, no noise."""
    if abs(v - round(v)) < 1e-9:
        return f"{int(round(v)):,}"
    return f"{v:,.1f}"


def _caps(
    d: ImageDraw.ImageDraw, x: float, y: float, text: str, size: int, plate_w: int
) -> None:
    """Letterspaced capitals, centred on x with the top at y — the folio style.

    A label at either end of the axis is nudged inward so it stays on the plate.
    """
    font = _font(size)
    text = text.upper()
    tracking = size * 0.12
    width = sum(font.getlength(ch) for ch in text) + tracking * (len(text) - 1)
    cx = max(EDGE, min(x - width / 2, plate_w - EDGE - width))
    for ch in text:
        d.text((cx, y), ch, font=font, fill=GREY)
        cx += font.getlength(ch) + tracking


def draw(spec: dict[str, Any]) -> Image.Image:
    w, h = ASPECTS[spec["aspect"]]
    im = Image.new("RGB", (w, h), PAPER)
    d = ImageDraw.Draw(im)
    labels: list[str] = spec["labels"]
    show_values: bool = spec["show_values"]
    left, right = 110, w - 60
    top = 70 + (VALUE_SIZE + 24 if show_values else 0)
    bottom = h - (150 if labels else 110)
    values: list[float] = spec["values"]
    low, scale = spec["min"], spec["max"]
    n = len(values)
    value_font = _font(VALUE_SIZE)

    def y_of(v: float) -> float:
        clamped = max(low, min(v, scale))
        return bottom - (bottom - top) * (clamped - low) / (scale - low)

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
            if spec["tick_every"] and i % spec["tick_every"] == 0 and not labels:
                d.rectangle([x - 5, bottom + 30, x + 5, bottom + 40], fill=GREY)
        centres = [left + (right - left) * i / (n - 1) for i in range(n)]
        if show_values:
            # The ends and the peak: enough to read the line, not so many
            # that the figures fight the curve.
            peak = max(range(n), key=lambda i: values[i])
            for i in sorted({0, peak, n - 1}):
                x, y = centres[i], y_of(values[i])
                anchor = "lb" if i == 0 else "rb" if i == n - 1 else "mb"
                d.text((x, y - 22), _figure(values[i]), font=value_font, fill=INK, anchor=anchor)
    else:
        bw = (right - left) / n
        centres = [left + (i + 0.5) * bw for i in range(n)]
        for i, v in enumerate(values):
            x0 = left + i * bw + bw * 0.18
            x1 = left + (i + 1) * bw - bw * 0.18
            filled = spec["target"] is None or v >= spec["target"]
            d.rectangle([x0, y_of(v), x1, bottom], fill=INK if filled else FILL, outline=INK, width=6)
            if show_values:
                text = _figure(v)
                half = value_font.getlength(text) / 2
                cx = max(EDGE + half, min(centres[i], w - EDGE - half))
                d.text((cx, y_of(v) - 18), text, font=value_font, fill=INK, anchor="mb")
        if spec["target"] is not None:
            ty = y_of(spec["target"])
            for x in range(int(left), int(right), 30):
                d.line([(x, ty), (x + 15, ty)], fill=GREY, width=7)

    if labels:
        # One label per value sits under its value; otherwise the labels are
        # spread evenly from the first value to the last.
        if len(labels) == n:
            xs = centres
        else:
            k = len(labels)
            xs = [centres[0] + (centres[-1] - centres[0]) * i / (k - 1) if k > 1 else centres[0] for i in range(k)]
        # A label wider than the room between labels would collide with its
        # neighbour; better to say so than to draw a plate nobody can read.
        font = _font(LABEL_SIZE)
        room = (xs[1] - xs[0]) if len(xs) > 1 else (right - left)
        for label in labels:
            width = sum(font.getlength(ch) for ch in label.upper()) + LABEL_SIZE * 0.12 * (len(label) - 1)
            if width > room * 0.92:
                raise ChartError(
                    f"chart.labels: {label!r} is too wide for the space between labels; "
                    "shorten it or use fewer labels"
                )
        for x, label in zip(xs, labels):
            _caps(d, x, bottom + 34, label, LABEL_SIZE, w)

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
