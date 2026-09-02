"""API tests.

The reader depends on exactly four things being true of this surface, so those
are what is checked: the routes exist, `latest` resolves to the newest edition,
images are served, and a request for an edition that is not there fails cleanly
rather than with a stack trace.
"""

from __future__ import annotations

import json
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from vael_paper.app import create_app

SAMPLE_ROOT = Path(__file__).resolve().parents[2] / "editions"


@pytest.fixture
def client() -> TestClient:
    return TestClient(create_app(editions_root=SAMPLE_ROOT, reader_dist=Path("/nonexistent")))


def test_health_reports_the_editions_it_can_see(client: TestClient) -> None:
    body = client.get("/api/health").json()
    assert body["ok"] is True
    assert body["editions"] >= 1


def test_the_index_lists_editions_newest_first(client: TestClient) -> None:
    rows = client.get("/api/editions").json()
    assert rows
    assert [r["date"] for r in rows] == sorted((r["date"] for r in rows), reverse=True)
    assert rows[0]["article_count"] > 0


def test_latest_resolves_to_the_newest_edition(client: TestClient) -> None:
    latest = client.get("/api/editions/latest").json()
    newest = client.get("/api/editions").json()[0]["id"]
    assert latest["id"] == newest


def test_the_json_suffixed_paths_the_reader_uses_answer_identically(client: TestClient) -> None:
    """The reader requests `.json` paths so the same bundle works on a static
    host; the server must answer them exactly as it answers the bare ones."""
    assert client.get("/api/editions.json").json() == client.get("/api/editions").json()
    assert (
        client.get("/api/editions/latest.json").json()
        == client.get("/api/editions/latest").json()
    )
    assert (
        client.get("/api/editions/2026-09-02.json").json()
        == client.get("/api/editions/2026-09-02").json()
    )


def test_image_paths_are_relative_so_they_work_under_a_subpath(client: TestClient) -> None:
    edition = client.get("/api/editions/2026-09-02").json()
    for asset in edition["images"].values():
        assert not asset["src"].startswith("/"), asset["src"]
        assert asset["src"].startswith("editions/")


def test_an_edition_carries_everything_the_reader_needs(client: TestClient) -> None:
    edition = client.get("/api/editions/2026-09-02").json()
    assert {"sections", "articles", "images", "warnings"} <= edition.keys()

    article = edition["articles"][0]
    # Body is markdown the reader parses; the rest it must not have to infer.
    assert article["body"]
    assert article["word_count"] > 0
    for asset in edition["images"].values():
        assert asset["w"] and asset["h"] and asset["aspect"]
        assert "is_photo" in asset


def test_an_unknown_edition_is_a_clean_404(client: TestClient) -> None:
    assert client.get("/api/editions/1999-01-01").status_code == 404


def test_an_edition_id_cannot_escape_the_editions_directory(client: TestClient) -> None:
    for probe in ["../../etc", "..%2f..%2fetc", "....//etc"]:
        assert client.get(f"/api/editions/{probe}").status_code in (404, 400)


def test_images_are_served_from_the_edition(client: TestClient) -> None:
    response = client.get("/editions/2026-09-02/images/markets-chart.png")
    assert response.status_code == 200
    assert response.headers["content-type"] == "image/png"


def test_a_freshly_written_edition_is_picked_up_without_a_restart(tmp_path: Path) -> None:
    """The contract that lets a nightly job publish by writing a directory."""
    client = TestClient(create_app(editions_root=tmp_path, reader_dist=Path("/nonexistent")))
    assert client.get("/api/editions").json() == []

    edition = tmp_path / "2026-09-04"
    (edition / "articles").mkdir(parents=True)
    (edition / "articles" / "01-x.md").write_text("---\nheadline: Hello\n---\nBody.\n")
    (edition / "edition.json").write_text(
        json.dumps({"sections": [{"id": "s", "name": "S", "articles": ["01-x"]}]})
    )

    assert client.get("/api/editions/latest").json()["id"] == "2026-09-04"
