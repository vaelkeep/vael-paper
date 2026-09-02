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
from datetime import date, datetime
from pathlib import Path
from typing import Any

import yaml
from PIL import Image, ImageStat
from urllib.parse import urlparse

from .lint import lint_edition
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

    def warn(
        self,
        scope: str,
        code: str,
        message: str,
        *,
        file: str | None = None,
        line: int | None = None,
    ) -> None:
        self.warnings.append(
            Warning_(scope=scope, code=code, message=message, file=file, line=line)
        )
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


# The names a model might reasonably reach for, mapped to the ones the format
# uses. A generator that writes `title:` or `author:` has not made a mistake.
KEY_ALIASES = {
    "title": "headline",
    "head": "headline",
    "heading": "headline",
    "subhead": "deck",
    "subheading": "deck",
    "subtitle": "deck",
    "standfirst": "deck",
    "summary": "deck",
    "dek": "deck",
    "author": "byline",
    "by": "byline",
    "writer": "byline",
    "photo": "image",
    "img": "image",
    "picture": "image",
    "figure": "image",
    "alt": "caption",
    "cutline": "caption",
    "link": "sources",
    "links": "sources",
    "source": "sources",
    "references": "sources",
    "refs": "sources",
    "rank": "priority",
    "importance": "priority",
    "prio": "priority",
    "crop": "focus",
    "anchor": "focus",
    "category": "section",
    "desk": "section",
}

PLAIN_KV_RE = re.compile(r"^([A-Za-z_][\w-]*)[ \t]*:[ \t]+(.+?)[ \t]*$")


def _needs_quotes(value: str) -> bool:
    """Would YAML misread this plain scalar the way a headline is often written?"""
    if value[0] in "\"'[{|>":
        return False  # already quoted, or deliberately structured
    if value[0] in "*&!%@`":
        return True  # indicators a title may legitimately begin with
    return ": " in value or value.endswith(":") or " #" in value


def quote_risky_scalars(raw: str) -> str:
    """Quote the top-level values YAML would otherwise trip over.

    `headline: Markets: A Cautious Session` is the single most common way a
    model breaks frontmatter, and it is not a mistake in any language but
    YAML's. Only whole-line ``key: value`` pairs at the top level are touched;
    lists, nested mappings and anything already quoted pass through unchanged.
    """
    out = []
    for line in raw.splitlines():
        m = PLAIN_KV_RE.match(line)
        if m and _needs_quotes(m.group(2)):
            key, value = m.groups()
            escaped = value.replace("\\", "\\\\").replace('"', '\\"')
            line = f'{key}: "{escaped}"'
        out.append(line)
    return "\n".join(out)


def normalise_keys(data: dict[str, Any]) -> dict[str, Any]:
    """Lower-case the keys and fold the aliases. The first spelling wins."""
    out: dict[str, Any] = {}
    for key, value in data.items():
        name = str(key).strip().lower().replace("-", "_")
        name = KEY_ALIASES.get(name, name)
        out.setdefault(name, value)
    return out


def parse_frontmatter(
    raw: str, scope: str, ctx: _Ctx, *, file: str | None = None
) -> dict[str, Any]:
    if not raw.strip():
        return {}
    try:
        data = yaml.safe_load(quote_risky_scalars(raw))
    except yaml.YAMLError as exc:
        detail = str(exc).splitlines()[0] if str(exc) else exc.__class__.__name__
        mark = getattr(exc, "problem_mark", None)
        # The frontmatter starts on line 2 of the file, after the opening fence.
        line = mark.line + 2 if mark is not None else None
        recovered = normalise_keys(_scrape_scalars(raw))
        ctx.warn(
            scope,
            "yaml_parse",
            f"Frontmatter is not valid YAML ({detail}); "
            f"recovered {len(recovered)} field(s) by scraping.",
            file=file,
            line=line,
        )
        return recovered
    if data is None:
        return {}
    if not isinstance(data, dict):
        ctx.warn(
            scope, "frontmatter_type", "Frontmatter is not a mapping; ignoring it.", file=file
        )
        return {}
    return normalise_keys(data)


HEADING_RE = re.compile(r"^#[ \t]+(.+?)[ \t#]*$")
ITALIC_LINE_RE = re.compile(r"^(?:\*([^*]+)\*|_([^_]+)_)$")


