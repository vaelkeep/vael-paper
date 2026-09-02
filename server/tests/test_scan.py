"""Scanner tests.

Two things are worth pinning down here.

The first is **safety**. Article bodies and frontmatter are written by a
language model from feeds nobody controls, so a hostile URL is a realistic
input; `safe_url` is the only thing standing between that and an href.

The second is **tolerance**. The scanner's contract is that it never raises on
content: the generator runs unattended at four in the morning and the paper has
to print at breakfast. Every malformed thing below must produce a warning and a
usable article, not an exception.
"""

from __future__ import annotations

import json
from pathlib import Path

import pytest
from PIL import Image

from vael_paper.scan import (
    _Ctx,
    classify_tone,
    list_edition_dirs,
    parse_frontmatter,
    parse_sources,
    safe_url,
    scan_article,
    scan_edition,
    split_frontmatter,
)

SAMPLE = Path(__file__).resolve().parents[2] / "editions" / "2026-09-02"


@pytest.fixture
def ctx() -> _Ctx:
    return _Ctx()


# ---------------------------------------------------------------- safety


@pytest.mark.parametrize(
    "url",
    [
        "javascript:alert(1)",
        "JavaScript:alert(1)",
        "  javascript:alert(1)",
        "vbscript:msgbox(1)",
        "data:text/html,<script>alert(1)</script>",
        "file:///etc/passwd",
        "ftp://example.com/x",
        "//evil.example.com",
        "/relative/path",
        "example.com",
        "",
        None,
    ],
)
def test_safe_url_refuses_anything_but_http(url: str | None) -> None:
    assert safe_url(url) is None


@pytest.mark.parametrize(
    "url",
    [
        "http://example.com",
        "https://example.com",
        "https://www.reuters.com/markets/x?a=1&b=2#frag",
        "HTTPS://EXAMPLE.COM/Path",
    ],
)
def test_safe_url_accepts_http_and_https(url: str) -> None:
    assert safe_url(url) == url.strip()


def test_unsafe_source_is_dropped_and_recorded(ctx: _Ctx) -> None:
    out = parse_sources("javascript:alert(1)", "article:x", ctx)
    assert out == []
    assert [w.code for w in ctx.warnings] == ["unsafe_source"]


def test_unsafe_url_in_a_mapping_keeps_the_publisher_but_drops_the_link(ctx: _Ctx) -> None:
    out = parse_sources([{"name": "Somewhere", "url": "vbscript:x"}], "article:x", ctx)
    assert len(out) == 1
    assert out[0].name == "Somewhere"
    assert out[0].url is None  # named, but never linked
    assert [w.code for w in ctx.warnings] == ["unsafe_source"]


# ---------------------------------------------------------------- sources


def test_a_bare_url_takes_its_name_from_the_host(ctx: _Ctx) -> None:
    (source,) = parse_sources("https://www.reuters.com/markets/x", "s", ctx)
    assert (source.name, source.url) == ("reuters.com", "https://www.reuters.com/markets/x")


def test_a_bare_name_is_a_source_with_no_link(ctx: _Ctx) -> None:
    (source,) = parse_sources("NERC Reliability Assessment", "s", ctx)
    assert source.name == "NERC Reliability Assessment"
    assert source.url is None
    assert ctx.warnings == []


def test_a_list_of_mixed_shapes(ctx: _Ctx) -> None:
    out = parse_sources(
        [
            "https://apnews.com/a",
            {"name": "The Economist", "url": "https://economist.com/b", "title": "A piece"},
            "A committee report",
        ],
        "s",
        ctx,
    )
    assert [s.name for s in out] == ["apnews.com", "The Economist", "A committee report"]
    assert out[1].title == "A piece"


def test_no_sources_is_not_an_error(ctx: _Ctx) -> None:
    assert parse_sources(None, "s", ctx) == []
    assert ctx.warnings == []


