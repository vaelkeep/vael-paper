"""Static export tests.

The export's one job is to produce a directory whose URL space is identical to
the server's, so that a reader bundle which knows nothing about where it is
mounted works against either. That equivalence is what is checked.
"""

from __future__ import annotations

import json
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from vael_paper.app import create_app
from vael_paper.export import export

ROOT = Path(__file__).resolve().parents[2]
SAMPLE_ROOT = ROOT / "editions"
READER_DIST = ROOT / "reader" / "dist"

needs_built_reader = pytest.mark.skipif(
    not (READER_DIST / "index.html").exists(),
    reason="reader not built; run `npm --prefix reader run build`",
)


@pytest.fixture
def site(tmp_path: Path) -> Path:
    out = tmp_path / "site"
    export(SAMPLE_ROOT, READER_DIST, out)
    return out


@needs_built_reader
def test_export_lays_out_the_same_url_space_as_the_server(site: Path) -> None:
    client = TestClient(create_app(editions_root=SAMPLE_ROOT, reader_dist=READER_DIST))

    for path in ["api/editions.json", "api/editions/latest.json", "api/editions/2026-09-02.json"]:
        on_disk = json.loads((site / path).read_text(encoding="utf-8"))
        served = client.get("/" + path).json()
        assert on_disk == served, path


@needs_built_reader
def test_latest_is_a_real_file_not_a_link(site: Path) -> None:
    latest = site / "api" / "editions" / "latest.json"
    assert latest.is_file() and not latest.is_symlink()
    assert json.loads(latest.read_text())["id"] == "2026-09-02"


@needs_built_reader
def test_every_image_the_edition_references_is_present(site: Path) -> None:
    edition = json.loads((site / "api" / "editions" / "2026-09-02.json").read_text())
    for asset in edition["images"].values():
        assert (site / asset["src"]).is_file(), asset["src"]


@needs_built_reader
def test_the_reader_bundle_makes_no_root_relative_requests(site: Path) -> None:
    """A leading slash would resolve to the host root and 404 under a subpath."""
    html = (site / "index.html").read_text()
    for attr in ('src="/', 'href="/'):
        assert attr not in html, f"root-relative {attr} in index.html"

    bundle = next((site / "assets").glob("index-*.js")).read_text()
    assert "'/api/" not in bundle and '"/api/' not in bundle


@needs_built_reader
def test_jekyll_is_disabled(site: Path) -> None:
    assert (site / ".nojekyll").exists()


@needs_built_reader
def test_a_stale_export_is_replaced_not_merged(tmp_path: Path) -> None:
    out = tmp_path / "site"
    out.mkdir()
    stale = out / "api" / "editions" / "1999-01-01.json"
    stale.parent.mkdir(parents=True)
    stale.write_text("{}")

    export(SAMPLE_ROOT, READER_DIST, out)
    assert not stale.exists()


def test_export_refuses_to_run_without_a_built_reader(tmp_path: Path) -> None:
    with pytest.raises(SystemExit, match="No built reader"):
        export(SAMPLE_ROOT, tmp_path / "nowhere", tmp_path / "out")
