/**
 * The packer: fill one column from one article's ledger.
 *
 * PURE. No DOM, no measurement, no side effects — give it the same ledger and
 * the same capacity and it returns the same plan. That is what makes it cheap
 * enough to run on every relayout, and testable without a browser.
 *
 * Everything here is integer arithmetic over baselines. There are no pixels in
 * this file, and there should never be any: the moment a float enters, the
 * cross-browser guarantees of the baseline grid go with it.
 */

import type { Cursor, LineLedger, SliceRef } from '../model/types';

/** Never leave fewer than this many lines of a paragraph at a column foot. */
export const ORPHAN_MIN = 2;
/** Never push fewer than this many lines of a paragraph to the next column. */
export const WIDOW_MIN = 2;
/** Space reserved for a "Continued on page N" slug. */
export const JUMP_LINES = 1;

export interface PackOptions {
  /** Reserve room for a jump line if the article will not finish here. */
  isPageFinalColumn?: boolean;
  /**
   * Set when this region's measure differs from the one the cursor was
   * produced at. A line index is not transferable across widths, but a block
   * index is, so entry must be at a block boundary.
   */
  blockBreakOnly?: boolean;
  /** Teaser regions take a fixed number of lines and stop. */
  maxLines?: number;
  /**
   * Whether the column is empty *before* this call. A column is filled by
   * several calls in sequence — one per article — so "this call has placed
   * nothing" is not the same question as "there is nothing in the column", and
   * the oversized-block escape hatch below depends on the latter. Defaults to
   * true so a standalone call behaves as if it owns the column.
   */
  columnIsEmpty?: boolean;
}

export interface PackResult {
  /** Where the article got to. Compare with the input to detect no progress. */
  cursor: Cursor;
  /** The contiguous run placed in this column, if any. */
  slice: SliceRef | null;
  /** Baselines consumed, including leads. */
  usedLines: number;
  /** True when the article ran out of blocks — nothing left to continue. */
  finished: boolean;
  /**
   * Set when a single atomic block was larger than an entire empty column and
   * had to be force-placed. The planner surfaces this as a printer's mark
   * rather than looping forever trying to fit it.
   */
  overflowed: boolean;
}

export function atEnd(cursor: Cursor, ledger: LineLedger): boolean {
  return cursor.blockIndex >= ledger.blocks.length;
}

export function cursorAt(articleId: string): Cursor {
  return { articleId, blockIndex: 0, lineIndex: 0 };
}

export function sameCursor(a: Cursor, b: Cursor): boolean {
  return (
    a.articleId === b.articleId &&
    a.blockIndex === b.blockIndex &&
    a.lineIndex === b.lineIndex
  );
}

/** Total baselines an article occupies. Used for template fitting heuristics. */
export function totalLines(ledger: LineLedger): number {
  return ledger.totalLines;
}

