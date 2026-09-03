/**
 * The planner: articles + ledgers + geometry → an ordered set of pages.
 *
 * Pure, like the packer. It never touches the DOM and never measures; every
 * height it needs was measured once and handed to it. That is what makes a
 * repack after a height-only viewport change cost single-digit milliseconds.
 *
 * The front page is composed from a template whose areas span whole numbers of
 * base columns. That is not a cosmetic choice: it keeps every internal text
 * column at the same measure, so one ledger per article serves the front page
 * and every continuation, and a story can flow from a wide area to a narrow one
 * without being re-measured.
 */

import type {
  ArticleId,
  ColumnFill,
  Cursor,
  GridMetrics,
  JumpLine,
  LineLedger,
  ParsedArticle,
  SectionId,
  SliceRef,
} from '../model/types';
import { JUMP_LINES, cursorAt, openingLines, packColumn } from './packer';

/** Reserved at the foot of every page for the folio and its rule. */
const FOLIO_LINES = 2;
/** Height of a section rule, in baselines. */
const SECTION_RULE_LINES = 2;

/**
 * Slice sentinels. A column carries furniture as well as body copy, and these
 * mark the two kinds that do not point into block space.
 */
export const HEAD_SLICE = -2;
export const SECTION_SLICE = -1;

export interface Band {
  kind: 'masthead' | 'head' | 'section';
  articleId?: ArticleId;
  sectionId?: SectionId;
  label?: string;
  /** True when this head is set across the band rather than one column. */
  lead?: boolean;
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface PagePlan {
  index: number;
  folio: number;
  templateId: string;
  bands: Band[];
  columns: ColumnFill[];
  jumps: JumpLine[];
  /** The first content position on this page. Drives anchor restoration. */
  topAnchor: Cursor | null;
  sections: SectionId[];
}

export interface EditionPlan {
  pages: PagePlan[];
  byArticle: Map<ArticleId, { startPage: number; pages: number[] }>;
  bySection: Map<SectionId, Cursor>;
  /** Page index holding a cursor. Binary search; topAnchor is monotonic. */
  anchorToPage(anchor: Cursor): number;
  overflows: ArticleId[];
}

export interface PlanInput {
  order: ParsedArticle[];
  ledgers: Map<ArticleId, LineLedger>;
  headLines: Map<ArticleId, number>;
  /** Head height when set across the whole type block, for the lead only. */
  leadHeadLines: number;
  mastheadLines: number;
  sectionOf: Map<ArticleId, SectionId>;
  sectionNames: Map<SectionId, string>;
  grid: GridMetrics;
}

interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Slice one band into `count` base-width columns. */
function columnsIn(area: Rect, count: number, grid: GridMetrics): Rect[] {
  const out: Rect[] = [];
  for (let i = 0; i < count; i++) {
    out.push({
      x: area.x + i * (grid.colW + grid.gutter),
      y: area.y,
      w: grid.colW,
      h: area.h,
    });
  }
  return out;
}

/** A work item: an article, and how far into it we have got. */
interface Pending {
  article: ParsedArticle;
  cursor: Cursor;
  /** Head furniture still to place (false once the story has started). */
  needsHead: boolean;
  /** Page the story began on, for the "continued from" slug. */
  startedOnPage: number;
}

export function planEdition(input: PlanInput): EditionPlan {
  const { grid, ledgers, headLines } = input;
  const lh = grid.lineHeight;

  const typeBlock: Rect = {
    x: grid.margins.l,
    y: grid.margins.t,
    w: grid.pageW - grid.margins.l - grid.margins.r,
    h: grid.pageH - grid.margins.t - grid.margins.b,
  };

  const work: Pending[] = input.order
    .filter((a) => ledgers.has(a.id))
    .map((article) => ({
      article,
      cursor: cursorAt(article.id),
      needsHead: true,
      startedOnPage: -1,
    }));

  const pages: PagePlan[] = [];
  const byArticle = new Map<ArticleId, { startPage: number; pages: number[] }>();
  const bySection = new Map<SectionId, Cursor>();
  const overflows: ArticleId[] = [];
  const seenSections = new Set<SectionId>();

  const note = (id: ArticleId, page: number) => {
    const entry = byArticle.get(id);
    if (!entry) {
      byArticle.set(id, { startPage: page, pages: [page] });
    } else if (!entry.pages.includes(page)) {
      entry.pages.push(page);
    }
  };

  let guard = 0;
  while (work.length > 0 && guard++ < 500) {
    const pageIndex = pages.length;
    const isFront = pageIndex === 0;
    const bands: Band[] = [];
    const columns: ColumnFill[] = [];
    const jumps: JumpLine[] = [];
    const sections: SectionId[] = [];
    let topAnchor: Cursor | null = null;

    let y = typeBlock.y;
    let remainingH = typeBlock.h - FOLIO_LINES * lh;

    if (isFront) {
      bands.push({
        kind: 'masthead',
        x: typeBlock.x,
        y,
        w: typeBlock.w,
        h: input.mastheadLines * lh,
      });
      y += input.mastheadLines * lh;
      remainingH -= input.mastheadLines * lh;

      // The lead's head is set across the full type block. This is the one
      // place a different measure is used, and it is safe because head
      // furniture is not part of block space — no cursor points into it.
      const lead = work[0];
      if (lead && lead.needsHead) {
        bands.push({
          kind: 'head',
          articleId: lead.article.id,
          lead: true,
          x: typeBlock.x,
          y,
          w: typeBlock.w,
          h: input.leadHeadLines * lh,
        });
        y += input.leadHeadLines * lh;
        remainingH -= input.leadHeadLines * lh;
        lead.needsHead = false;
        lead.startedOnPage = pageIndex;
        note(lead.article.id, pageIndex);

        // The lead skips the in-column head path entirely, so its section
        // would otherwise still look unseen and print a rule further in.
        const leadSection = input.sectionOf.get(lead.article.id);
        if (leadSection !== undefined) {
          seenSections.add(leadSection);
          sections.push(leadSection);
          bySection.set(leadSection, { ...lead.cursor });
        }
      }
    }

    const rects = columnsIn(
      { x: typeBlock.x, y, w: typeBlock.w, h: Math.max(lh, remainingH) },
      grid.cols,
      grid,
    );

    for (let colIndex = 0; colIndex < rects.length; colIndex++) {
      const rect = rects[colIndex]!;
      const column: ColumnFill = {
        regionId: isFront ? 'front' : 'flow',
        colIndex,
        x: rect.x,
        y: rect.y,
        w: rect.w,
        h: rect.h,
        items: [],
      };
      columns.push(column);

      // The 1px epsilon absorbs fractional heights some engines report.
      let capacity = Math.floor((rect.h - 1) / lh);
      const isFinalColumn = colIndex === rects.length - 1;

      while (capacity > 0 && work.length > 0) {
        const pending = work[0]!;
        const ledger = ledgers.get(pending.article.id)!;

        // A section rule and the headline beneath it are a single unit. Both
        // must be committed together or neither: emitting the rule first and
        // then discovering the headline does not fit strands the rule at the
        // foot of a column, under nothing.
        const sectionId = input.sectionOf.get(pending.article.id);
        const needsRule =
          sectionId !== undefined && !seenSections.has(sectionId) && pending.needsHead;
        const ruleLines = needsRule ? SECTION_RULE_LINES : 0;

        // Head furniture is charged before any body lines, plus the least the
        // packer will accept of the story — a drop-cap paragraph comes whole,
        // a plate comes whole — and the jump line the packer reserves in a
        // final column, so a headline is never left stranded above nothing.
        if (pending.needsHead) {
          const head = headLines.get(pending.article.id) ?? 2;
          const reserve = isFinalColumn ? JUMP_LINES : 0;
          if (ruleLines + head + openingLines(ledger) + reserve > capacity) break;

          if (needsRule && sectionId !== undefined) {
            seenSections.add(sectionId);
            sections.push(sectionId);
            bySection.set(sectionId, { ...pending.cursor });
            column.items.push({
              articleId: `§${sectionId}`,
              fromBlock: SECTION_SLICE,
              fromLine: 0,
              toBlock: SECTION_SLICE,
              toLine: 0,
              heightLines: ruleLines,
              isArticleStart: false,
              isArticleEnd: false,
            });
            capacity -= ruleLines;
          }
          column.items.push({
            articleId: pending.article.id,
            fromBlock: HEAD_SLICE, // furniture, not block space
            fromLine: 0,
            toBlock: HEAD_SLICE,
            toLine: 0,
            heightLines: head,
            isArticleStart: true,
            isArticleEnd: false,
          });
          capacity -= head;
          pending.needsHead = false;
          pending.startedOnPage = pageIndex;
          note(pending.article.id, pageIndex);
        }

        const before = pending.cursor;
        const result = packColumn(capacity, before, ledger, {
          isPageFinalColumn: isFinalColumn,
          columnIsEmpty: column.items.length === 0,
        });

        if (result.overflowed) overflows.push(pending.article.id);

        if (result.slice) {
          if (!topAnchor) topAnchor = { ...before };
          column.items.push(result.slice);
          capacity -= result.usedLines;
          note(pending.article.id, pageIndex);
        }

        if (result.finished) {
          work.shift();
          pending.cursor = result.cursor;
          continue; // the next story may still fit in this column
        }

        pending.cursor = result.cursor;

        if (!result.slice) break; // nothing fit here; try the next column

        if (isFinalColumn) {
          jumps.push({
            kind: 'to',
            articleId: pending.article.id,
            page: -1, // resolved once every page exists
            columnIndex: colIndex,
          });
        }
        break; // column is full
      }
    }

    // A page that placed nothing would loop forever. Only possible if every
    // remaining article is empty, in which case discard them.
    const placed = columns.some((c) => c.items.length > 0);
    if (!placed) {
      work.shift();
      continue;
    }

    pages.push({
      index: pageIndex,
      folio: pageIndex + 1,
      templateId: isFront ? 'front' : 'flow',
      bands,
      columns,
      jumps,
      topAnchor,
      sections,
    });
  }

  resolveJumps(pages, byArticle);

  return {
    pages,
    byArticle,
    bySection,
    overflows,
    anchorToPage: (anchor) => anchorToPage(pages, byArticle, anchor),
  };
}

/**
 * Fill in "continued on page N".
 *
 * Two-phase by necessity: the number depends on a page order that depends on
 * the slug's height. The height was reserved during packing (JUMP_LINES), so
 * this pass only writes text — and because the slug uses tabular figures in a
 * fixed slot, no number can change the line count that produced it.
 */
function resolveJumps(
  pages: PagePlan[],
  byArticle: Map<ArticleId, { startPage: number; pages: number[] }>,
): void {
  for (const page of pages) {
    for (const jump of page.jumps) {
      const entry = byArticle.get(jump.articleId);
      const next = entry?.pages.find((p) => p > page.index);
      // Store the printed folio, not the index. Readers count from one, and
      // nothing downstream should have to remember to add it.
      jump.page = next === undefined ? -1 : (pages[next]?.folio ?? next + 1);
    }
    // A reserved slug with nowhere to point is dropped; the reserved line
    // simply goes unused, which is invisible.
    page.jumps = page.jumps.filter((j) => j.page > 0);
  }
}

function compareCursor(a: Cursor, b: Cursor, order: Map<ArticleId, number>): number {
  const ai = order.get(a.articleId) ?? 0;
  const bi = order.get(b.articleId) ?? 0;
  if (ai !== bi) return ai - bi;
  if (a.blockIndex !== b.blockIndex) return a.blockIndex - b.blockIndex;
  return a.lineIndex - b.lineIndex;
}

function anchorToPage(
  pages: PagePlan[],
  byArticle: Map<ArticleId, { startPage: number; pages: number[] }>,
  anchor: Cursor,
): number {
  if (pages.length === 0) return 0;

  const order = new Map<ArticleId, number>();
  pages.forEach((page) => {
    for (const column of page.columns) {
      for (const item of column.items) {
        if (!order.has(item.articleId)) order.set(item.articleId, order.size);
      }
    }
  });

  // Pages are ordered and topAnchor is monotonic, so a binary search finds the
  // last page whose top is at or before the anchor.
  let lo = 0;
  let hi = pages.length - 1;
  let best = byArticle.get(anchor.articleId)?.startPage ?? 0;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const top = pages[mid]!.topAnchor;
    if (!top) {
      lo = mid + 1;
      continue;
    }
    if (compareCursor(top, anchor, order) <= 0) {
      best = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return best;
}

export function isHeadSlice(slice: SliceRef): boolean {
  return slice.fromBlock === HEAD_SLICE;
}

export function isSectionSlice(slice: SliceRef): boolean {
  return slice.fromBlock === SECTION_SLICE;
}

export function sectionIdOf(slice: SliceRef): SectionId {
  return slice.articleId.slice(1);
}
