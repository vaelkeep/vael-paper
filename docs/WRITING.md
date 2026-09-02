# Writing an edition

This page is for whatever writes the paper: a person, a script, or a language
model given it as instructions. It is short on purpose. Everything here is
also checked by `vael-paper-check`, so you will be told when you drift.

## The shape

```
editions/
  paper.json                 already written: masthead, motto, section order
  2026-09-04/                one folder per edition, named by date
    articles/
      01-your-thursday.md    one file per story
      02-orange-line.md
    images/                  photographs you were given; plates are drawn for you
```

Write the folder for tomorrow's date. Nothing else needs to exist. There is
no manifest to update, and the paper picks the folder up the moment it is
written.

## A story

```markdown
---
headline: Orange Line Single-Tracks Through Eastern Market to the Seventeenth
deck: Trains every fifteen minutes, a shuttle nobody should need, and one useful walk
section: local
priority: 2
sources:
  - name: WMATA service advisories
    url: https://wmata.example/advisories/orange
  - The Hill Rag
---

Metro is single-tracking the Orange Line between Stadium–Armory and Eastern
Market from this morning through the seventeenth for track and platform work…
```

- **`headline`** is the only field you must supply. Under eighty characters
  sets in two lines. If you would rather not write frontmatter at all, start
  the file with `# Headline` and, on the next line, `*a one-line deck*`.
- **`section`** is one of the ids in `paper.json`. Look there; do not invent
  one. A story with no section lands in "Misc" at the back.
- **`priority`** is 1 to 5. Exactly one story in the paper should be 1: that
  is the front page. Use 2 for the second-most important story in each
  section, 3 for everything else. You rarely need 4 or 5.
- **`deck`** is one sentence under the headline, under 170 characters.
- **`sources`** is a list. A bare name, a bare URL, or `name` + `url`. Only
  `http` and `https` links are ever printed. Every story that summarises
  something published elsewhere should have at least one.
- **`byline`** defaults to the paper's desk. Set it only when it matters.
- **`caption`** goes with an image or a chart, and should say what the
  picture *means*, not what it shows.

Colons in a headline are fine. `title`, `subtitle`, `author`, `photo`,
`category` and the like are accepted as well, but the names above are the
ones the paper uses.

## Length

| | words |
|---|---|
| A brief, a listing, a reply | 60 – 150 |
| An ordinary story | 250 – 500 |
| The front-page lead | 400 – 700 |
| The most a story should be | 1,500 |

Under sixty words a story cannot carry its own headline; fold it into
another. Over fifteen hundred it runs across several pages; split it.

## Markdown that becomes newspaper furniture

Paragraphs, `##` and `###` subheads, `*italic*`, `**bold**`, bulleted and
numbered lists, `> a pull quote`, `---` rules, links, and pipe tables. No raw
HTML. No headings deeper than `###`.

**Tables** are set in small type in a column about fifty-two characters
wide. So:

- at most four columns, five if all but one are numbers;
- the longest cell in any column under twenty-six characters;
- put the day into the time (`Thu 9:30`) rather than in its own column;
- a `### Label` line directly above a table becomes its title.

Numbers, times and prices are set in tabular figures; `−` for a decline is
set apart from the rest of the row.

## Pictures

You have two ways to get a picture into a story, and only one of them asks
you to find pixels.

**A chart from data.** Instead of an image, write the numbers:

```yaml
chart:
  kind: bars               # or line
  values: [9120, 8340, 10205, 2860, 8015, 11480, 8470]
  labels: [Thu, Fri, Sat, Sun, Mon, Tue, Wed]
  show_values: true
  target: 8000             # optional reference line
caption: Daily steps, last seven days. The dotted line is the target of eight thousand.
```

The paper draws it in its own style. Two to about forty values for a line,
two to twelve for bars. Put the reading in the caption.

**Adding labels.** `labels:` is a list of short strings set under the axis.

- Give one label per value and each sits under its own bar or point:
  `labels: [Thu, Fri, Sat, Sun, Mon, Tue, Wed]` for seven values.
- Give fewer and they are spread evenly from the first value to the last:
  `labels: [6am, 9, noon, 3pm, 6, 9, 12]` over thirty-seven half-hourly
  readings puts one every three hours. Use this for a line with many points.
- Keep them short: twelve characters at most, and a label must fit in the
  space between labels. "Midnight" over seven labels is too wide; "12" is
  fine. If the check says a label is too wide, shorten it or use fewer.
- Numbers on the bars: add `show_values: true`. On a line chart only the
  first, last and highest values are shown, so the figures never crowd the
  curve.
- Values all close together (daily highs of 94 to 99) look identical from
  zero; set `min: 80` and the differences show.

Label the axis whenever the reader would otherwise have to guess which bar
is which. Show the values when the numbers themselves matter.

**A photograph** from the pictures you were given: `image: images/name.png`
plus `focus: top`, `center` or `bottom` to say which part to keep when it is
cropped to the column. A landscape image, 16:9 to 4:3, needs no `focus`.

Do not reference an image that is not in `images/`. The story will print
without it and a printer's mark will say so.

## The paper's voice

It is written for one reader, in the second person when the story concerns
them and the third when it does not. Plain, specific, unhurried. Say what
happened, then what it means for the reader, then what they might do. No
exclamation marks, no headlines that ask a question, no "in today's
fast-paced world". A story that summarises someone else's reporting says so
and links to it. Something that is only true in one house — the cat, the
furnace, the fennel — belongs in the paper as much as the central bank does.

## Before you finish

```
vael-paper-check editions/2026-09-04 --json
```

Fix every **mark** (something is wrong: a file will not parse, an image is
missing, a section is unknown). Fix the **lint** you can (a table too wide, a
cell too long, a story too short, a tall image with no `focus`). Run it
again. When `"ok": true`, the edition is ready; when `"clean": true`, it will
also print well.
