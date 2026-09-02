---
name: check-edition
description: Check an edition of the personal paper the way the server will read it, then fix what the report says. Use after writing or editing articles, before publishing, or when asked why a story looks wrong.
---

# Check an edition and fix it

The paper never refuses to print, so a broken article shows up as a
printer's mark at breakfast rather than an error at night. This skill is
how you see the marks first.

## Run the check

From the repository root:

```
cd server && uv run vael-paper-check ../editions/<date> --json
```

or, against a running server, `GET /api/editions/<date>/check`.

The report has two lists. Each entry has a `code`, a `message`, and where
the scanner knows it, a `file` and 1-based `line`.

- **`marks`** — something is wrong. The edition prints without the broken
  piece. `"ok"` is false while any remain.
- **`lint`** — it will print, but badly. `"clean"` is false while any remain.

## Fix, by code

| code | do this |
|---|---|
| `yaml_parse` | Open `file` at `line`. Usually an unquoted colon, an unclosed bracket, or an indented key. Quote the value, or rewrite the frontmatter plainly. |
| `no_headline` | Add `headline:` or start the body with `# Headline`. |
| `unknown_section` | Use an id from `editions/paper.json`. |
| `missing_image`, `bad_image` | Remove the `image:` line or point it at a file that exists in `images/`. |
| `bad_chart` | `values` needs at least two numbers; `kind` is `line` or `bars`. |
| `unsafe_source` | Only `http`/`https` URLs are printed. Drop or fix the link. |
| `dangling_article`, `unlisted_articles` | Only with an `edition.json`. Usually simplest to delete the manifest and let `paper.json` order the paper. |
| `table_wide`, `cell_long` | Drop a column, shorten the longest cells, fold the day into the time. |
| `plate_aspect` | Add `focus: top`/`center`/`bottom`, or use a landscape image. |
| `story_short` | Fold it into another story, or write the rest. |
| `story_long` | Split it. |
| `headline_long`, `deck_long` | Cut. |
| `no_lead` | Give the front-page story `priority: 1`. |

Edit the files, run the check again, and repeat until `"ok"` is true.
Stop at `"clean"` when you can; say what lint you left and why when you
cannot.