# ---------------------------------------------------------------- frontmatter


def test_split_frontmatter_separates_yaml_from_body() -> None:
    fm, body = split_frontmatter("---\nheadline: X\n---\nThe body.\n")
    assert fm == "headline: X"
    assert body.strip() == "The body."


def test_missing_frontmatter_returns_the_whole_thing_as_body() -> None:
    fm, body = split_frontmatter("Just prose.\n")
    assert fm == ""
    assert body.strip() == "Just prose."


def test_malformed_yaml_is_scraped_rather_than_abandoned(ctx: _Ctx) -> None:
    """The behaviour the deliberately-broken sample article exists to prove."""
    fm = parse_frontmatter(
        "headline: A Real Headline\ndeck: [unclosed\n  span: 1col\n", "article:x", ctx
    )
    assert fm["headline"] == "A Real Headline"  # the field survives
    assert [w.code for w in ctx.warnings] == ["yaml_parse"]


def test_frontmatter_that_is_not_a_mapping_is_ignored(ctx: _Ctx) -> None:
    assert parse_frontmatter("- a\n- b\n", "article:x", ctx) == {}
    assert [w.code for w in ctx.warnings] == ["frontmatter_type"]


# ---------------------------------------------------------------- articles


def _article(tmp_path: Path, text: str) -> Path:
    p = tmp_path / "01-x.md"
    p.write_text(text, encoding="utf-8")
    return p


def test_an_article_with_no_headline_falls_back_to_its_filename(
    tmp_path: Path, ctx: _Ctx
) -> None:
    article = scan_article(_article(tmp_path, "---\nsection: x\n---\nBody.\n"), "e", ctx)
    assert article is not None
    assert article.headline == "01 X"
    assert "no_headline" in [w.code for w in ctx.warnings]


@pytest.mark.parametrize("field,value,expected", [("span", "sideways", "1col"), ("focus", "sideways", "center")])
def test_an_unknown_enum_falls_back_and_warns(
    tmp_path: Path, ctx: _Ctx, field: str, value: str, expected: str
) -> None:
    article = scan_article(
        _article(tmp_path, f"---\nheadline: X\n{field}: {value}\n---\nBody.\n"), "e", ctx
    )
    assert getattr(article, field) == expected
    assert any(w.code.startswith("bad_") for w in ctx.warnings)


def test_priority_is_clamped_rather_than_trusted(tmp_path: Path, ctx: _Ctx) -> None:
    article = scan_article(
        _article(tmp_path, "---\nheadline: X\npriority: 99\n---\nBody.\n"), "e", ctx
    )
    assert article is not None and article.priority == 5


# ---------------------------------------------------------------- images


def _solid(path: Path, size: tuple[int, int], colour: tuple[int, int, int]) -> None:
    Image.new("RGB", size, colour).save(path)


def test_line_art_and_photographs_are_told_apart(tmp_path: Path) -> None:
    """Night mode inverts plates but must not invert photographs."""
    plate = tmp_path / "plate.png"
    Image.new("RGB", (200, 200), (250, 247, 240)).save(plate)  # near-white, neutral
    with Image.open(plate) as im:
        assert classify_tone(im) is False

    photo = tmp_path / "photo.png"
    Image.new("RGB", (200, 200), (150, 110, 70)).save(photo)  # mid-tone, saturated
    with Image.open(photo) as im:
        assert classify_tone(im) is True


def test_the_real_sample_images_are_classified_correctly() -> None:
    edition = scan_edition(SAMPLE)
    photos = {k for k, v in edition.images.items() if v.is_photo}
    assert photos == {"images/marmalade.png"}


def test_a_missing_image_is_dropped_rather_than_reserved(tmp_path: Path) -> None:
    (tmp_path / "articles").mkdir()
    (tmp_path / "articles" / "01-x.md").write_text(
        "---\nheadline: X\nimage: images/gone.png\ncaption: A caption\n---\nBody.\n"
    )
    edition = scan_edition(tmp_path)
    assert edition.articles[0].image is None  # nothing to reserve space for
    assert edition.articles[0].caption is None
    assert "missing_image" in [w.code for w in edition.warnings]


