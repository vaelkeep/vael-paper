"""Scan edition directories into wire models.

Design rule for this whole module: **never raise on content.** The generator is
a language model writing files unattended at four in the morning; the reader
must still print something at breakfast. Every content problem becomes a
``Warning_`` and the scan continues with a sensible default.

Only genuine I/O failures (the editions root does not exist, an edition is not
found) propagate, and those are the caller's business.
"""

from __future__ import annotations

import hashlib
import json
import logging
import re
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

import yaml
from PIL import Image, ImageStat
from urllib.parse import urlparse

from .models import (
    Article,
    Edition,
    EditionSummary,
    ImageAsset,
    Section,
    SourceRef,
    Warning_,
)

log = logging.getLogger(__name__)

EDITION_DIR_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")
FRONTMATTER_RE = re.compile(r"\A---[ \t]*\r?\n(.*?)\r?\n---[ \t]*\r?\n?", re.DOTALL)
SCALAR_RE = re.compile(r"^([A-Za-z_][A-Za-z0-9_]*)\s*:\s*(.*)$")
VALID_SPANS = {"full", "2col", "1col"}
VALID_FOCUS = {"top", "center", "bottom"}


@dataclass
class _Ctx:
    """Accumulates warnings across one edition scan."""

    warnings: list[Warning_] = field(default_factory=list)

    def warn(self, scope: str, code: str, message: str) -> None:
        self.warnings.append(Warning_(scope=scope, code=code, message=message))
        log.debug("scan warning [%s/%s] %s", scope, code, message)


# --------------------------------------------------------------------------
# frontmatter
# --------------------------------------------------------------------------


def split_frontmatter(text: str) -> tuple[str, str]:
    """Return ``(frontmatter_yaml, body)``. Missing frontmatter yields ``("", text)``."""
    m = FRONTMATTER_RE.match(text)
    if not m:
        return "", text
    return m.group(1), text[m.end() :]


def _scrape_scalars(raw: str) -> dict[str, Any]:
    """Last-resort frontmatter recovery when YAML refuses to parse.

    Pulls ``key: value`` pairs off individual lines, ignoring anything it can't
    make sense of. This is how a single malformed field (an unclosed bracket, a
    stray indent) costs us that field rather than the whole article.
    """
    out: dict[str, Any] = {}
    for line in raw.splitlines():
        m = SCALAR_RE.match(line.strip())
        if not m:
            continue
        key, val = m.group(1), m.group(2).strip()
        if not val or val[0] in "[{|>&*":  # not a plain scalar; skip it
            continue
        out[key] = val.strip("'\"")
    return out


def parse_frontmatter(raw: str, scope: str, ctx: _Ctx) -> dict[str, Any]:
    if not raw.strip():
        ctx.warn(scope, "no_frontmatter", "Article has no YAML frontmatter block.")
        return {}
    try:
        data = yaml.safe_load(raw)
    except yaml.YAMLError as exc:
        detail = str(exc).splitlines()[0] if str(exc) else exc.__class__.__name__
        recovered = _scrape_scalars(raw)
        ctx.warn(
            scope,
            "yaml_parse",
            f"Frontmatter is not valid YAML ({detail}); "
            f"recovered {len(recovered)} field(s) by scraping.",
        )
        return recovered
    if data is None:
        return {}
    if not isinstance(data, dict):
        ctx.warn(scope, "frontmatter_type", "Frontmatter is not a mapping; ignoring it.")
        return {}
    return data


# --------------------------------------------------------------------------
# images
# --------------------------------------------------------------------------


