"""Layout lint: advice the scanner cannot give as a warning.

A warning says the edition is damaged. Lint says it will print, but not well:
a table wider than a column, a plate of an awkward shape, a story too thin to
carry a headline. The numbers here come from the reader's own geometry — a
column is sixty-odd characters of body text, agate runs at four-fifths of the
body size, so a table has about forty-six agate characters to work with — and
they are deliberately a little conservative, because a generator that reads
this output will simply shorten a cell, and that is cheaper than a truncated
table the next morning.

Everything here is a pure function of the scanned edition so the command line,
the API and the test-suite all see the same advice.
"""

from __future__ import annotations

import re

from .models import Article, Edition, Warning_

# Agate characters a single column can hold before cells start truncating.
TABLE_FITS_CH = 52
# Longest cell that still reads well at agate size in a narrow column.
CELL_MAX_CH = 26
TABLE_MAX_COLUMNS = 5
STORY_MIN_WORDS = 60
STORY_MAX_WORDS = 1600
HEADLINE_MAX_CH = 80
DECK_MAX_CH = 170
# A plate is held to sixteen baselines; taller than 4:5 and it will be cropped
# hard, wider than 9:4 and it becomes a stripe.
PLATE_ASPECT_MIN = 0.44
PLATE_ASPECT_MAX = 0.85

_INLINE_MD = re.compile(r"[*_`]|\[([^\]]*)\]\([^)]*\)")


def _plain(cell: str) -> str:
    return _INLINE_MD.sub(lambda m: m.group(1) or "", cell).strip()


def _cells(line: str) -> list[str]:
    return [_plain(c) for c in line.strip().strip("|").split("|")]


def _is_separator(line: str) -> bool:
    return bool(re.fullmatch(r"\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?", line.strip()))


def _tables(body: str) -> list[tuple[int, list[list[str]]]]:
    """Every pipe table in a body, as ``(first_line_index, rows)``."""
    out: list[tuple[int, list[list[str]]]] = []
    lines = body.splitlines()
    i = 0
    while i < len(lines):
        if lines[i].lstrip().startswith("|"):
            start = i
            rows = []
            while i < len(lines) and lines[i].lstrip().startswith("|"):
                if not _is_separator(lines[i]):
                    rows.append(_cells(lines[i]))
                i += 1
            if rows:
                out.append((start, rows))
        else:
            i += 1
    return out


def _line_in_file(article: Article, body_line: int) -> int | None:
    """Translate a body line index into a line number in the file on disk."""
    if not article.source:
        return None
    body_lines = article.body.splitlines()
    if body_line >= len(body_lines):
        return None
    needle = body_lines[body_line]
    for n, line in enumerate(article.source.splitlines(), start=1):
        if line == needle:
            return n
    return None


def lint_article(article: Article) -> list[Warning_]:
    scope = f"article:{article.id}"
    out: list[Warning_] = []

    def note(code: str, message: str, line: int | None = None) -> None:
        out.append(Warning_(scope=scope, code=code, message=message, file=article.file, line=line))

    if len(article.headline) > HEADLINE_MAX_CH:
        note("headline_long", f"Headline is {len(article.headline)} characters; under {HEADLINE_MAX_CH} sets in two lines.")
    if article.deck and len(article.deck) > DECK_MAX_CH:
        note("deck_long", f"Deck is {len(article.deck)} characters; under {DECK_MAX_CH} keeps it to a few lines.")
    if article.word_count < STORY_MIN_WORDS:
        note("story_short", f"{article.word_count} words is too few to carry a headline; {STORY_MIN_WORDS} is a working minimum.")
    elif article.word_count > STORY_MAX_WORDS:
        note("story_long", f"{article.word_count} words will run across several pages; consider splitting it.")

    for start, rows in _tables(article.body):
        line = _line_in_file(article, start)
        width = max(len(r) for r in rows)
        widest = [max((len(r[i]) if i < len(r) else 0) for r in rows) for i in range(width)]
        needed = sum(widest) + 2 * (width - 1)
        if width > TABLE_MAX_COLUMNS:
            note("table_wide", f"Table has {width} columns; a column of this paper fits {TABLE_MAX_COLUMNS} at most.", line)
        elif needed > TABLE_FITS_CH:
            note(
                "table_wide",
                f"Table needs about {needed} characters across and a column fits about {TABLE_FITS_CH}; drop a column or shorten the longest cells.",
                line,
            )
        longest = max((c for r in rows for c in r), key=len, default="")
        if len(longest) > CELL_MAX_CH:
            note("cell_long", f"Cell {longest[:30]!r} is {len(longest)} characters; over {CELL_MAX_CH} it will be cut with an ellipsis.", line)
        # A generator that trims cells itself does the paper's job badly: the
        # cut lands at a fixed count rather than at the column, and the reader
        # then cuts a second time. Shorten the words instead.
        cut = next((c for r in rows for c in r if c.endswith(("…", "..."))), None)
        if cut is not None:
            note(
                "cell_truncated",
                f"Cell {cut[:30]!r} was cut with an ellipsis before it reached the paper; "
                "shorten it in words (drop a prefix, abbreviate) and let the column do any cutting.",
                line,
            )

    return out


def lint_edition(edition: Edition) -> list[Warning_]:
    out: list[Warning_] = []
    for article in edition.articles:
        out.extend(lint_article(article))

    # A tall image is cropped to the column's sixteen baselines. That is fine
    # when the author said which part to keep, and a surprise when they did not.
    held = {a.image for a in edition.articles if a.image and a.focus_explicit}
    for key, asset in edition.images.items():
        if key in held:
            continue
        if asset.aspect > PLATE_ASPECT_MAX or asset.aspect < PLATE_ASPECT_MIN:
            shape = "tall" if asset.aspect > PLATE_ASPECT_MAX else "wide"
            out.append(
                Warning_(
                    scope=f"image:{key}",
                    code="plate_aspect",
                    message=(
                        f"Image is {asset.w}×{asset.h}, {shape} for a column, and will be cropped; "
                        "set `focus: top|center|bottom` to say what to keep, or use 16:9, 3:2 or 4:3."
                    ),
                    file=key,
                )
            )

    # One story is the lead whatever its priority; the rule is for a paper
    # that has several and forgot to say which.
    if len(edition.articles) >= 2 and not any(a.priority <= 2 for a in edition.articles):
        out.append(
            Warning_(
                scope="edition",
                code="no_lead",
                message="No story has priority 1 or 2; the first article will lead the front page.",
            )
        )
    if edition.articles and not edition.images:
        out.append(
            Warning_(
                scope="edition",
                code="no_images",
                message="No story carries an image; the front page will be all text.",
            )
        )
    return out