# ---------------------------------------------------------------- editions


def test_the_sample_edition_scans_as_expected() -> None:
    edition = scan_edition(SAMPLE)
    assert len(edition.articles) == 12
    assert [s.id for s in edition.sections] == [
        "markets", "figures", "comment", "science", "wires", "weather", "arts", "household",
    ]
    # Exactly one warning, from the article that exists to produce one.
    assert [w.code for w in edition.warnings] == ["yaml_parse"]
    assert all(i.w and i.h and i.aspect for i in edition.images.values())


def test_every_image_carries_dimensions_the_reader_can_reserve_space_from() -> None:
    """The reader commits an image's box before the bytes arrive; without these
    it would guess, and a late correction would invalidate the pagination."""
    for asset in scan_edition(SAMPLE).images.values():
        assert asset.w > 0 and asset.h > 0
        assert asset.aspect == pytest.approx(asset.h / asset.w)


def test_a_section_naming_an_absent_article_warns_and_carries_on(tmp_path: Path) -> None:
    (tmp_path / "articles").mkdir()
    (tmp_path / "articles" / "01-x.md").write_text("---\nheadline: X\n---\nBody.\n")
    (tmp_path / "edition.json").write_text(
        json.dumps({"sections": [{"id": "s", "name": "S", "articles": ["01-x", "ghost"]}]})
    )
    edition = scan_edition(tmp_path)
    assert edition.sections[0].articles == ["01-x"]
    assert "dangling_article" in [w.code for w in edition.warnings]


def test_an_edition_with_no_manifest_still_prints(tmp_path: Path) -> None:
    (tmp_path / "articles").mkdir()
    (tmp_path / "articles" / "01-x.md").write_text("---\nheadline: X\nsection: news\n---\nB.\n")
    edition = scan_edition(tmp_path)
    assert len(edition.articles) == 1
    assert [s.id for s in edition.sections] == ["news"]
    # This is the ordinary way to publish, so it is not a warning.
    assert edition.warnings == []


def test_an_entirely_empty_directory_does_not_raise(tmp_path: Path) -> None:
    edition = scan_edition(tmp_path)
    assert edition.articles == []
    assert "no_articles" in [w.code for w in edition.warnings]


def test_editions_are_listed_newest_first(tmp_path: Path) -> None:
    for name in ["2026-09-01", "2026-09-03", "2026-09-02", "not-an-edition"]:
        (tmp_path / name).mkdir()
    assert [p.name for p in list_edition_dirs(tmp_path)] == [
        "2026-09-03", "2026-09-02", "2026-09-01",
    ]


def test_the_source_view_gets_the_files_exactly_as_written() -> None:
    """The reader shows an article's markdown alongside the rendered page, so
    the server must pass the file through untouched, frontmatter and all."""
    edition = scan_edition(SAMPLE)
    for article in edition.articles:
        on_disk = (SAMPLE / "articles" / article.file).read_text(encoding="utf-8")
        assert article.source == on_disk
    assert edition.manifest_source == (SAMPLE / "edition.json").read_text(encoding="utf-8")


# --------------------------------------------------------------------------
# the paper, and editions that are only a folder of articles
# --------------------------------------------------------------------------


def _write(dir_: Path, name: str, text: str) -> None:
    (dir_ / "articles").mkdir(parents=True, exist_ok=True)
    (dir_ / "articles" / name).write_text(text, encoding="utf-8")