def classify_tone(im: Image.Image) -> bool:
    """True when an image looks like a photograph rather than line art.

    The two want opposite treatment in the night theme — a chart should invert
    to white-on-black, a photograph must not become a film negative — and the
    generator cannot be relied upon to say which it produced.

    Two signals, either of which is sufficient:

    * **Midtone occupancy.** Line art is bimodal: ink and paper, with little
      in between. A photograph fills the middle of the range. On the sample
      edition this alone separates cleanly — 0.86 for a photograph against
      0.02-0.23 for three different kinds of plate.
    * **Saturation.** Line art is near-neutral by construction.
    """
    small = im.copy()
    small.thumbnail((160, 160))
    rgb = small.convert("RGB")

    hist = rgb.convert("L").histogram()
    total = sum(hist) or 1
    midtone = sum(hist[64:192]) / total

    saturation = ImageStat.Stat(rgb.convert("HSV").getchannel("S")).mean[0] / 255

    return midtone > 0.45 or saturation > 0.20


def probe_image(path: Path, key: str, src: str, scope: str, ctx: _Ctx) -> ImageAsset | None:
    """Read intrinsic dimensions and a dominant colour.

    Dimensions are not a nicety: the reader reserves an image's space *before*
    the bytes arrive, and a wrong reservation invalidates the pagination it was
    computed from. Doing this here means the generator never has to know or
    guess a pixel size.
    """
    try:
        with Image.open(path) as im:
            w, h = im.size
            thumb = im.convert("RGB").resize((1, 1), Image.Resampling.BOX)
            r, g, b = thumb.getpixel((0, 0))
            is_photo = classify_tone(im)
    except FileNotFoundError:
        ctx.warn(scope, "missing_image", f"Image {key!r} is referenced but not on disk.")
        return None
    except Exception as exc:  # unreadable/truncated/not an image
        ctx.warn(scope, "bad_image", f"Image {key!r} could not be read: {exc}")
        return None

    if not w or not h:
        ctx.warn(scope, "bad_image", f"Image {key!r} reports a zero dimension.")
        return None

    return ImageAsset(
        key=key,
        src=src,
        w=w,
        h=h,
        aspect=h / w,
        dominant=f"#{r:02x}{g:02x}{b:02x}",
        is_photo=is_photo,
    )


# --------------------------------------------------------------------------
# articles
# --------------------------------------------------------------------------


def _as_int(value: Any, default: int, lo: int, hi: int) -> int:
    try:
        n = int(value)
    except (TypeError, ValueError):
        return default
    return max(lo, min(hi, n))


# Only these schemes may ever reach an href. The body of this paper is written
# by a language model from feeds nobody controls, so a "javascript:" URL is a
# realistic input, not a hypothetical one.
SAFE_SCHEMES = {"http", "https"}


def safe_url(raw: str | None) -> str | None:
    """Return the URL only if it is one we are willing to link to."""
    if not raw:
        return None
    candidate = raw.strip()
    try:
        parsed = urlparse(candidate)
    except ValueError:
        return None
    if parsed.scheme.lower() not in SAFE_SCHEMES or not parsed.netloc:
        return None
    return candidate


def _host_of(url: str) -> str:
    """A readable publisher name from a URL, when none was given."""
    host = urlparse(url).netloc.lower()
    return host[4:] if host.startswith("www.") else host


def parse_sources(value: Any, scope: str, ctx: _Ctx) -> list[SourceRef]:
    """Accept the several shapes a generator might plausibly emit.

    A bare URL, a bare publisher name, a list of either, or a list of mappings.
    Anything unusable is dropped with a warning rather than failing the article.
    """
    if value is None:
        return []
    items = value if isinstance(value, list) else [value]
    out: list[SourceRef] = []

    for item in items:
        if isinstance(item, str):
            text = item.strip()
            if not text:
                continue
            url = safe_url(text)
            if url:
                out.append(SourceRef(name=_host_of(url), url=url))
            elif "://" in text or text.lower().startswith("javascript:"):
                ctx.warn(scope, "unsafe_source", f"Refused a source URL: {text[:60]!r}.")
            else:
                out.append(SourceRef(name=text))  # a publisher with no link
        elif isinstance(item, dict):
            url = safe_url(_as_text(item.get("url")))
            if item.get("url") and not url:
                ctx.warn(
                    scope, "unsafe_source", f"Refused a source URL: {str(item['url'])[:60]!r}."
                )
            name = _as_text(item.get("name")) or (_host_of(url) if url else None)
            if not name:
                continue
            out.append(SourceRef(name=name, url=url, title=_as_text(item.get("title"))))
        else:
            ctx.warn(scope, "bad_source", "Skipped a source that was neither text nor a mapping.")

    return out


