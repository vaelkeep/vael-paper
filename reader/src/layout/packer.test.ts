/**
 * Packer tests.
 *
 * The packer is pure integer arithmetic, so it can be exercised exhaustively
 * against synthetic ledgers with no browser and no measurement. Given that
 * every page in the paper is produced by this function, that is a bargain.
 */

import { describe, expect, it } from 'vitest';
import type { BlockMetrics, LineLedger } from '../model/types';
import { ORPHAN_MIN, WIDOW_MIN, atEnd, cursorAt, lastBlockOf, packColumn } from './packer';

type Spec = Partial<BlockMetrics> & { lines: number };

function ledger(specs: Spec[], articleId = 'a'): LineLedger {
  const blocks: BlockMetrics[] = specs.map((s, i) => ({
    index: i,
    kind: s.kind ?? 'para',
    lines: s.lines,
    leadLines: i === 0 ? 0 : (s.leadLines ?? 1),
    atomic: s.atomic ?? false,
    keepWithNext: s.keepWithNext ?? false,
    keepWithPrevious: s.keepWithPrevious ?? false,
  }));
  return {
    key: {
      articleId,
      contentHash: 'h',
      colW: 300,
      fontScale: 1,
      fontsVersion: 'test',
    },
    lineHeight: 26,
    totalLines: blocks.reduce((n, b) => n + b.lines + b.leadLines, 0),
    blocks,
  };
}

/** Fill columns until the article is exhausted, as the planner would. */
function flow(led: LineLedger, capacity: number, max = 200) {
  let cursor = cursorAt(led.key.articleId);
  const columns: number[][] = [];
  for (let i = 0; i < max && !atEnd(cursor, led); i++) {
    const result = packColumn(capacity, cursor, led, {});
    if (result.slice === null && result.cursor.blockIndex === cursor.blockIndex) {
      throw new Error(`no progress at block ${cursor.blockIndex}`);
    }
    columns.push([result.usedLines, result.slice ? 1 : 0]);
    cursor = result.cursor;
  }
  if (!atEnd(cursor, led)) throw new Error('did not terminate');
  return columns;
}

