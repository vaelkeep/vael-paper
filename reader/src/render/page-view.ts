/**
 * Render a planned page into DOM.
 *
 * Every fragment of body copy is produced the same way: clone the whole blocks
 * the slice spans out of the article's template, put them in a window of the
 * exact height the packer allotted, and shift the ribbon up by
 * `fromLine * lineHeight`. The paragraph is never re-broken — only masked — so
 * justification, hyphenation and drop-cap indents survive a page break intact.
 *
 * No measurement happens here. Every number this module writes came from the
 * plan, which is what lets a page be built mid-animation without risking a
 * visible relayout.
 */

import type { ColumnFill, GridMetrics, ImageAsset, ParsedArticle } from '../model/types';
import {
  isHeadSlice,
  isSectionSlice,
  sectionIdOf,
  type Band,
  type PagePlan,
} from '../layout/planner';
import { buildHead } from './ribbon';
import { h } from '../util/dom';

export interface RenderContext {
  grid: GridMetrics;
  templates: Map<string, HTMLTemplateElement>;
  articles: Map<string, ParsedArticle>;
  images: Record<string, ImageAsset>;
  sectionNames: Map<string, string>;
  masthead: (width: number, height: number) => HTMLElement;
  /** The paper's name, for the running head on interior pages. */
  mastheadName: string;
  /** Page a story started on, so a continuation can say where it came from. */
  startPageOf: (articleId: string) => number | undefined;
}

function sliceNode(
  slice: ColumnFill['items'][number],
  ctx: RenderContext,
  isFirstInColumn: boolean,
): HTMLElement | null {
  const lh = ctx.grid.lineHeight;

  if (isSectionSlice(slice)) {
    const id = sectionIdOf(slice);
    const rule = h('div', 'section-rule');
    rule.style.height = `${slice.heightLines * lh}px`;
    rule.append(h('span', 'section-rule__name', ctx.sectionNames.get(id) ?? id));
    rule.append(h('span', 'section-rule__fill'));
    return rule;
  }

  const article = ctx.articles.get(slice.articleId);
  if (!article) return null;

  if (isHeadSlice(slice)) {
    const head = buildHead(article, {
      lineHeight: lh,
      colW: ctx.grid.colW,
      maxFigureLines: ctx.grid.maxFigureLines,
      images: ctx.images,
    });
    head.style.height = `${slice.heightLines * lh}px`;
    return head;
  }

  const template = ctx.templates.get(slice.articleId);
  if (!template) return null;

  const window_ = h('div', 'slice');
  window_.style.height = `${slice.heightLines * lh}px`;

  const ribbon = h('div', 'ribbon');
  ribbon.dataset.article = slice.articleId;
  // The lead of the first block in a column was never charged by the packer,
  // so it must not be painted either. This pairing is what keeps slices from
  // drifting by one lead per column.
  if (isFirstInColumn || slice.fromLine > 0) ribbon.classList.add('slice-head');
  const source = template.content.firstElementChild!;

  // A table continued from the previous column gets its heading row again,
  // drawn over the top of the window while the rows sit below it. The packer
  // charged for these lines, so the slice's height already includes them.
  const headLines = slice.headLines ?? 0;
  if (headLines > 0) {
    const block = source.children[slice.fromBlock];
    const table = block?.querySelector('table');
    if (table) {
      const repeat = table.cloneNode(true) as HTMLElement;
      repeat.querySelector('tbody')?.remove();
      const head = h('div', 'slice__head');
      head.style.height = `${headLines * lh}px`;
      head.append(repeat);
      window_.append(head);
    }
  }
  ribbon.style.setProperty('--slice-offset', `${(headLines - slice.fromLine) * lh}px`);

  const lastBlock = slice.toLine > 0 ? slice.toBlock : slice.toBlock - 1;
  for (let i = slice.fromBlock; i <= lastBlock; i++) {
    const node = source.children[i];
    if (node) ribbon.append(node.cloneNode(true));
  }

  window_.append(ribbon);
  return window_;
}

function columnNode(column: ColumnFill, ctx: RenderContext): HTMLElement {
  const node = h('div', 'col');
  node.style.left = `${column.x}px`;
  node.style.top = `${column.y}px`;
  node.style.width = `${column.w}px`;
  node.style.height = `${column.h}px`;
  node.dataset.col = String(column.colIndex);

  column.items.forEach((slice, i) => {
    const child = sliceNode(slice, ctx, i === 0);
    if (child) node.append(child);
  });

  return node;
}

function bandNode(band: Band, ctx: RenderContext): HTMLElement | null {
  const node = h('div', `band band--${band.kind}`);
  node.style.left = `${band.x}px`;
  node.style.top = `${band.y}px`;
  node.style.width = `${band.w}px`;
  node.style.height = `${band.h}px`;

  if (band.kind === 'masthead') {
    node.append(ctx.masthead(band.w, ctx.grid.pageH));
    return node;
  }
  if (band.kind === 'head' && band.articleId) {
    const article = ctx.articles.get(band.articleId);
    if (!article) return null;
    node.append(
      buildHead(article, {
        lineHeight: ctx.grid.lineHeight,
        colW: band.w,
        maxFigureLines: ctx.grid.maxFigureLines,
        images: ctx.images,
        lead: band.lead ?? false,
      }),
    );
    return node;
  }
  return null;
}

function folioNode(page: PagePlan, ctx: RenderContext, dateLabel: string): HTMLElement {
  const { grid } = ctx;
  const node = h('div', 'folio');
  node.style.left = `${grid.margins.l}px`;
  node.style.right = `${grid.margins.r}px`;
  node.style.bottom = `${Math.round(grid.margins.b / 2)}px`;
  node.style.width = `${grid.pageW - grid.margins.l - grid.margins.r}px`;

  const left = h('span', undefined, page.index === 0 ? dateLabel : ctx.mastheadName);
  const right = h('span', undefined, String(page.folio));
  node.append(left, right);
  return node;
}

/** Jump slugs sit at the foot of the column whose story runs on. */
function jumpNodes(page: PagePlan, ctx: RenderContext): HTMLElement[] {
  const lh = ctx.grid.lineHeight;
  return page.jumps.map((jump) => {
    const column = page.columns[jump.columnIndex];
    const node = h('p', 'jump-line', `Continued on page ${jump.page}`);
    if (column) {
      node.style.left = `${column.x}px`;
      node.style.width = `${column.w}px`;
      node.style.top = `${column.y + column.h - lh}px`;
    }
    return node;
  });
}

export function renderPage(
  page: PagePlan,
  ctx: RenderContext,
  dateLabel: string,
): HTMLElement {
  const node = h('div', 'page');
  node.dataset.page = String(page.index);
  node.style.width = `${ctx.grid.pageW}px`;
  node.style.height = `${ctx.grid.pageH}px`;

  for (const band of page.bands) {
    const child = bandNode(band, ctx);
    if (child) node.append(child);
  }
  for (const column of page.columns) {
    node.append(columnNode(column, ctx));
  }
  for (const jump of jumpNodes(page, ctx)) {
    node.append(jump);
  }
  node.append(folioNode(page, ctx, dateLabel));

  return node;
}