def _as_text(value: Any) -> str | None:
    if value is None:
        return None
    text = str(value).strip()
    return text or None


def scan_article(path: Path, edition_id: str, ctx: _Ctx) -> Article | None:
    scope = f"article:{path.stem}"
    try:
        text = path.read_text(encoding="utf-8")
    except Exception as exc:
        ctx.warn(scope, "unreadable", f"Could not read {path.name}: {exc}")
        return None

    raw_fm, body = split_frontmatter(text)
    fm = parse_frontmatter(raw_fm, scope, ctx)

    article_id = _as_text(fm.get("id")) or path.stem
    headline = _as_text(fm.get("headline"))
    if not headline:
        ctx.warn(scope, "no_headline", "No headline in frontmatter; using the filename.")
        headline = path.stem.replace("-", " ").title()

    span = str(fm.get("span", "1col")).strip()
    if span not in VALID_SPANS:
        if "span" in fm:
            ctx.warn(scope, "bad_span", f"Unknown span {span!r}; falling back to '1col'.")
        span = "1col"

    image_key = _as_text(fm.get("image"))
    if image_key:
        image_key = image_key.lstrip("./")

    focus = str(fm.get("focus", "center")).strip().lower()
    if focus not in VALID_FOCUS:
        if "focus" in fm:
            ctx.warn(scope, "bad_focus", f"Unknown focus {focus!r}; using 'center'.")
        focus = "center"

    return Article(
        id=article_id,
        file=path.name,
        headline=headline,
        deck=_as_text(fm.get("deck")),
        section=(_as_text(fm.get("section")) or "misc").lower(),
        byline=_as_text(fm.get("byline")),
        priority=_as_int(fm.get("priority"), 3, 1, 5),
        span=span,  # type: ignore[arg-type]
        image=image_key,
        caption=_as_text(fm.get("caption")),
        focus=focus,  # type: ignore[arg-type]
        sources=parse_sources(fm.get("sources") or fm.get("source"), scope, ctx),
        word_count=len(body.split()),
        body=body.strip(),
        source=text,
    )


# --------------------------------------------------------------------------
# editions
# --------------------------------------------------------------------------


def _read_manifest(edition_dir: Path, ctx: _Ctx) -> dict[str, Any]:
    manifest_path = edition_dir / "edition.json"
    if not manifest_path.exists():
        ctx.warn("edition", "no_manifest", "No edition.json; ordering by filename.")
        return {}
    try:
        data = json.loads(manifest_path.read_text(encoding="utf-8"))
    except Exception as exc:
        ctx.warn("edition", "bad_manifest", f"edition.json is not valid JSON ({exc}).")
        return {}
    if not isinstance(data, dict):
        ctx.warn("edition", "bad_manifest", "edition.json is not an object.")
        return {}
    return data


def _build_sections(
    manifest: dict[str, Any], articles: list[Article], ctx: _Ctx
) -> list[Section]:
    """Order articles into sections, tolerating a manifest that disagrees with disk."""
    by_id = {a.id: a for a in articles}
    sections: list[Section] = []
    placed: set[str] = set()

    for raw in manifest.get("sections") or []:
        if not isinstance(raw, dict):
            ctx.warn("edition", "bad_section", "Skipped a non-object entry in sections.")
            continue
        sid = str(raw.get("id") or raw.get("name") or "").strip().lower()
        if not sid:
            ctx.warn("edition", "bad_section", "Skipped a section with no id.")
            continue
        members: list[str] = []
        for aid in raw.get("articles") or []:
            aid = str(aid)
            if aid not in by_id:
                ctx.warn(
                    "edition",
                    "dangling_article",
                    f"Section {sid!r} lists {aid!r}, which is not on disk.",
                )
                continue
            members.append(aid)
            placed.add(aid)
        sections.append(
            Section(id=sid, name=str(raw.get("name") or sid.title()), articles=members)
        )

    # Anything on disk the manifest forgot still gets printed, grouped by its
    # own declared section so it lands somewhere sensible.
    orphans = [a for a in articles if a.id not in placed]
    if orphans:
        ctx.warn(
            "edition",
            "unlisted_articles",
            f"{len(orphans)} article(s) not listed in any section; appended.",
        )
        existing = {s.id: s for s in sections}
        for a in orphans:
            sec = existing.get(a.section)
            if sec is None:
                sec = Section(id=a.section, name=a.section.title(), articles=[])
                existing[a.section] = sec
                sections.append(sec)
            sec.articles.append(a.id)

    return [s for s in sections if s.articles]


