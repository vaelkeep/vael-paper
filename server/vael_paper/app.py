"""FastAPI application: scan the editions directory, serve it to the reader.

The server is deliberately dumb. It parses frontmatter, probes images and hands
the client one bundle; every layout decision belongs to the reader, because
pagination depends on a viewport and a font size only the client knows. That
also keeps the eventual Vaelkeep port small — four endpoints move, nothing else.
"""

from __future__ import annotations

import logging
import os
from pathlib import Path

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles

from .models import Edition
from .check import report
from .scan import list_edition_dirs, scan_edition, summarize

log = logging.getLogger(__name__)

DEFAULT_EDITIONS = Path(__file__).resolve().parents[2] / "editions"
DEFAULT_READER_DIST = Path(__file__).resolve().parents[2] / "reader" / "dist"


class EditionCache:
    """Memoise scans, keyed on a cheap fingerprint of the directory.

    A scan is only a few milliseconds, but it runs on every page load and on
    every reader restart during development. Fingerprinting on mtimes means a
    freshly dropped edition is picked up with no restart and no watcher.
    """

    def __init__(self, root: Path) -> None:
        self.root = root
        self._cache: dict[str, tuple[tuple[int, float], Edition]] = {}

    @staticmethod
    def fingerprint(edition_dir: Path) -> tuple[int, float]:
        count, newest = 0, 0.0
        for path in edition_dir.rglob("*"):
            if path.is_file():
                count += 1
                newest = max(newest, path.stat().st_mtime)
        # The paper's standing config feeds every edition, so a change to it
        # must invalidate them all.
        paper = edition_dir.parent / "paper.json"
        if paper.exists():
            newest = max(newest, paper.stat().st_mtime)
        return count, newest

    def get(self, edition_id: str) -> Edition:
        edition_dir = self.root / edition_id
        if not edition_dir.is_dir() or edition_dir.parent != self.root:
            raise HTTPException(status_code=404, detail=f"No edition {edition_id!r}.")

        fp = self.fingerprint(edition_dir)
        hit = self._cache.get(edition_id)
        if hit and hit[0] == fp:
            return hit[1]

        edition = scan_edition(edition_dir)
        self._cache[edition_id] = (fp, edition)
        if edition.warnings:
            log.info(
                "scanned %s: %d article(s), %d warning(s)",
                edition_id,
                len(edition.articles),
                len(edition.warnings),
            )
        return edition

    def latest_id(self) -> str:
        dirs = list_edition_dirs(self.root)
        if not dirs:
            raise HTTPException(
                status_code=404, detail=f"No editions found under {self.root}."
            )
        return dirs[0].name


def create_app(
    editions_root: Path | None = None, reader_dist: Path | None = None
) -> FastAPI:
    root = Path(editions_root or os.environ.get("VAEL_PAPER_EDITIONS", DEFAULT_EDITIONS))
    dist = Path(reader_dist or os.environ.get("VAEL_PAPER_READER", DEFAULT_READER_DIST))
    cache = EditionCache(root)

    app = FastAPI(title="The Vael Paper", version="0.1.0")

    # The reader runs on the Vite dev server during development and is served
    # from this same origin in production; allow both.
    app.add_middleware(
        CORSMiddleware,
        allow_origin_regex=r"http://(localhost|127\.0\.0\.1|\[::1\]|[\w.-]+\.ts\.net)(:\d+)?",
        allow_methods=["GET"],
        allow_headers=["*"],
    )

    @app.get("/api/health")
    def health() -> dict[str, object]:
        return {
            "ok": True,
            "editions_root": str(root),
            "editions": len(list_edition_dirs(root)),
        }

    # Each route is registered under two paths. The bare form is the natural
    # API; the .json form is what the reader requests, because on a static
    # host `api/editions` cannot be both a file and a directory.
    @app.get("/api/editions")
    @app.get("/api/editions.json")
    def index() -> list[dict]:
        """The archive, newest first."""
        return [summarize(cache.get(d.name)).model_dump() for d in list_edition_dirs(root)]

    @app.get("/api/editions/latest")
    @app.get("/api/editions/latest.json")
    def latest() -> JSONResponse:
        return JSONResponse(cache.get(cache.latest_id()).model_dump_wire())

    @app.get("/api/editions/{edition_id}/check")
    @app.get("/api/editions/{edition_id}/check.json")
    def check(edition_id: str) -> JSONResponse:
        """Marks and lint for one edition, for a generator's second pass."""
        return JSONResponse(report(cache.get(edition_id)))

    @app.get("/api/editions/{edition_id}")
    def one(edition_id: str) -> JSONResponse:
        # A path parameter matches `2026-09-02.json` whole, so the suffix is
        # handled here rather than as a second route that would never be hit.
        return JSONResponse(cache.get(edition_id.removesuffix(".json")).model_dump_wire())

    if root.is_dir():
        app.mount("/editions", StaticFiles(directory=root), name="editions")

    if dist.is_dir():
        app.mount("/assets", StaticFiles(directory=dist / "assets"), name="assets")

        @app.get("/{path:path}")
        def reader(path: str) -> FileResponse:
            """Serve the built reader, falling back to index.html for routes."""
            candidate = (dist / path).resolve()
            if path and candidate.is_file() and candidate.is_relative_to(dist.resolve()):
                return FileResponse(candidate)
            return FileResponse(dist / "index.html")
    else:
        log.warning("reader bundle not found at %s; API-only mode", dist)

    return app


app = create_app()