def test_paper_json_supplies_what_never_changes(tmp_path: Path) -> None:
    (tmp_path / "paper.json").write_text(
        json.dumps(
            {
                "masthead": "The Test Gazette",
                "motto": "Set in type",
                "founded": "2026-01-01",
                "sections": [{"id": "world", "name": "World"}, {"id": "local", "name": "Local"}],
            }
        )
    )
    edition = tmp_path / "2026-01-10"
    _write(edition, "01-b.md", "---\nheadline: B\nsection: local\n---\n" + "w " * 80)
    _write(edition, "02-a.md", "---\nheadline: A\nsection: world\npriority: 2\n---\n" + "w " * 80)
    _write(edition, "03-c.md", "---\nheadline: C\nsection: world\npriority: 1\n---\n" + "w " * 80)

    scanned = scan_edition(edition)
    assert scanned.masthead == "The Test Gazette"
    assert scanned.motto == "Set in type"
    assert scanned.number == 10  # ten days into the paper's life
    assert scanned.volume == 1
    # Catalogue order for sections; priority, then filename, within one.
    assert [(s.id, s.articles) for s in scanned.sections] == [
        ("world", ["03-c", "02-a"]),
        ("local", ["01-b"]),
    ]
    assert scanned.manifest_file == "paper.json"
    assert scanned.warnings == []


def test_an_edition_manifest_still_overrides_the_paper(tmp_path: Path) -> None:
    (tmp_path / "paper.json").write_text(json.dumps({"masthead": "Paper", "founded": "2026-01-01"}))
    edition = tmp_path / "2026-01-10"
    _write(edition, "01-a.md", "---\nheadline: A\nsection: s\n---\nBody.\n")
    (edition / "edition.json").write_text(json.dumps({"masthead": "Special", "number": 99}))
    scanned = scan_edition(edition)
    assert scanned.masthead == "Special"
    assert scanned.number == 99
    assert scanned.manifest_file == "edition.json"


def test_a_section_the_paper_does_not_know_is_printed_last_and_noted(tmp_path: Path) -> None:
    (tmp_path / "paper.json").write_text(json.dumps({"sections": ["world"]}))
    edition = tmp_path / "2026-01-02"
    _write(edition, "01-a.md", "---\nheadline: A\nsection: cats\n---\nBody.\n")
    _write(edition, "02-b.md", "---\nheadline: B\nsection: world\n---\nBody.\n")
    scanned = scan_edition(edition)
    assert [s.id for s in scanned.sections] == ["world", "cats"]
    assert [w.code for w in scanned.warnings] == ["unknown_section"]


def test_without_a_founding_date_the_number_is_the_position_on_disk(tmp_path: Path) -> None:
    for name in ["2026-03-01", "2026-03-02", "2026-03-05"]:
        _write(tmp_path / name, "01-a.md", "---\nheadline: A\n---\nBody.\n")
    assert scan_edition(tmp_path / "2026-03-05").number == 3
    assert scan_edition(tmp_path / "2026-03-01").number == 1


# --------------------------------------------------------------------------
# frontmatter that forgives
# --------------------------------------------------------------------------


def test_a_colon_in_a_headline_is_not_an_error(tmp_path: Path, ctx: _Ctx) -> None:
    _write(tmp_path, "01-a.md", "---\nheadline: Markets: A Cautious Session Ends Lower\ndeck: Rates: what next?\n---\nBody.\n")
    article = scan_article(tmp_path / "articles" / "01-a.md", "e", ctx)
    assert article is not None
    assert article.headline == "Markets: A Cautious Session Ends Lower"
    assert article.deck == "Rates: what next?"
    assert ctx.warnings == []


def test_common_aliases_and_any_case_are_accepted(tmp_path: Path, ctx: _Ctx) -> None:
    _write(
        tmp_path,
        "01-a.md",
        "---\nTitle: Hello\nSubtitle: A deck\nAuthor: Me\nphoto: images/x.png\ncategory: World\nrank: 1\n---\nBody.\n",
    )
    article = scan_article(tmp_path / "articles" / "01-a.md", "e", ctx)
    assert article is not None
    assert (article.headline, article.deck, article.byline) == ("Hello", "A deck", "Me")
    assert article.image == "images/x.png"
    assert article.section == "world"
    assert article.priority == 1


