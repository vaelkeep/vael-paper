# The edition format

This is the contract between whatever writes the paper and the reader that
prints it. Get this right and everything else is replaceable.

The reader never talks to a generator. It reads a directory. Anything that can
write markdown into that directory — a nightly cron job, a shell
script, you with a text editor — can publish an edition.

## Shape

The paper is described once. An edition is a folder of articles.

```
editions/
  paper.json              the masthead, the motto, the section order — written once
  2026-09-03/
    articles/
      01-your-thursday.md one file per story
      02-orange-line.md
    images/
      rain-by-hour.png
```

That is a complete, publishable edition. There is no manifest to keep in step
with the files: each article says which section it belongs to, `paper.json`
says what order the sections come in, and within a section stories run by
`priority` and then by filename. The highest-priority story in the paper is
the lead and gets the front page's full-width headline treatment.

## `paper.json`

The things that are true of every edition, so a generator never writes them.

```json
{
  "masthead": "The John Smith Daily",
  "motto": "Printed nightly, for one reader",
  "founded": "2026-02-01",
  "sections": [
    { "id": "today", "name": "Today" },
    { "id": "week", "name": "The Week Ahead" },
    { "id": "local", "name": "Local" },
    { "id": "money", "name": "Money" }
  ]
}
```

`founded` gives every edition its number for free — days since the paper
began — and its volume, the year of its life. Both survive old editions being
pruned. Without it, an edition is numbered by its position among the
directories on disk. A section an article names that the catalogue does not
know is still printed, after the others, with a note.

## `edition.json` (optional)

An edition may carry its own manifest to override the paper for one day:
a different masthead for a special, an explicit number, or a hand-picked
order of stories.

```json
{
  "schema": 1,
  "date": "2026-09-02",
  "volume": 1,
  "number": 214,
  "masthead": "The Vael Paper",
  "motto": "Printed nightly, for one reader",
  "generated_at": "2026-09-02T04:12:00-04:00",
  "sections": [
    { "id": "markets", "name": "Markets", "articles": ["01-markets-slip", "05-copper"] },
    { "id": "comment", "name": "Comment", "articles": ["02-on-quiet-machines"] }
  ]
}
```

Any field present here wins over `paper.json`. When `sections` is given it
replaces the catalogue order entirely and lists stories explicitly; a story
on disk that it forgets is appended under its own section, with a note.

## Article files

YAML frontmatter, then markdown.

```markdown
---
id: 01-markets-slip
headline: Markets Slip as Traders Weigh the Rate Path
deck: A cautious session ends lower
section: markets
byline: The Vael Desk
priority: 1
span: full
image: images/markets-chart.png
caption: Three sessions of decline.
---

The body starts here.
```

| Field | Required | Notes |
|---|---|---|
| `id` | no | Defaults to the filename stem. Must be unique. |
| `headline` | **yes** | Falls back to the filename, and records a warning. |
| `deck` | no | The standfirst under the headline. |
| `section` | no | Lower-cased. Defaults to `misc`. |
| `byline` | no | Rendered as "By …". |
| `priority` | no | 1–5, clamped. Lower is more prominent. |
| `span` | no | `full`, `2col`, `1col`. Sets the headline weight. |
| `image` | no | Path relative to the edition directory. |
| `caption` | no | Ignored without an `image`. |
| `focus` | no | `top`, `center` (default), `bottom` — see below. |
| `sources` | no | Where a summarised story came from — see below. |

**Do not write image dimensions.** The server measures them with Pillow at scan
time and injects `w`, `h` and `aspect` into the manifest it serves. This is not
a convenience: the reader must reserve an image's exact space *before* the file
loads, because a late-arriving size would invalidate the pagination that was
computed from it. A generator cannot be trusted to know pixel dimensions and
should never be asked to.

`word_count` is likewise computed by the server.

The server also passes each file through untouched as `source`, and
`edition.json` as `manifest_source`, so the reader's **Source** button can show
the markdown behind any page exactly as the generator wrote it.

### The frontmatter forgives

A generator that writes an article the way it would write any document has
written a valid article. Specifically:

- **The frontmatter is optional.** A leading `# Heading` is the headline, and
  an italic line directly under it (`*Arranged in the order it will happen*`)
  is the deck. The rest is the body.
- **Colons are not an error.** `headline: Markets: A Cautious Session` is the
  most common way a model breaks YAML, and it is quoted for you before YAML
  sees it. So is a value that begins with `*`, `&`, `!`, `%`, `@` or a
  backtick.
- **Common names are accepted.** `title`, `subtitle`/`standfirst`/`summary`,
  `author`/`by`, `photo`/`img`, `category`/`desk`, `link`/`links`/`source`,
  `rank`, `crop` — each folds to the field it means, and keys are matched in
  any case.
