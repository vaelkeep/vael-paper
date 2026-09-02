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
    assert "no_manifest" in [w.code for w in edition.warnings]


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
