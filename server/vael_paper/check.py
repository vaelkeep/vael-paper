"""``vael-paper-check``: what a generator runs after writing an edition.

Prints the printer's marks (things that are wrong) and the lint (things that
will print badly), each with a file and line where the scanner knows one, so
that a model or a person can fix the edition in a second pass. ``--json`` gives
the same report as data. The exit status is 1 when there are marks, and with
``--strict`` when there is lint too, so a nightly job can refuse to publish.
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Any

from .models import Edition, Warning_
from .scan import list_edition_dirs, read_paper, scan_edition

ROOT = Path(__file__).resolve().parents[2]
DEFAULT_EDITIONS = ROOT / "editions"


def report(edition: Edition) -> dict[str, Any]:
    return {
        "id": edition.id,
        "masthead": edition.masthead,
        "number": edition.number,
        "articles": len(edition.articles),
        "images": len(edition.images),
        "sections": [s.id for s in edition.sections],
        "manifest": edition.manifest_file,
        "marks": [w.model_dump() for w in edition.warnings],
        "lint": [w.model_dump() for w in edition.lint],
        "ok": not edition.warnings,
        "clean": not edition.warnings and not edition.lint,
    }


def _where(w: Warning_) -> str:
    if w.file and w.line:
        return f"{w.file}:{w.line}"
    return w.file or w.scope


def format_report(edition: Edition) -> str:
    lines = [
        f"{edition.id}  {edition.masthead}  No. {edition.number}  "
        f"{len(edition.articles)} articles, {len(edition.images)} images, "
        f"{len(edition.sections)} sections"
        + (f"  ({edition.manifest_file})" if edition.manifest_file else "  (no manifest)")
    ]
    for title, items in (("marks", edition.warnings), ("lint", edition.lint)):
        lines.append(f"  {title} ({len(items)})")
        for w in items:
            lines.append(f"    {_where(w):<36} {w.code:<18} {w.message}")
    return "\n".join(lines)


def main(argv: list[str] | None = None) -> None:
    parser = argparse.ArgumentParser(
        prog="vael-paper-check",
        description="Check an edition the way the server will read it.",
    )
    parser.add_argument("editions", nargs="*", type=Path, help="edition directories (default: the latest)")
    parser.add_argument("--root", type=Path, default=DEFAULT_EDITIONS, help="the editions root")
    parser.add_argument("--all", action="store_true", help="check every edition under the root")
    parser.add_argument("--json", action="store_true", help="emit the report as JSON")
    parser.add_argument("--strict", action="store_true", help="fail on lint as well as marks")
    args = parser.parse_args(argv)

    if args.all:
        targets = list_edition_dirs(args.root)
    elif args.editions:
        targets = [p.resolve() for p in args.editions]
    else:
        targets = list_edition_dirs(args.root)[:1]
    if not targets:
        print(f"no editions under {args.root}", file=sys.stderr)
        raise SystemExit(2)

    reports = []
    failed = False
    for edition_dir in targets:
        if not edition_dir.is_dir():
            print(f"not a directory: {edition_dir}", file=sys.stderr)
            raise SystemExit(2)
        edition = scan_edition(edition_dir, paper=read_paper(edition_dir.parent))
        reports.append(report(edition))
        if not args.json:
            print(format_report(edition))
        if edition.warnings or (args.strict and edition.lint):
            failed = True

    if args.json:
        print(json.dumps(reports if len(reports) > 1 else reports[0], indent=2, ensure_ascii=False))
    raise SystemExit(1 if failed else 0)


if __name__ == "__main__":
    main()