- **Everything but the headline has a default.** `section` falls back to
  `misc`, `priority` to 3, `span` to a single column, `focus` to `center`.

When YAML still refuses — an unclosed bracket, a stray indent — the file is
scraped line by line for whatever `key: value` pairs survive, and the printer's
mark says which line to look at.

### Images are cropped, so say where to hold them

A column is a fixed width and a plate may occupy at most sixteen baselines, so
any image taller than about a 1:1.15 ratio is cropped to fit. `focus` says which
part to keep:

- `center` (the default) holds the image slightly **above** centre, because a
  cropped photograph's subject is usually in the upper half and a face cut at
  the forehead is a far worse failure than a little extra foreground;
- `top` for a tall portrait whose subject is right at the top;
- `bottom` for the rarer opposite.

Photographs are printed as ink on paper — desaturated, contrast-lifted, and
multiplied into the page so the paper shows through the highlights. The contrast
lift matters: a typical photograph is mid-tone heavy, and multiplying that
against a cream ground without it produces mud.

### Plates from data

A generator cannot make a picture, but it can write down seven numbers. Give
an article a `chart:` block instead of an `image:` and the server draws the
plate in the paper's style — ink on cream, no lettering — and files it under
`images/` as if you had supplied it. The reading of the chart goes in the
caption, where a newspaper puts it anyway.

```yaml
chart:
  kind: bars              # line | bars
  values: [9120, 8340, 10205, 2860, 8015, 11480, 8470]
  labels: [Thu, Fri, Sat, Sun, Mon, Tue, Wed]   # optional: under the axis
  show_values: true       # optional: the figure above each bar (a line: its ends and peak)
  target: 8000            # optional: a reference line; bars at or above it are filled
  min: 0                  # optional: bottom of the scale — start highs of 94–99 at 80, not 0
  max: 12500              # optional: top of the scale (default: a little above the peak)
  aspect: 4:3             # optional: 16:9 (default for line), 3:2, 4:3 (default for bars)
  tick_every: 3           # optional: a heavier tick every n values, for an unlabelled line
caption: Daily steps, last seven days. The dotted line is your own target of eight thousand.
```

Lettering is set in the paper's own face at agate size, so a plate matches
the page.

**Labels.** `labels` is a list of short strings drawn under the axis in
letterspaced capitals. With exactly one label per value, each sits under its
own bar or point. With fewer, they are spread evenly from the first value to
the last, which is the right shape for a line with many points: seven labels
over thirty-seven half-hourly readings puts one every three hours. Each label
is twelve characters at most, there are forty at most, and a label must fit
in the space between labels — the renderer refuses one that would collide
with its neighbour (`bad_chart`, with the offending label named) rather than
draw a plate nobody can read. `show_values: true` adds the figure above each
bar; on a line, only the first, last and peak values, so the figures do not
fight the curve. There are no y-axis figures; `min`, `max`, the `target` and
`show_values` between them say what the scale is, and the caption says what
it means.

A line chart fills the area beneath it and, when there is a `target`, rules a
vertical at the first value to reach it. Bars rise from the axis, which sits
at `min`. The plate is redrawn only when the spec changes; its hash is kept
inside the PNG. An unusable spec is a printer's mark, `bad_chart`, and the
story prints without a picture. An explicit `image:` always wins over a
chart.

### Sources

A paper of machine-written summaries owes its reader the provenance of each one,
so a source is a field rather than a link buried in the prose. Several shapes
are accepted, because a generator will not always produce the same one:

```yaml
source: https://www.reuters.com/business/energy/     # a bare URL
```

```yaml
sources:
  - name: Reuters
    url: https://www.reuters.com/business/energy/
    title: Regulator flags tighter reserves          # optional
  - https://apnews.com/hub/business                  # name taken from the host
  - NERC Long-Term Reliability Assessment            # a source with no link
```

`source` and `sources` are interchangeable. The result renders as a rule-topped
credit line at the end of the story, naming each publisher and linking those
that have a URL. It is bound to the story it credits, so it can never begin a
column on its own.

**Only `http` and `https` URLs are ever linked.** Anything else — a
`javascript:` URL, a `data:` URL, a scheme smuggled past with whitespace or
control characters — is refused and recorded as a printer's mark. This is not
hypothetical: article bodies are written by a language model from feeds nobody
controls, and the same rule applies to inline `[text](url)` links in the prose,
which degrade to plain text rather than becoming a link that does something
else.

## Supported markdown

Deliberately narrow. Every construct here is one the paginator can measure and
break correctly, so the grammar is a liability rather than a feature.

