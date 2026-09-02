"""Export the paper as a static site.

Every response the server produces is a pure function of the files on disk, so
the whole API can be written out ahead of time. The result is a directory that
any static host can serve — GitHub Pages, Cloudflare Pages, a USB stick — with
no Python running anywhere.

The output layout mirrors the server's URL space exactly, so the same reader
bundle works against either without knowing which it is talking to:

    out/
      index.html, assets/          the built reader
      api/editions.json            the archive index
      api/editions/latest.json     the newest edition, copied not linked
      api/editions/<date>.json     every edition
      editions/<date>/images/      the plates
      .nojekyll                    stop GitHub Pages running Jekyll over it
"""

from __future__ import annotations

import argparse
import json
import logging
import shutil
import sys
from pathlib import Path

from .scan import list_edition_dirs, scan_edition, summarize

log = logging.getLogger(__name__)

ROOT = Path(__file__).resolve().parents[2]
DEFAULT_EDITIONS = ROOT / "editions"
DEFAULT_READER_DIST = ROOT / "reader" / "dist"
DEFAULT_OUT = ROOT / "site"


def export(editions_root: Path, reader_dist: Path, out: Path) -> int:
    """Write the site. Returns the number of editions exported."""
    if not reader_dist.is_dir() or not (reader_dist / "index.html").exists():
        raise SystemExit(
            f"No built reader at {reader_dist}. Run `npm --prefix reader run build` first."
        )

    dirs = list_edition_dirs(editions_root)
    if not dirs:
        raise SystemExit(f"No editions found under {editions_root}.")

    # Start clean: a stale edition left over from a previous export would be
    # served as if it were current.
    if out.exists():
        shutil.rmtree(out)
    shutil.copytree(reader_dist, out)

    api = out / "api"
    (api / "editions").mkdir(parents=True)

    index = []
    for edition_dir in dirs:
        edition = scan_edition(edition_dir)
        index.append(summarize(edition).model_dump())

        payload = json.dumps(edition.model_dump_wire(), ensure_ascii=False)
        (api / "editions" / f"{edition.id}.json").write_text(payload, encoding="utf-8")

        images = edition_dir / "images"
        if images.is_dir():
            shutil.copytree(images, out / "editions" / edition.id / "images")

        if edition.warnings:
            log.warning(
                "%s: %d printer's mark(s): %s",
                edition.id,
                len(edition.warnings),
                ", ".join(w.code for w in edition.warnings),
            )

    # `latest` is a copy rather than a symlink: static hosts do not follow
    # links, and a reader must be able to open the paper from a cold cache.
    newest = index[0]["id"]
    shutil.copyfile(api / "editions" / f"{newest}.json", api / "editions" / "latest.json")
    (api / "editions.json").write_text(json.dumps(index, ensure_ascii=False), encoding="utf-8")

    # Without this, GitHub Pages runs Jekyll over the output, which drops
    # anything beginning with an underscore and slows the deploy for nothing.
    (out / ".nojekyll").touch()

    return len(dirs)


def main(argv: list[str] | None = None) -> None:
    parser = argparse.ArgumentParser(
        prog="vael-paper-export", description="Export the paper as a static site."
    )
    parser.add_argument("--editions", type=Path, default=DEFAULT_EDITIONS)
    parser.add_argument("--reader", type=Path, default=DEFAULT_READER_DIST)
    parser.add_argument("--out", type=Path, default=DEFAULT_OUT)
    args = parser.parse_args(argv)

    logging.basicConfig(level=logging.INFO, format="%(levelname)s: %(message)s")
    count = export(args.editions, args.reader, args.out)
    print(f"exported {count} edition(s) to {args.out}", file=sys.stderr)


if __name__ == "__main__":
    main()