export function packColumn(
  capacityLines: number,
  start: Cursor,
  ledger: LineLedger,
  options: PackOptions = {},
): PackResult {
  const blocks = ledger.blocks;
  let cap = Math.max(0, Math.floor(capacityLines));
  if (options.maxLines !== undefined) cap = Math.min(cap, options.maxLines);

  // The jump line has to be paid for before we know whether the article will
  // actually continue, so reserve it and hand it back if the story finishes
  // inside this column. Resolving the number itself happens later, once the
  // page order exists — see planner.resolveJumps.
  const reserve = options.isPageFinalColumn ? JUMP_LINES : 0;
  const budget = Math.max(0, cap - reserve);

  let cursor: Cursor = { ...start };
  let used = 0;
  let emitted = 0;
  let overflowed = false;
  let fitted = false;
  // The escape hatch may only fire into a genuinely empty column; otherwise it
  // would overrun a budget already partly spent by an earlier call.
  const canOverrun = options.columnIsEmpty !== false;

  const from = { blockIndex: cursor.blockIndex, lineIndex: cursor.lineIndex };
  // A slice that opens inside a table's rows repeats the heading above them.
  const first = blocks[from.blockIndex];
  const headLines =
    first?.head && !first.atomic && from.lineIndex >= first.head.bodyStart ? first.head.lines : 0;

  while (cursor.blockIndex < blocks.length) {
    const block = blocks[cursor.blockIndex]!;

    // A block's lead is the gap above it. The first block placed in a column
    // has that margin suppressed in the DOM (`.ribbon.slice-head`), so it must
    // not be charged here either — this is the pairing that keeps slices from
    // drifting by one lead per column.
    const lead = cursor.lineIndex === 0 && emitted > 0 ? block.leadLines : 0;
    const remaining = budget - used;

    // ---- atomic: figures, pull quotes, rules. Placed whole or not at all.
    if (block.atomic) {
      if (lead + block.lines > remaining) {
        if (canOverrun && emitted === 0 && block.lines > budget) {
          if (block.kind === 'figure' && budget >= 3) {
            // A plate taller than the column that opens it — the usual case
            // being the front-page lead, whose band is short. Crop it to the
            // column rather than let it run over the jump line; the renderer
            // gives the frame whatever the caption leaves.
            used += budget;
            emitted += 1;
            fitted = true;
            cursor = { ...cursor, blockIndex: cursor.blockIndex + 1, lineIndex: 0 };
            break;
          }
          // Larger than an entire empty column. Place it anyway; the column
          // clips it. Refusing would deadlock the planner on this cursor.
          used += block.lines;
          emitted += 1;
          overflowed = true;
          cursor = { ...cursor, blockIndex: cursor.blockIndex + 1, lineIndex: 0 };
          continue;
        }
        break;
      }
      used += lead + block.lines;
      emitted += 1;
      cursor = { ...cursor, blockIndex: cursor.blockIndex + 1, lineIndex: 0 };
      continue;
    }

    // ---- entering a fresh region at a different measure: block boundary only
    if (options.blockBreakOnly && cursor.lineIndex !== 0) break;

    // Entering a table among its rows costs the repeated heading first.
    const entering = cursor.blockIndex === from.blockIndex ? headLines : 0;
    const availableInBlock = block.lines - cursor.lineIndex;
    let take = Math.min(availableInBlock, Math.max(0, remaining - lead - entering));
    let rest = availableInBlock - take;

    if (take > 0 && rest > 0 && take < ORPHAN_MIN) {
      take = 0; // too few lines to strand at the foot
      rest = availableInBlock;
    }
    // A table's label and heading with no rows beneath them is a heading
    // stranded at the foot; the rows must come along or the table moves.
    if (
      block.head &&
      cursor.lineIndex === 0 &&
      take > 0 &&
      rest > 0 &&
      take < block.head.bodyStart + ORPHAN_MIN
    ) {
      take = 0;
      rest = availableInBlock;
    }
    if (take > 0 && rest > 0 && rest < WIDOW_MIN) {
      take -= WIDOW_MIN - rest; // pull lines back so the remainder is readable
      rest = availableInBlock - take;
    }

    if (take <= 0) {
      if (canOverrun && emitted === 0 && availableInBlock > budget) {
        // A single paragraph taller than the column. Take what fits rather
        // than stalling; the continuation picks up from the exact line.
        take = Math.max(1, budget - lead - entering);
      } else {
        break;
      }
    }

    // ---- keep-with-next: a headline or deck must not sit alone at the foot
    if (block.keepWithNext && take === availableInBlock) {
      const next = blocks[cursor.blockIndex + 1];
      const need = next ? next.leadLines + Math.min(next.lines, ORPHAN_MIN) : 0;
      if (used + lead + entering + take + need > budget && emitted > 0) break;
    }

    // ---- keep-with-previous: a credit line must not begin a column alone.
    // If this block finishes here but the credit that follows will not fit,
    // move both to the next column together — but only when they would
    // actually fit there, otherwise we would defer for ever.
    const following = blocks[cursor.blockIndex + 1];
    if (
      following?.keepWithPrevious &&
      take === availableInBlock &&
      emitted > 0 &&
      !options.blockBreakOnly
    ) {
      const need = following.leadLines + following.lines;
      const fitsHere = used + lead + entering + take + need <= budget;
      const fitsAlone = block.lines + need <= budget;
      if (!fitsHere && fitsAlone) break;
    }

    used += lead + entering + take;
    emitted += 1;

    const consumed = cursor.lineIndex + take;
    cursor =
      consumed >= block.lines
        ? { ...cursor, blockIndex: cursor.blockIndex + 1, lineIndex: 0 }
        : { ...cursor, lineIndex: consumed };

    if (cursor.lineIndex !== 0) break; // column filled mid-paragraph
  }

  const finished = cursor.blockIndex >= blocks.length;

  if (emitted === 0) {
    return { cursor, slice: null, usedLines: 0, finished, overflowed };
  }

  const slice: SliceRef = {
    articleId: ledger.key.articleId,
    fromBlock: from.blockIndex,
    fromLine: from.lineIndex,
    toBlock: cursor.blockIndex,
    toLine: cursor.lineIndex,
    heightLines: used,
    isArticleStart: from.blockIndex === 0 && from.lineIndex === 0,
    isArticleEnd: finished,
    ...(headLines > 0 ? { headLines } : {}),
    ...(fitted ? { fitted: true } : {}),
  };

  return { cursor, slice, usedLines: used, finished, overflowed };
}

/**
 * The last block a slice touches. Rendering clones `fromBlock..lastBlock`
 * inclusive; when a slice ends exactly on a block boundary `toBlock` already
 * points past the run.
 */
export function lastBlockOf(slice: SliceRef): number {
  return slice.toLine > 0 ? slice.toBlock : slice.toBlock - 1;
}