def scan_edition(edition_dir: Path, base_url: str = "") -> Edition:
    """Scan one edition directory into a fully resolved :class:`Edition`."""
    ctx = _Ctx()
    edition_id = edition_dir.name
    manifest = _read_manifest(edition_dir, ctx)
    manifest_path = edition_dir / "edition.json"
    manifest_source = (
        manifest_path.read_text(encoding="utf-8") if manifest_path.exists() else None
    )

    articles_dir = edition_dir / "articles"
    files = sorted(articles_dir.glob("*.md")) if articles_dir.is_dir() else []
    if not files:
        ctx.warn("edition", "no_articles", "No articles/*.md found in this edition.")

    articles: list[Article] = []
    seen: set[str] = set()
    for path in files:
        article = scan_article(path, edition_id, ctx)
        if article is None:
            continue
        if article.id in seen:
            ctx.warn(
                f"article:{article.id}",
                "duplicate_id",
                f"Duplicate id {article.id!r}; keeping the first.",
            )
            continue
        seen.add(article.id)
        articles.append(article)

    # Probe every referenced image once, even when several articles share one.
    images: dict[str, ImageAsset] = {}
    for article in articles:
        key = article.image
        if not key or key in images:
            continue
        asset = probe_image(
            edition_dir / key,
            key,
            # Relative on purpose: resolved against wherever the reader is
            # mounted, which is the root on the server and a subpath on Pages.
            f"{base_url}editions/{edition_id}/{key}",
            f"article:{article.id}",
            ctx,
        )
        if asset is None:
            article.image = None  # the reader must not reserve space for a ghost
            article.caption = None
        else:
            images[key] = asset

    sections = _build_sections(manifest, articles, ctx)

    digest = hashlib.sha256()
    for article in articles:
        digest.update(article.id.encode())
        digest.update(article.body.encode())

    return Edition(
        schema=int(manifest.get("schema") or 1),
        id=edition_id,
        date=str(manifest.get("date") or edition_id),
        volume=_as_int(manifest.get("volume"), 1, 0, 10_000),
        number=_as_int(manifest.get("number"), 1, 0, 100_000),
        masthead=str(manifest.get("masthead") or "The Vael Paper"),
        motto=_as_text(manifest.get("motto")),
        generated_at=_as_text(manifest.get("generated_at")),
        front_template=_as_text(manifest.get("front_template")),
        content_hash=digest.hexdigest()[:16],
        manifest_source=manifest_source,
        sections=sections,
        articles=articles,
        images=images,
        warnings=ctx.warnings,
    )


def list_edition_dirs(root: Path) -> list[Path]:
    """Edition directories, newest first. Only ``YYYY-MM-DD`` names count."""
    if not root.is_dir():
        return []
    dirs = [p for p in root.iterdir() if p.is_dir() and EDITION_DIR_RE.match(p.name)]
    return sorted(dirs, key=lambda p: p.name, reverse=True)


def summarize(edition: Edition) -> EditionSummary:
    return EditionSummary(
        id=edition.id,
        date=edition.date,
        volume=edition.volume,
        number=edition.number,
        masthead=edition.masthead,
        article_count=len(edition.articles),
        warning_count=len(edition.warnings),
    )
