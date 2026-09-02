"""Plates drawn from data.

A chart block is the one way a generator gets a picture into the paper without
producing pixels, so the contract is: a valid spec always yields a plate the
scanner then treats like any other image, an invalid one becomes a mark and
never an exception, and the same numbers never redraw the same file.
"""

from __future__ import annotations

from pathlib import Path

import pytest
from PIL import Image

from vael_paper.plates import ChartError, ensure_plate, normalise_spec, spec_hash, stored_hash
from vael_paper.scan import scan_edition


def test_a_minimal_spec_gets_sensible_defaults() -> None:
    spec = normalise_spec({"values": [1, 2, 3]})
    assert spec["kind"] == "line" and spec["aspect"] == "16:9"
    assert spec["max"] == pytest.approx(3 * 1.12)
    assert normalise_spec({"kind": "bars", "values": [1, 2]})["aspect"] == "4:3"


@pytest.mark.parametrize(
    "raw",
    [
        "not a mapping",
        {"values": [1]},
        {"values": ["a", "b"]},
        {"values": [1, 2], "kind": "pie"},
        {"values": [1, 2], "aspect": "1:1"},
        {"values": [1, 2], "max": 0},
        {"values": list(range(500))},
    ],
)
def test_a_bad_spec_says_why(raw: object) -> None:
    with pytest.raises(ChartError):
        normalise_spec(raw)


def test_the_same_numbers_never_redraw_the_plate(tmp_path: Path) -> None:
    spec = normalise_spec({"kind": "bars", "values": [3, 5, 8], "target": 4})
    out = tmp_path / "images" / "x.png"
    assert ensure_plate(spec, out) is True
    first = out.stat().st_mtime_ns
    assert stored_hash(out) == spec_hash(spec)
    assert ensure_plate(spec, out) is False
    assert out.stat().st_mtime_ns == first
    # Change one number and it is redrawn.
    assert ensure_plate(normalise_spec({"kind": "bars", "values": [3, 5, 9]}), out) is True


def test_a_plate_is_line_art_in_the_paper_s_own_shape(tmp_path: Path) -> None:
    out = tmp_path / "p.png"
    ensure_plate(normalise_spec({"values": [10, 40, 90, 60], "target": 50}), out)
    with Image.open(out) as im:
        assert im.size == (1600, 900)


def test_the_scanner_draws_a_chart_and_treats_it_as_the_image(tmp_path: Path) -> None:
    edition = tmp_path / "2026-01-02"
    (edition / "articles").mkdir(parents=True)
    (edition / "articles" / "01-steps.md").write_text(
        "---\nheadline: Steps\ncaption: Seven days against the target.\n"
        "chart:\n  kind: bars\n  values: [9120, 8340, 10205, 2860]\n  target: 8000\n---\n"
        + "w " * 80
    )
    scanned = scan_edition(edition)
    (article,) = scanned.articles
    assert article.image == "images/01-steps-chart.png"
    assert (edition / "images" / "01-steps-chart.png").is_file()
    asset = scanned.images[article.image]
    assert asset.is_photo is False and asset.aspect == pytest.approx(0.75)
    assert scanned.warnings == [] and scanned.lint == []


def test_a_bad_chart_is_a_mark_and_the_story_still_prints(tmp_path: Path) -> None:
    edition = tmp_path / "2026-01-02"
    (edition / "articles").mkdir(parents=True)
    (edition / "articles" / "01-x.md").write_text(
        "---\nheadline: X\nchart:\n  values: [1]\n---\n" + "w " * 80
    )
    scanned = scan_edition(edition)
    assert scanned.articles[0].image is None
    (mark,) = scanned.warnings
    assert mark.code == "bad_chart" and mark.file == "01-x.md"


def test_an_explicit_image_wins_over_a_chart(tmp_path: Path) -> None:
    edition = tmp_path / "2026-01-02"
    (edition / "articles").mkdir(parents=True)
    (edition / "images").mkdir()
    Image.new("RGB", (160, 90), "white").save(edition / "images" / "given.png")
    (edition / "articles" / "01-x.md").write_text(
        "---\nheadline: X\nimage: images/given.png\nchart:\n  values: [1, 2]\n---\n" + "w " * 80
    )
    scanned = scan_edition(edition)
    assert scanned.articles[0].image == "images/given.png"
    assert not (edition / "images" / "01-x-chart.png").exists()
