# How the pagination works

The interesting part of this project, and the thing most likely to be broken by
a well-meaning edit. If you change anything under `reader/src/layout/`, read
this first.

## Contents

- [The three stages](#the-three-stages)
- [Two consequences worth knowing](#two-consequences-worth-knowing)
- [Invariants you must not break](#invariants-you-must-not-break)
- [The column rule](#the-column-rule)
- [Drop caps](#drop-caps)
- [Tables](#tables)
- [Development checks](#development-checks)

## The three stages

**Measure once.** Each article is laid out a single time, offscreen, at exactly
the base column width, and read back into a `LineLedger` — how many baselines
each block occupies. One forced layout for the whole edition.

**Pack arithmetically.** `packColumn` fills a column from a ledger using integer
arithmetic over baselines. It is a pure function: no DOM, no measurement.
Orphans, widows, keep-with-next, keep-with-previous, atomic figures and the
jump-slug reservation are all integer constraints, and all unit-tested against
synthetic ledgers.

**Render by slice-and-clip.** A fragment is the *whole* blocks it spans, cloned
from the article's template, inside a window of the exact allotted height, with
the ribbon shifted up by `fromLine × lineHeight`. Text is never re-broken — only
masked.

That last point is the whole design. The rendered fragment is the same DOM at
the same width that was measured, so measured layout and rendered layout are
identical by construction. Justification, hyphenation and drop-cap indents
survive a column break because the paragraph was never split — which is exactly
the failure class that makes DOM-splitting paginators unreliable.

## Two consequences worth knowing

- **The ledger's cache key excludes page height.** Line breaking depends only on
  the measure, so a height-only change — an iPad toolbar collapsing, a window
  dragged shorter — reuses every ledger and costs a repack of a few milliseconds
  rather than a remeasure.
- **Page numbers are not identity.** They are a function of the layout key,
  which is why the router addresses articles: `#/2026-09-02/a/04-orbital-debris`
  is stable, `#/2026-09-02/p4` is resolved and then rewritten.

## Invariants you must not break

1. **The baseline grid.** `--lh` is an integer pixel value and every block
   margin and atomic height is a multiple of it. Introduce a fractional baseline
   and the packer's integer arithmetic stops matching what the browser draws.
2. **Atomic blocks are snapped after measurement.** Splittable text is
   baseline-aligned for free, because its line-height *is* the baseline. Pull
   quotes, figures with captions and rules are not — they set their own leading
   or carry borders — so `measure.ts` writes their measured height back onto the
   template. Skip that and a block half a baseline taller than the ledger
   believes shows up as a line sliced through the middle at a column foot.
3. **The rhythm rule.** Vertical space in a ribbon is expressed *only* as
   `margin-block-start` via `.ribbon > * + *`. Never `margin-block-end`, never a
   bare margin on a child. `BlockMetrics.leadLines` assumes exactly this; break
   it and slices drift by one lead per column, which presents as a phantom
   off-by-one in the packer.
4. **One child per block.** A ribbon's children map one-to-one onto
   `article.blocks`, so a cursor's `blockIndex` means the same thing in the
   parser, the ledger, the packer and the renderer. Head furniture is built
   separately for this reason — and it is what lets the front-page lead take a
   full-width headline while its body flows in base columns.
5. **Phase discipline.** Write, then one forced flush, then read, then compute.
   `util/rw-batch.ts` logs violations in development.
6. **Nothing may sit outside a column.** A column is `overflow: hidden` with
   `contain: strict`, because that clipping *is* the slice mechanism. A negative
   margin — the optical nudge a drop cap conventionally wants, say — puts ink
   outside the box and it is silently cut off.

## The column rule

Column count is chosen by **measure**, not by breakpoints: the paper picks the
count whose resulting line length lands closest to an ideal ~62 characters,
inside a readable band of 34–75. Deliberately *not* "as many columns as fit" —
that is what gives a printed broadsheet its cramped five-column grid, which
reads badly on a screen — and deliberately not a fixed number, which would give
a 97-character line on an ultrawide display.

The consequence is that the paper always fills the display, and a very wide
window answers by growing **columns** rather than line length. Because the rule
is expressed in characters, it also scales with the text-size setting for free:
turn the type up far enough and a column drops away on its own.

| | mode | columns per leaf | measure | screen used |
|---|---|---|---|---|
| Ultrawide 3440, full screen | spread | 3 | ~64 chars | 100% |
| Desktop 1630 windowed | spread | 2 | ~43 chars | 100% |
| MacBook 1512×900 | spread | 2 | ~39 chars | 100% |
| iPad landscape | spread | 1 | ~56–62 chars | 100% |
| iPad portrait | single | 2 | ~43 chars | 100% |
| phone | scroll | 1 | — | 100% |

`geometry.test.ts` pins this against those devices at every text size, including
that the measure never leaves the band when some column count could satisfy it.

## Drop caps

A three-line drop cap has two obligations, both about *ink*: its top aligns with
the capitals on line one, and its baseline sits on line three's baseline.

`font-size: 3 × lineHeight` satisfies neither, because a font's cap-height is
only a fraction of its em size — about 0.72 for Playfair Display. Set that way
the letter is roughly 8px short over three lines, so it hangs below the first
line's capitals and stops above the third line's baseline.

`layout/dropcap.ts` therefore measures the faces with `measureText` and solves
for the size and line height that satisfy both alignments, writing the result to
CSS custom properties *before* the paginator measures anything — a drop cap
changes the height of the paragraph it starts.

The solve deliberately requires **zero `padding-top`**, so the cap never needs
to sit above the paragraph, which invariant 6 forbids.

## Tables

Tables are **not** atomic — unlike figures and pull quotes, they may split. A
share listing is routinely longer than a column, and a table that cannot break
is a table that gets clipped.

Every row is exactly one baseline tall, so the packer's ordinary line arithmetic
splits a table at a row boundary for free and the renderer's clip lands between
rows. Three CSS choices are load-bearing for that:

1. `line-height` is `--lh` even though the type is smaller, so a row is a
   baseline regardless of font size;
2. cells carry no vertical padding, which would add to the row box;
3. rules are drawn with `box-shadow`, not `border` — a 1px border on 12 rows is
   12px of accumulated drift.

`table-layout: fixed` is equally load-bearing horizontally: with `auto`, cells
that must not wrap size the table to their content and it grows wider than its
column. Per-column widths are computed from the content in `ch` units, which are
exact for tabular figures.

The cost: a continuation carries no repeated header, because
`display: table-header-group` only repeats in print, not in a clipped box.

## Development checks

```sh
cd reader
npm test        # packer, geometry, markdown and drop caps — all pure
npm run typecheck
```

In development the reader also:

- logs each pagination with its cost, page count and mode;
- asserts that no rendered column overflows its box, and that every slice and
  atomic block is a whole number of baselines — both catch the packer and the
  renderer disagreeing, which is the one bug this design exists to prevent;
- exposes `window.__vael` for inspecting the plan, the current anchor and the
  layout key, and for driving `setScale()` directly.

Cost for the sample edition on an M-series Mac: **~20ms cold, ~10ms warm.**