def test_a_leading_heading_is_the_headline_when_there_is_no_frontmatter(
    tmp_path: Path, ctx: _Ctx
) -> None:
    _write(tmp_path, "01-a.md", "# Rain by Six\n\n*Arranged in the order it will happen*\n\nThe body starts here.\n")
    article = scan_article(tmp_path / "articles" / "01-a.md", "e", ctx)
    assert article is not None
    assert article.headline == "Rain by Six"
    assert article.deck == "Arranged in the order it will happen"
    assert article.body == "The body starts here."
    assert ctx.warnings == []


def test_a_yaml_error_says_which_line(tmp_path: Path, ctx: _Ctx) -> None:
    _write(tmp_path, "01-a.md", "---\nheadline: X\ndeck: [unclosed\n---\nBody.\n")
    scan_article(tmp_path / "articles" / "01-a.md", "e", ctx)
    (warning,) = ctx.warnings
    assert warning.code == "yaml_parse"
    assert warning.file == "01-a.md"
    assert warning.line == 3


# --------------------------------------------------------------------------
# lint
# --------------------------------------------------------------------------


def test_lint_flags_a_table_too_wide_for_a_column(tmp_path: Path) -> None:
    body = ("w " * 70) + "\n\n| Day | Time | What | Where |\n|---|---|---|---|\n| Thu 3 | 2:30 pm | Dentist, cleaning and a check | Pennsylvania Avenue SE |\n"
    _write(tmp_path / "2026-01-02", "01-a.md", "---\nheadline: A\n---\n" + body)
    edition = scan_edition(tmp_path / "2026-01-02")
    codes = {w.code for w in edition.lint}
    assert "table_wide" in codes and "cell_long" in codes
    wide = next(w for w in edition.lint if w.code == "table_wide")
    assert wide.file == "01-a.md" and wide.line == 6


def test_lint_is_quiet_about_a_tall_photo_the_author_has_held(tmp_path: Path) -> None:
    from PIL import Image

    edition = tmp_path / "2026-01-02"
    (edition / "images").mkdir(parents=True)
    Image.new("RGB", (400, 700), "grey").save(edition / "images" / "tall.png")
    _write(edition, "01-a.md", "---\nheadline: A\nimage: images/tall.png\n---\n" + "w " * 80)
    _write(edition, "02-b.md", "---\nheadline: B\nimage: images/tall.png\nfocus: top\n---\n" + "w " * 80)
    unheld = scan_edition(edition)
    # 02-b holds it, so the edition as a whole is fine.
    assert "plate_aspect" not in {w.code for w in unheld.lint}
    (edition / "articles" / "02-b.md").unlink()
    assert "plate_aspect" in {w.code for w in scan_edition(edition).lint}
    assert "focus_explicit" not in scan_edition(edition).model_dump_wire()["articles"][0]


def test_the_demo_edition_is_clean_and_the_fixture_keeps_its_one_mark() -> None:
    demo = scan_edition(SAMPLE.parent / "2026-09-03")
    assert demo.warnings == [] and demo.lint == [], (demo.warnings, demo.lint)
    fixture = scan_edition(SAMPLE)
    assert [w.code for w in fixture.warnings] == ["yaml_parse"]


def test_lint_notices_cells_the_generator_already_cut(tmp_path: Path) -> None:
    body = ("w " * 70) + "\n\n| When | What |\n|---|---|\n| Thu 1:15 | Appointment: Visit wi… |\n"
    _write(tmp_path / "2026-01-02", "01-a.md", "---\nheadline: A\n---\n" + body)
    codes = [w.code for w in scan_edition(tmp_path / "2026-01-02").lint]
    assert "cell_truncated" in codes