describe('packColumn', () => {
  it('places a whole short article in one column', () => {
    const led = ledger([{ lines: 4 }, { lines: 6 }]);
    const r = packColumn(40, cursorAt('a'), led, {});
    expect(r.finished).toBe(true);
    expect(r.slice?.isArticleStart).toBe(true);
    expect(r.slice?.isArticleEnd).toBe(true);
    expect(r.usedLines).toBe(4 + 1 + 6); // second block charges its lead
  });

  it('never charges a lead to the first block in a column', () => {
    const led = ledger([{ lines: 10, leadLines: 0 }, { lines: 10, leadLines: 3 }]);
    const first = packColumn(10, cursorAt('a'), led, {});
    expect(first.usedLines).toBe(10);
    // Block 1 starts the next column, so its 3-line lead is suppressed there.
    const second = packColumn(10, first.cursor, led, {});
    expect(second.usedLines).toBe(10);
  });

  it('splits a paragraph mid-block and resumes at the exact line', () => {
    const led = ledger([{ lines: 30 }]);
    const a = packColumn(12, cursorAt('a'), led, {});
    expect(a.cursor.lineIndex).toBe(12);
    expect(a.slice).toMatchObject({ fromLine: 0, toBlock: 0, toLine: 12, heightLines: 12 });

    const b = packColumn(12, a.cursor, led, {});
    expect(b.slice).toMatchObject({ fromLine: 12, toLine: 24 });

    const c = packColumn(12, b.cursor, led, {});
    expect(c.finished).toBe(true);
    expect(c.slice).toMatchObject({ fromLine: 24, isArticleEnd: true });
  });

  it('loses no lines when a paragraph spans many columns', () => {
    const led = ledger([{ lines: 97 }]);
    const columns = flow(led, 14);
    expect(columns.reduce((n, [used]) => n + used!, 0)).toBe(97);
  });

  it('leaves no orphan at the foot of a column', () => {
    // 20 lines into a 21-line budget would strand 1 line — below ORPHAN_MIN.
    const led = ledger([{ lines: 8, leadLines: 0 }, { lines: 21 }]);
    const r = packColumn(9 + ORPHAN_MIN - 1, cursorAt('a'), led, {});
    const linesOfSecond = r.cursor.blockIndex === 1 ? r.cursor.lineIndex : 0;
    expect(linesOfSecond === 0 || linesOfSecond >= ORPHAN_MIN).toBe(true);
  });

  it('leaves no widow at the head of the next column', () => {
    const led = ledger([{ lines: 20, leadLines: 0 }]);
    // Capacity 19 would push a single line over; the packer pulls one back.
    const r = packColumn(19, cursorAt('a'), led, {});
    const carried = 20 - r.cursor.lineIndex;
    expect(carried).toBeGreaterThanOrEqual(WIDOW_MIN);
  });

  it('does not strand a heading at the foot of a column', () => {
    const led = ledger([
      { lines: 6, leadLines: 0 },
      { lines: 2, keepWithNext: true },
      { lines: 12 },
    ]);
    // Room for the body and the heading, but not for the heading plus two
    // lines of what follows: the heading must move to the next column.
    const r = packColumn(6 + 1 + 2, cursorAt('a'), led, {});
    expect(r.cursor.blockIndex).toBe(1);
  });

  it('pushes an atomic block whole rather than splitting it', () => {
    const led = ledger([
      { lines: 4, leadLines: 0 },
      { lines: 10, atomic: true, kind: 'figure' },
    ]);
    const r = packColumn(9, cursorAt('a'), led, {});
    expect(r.cursor.blockIndex).toBe(1);
    expect(r.cursor.lineIndex).toBe(0);
    expect(r.usedLines).toBe(4);
  });

  it('force-places an atomic block taller than an empty column', () => {
    const led = ledger([{ lines: 40, atomic: true, kind: 'figure', leadLines: 0 }]);
    const r = packColumn(20, cursorAt('a'), led, {});
    expect(r.overflowed).toBe(true);
    expect(r.finished).toBe(true); // and crucially, it made progress
  });

  it('reserves a line for the jump slug only while the story continues', () => {
    const led = ledger([{ lines: 30, leadLines: 0 }]);
    const withJump = packColumn(10, cursorAt('a'), led, { isPageFinalColumn: true });
    const without = packColumn(10, cursorAt('a'), led, {});
    expect(withJump.usedLines).toBe(without.usedLines - 1);
  });

  it('enters a differently-measured region only at a block boundary', () => {
    const led = ledger([{ lines: 30, leadLines: 0 }]);
    const mid = packColumn(10, cursorAt('a'), led, {});
    expect(mid.cursor.lineIndex).toBe(10);

    const blocked = packColumn(10, mid.cursor, led, { blockBreakOnly: true });
    expect(blocked.slice).toBeNull();
    expect(blocked.usedLines).toBe(0);
  });

  it('clips a teaser to maxLines', () => {
    const led = ledger([{ lines: 50, leadLines: 0 }]);
    const r = packColumn(100, cursorAt('a'), led, { maxLines: 6 });
    expect(r.usedLines).toBe(6);
    expect(r.finished).toBe(false);
  });

  it('reports the last block a slice actually touches', () => {
    const led = ledger([{ lines: 3, leadLines: 0 }, { lines: 3 }]);
    const r = packColumn(100, cursorAt('a'), led, {});
    expect(lastBlockOf(r.slice!)).toBe(1);
  });

  it('always terminates across a spread of capacities and shapes', () => {
    const shapes: Spec[][] = [
      [{ lines: 1 }],
      [{ lines: 60 }],
      [{ lines: 3, keepWithNext: true }, { lines: 40 }],
      [{ lines: 12, atomic: true, kind: 'figure' }, { lines: 25 }],
      [{ lines: 2 }, { lines: 2 }, { lines: 2 }, { lines: 2 }, { lines: 2 }],
      [{ lines: 30, atomic: true, kind: 'pullquote' }],
    ];
    for (const shape of shapes) {
      for (const capacity of [3, 5, 8, 13, 21, 34, 55]) {
        const led = ledger(shape);
        expect(() => flow(led, capacity)).not.toThrow();
      }
    }
  });

  it('conserves every line of every block across an arbitrary flow', () => {
    const led = ledger([
      { lines: 3, leadLines: 0, keepWithNext: true },
      { lines: 18 },
      { lines: 6, atomic: true, kind: 'figure' },
      { lines: 24 },
      { lines: 9 },
    ]);
    const bodyLines = led.blocks.reduce((n, b) => n + b.lines, 0);
    let cursor = cursorAt('a');
    let placed = 0;
    while (!atEnd(cursor, led)) {
      const r = packColumn(11, cursor, led, {});
      const slice = r.slice!;
      // Leads are layout, not content; count only the block lines placed.
      const spanned = led.blocks
        .slice(slice.fromBlock, lastBlockOf(slice) + 1)
        .reduce((n, b, i) => {
          const isFirst = i === 0;
          const isLast = slice.fromBlock + i === lastBlockOf(slice);
          const start = isFirst ? slice.fromLine : 0;
          const end = isLast && slice.toLine > 0 ? slice.toLine : b.lines;
          return n + (end - start);
        }, 0);
      placed += spanned;
      cursor = r.cursor;
    }
    expect(placed).toBe(bodyLines);
  });
});

