"""Wire types shared with the reader.

These mirror ``reader/src/model/types.ts``. Keep the two in step: the reader
validates what arrives, but it cannot invent fields the server never sent.
"""

from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, Field

Span = Literal["full", "2col", "1col"]
# Where to hold an image when it has to be cropped to fit its box.
Focus = Literal["top", "center", "bottom"]


class Warning_(BaseModel):
    """A non-fatal problem found while scanning.

    Nothing in the scan path raises on bad content. A malformed article, a
    missing image or a dangling section reference becomes one of these and the
    edition still prints — a bad generation run should be visible, not fatal.
    """

    scope: str  # "edition" | "article:<id>" | "image:<key>"
    code: str  # machine-readable: "yaml_parse", "missing_image", ...
    message: str


class SourceRef(BaseModel):
    """Where a summarised story came from.

    A paper of machine-written summaries owes its reader the provenance of
    every one of them, so this is a first-class field rather than a link
    buried in the prose.
    """

    name: str
    url: str | None = None
    title: str | None = None


class ImageAsset(BaseModel):
    key: str  # as written in frontmatter, e.g. "images/plate.png"
    src: str  # URL the reader fetches
    w: int
    h: int
    aspect: float  # h / w — the reader reserves space with this before load
    dominant: str = "#e8e3d9"
    # Photographs and line art want opposite treatment in the night theme: a
    # chart should invert to white-on-black, a photograph must not become a
    # film negative. Detected at scan time — see scan.classify_tone.
    is_photo: bool = False


class Article(BaseModel):
    id: str
    file: str
    headline: str
    deck: str | None = None
    section: str = "misc"
    byline: str | None = None
    priority: int = 3
    span: Span = "1col"
    image: str | None = None
    caption: str | None = None
    focus: Focus = "center"
    sources: list[SourceRef] = Field(default_factory=list)
    word_count: int = 0
    body: str  # raw markdown; the reader parses it in a worker
    # The file exactly as the generator wrote it, frontmatter included, so a
    # reader can show the source of what it is looking at.
    source: str = ""


class Section(BaseModel):
    id: str
    name: str
    articles: list[str] = Field(default_factory=list)


class Edition(BaseModel):
    schema_version: int = Field(1, alias="schema")
    id: str  # the directory name, e.g. "2026-09-02"
    date: str
    volume: int = 1
    number: int = 1
    masthead: str = "The Vael Paper"
    motto: str | None = None
    generated_at: str | None = None
    front_template: str | None = None
    content_hash: str = ""
    # edition.json as written, for the reader's source view. None when absent.
    manifest_source: str | None = None
    sections: list[Section] = Field(default_factory=list)
    articles: list[Article] = Field(default_factory=list)
    images: dict[str, ImageAsset] = Field(default_factory=dict)
    warnings: list[Warning_] = Field(default_factory=list)

    model_config = {"populate_by_name": True}

    def model_dump_wire(self) -> dict[str, Any]:
        return self.model_dump(by_alias=True)


class EditionSummary(BaseModel):
    """One row in the archive index."""

    id: str
    date: str
    volume: int
    number: int
    masthead: str
    article_count: int
    warning_count: int
