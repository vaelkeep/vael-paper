# The edition format

This is the contract between whatever writes the paper and the reader that
prints it. Get this right and everything else is replaceable.

The reader never talks to a generator. It reads a directory. Anything that can
write markdown into that directory — a nightly Vaelkeep cron job, a shell
script, you with a text editor — can publish an edition.

## Shape

One directory per edition, named `YYYY-MM-DD`:

```
editions/
  2026-09-02/
    edition.json          ordering and sectioning
    articles/
      01-markets-slip.md  one file per story
      02-on-quiet-machines.md
    images/
      markets-chart.png
```

The reading order is: sections in the order `edition.json` lists them, and
articles in the order each section lists them. The first article in that order
is the lead, and gets the front page's full-width headline treatment.

## `edition.json`

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

Only `sections` really matters. Everything else has a sensible default, and the
file may be omitted entirely — the scanner will then order articles by filename
and group them by each article's own `section` field.

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
the reader, and the edition prints without it. Frontmatter that YAML refuses to
parse is scraped line-by-line for whatever `key: value` pairs survive, so one
bad field costs that field rather than the article.

`editions/2026-09-02/articles/08-broken.md` exists precisely to exercise this
path, and should be kept broken.

## Publishing a new edition

Write the directory and the server picks it up on the next request — no restart,
no watcher. Editions are fingerprinted on file count and mtime, so a rewrite in
place is noticed too.

```
editions/2026-09-03/
  edition.json
  articles/*.md
  images/*
```

`GET /api/editions/latest` resolves to the newest directory name that looks like
a date, so an edition dated in the future will become "latest" the moment it is
written.