| Syntax | Becomes |
|---|---|
| blank-line-separated text | a paragraph (the first takes a drop cap) |
| `## Heading` / `### Heading` | a crosshead |
| `**bold**`, `*italic*`, `` `code` `` | inline emphasis |
| `- item` / `1. item` | a list (items may wrap onto continuation lines) |
| `> quoted text` | a **pull quote**, not a blockquote |
| `> — Name` as the last quoted line | the pull quote's attribution |
| `---` | a rule |
| `![caption](images/x.png)` | an inline figure |
| a pipe table | a table set as agate — see below |
| `[text](https://…)` | a link, opened in a new tab |

Not supported, and silently dropped: raw HTML, footnotes, nested lists,
reference links. Straight quotes, `--` and `...` are converted to proper
typography automatically, so write them plainly.

### Tables

A GitHub-style pipe table, recognised by its delimiter row, which also carries
the column alignment:

```markdown
A table longer than the room left in a column continues in the next one, split
between rows, and the heading row is set again at the top of the continuation
so the figures never lose their names. The label above the table is not
repeated.

### Equities

| Index | Close | Change | % |
|:---|---:|---:|---:|
| S&P 500 | 5,412.66 | −38.21 | −0.70 |
| Nasdaq Composite | 17,884.02 | −146.55 | −0.81 |
```

- The delimiter must be the **second** line, so a sentence containing a pipe is
  never mistaken for a table.
- `:---` left, `---:` right, `:--:` centre. Numeric columns want `---:`.
- An `###` heading immediately above a table becomes the table's label rather
  than a crosshead, so the two cannot be separated by a page break.
- Ragged rows are padded, not rejected. A dropped cell costs that cell.

Tables are set in agate — small, dense, tabular figures — and every row is
exactly one baseline tall. That is what lets a long table **split across
columns and pages at a row boundary**, which a share listing needs.

Two consequences worth knowing when writing them:

- **A continuation carries no repeated header.** `display: table-header-group`
  only repeats in print, not in a clipped box, so keep column headings terse
  enough to be inferable, or break a very long table into labelled shorter ones.
- **Cells do not wrap.** A cell too wide for its column is truncated with an
  ellipsis, because a wrapping cell would be two baselines tall and rows must be
  one. Abbreviate long names — `Nasdaq Composite`, not
  `Nasdaq Composite Index (Total Return)`.

A value beginning with a minus sign or a parenthesis is set in italic as a
decline. There is no colour: red would be the only colour on the page.

## Failure is not fatal

Nothing in the pipeline throws on bad content. The generator runs unattended at
four in the morning; the paper still has to print at breakfast.

A malformed article, a missing image, a section listing a story that isn't on
disk — each becomes a **printer's mark**, visible behind a small affordance in
the reader, and the edition prints without it. Marks carry a file and, where
the scanner knows it, a line. Frontmatter that YAML refuses to parse is scraped
line-by-line for whatever `key: value` pairs survive, so one bad field costs
that field rather than the article.

Alongside the marks the scanner produces **lint**: advice about things that
will print, but not well. A table wider than a column, a cell that will be
cut with an ellipsis, a tall image with no `focus`, a story too short to carry
a headline. The numbers come from the reader's own geometry.

### Checking an edition before it prints

```
$ vael-paper-check editions/2026-09-04
2026-09-04  The John Smith Daily  No. 216  15 articles, 2 images, 11 sections  (paper.json)
  marks (1)
    03-rates.md:4            yaml_parse   Frontmatter is not valid YAML (while parsing a flow sequence); recovered 5 field(s) by scraping.
  lint (1)
    07-ledger.md:18          table_wide   Table needs about 58 characters across and a column fits about 52; drop a column or shorten the longest cells.
```

`--json` gives the same report as data, `--all` checks every edition, and
`--strict` fails on lint as well as marks. The exit status is 1 when the
edition has marks, so a nightly job can write, check, fix and only then
publish. The server answers the same report at
`GET /api/editions/<date>/check`, and the reader lists both marks and lint
behind its printer's-marks toggle.

`editions/2026-09-02/articles/08-broken.md` exists precisely to exercise this
path, and should be kept broken.

The whole sample edition is fiction, written to exercise the engine: a story
long enough to force a continuation, a table longer than a column, images at
three different aspect ratios, and that one unparseable file. The market
figures in particular are invented, and the companies do not exist.

## Publishing a new edition

Write the directory and the server picks it up on the next request — no restart,
no watcher. Editions are fingerprinted on file count and mtime, so a rewrite in
place is noticed too.

```
editions/2026-09-04/
  articles/*.md
  images/*
```

`GET /api/editions/latest` resolves to the newest directory name that looks like
a date, so an edition dated in the future will become "latest" the moment it is
written.