def lift_heading(body: str) -> tuple[str, str | None, str | None]:
    """Take a leading ``# Heading`` (and an italic line under it) off the body.

    Returns ``(body, headline, deck)``. A model that writes an article the way
    it would write any document — a title line, a one-line summary in italics,
    then the text — has written a valid article; the frontmatter is optional.
    """
    lines = body.splitlines()
    i = 0
    while i < len(lines) and not lines[i].strip():
        i += 1
    if i >= len(lines):
        return body, None, None
    m = HEADING_RE.match(lines[i].strip())
    if not m:
        return body, None, None
    headline = m.group(1).strip()
    i += 1
    while i < len(lines) and not lines[i].strip():
        i += 1
    deck = None
    if i < len(lines):
        d = ITALIC_LINE_RE.match(lines[i].strip())
        if d:
            deck = (d.group(1) or d.group(2)).strip()
            i += 1
    return "\n".join(lines[i:]).lstrip("\n"), headline, deck


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
    fm = parse_frontmatter(raw_fm, scope, ctx, file=path.name)

    article_id = _as_text(fm.get("id")) or path.stem
    headline = _as_text(fm.get("headline"))
    deck = _as_text(fm.get("deck"))
    if not headline:
        body, headline, lifted_deck = lift_heading(body)
        deck = deck or lifted_deck
    if not headline:
        ctx.warn(
            scope,
            "no_headline",
            "No headline in the frontmatter and no leading heading; using the filename.",
            file=path.name,
        )
        headline = path.stem.replace("-", " ").title()

    span = str(fm.get("span", "1col")).strip()
    if span not in VALID_SPANS:
        if "span" in fm:
            ctx.warn(
                scope, "bad_span", f"Unknown span {span!r}; falling back to '1col'.", file=path.name
            )
        span = "1col"

    image_key = _as_text(fm.get("image"))
    if image_key:
        image_key = image_key.lstrip("./")

    focus = str(fm.get("focus", "center")).strip().lower()
    if focus not in VALID_FOCUS:
        if "focus" in fm:
            ctx.warn(
                scope, "bad_focus", f"Unknown focus {focus!r}; using 'center'.", file=path.name
            )
        focus = "center"

    return Article(
        id=article_id,
        file=path.name,
        headline=headline,
        deck=deck,
        section=(_as_text(fm.get("section")) or "misc").lower(),
        byline=_as_text(fm.get("byline")),
        priority=_as_int(fm.get("priority"), 3, 1, 5),
        span=span,  # type: ignore[arg-type]
        image=image_key,
        caption=_as_text(fm.get("caption")),
        focus=focus,  # type: ignore[arg-type]
        focus_explicit="focus" in fm,
        sources=parse_sources(fm.get("sources") or fm.get("source"), scope, ctx),
        word_count=len(body.split()),
        body=body.strip(),
        source=text,
    )


# --------------------------------------------------------------------------
# editions
# --------------------------------------------------------------------------


@dataclass
class Paper:
    """The standing facts of a paper, read once from ``editions/paper.json``.

    Everything here is true of every edition, which is exactly why a generator
    should never have to write it. An edition that wants to differ can still
    say so in its own ``edition.json``.
    """

    masthead: str | None = None
    motto: str | None = None
    founded: date | None = None
    volume: int | None = None
    sections: list[Section] = field(default_factory=list)
    source: str | None = None


def read_paper(root: Path, ctx: _Ctx | None = None) -> Paper:
    path = root / "paper.json"
    if not path.exists():
        return Paper()
    text = path.read_text(encoding="utf-8")
    try:
        data = json.loads(text)
    except Exception as exc:
        if ctx:
            ctx.warn("edition", "bad_paper", f"paper.json is not valid JSON ({exc}).", file="paper.json")
        return Paper(source=text)
    if not isinstance(data, dict):
        if ctx:
            ctx.warn("edition", "bad_paper", "paper.json is not an object.", file="paper.json")
        return Paper(source=text)

    founded = None
    if data.get("founded"):
        try:
            founded = date.fromisoformat(str(data["founded"]))
        except ValueError:
            if ctx:
                ctx.warn(
                    "edition", "bad_paper", "paper.json: founded is not a date.", file="paper.json"
                )

    sections: list[Section] = []
    for raw in data.get("sections") or []:
        if isinstance(raw, str):
            sections.append(Section(id=raw.strip().lower(), name=raw.strip().title()))
        elif isinstance(raw, dict):
            sid = str(raw.get("id") or raw.get("name") or "").strip().lower()
            if sid:
                sections.append(Section(id=sid, name=str(raw.get("name") or sid.title())))

    return Paper(
        masthead=_as_text(data.get("masthead")),
        motto=_as_text(data.get("motto")),
        founded=founded,
        volume=_as_int(data["volume"], 1, 0, 10_000) if "volume" in data else None,
        sections=sections,
        source=text,
    )


