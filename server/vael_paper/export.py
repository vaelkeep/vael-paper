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
import re
import shutil
import sys
from html import escape as html_escape
from pathlib import Path

from .scan import list_edition_dirs, scan_edition, summarize

log = logging.getLogger(__name__)

ROOT = Path(__file__).resolve().parents[2]
DEFAULT_EDITIONS = ROOT / "editions"
DEFAULT_READER_DIST = ROOT / "reader" / "dist"
DEFAULT_OUT = ROOT / "site"


SOCIAL_CARD_NAME = "social-card.png"


def _set_meta(html: str, key: str, attr: str, content: str) -> str:
    """Replace one meta tag's content, or add the tag if it is not there.

    The reader ships generic values so the dev server has something sane; this
    fills in the paper's own, which is the difference between a link that
    unfurls with a masthead and one that unfurls as a bare URL.
    """
    escaped = html_escape(content, quote=True)
    pattern = re.compile(
        rf'(<meta\s+{attr}="{re.escape(key)}"\s+content=")[^"]*(")', re.IGNORECASE
    )
    if pattern.search(html):
        return pattern.sub(rf'\g<1>{escaped}\g<2>', html, count=1)
    tag = f'    <meta {attr}="{key}" content="{escaped}" />\n'
    return html.replace("</head>", tag + "  </head>", 1)


def write_social_tags(out: Path, paper_title: str, motto: str,
                      base_url: str | None, social_card: Path | None,
                      og_title: str | None = None,
                      og_description: str | None = None) -> None:
    """Rewrite the exported index.html's link-preview tags for this paper.

    The masthead and motto are the sensible default, but a public demo usually
    wants to say what the *project* is: "The John Smith Daily" tells a stranger
    nothing. --og-title and --og-description override for exactly that case.
    """
    index = out / "index.html"
    html = index.read_text(encoding="utf-8")
    description = og_description or motto or (
        "A newspaper for one reader: a front page, sections, an order, and an end."
    )
    paper_title = og_title or paper_title

    html = html.replace("<title>The Vael Paper</title>", f"<title>{html_escape(paper_title)}</title>", 1)
    for key, attr in (("og:title", "property"), ("twitter:title", "name")):
        html = _set_meta(html, key, attr, paper_title)
    for key, attr in (("description", "name"), ("og:description", "property"),
                      ("twitter:description", "name")):
        html = _set_meta(html, key, attr, description)

    if social_card and social_card.is_file():
        shutil.copyfile(social_card, out / SOCIAL_CARD_NAME)
    elif social_card:
        log.warning("social card %s does not exist; leaving og:image unset", social_card)

    if base_url:
        root = base_url if base_url.endswith("/") else base_url + "/"
        html = _set_meta(html, "og:url", "property", root)
        if (out / SOCIAL_CARD_NAME).exists():
            # Absolute, because scrapers do not reliably resolve a relative one.
            for key, attr in (("og:image", "property"), ("twitter:image", "name")):
                html = _set_meta(html, key, attr, root + SOCIAL_CARD_NAME)
    elif (out / SOCIAL_CARD_NAME).exists():
        log.warning("a social card was copied but --base-url was not given, "
                    "so og:image is relative and most scrapers will ignore it")

    index.write_text(html, encoding="utf-8")


def export(editions_root: Path, reader_dist: Path, out: Path,
           base_url: str | None = None, social_card: Path | None = None,
           og_title: str | None = None, og_description: str | None = None) -> int:
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

    # Link-preview tags, so the paper unfurls as itself rather than as a bare
    # URL wherever someone pastes it.
    paper_title, motto = index[0]["masthead"], ""
    paper_json = editions_root / "paper.json"
    if paper_json.is_file():
        try:
            facts = json.loads(paper_json.read_text(encoding="utf-8"))
            paper_title = facts.get("masthead") or paper_title
            motto = facts.get("motto") or ""
        except json.JSONDecodeError:
            log.warning("paper.json is not valid JSON; link-preview tags fall back to the masthead")
    write_social_tags(out, paper_title, motto, base_url, social_card,
                      og_title, og_description)

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
    parser.add_argument(
        "--base-url",
        help="absolute URL the site will be served from, e.g. "
             "https://user.github.io/repo/ — needed for og:image and og:url, "
             "which scrapers will not resolve from a relative path",
    )
    parser.add_argument(
        "--social-card",
        type=Path,
        help=f"image to copy in as {SOCIAL_CARD_NAME} and use for og:image; "
             "1200x630 is the size every scraper agrees on",
    )
    parser.add_argument(
        "--og-title",
        help="override the link-preview title; defaults to the masthead. Use it "
             "on a public demo, where the masthead names the persona rather than "
             "the project",
    )
    parser.add_argument(
        "--og-description",
        help="override the link-preview description; defaults to the motto",
    )
    args = parser.parse_args(argv)

    logging.basicConfig(level=logging.INFO, format="%(levelname)s: %(message)s")
    count = export(args.editions, args.reader, args.out, args.base_url,
                   args.social_card, args.og_title, args.og_description)
    print(f"exported {count} edition(s) to {args.out}", file=sys.stderr)


if __name__ == "__main__":
    main()