describe('keep-with-previous', () => {
  it('moves a credit line and the paragraph it credits together', () => {
    // 10 lines of story, then a 2-line credit, into a 12-line column: the
    // story fits but the credit does not, so both should defer.
    const led = ledger([
      { lines: 4, leadLines: 0 },
      { lines: 10, leadLines: 1 },
      { lines: 2, leadLines: 1, atomic: true, keepWithPrevious: true },
    ]);
    const r = packColumn(16, cursorAt('a'), led, {});
    expect(r.cursor.blockIndex).toBe(1); // stopped before the story
    expect(r.finished).toBe(false);
  });

  it('does not defer when the pair could never fit a column anyway', () => {
    const led = ledger([
      { lines: 4, leadLines: 0 },
      { lines: 30, leadLines: 1 },
      { lines: 2, leadLines: 1, atomic: true, keepWithPrevious: true },
    ]);
    // The 30-line block cannot share a column with the credit at any capacity
    // here, so deferring for ever is not an option — it must make progress.
    const r = packColumn(20, cursorAt('a'), led, {});
    expect(r.usedLines).toBeGreaterThan(0);
  });

  it('still places a credit that fits alongside its story', () => {
    const led = ledger([
      { lines: 6, leadLines: 0 },
      { lines: 2, leadLines: 1, atomic: true, keepWithPrevious: true },
    ]);
    const r = packColumn(40, cursorAt('a'), led, {});
    expect(r.finished).toBe(true);
  });
});

describe('the oversized-block escape hatch', () => {
  const oversized = (): LineLedger =>
    ledger([{ lines: 40, atomic: true, kind: 'figure', leadLines: 0 }]);

  it('force-places into an empty column so the planner cannot deadlock', () => {
    const r = packColumn(20, cursorAt('a'), oversized(), { columnIsEmpty: true });
    expect(r.overflowed).toBe(true);
    expect(r.finished).toBe(true);
  });

  it('defers instead of overrunning a column that already has content', () => {
    // This is the real-world case: an earlier article filled part of the
    // column, so spending more than the remaining budget silently overflows
    // the page box.
    const r = packColumn(12, cursorAt('a'), oversized(), { columnIsEmpty: false });
    expect(r.slice).toBeNull();
    expect(r.usedLines).toBe(0);
    expect(r.overflowed).toBe(false);
  });

  it('never returns more lines than the budget for a non-empty column', () => {
    const shapes: Spec[][] = [
      [{ lines: 40, atomic: true, kind: 'figure', leadLines: 0 }],
      [{ lines: 60, leadLines: 0 }],
      [{ lines: 30, atomic: true, kind: 'pullquote', leadLines: 0 }, { lines: 9 }],
    ];
    for (const shape of shapes) {
      for (const capacity of [1, 2, 5, 9, 12, 20]) {
        const r = packColumn(capacity, cursorAt('a'), ledger(shape), {
          columnIsEmpty: false,
        });
        expect(r.usedLines).toBeLessThanOrEqual(capacity);
      }
    }
  });

  it('respects the jump reservation as part of the budget', () => {
    const r = packColumn(10, cursorAt('a'), ledger([{ lines: 40, leadLines: 0 }]), {
      isPageFinalColumn: true,
      columnIsEmpty: false,
    });
    expect(r.usedLines).toBeLessThanOrEqual(10 - 1);
  });
});