def _read_manifest(edition_dir: Path, ctx: _Ctx) -> dict[str, Any]:
    manifest_path = edition_dir / "edition.json"
    if not manifest_path.exists():
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


def _sections_from_catalogue(
    paper: Paper, articles: list[Article], ctx: _Ctx
) -> list[Section]:
    """The ordinary path: no manifest, the paper's own section order.

    Each article says which section it belongs to; the catalogue says what
    order the sections come in; priority and then filename order the stories
    within one. A section the catalogue does not know is printed anyway, after
    the ones it does, and noted.
    """
    known = {s.id: Section(id=s.id, name=s.name, articles=[]) for s in paper.sections}
    extra: dict[str, Section] = {}
    for article in sorted(articles, key=lambda a: (a.priority, a.file)):
        section = known.get(article.section)
        if section is None:
            section = extra.get(article.section)
            if section is None:
                section = Section(id=article.section, name=article.section.title(), articles=[])
                extra[article.section] = section
                if paper.sections:
                    ctx.warn(
                        f"article:{article.id}",
                        "unknown_section",
                        f"Section {article.section!r} is not in paper.json; printed after the others.",
                        file=article.file,
                    )
        section.articles.append(article.id)
    return [s for s in [*known.values(), *extra.values()] if s.articles]


def _build_sections(
    manifest: dict[str, Any], articles: list[Article], ctx: _Ctx, paper: Paper
) -> list[Section]:
    """Order articles into sections, tolerating a manifest that disagrees with disk."""
    if not manifest.get("sections"):
        return _sections_from_catalogue(paper, articles, ctx)

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


def _issue_number(edition_dir: Path, when: date | None, paper: Paper) -> int:
    """The number on the masthead when the edition did not say.

    Days since the paper was founded, when it says when that was: stable no
    matter which old editions have been pruned. Otherwise the edition's
    position among its siblings on disk.
    """
    if paper.founded and when:
        return max(1, (when - paper.founded).days + 1)
    siblings = list_edition_dirs(edition_dir.parent)
    earlier = [d for d in siblings if d.name <= edition_dir.name]
    return max(1, len(earlier))


def _volume(when: date | None, paper: Paper) -> int:
    if paper.volume is not None:
        return paper.volume
    if paper.founded and when:
        return max(1, when.year - paper.founded.year + 1)
    return 1


def _edition_date(edition_id: str) -> date | None:
    try:
        return date.fromisoformat(edition_id)
    except ValueError:
        return None


def scan_edition(edition_dir: Path, base_url: str = "", paper: Paper | None = None) -> Edition:
    """Scan one edition directory into a fully resolved :class:`Edition`."""
    ctx = _Ctx()
    edition_id = edition_dir.name
    if paper is None:
        paper = read_paper(edition_dir.parent, ctx)
    manifest = _read_manifest(edition_dir, ctx)
    manifest_path = edition_dir / "edition.json"
    if manifest_path.exists():
        manifest_source: str | None = manifest_path.read_text(encoding="utf-8")
        manifest_file: str | None = "edition.json"
    elif paper.source is not None:
        manifest_source, manifest_file = paper.source, "paper.json"
    else:
        manifest_source = manifest_file = None

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

    sections = _build_sections(manifest, articles, ctx, paper)
    when = _edition_date(str(manifest.get("date") or edition_id))

    generated_at = _as_text(manifest.get("generated_at"))
    if not generated_at and files:
        newest = max(f.stat().st_mtime for f in files)
        generated_at = datetime.fromtimestamp(newest).astimezone().isoformat(timespec="seconds")

    digest = hashlib.sha256()
    for article in articles:
        digest.update(article.id.encode())
        digest.update(article.body.encode())

    edition = Edition(
        schema=int(manifest.get("schema") or 1),
        id=edition_id,
        date=str(manifest.get("date") or edition_id),
        volume=(
            _as_int(manifest["volume"], 1, 0, 10_000)
            if "volume" in manifest
            else _volume(when, paper)
        ),
        number=(
            _as_int(manifest["number"], 1, 0, 100_000)
            if "number" in manifest
            else _issue_number(edition_dir, when, paper)
        ),
        masthead=str(manifest.get("masthead") or paper.masthead or "The Vael Paper"),
        motto=_as_text(manifest.get("motto")) or paper.motto,
        generated_at=generated_at,
        front_template=_as_text(manifest.get("front_template")),
        content_hash=digest.hexdigest()[:16],
        manifest_source=manifest_source,
        manifest_file=manifest_file,
        sections=sections,
        articles=articles,
        images=images,
        warnings=ctx.warnings,
    )
    edition.lint = lint_edition(edition)
    return edition


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
