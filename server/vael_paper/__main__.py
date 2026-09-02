"""Entry point: ``uv run vael-paper`` or ``python -m vael_paper``."""

from __future__ import annotations

import argparse
import logging
import os

import uvicorn


def main() -> None:
    parser = argparse.ArgumentParser(prog="vael-paper", description="Serve The Vael Paper.")
    parser.add_argument("--host", default=os.environ.get("VAEL_PAPER_HOST", "0.0.0.0"))
    parser.add_argument(
        "--port", type=int, default=int(os.environ.get("VAEL_PAPER_PORT", "8791"))
    )
    parser.add_argument("--editions", default=os.environ.get("VAEL_PAPER_EDITIONS"))
    parser.add_argument("--reload", action="store_true")
    args = parser.parse_args()

    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(name)s: %(message)s")
    if args.editions:
        os.environ["VAEL_PAPER_EDITIONS"] = args.editions

    uvicorn.run("vael_paper.app:app", host=args.host, port=args.port, reload=args.reload)


if __name__ == "__main__":
    main()
