/**
 * Builds the DOM for one article.
 *
 * This is the only place article DOM is constructed. The measuring pass and
 * every rendered fragment clone from the same template, at the same width, so
 * measured layout and rendered layout are identical by construction — the
 * property the whole pagination design rests on. If you find yourself building
 * article markup anywhere else, that guarantee is gone.
 *
 * Head furniture (headline, deck, byline) is built *separately* from the body
 * ribbon, and deliberately so. A ribbon's children map one-to-one onto
 * `article.blocks`, which means a cursor's `blockIndex` means the same thing in
 * the parser, the ledger, the packer and the renderer. It also frees the head
 * to be set at a different width from the body — exactly what a front-page lead
 * needs, and impossible if the two are one flow.
 */

import type { Block, ImageAsset, ParsedArticle } from '../model/types';

export interface RibbonOptions {
  /** Baseline unit in px. Figure heights are snapped to a multiple of it. */
  lineHeight: number;
  /** Rendered width of the column this ribbon is measured at. */
  colW: number;
  /** Tallest a figure may be, in baselines. A figure is atomic, so one taller
   *  than its column cannot be broken and would overflow the page. */
  maxFigureLines: number;
  images: Record<string, ImageAsset>;
}

export interface HeadOptions extends RibbonOptions {
  /** Lead stories take the larger, centred headline treatment. */
  lead?: boolean;
  /** A continuation prints a "continued from" slug instead of the headline. */
  continuedFrom?: number;
}

function el(tag: string, className?: string, html?: string): HTMLElement {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (html !== undefined) node.innerHTML = html;
  return node;
}

/**
 * Reserve an integer number of baselines for a figure.
 *
 * Space must be committed before the image loads: a late-arriving intrinsic
 * size would invalidate the ledger the layout was computed from. The aspect
 * comes from the manifest, which the server computed at scan time, so this is
 * knowable with zero network work.
 */
export function figureHeight(
  asset: ImageAsset,
  colW: number,
  lh: number,
  maxLines: number,
): number {
  const natural = colW * asset.aspect;
  const capped = Math.min(natural, lh * maxLines);
  return Math.max(lh * 2, Math.min(Math.ceil(capped / lh) * lh, lh * maxLines));
}

function buildFigure(block: Extract<Block, { kind: 'figure' }>, o: RibbonOptions) {
  const asset = o.images[block.imageKey];
  if (!asset) return null;

  const fig = el('figure', 'figure');
  fig.dataset.atomic = '';

  const frame = el('div', 'figure__frame');
  frame.style.height = `${figureHeight(asset, o.colW, o.lineHeight, o.maxFigureLines)}px`;
  // Deliberately no dominant-colour placeholder: the plate is composited with
  // `mix-blend-mode`, so anything painted behind it tints the image. The frame
  // reserves the box and paints a theme-correct ground, which is all the
  // placeholder was needed for.

  const img = el('img') as HTMLImageElement;
  // A tall photograph in a column is always cropped, so where it is held
  // matters more than it does for line art. Faces sit above centre far more
  // often than below it, hence the default.
  img.dataset.focus = block.focus ?? 'center';
  img.dataset.tone = asset.is_photo ? 'photo' : 'plate';
  img.src = asset.src;
  img.width = asset.w;
  img.height = asset.h;
  img.alt = block.caption ?? '';
  img.loading = 'lazy';
  img.decoding = 'async';
  frame.append(img);
  fig.append(frame);

  if (block.caption) fig.append(el('figcaption', 'figure__caption', block.caption));
  return fig;
}

/** Visible length of a cell, ignoring the markup inside it. */
function textLength(html: string): number {
  return html.replace(/<[^>]+>/g, '').replace(/&[a-z]+;/gi, 'x').length;
}

/**
 * A table, set as newspaper agate.
 *
 * Deliberately *not* atomic. A market table is often longer than a column, and
 * a table that cannot break is a table that gets clipped. Because every row is
 * exactly one baseline tall, the packer's ordinary line arithmetic splits it at
 * a row boundary for free, and the renderer's clip lands between rows.
 *
 * The one thing that costs: a continuation carries no repeated header, since
 * `display: table-header-group` only repeats in paged media, not in a clipped
 * box. Column headings are therefore kept terse enough to be inferable, and a
 * long table is better split into labelled shorter ones.
 */
function buildTable(block: Extract<Block, { kind: 'table' }>): HTMLElement {
  const wrap = el('div', 'table-block');

  if (block.label) wrap.append(el('p', 'table-block__label', block.label));

  const table = el('table', 'agate') as HTMLTableElement;

  // Column widths, computed from the widest cell in each column.
  //
  // `table-layout: fixed` is what actually keeps the table inside its column:
  // with `auto`, cells that must not wrap size the table to their content, and
  // a five-column table quietly grows wider than the page. Fixed layout honours
  // `width: 100%` unconditionally.
  //
  // Columns come in two kinds. A *numeric* column (prices, times, step counts)
  // is given exactly the space its longest value needs, in `ch`, which for the
  // tabular figures used here is exactly one digit. The *text* columns then
  // share whatever is left, in proportion to their longest entries, and
  // truncate with an ellipsis when the column is narrow. A share table has one
  // text column, the company name, so it takes all the slack; a schedule with
  // a day, a description and a place splits it three ways rather than letting
  // the last column push the first off the edge.
  //
  // Headers are set in letterspaced small caps, so they occupy a little more
  // than one `ch` per character. Measured against the real headers in this
  // face: the widest ("Change", "Company") need 1.12, so 1.15 covers them with
  // a little slack. Do not raise it further — every extra ch here is taken
  // from the text columns, which is where the words live.
  const HEADER_WIDTH_FACTOR = 1.15;
  // A bold total row runs about a tenth wider than the figures above it.
  const BOLD_WIDTH_FACTOR = 1.12;
  const NUMERIC = /^[\s\d.,:%+\u2212()$€£/·✓—-]*(?:am|pm)?$/i;
  const plain = (html: string) => html.replace(/<[^>]+>/g, '').trim();
  const cellWidth = (html: string) =>
    Math.ceil(textLength(html) * (/<(strong|b)>/.test(html) ? BOLD_WIDTH_FACTOR : 1));
  const widest = block.align.map((_, i) =>
    Math.max(
      block.head[i] ? Math.ceil(textLength(block.head[i]!) * HEADER_WIDTH_FACTOR) : 0,
      ...block.rows.map((r) => cellWidth(r[i] ?? '')),
    ),
  );
  const numeric = block.align.map(
    (_, i) => i > 0 && block.rows.every((r) => NUMERIC.test(plain(r[i] ?? ''))),
  );
  const fixedCh = widest.reduce((sum, chars, i) => sum + (numeric[i] ? chars : 0), 0);
  const fixedCount = numeric.filter(Boolean).length;
  const textTotal = widest.reduce((sum, chars, i) => sum + (numeric[i] ? 0 : chars), 0);
  const group = el('colgroup');
  widest.forEach((chars, i) => {
    const colEl = el('col');
    if (numeric[i]) {
      colEl.style.width = `calc(${chars}ch + 0.6em)`;
    } else if (textTotal > 0) {
      const share = (chars / textTotal).toFixed(3);
      colEl.style.width = `calc((100% - ${fixedCh}ch - ${(fixedCount * 0.6).toFixed(1)}em) * ${share})`;
    }
    group.append(colEl);
  });
  table.append(group);

  if (block.head.length > 0) {
    const thead = el('thead');
    const tr = el('tr');
    block.head.forEach((cell, i) => {
      const th = el('th', undefined, cell);
      th.style.textAlign = block.align[i] ?? 'left';
      tr.append(th);
    });
    thead.append(tr);
    table.append(thead);
  }

  const tbody = el('tbody');
  for (const row of block.rows) {
    const tr = el('tr');
    row.forEach((cell, i) => {
      const td = el('td', undefined, cell);
      td.style.textAlign = block.align[i] ?? 'left';
      // A leading minus or parenthesis marks a decline; papers set those apart.
      if (/^[(−-]/.test(cell.replace(/<[^>]+>/g, '').trim())) {
        td.classList.add('is-down');
      }
      tr.append(td);
    });
    tbody.append(tr);
  }
  table.append(tbody);
  wrap.append(table);
  return wrap;
}

/**
 * The credit line closing a summarised story.
 *
 * A paper of machine-written summaries owes its reader the provenance of each
 * one, and owes it *honestly*: the publisher is named and the domain shown, so
 * following a link holds no surprises. Set as a rule-topped footer, in the
 * manner of a wire credit.
 */
function buildSources(block: Extract<Block, { kind: 'sources' }>): HTMLElement {
  const wrap = el('div', 'source-line');
  wrap.dataset.atomic = '';
  // A credit belongs to its story. Without this it can begin a column on its
  // own, orphaned from the piece it credits.
  wrap.dataset.keepWithPrevious = '';

  wrap.append(
    el('span', 'source-line__label', block.sources.length > 1 ? 'Sources' : 'Source'),
  );

  const list = el('span', 'source-line__items');
  block.sources.forEach((source, i) => {
    if (i > 0) list.append(document.createTextNode(' · '));
    const label = source.title ? `${source.name}: ${source.title}` : source.name;
    if (source.url) {
      const a = el('a', 'source-line__link') as HTMLAnchorElement;
      a.href = source.url;
      a.target = '_blank';
      a.rel = 'noreferrer noopener';
      a.textContent = label;
      list.append(a);
    } else {
      list.append(el('span', 'source-line__name', label));
    }
  });
  wrap.append(list);
  return wrap;
}

function buildBlock(block: Block, o: RibbonOptions): HTMLElement | null {
  switch (block.kind) {
    case 'heading': {
      const node = el(`h3`, `sub-head sub-head--${block.level}`, block.html);
      node.dataset.keepWithNext = '';
      return node;
    }
    case 'para':
      return el('p', block.dropCap ? 'drop-cap' : undefined, block.html);
    case 'list':
      return el(block.ordered ? 'ol' : 'ul', undefined, block.html);
    case 'table':
      return buildTable(block);
    case 'sources':
      return buildSources(block);
    case 'rule': {
      const node = el('hr');
      node.dataset.atomic = '';
      return node;
    }
    case 'pullquote': {
      const node = el('blockquote', 'pullquote', block.html);
      node.dataset.atomic = '';
      if (block.attribution) {
        node.append(el('span', 'pullquote__attribution', `— ${block.attribution}`));
      }
      return node;
    }
    case 'figure':
      return buildFigure(block, o);
  }
}

/**
 * A figure whose image is missing still occupies a slot in `article.blocks`.
 * Returning a zero-height marker rather than nothing keeps ribbon children and
 * block indices aligned, which every cursor in the engine depends on.
 */
function placeholderFor(): HTMLElement {
  const node = el('div', 'block-void');
  node.dataset.atomic = '';
  return node;
}

/** The body ribbon: exactly one child per entry in `article.blocks`, in order. */
export function buildRibbonTemplate(
  article: ParsedArticle,
  o: RibbonOptions,
): HTMLTemplateElement {
  const template = document.createElement('template');
  const ribbon = el('div', 'ribbon');
  ribbon.dataset.article = article.id;

  for (const block of article.blocks) {
    ribbon.append(buildBlock(block, o) ?? placeholderFor());
  }

  template.content.append(ribbon);
  return template;
}

/** Headline, deck and byline. Measured and placed independently of the body. */
export function buildHead(article: ParsedArticle, o: HeadOptions): HTMLElement {
  const { meta } = article;
  const head = el('header', `story-head${o.lead ? ' story-head--lead' : ''}`);
  head.dataset.articleHead = meta.id;

  if (o.continuedFrom !== undefined) {
    const slug = el('p', 'jump-line jump-line--from');
    slug.append(el('span', 'jump-line__title', meta.headline));
    slug.append(
      el('span', 'continued', `, continued from page ${o.continuedFrom}`),
    );
    head.append(slug);
    return head;
  }

  head.append(el('h2', `headline headline--${o.lead ? 'lead' : meta.span}`, meta.headline));
  if (meta.deck) head.append(el('p', 'deck no-justify', meta.deck));
  if (meta.byline) head.append(el('p', 'byline', `By ${meta.byline}`));
  return head;
}

export function buildRibbon(article: ParsedArticle, o: RibbonOptions): HTMLElement {
  return buildRibbonTemplate(article, o).content.firstElementChild!.cloneNode(
    true,
  ) as HTMLElement;
}
