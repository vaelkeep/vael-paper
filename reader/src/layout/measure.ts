/**
 * Measurement: turn articles into line ledgers.
 *
 * The contract, and the reason the rest of the engine can be integer
 * arithmetic: an article is laid out **once** per (width, font scale) into an
 * offscreen ribbon at the exact column width, and we read back how many
 * baselines each block occupies. Nothing here re-breaks text, and nothing
 * downstream ever needs to.
 *
 * Phase discipline is absolute: one write phase, one forced flush, one read
 * phase. Interleaving a read into the write phase costs a second layout of the
 * entire edition — the difference between 90ms and several hundred.
 */

import type { GridMetrics, ImageAsset, LineLedger, ParsedArticle } from '../model/types';
import { buildHead, buildRibbonTemplate } from '../render/ribbon';
import { idle } from '../util/dom';
import { beginRead, beginWrite, endPhase } from '../util/rw-batch';

export interface MeasureContext {
  grid: GridMetrics;
  images: Record<string, ImageAsset>;
  fontsVersion: string;
}

/**
 * The offscreen host.
 *
 * `visibility: hidden` rather than `display: none` or
 * `content-visibility: hidden`: the latter two skip layout entirely, which
 * would make every measurement zero. See tokens.css.
 */
function ensureHost(width: number): HTMLElement {
  let host = document.getElementById('measure-host');
  if (!host) {
    host = document.createElement('div');
    host.id = 'measure-host';
    host.setAttribute('aria-hidden', 'true');
    document.body.append(host);
  }
  // Same class chain as the live paper, so inherited type resolves identically.
  host.className = 'paper';
  host.style.width = `${width}px`;
  return host;
}

/** Round to the nearest baseline, tolerating sub-pixel layout noise. */
function toLines(px: number, lh: number): number {
  return Math.max(0, Math.round(px / lh));
}

/**
 * Read one laid-out ribbon into a ledger.
 *
 * Only integer offsets are read (`offsetTop`/`offsetHeight`), never
 * `getBoundingClientRect` and never per-run `getClientRects` — under the
 * baseline grid a block's height already encodes its line count.
 *
 * Ribbon children map one-to-one onto `article.blocks`, so `blocks[i]` here is
 * `article.blocks[i]` and a cursor means the same thing everywhere.
 */
export function readLedger(
  ribbon: HTMLElement,
  article: ParsedArticle,
  ctx: MeasureContext,
): LineLedger {
  const lh = ctx.grid.lineHeight;
  const children = Array.from(ribbon.children) as HTMLElement[];

  const blocks: LineLedger['blocks'] = [];
  let prevBottom = children.length ? children[0]!.offsetTop : 0;
  let total = 0;

  children.forEach((el, i) => {
    const top = el.offsetTop;
    const height = el.offsetHeight;
    const lead = i === 0 ? 0 : toLines(Math.max(0, top - prevBottom), lh);
    const atomic = el.hasAttribute('data-atomic');

    // Ordinary text blocks are whole baselines already, because their
    // line-height *is* the baseline. Atomic blocks are not: a pull quote sets
    // its own leading, a rule is a single pixel, a figure carries a caption.
    // Round those *up* — rounding to nearest would let the ledger claim less
    // height than the DOM occupies, and the renderer would then clip a line in
    // half. The excess is given back below by snapping the block itself.
    const lines = atomic
      ? Math.max(1, Math.ceil(height / lh))
      : Math.max(1, toLines(height, lh));
    prevBottom = top + height;

    // A table's heading row repeats when the table continues in another
    // column. Read where it ends so the packer can charge for the repeat and
    // the renderer can know whether a slice starts among the rows.
    let head: { lines: number; bodyStart: number } | undefined;
    if (el.hasAttribute('data-repeat-head')) {
      const thead = el.querySelector('thead');
      if (thead) {
        const blockTop = el.getBoundingClientRect().top;
        const rect = thead.getBoundingClientRect();
        head = {
          lines: Math.max(1, toLines(rect.height, lh)),
          bodyStart: Math.max(1, toLines(rect.bottom - blockTop, lh)),
        };
      }
    }

    blocks.push({
      index: i,
      kind: article.blocks[i]?.kind ?? 'para',
      lines,
      leadLines: lead,
      atomic,
      keepWithNext: el.hasAttribute('data-keep-with-next'),
      keepWithPrevious: el.hasAttribute('data-keep-with-previous'),
      ...(head ? { head } : {}),
    });
    total += lines + lead;
  });

  return {
    key: {
      articleId: article.id,
      contentHash: article.hash,
      colW: ctx.grid.colW,
      fontScale: ctx.grid.fontScale,
      fontsVersion: ctx.fontsVersion,
    },
    lineHeight: lh,
    totalLines: total,
    blocks,
  };
}

export interface MeasureResult {
  ledgers: Map<string, LineLedger>;
  /** Height of each article's head furniture, in baselines, at column width. */
  headLines: Map<string, number>;
  /** Templates to clone fragments from. Never rebuilt per page. */
  templates: Map<string, HTMLTemplateElement>;
  elapsedMs: number;
}

/**
 * Measure every article in one pass.
 *
 * WRITE (build and attach) → FLUSH (one forced layout) → READ (integer offsets)
 * → deferred WRITE (clear the host on idle; clearing inline would dirty layout
 * and cost a second flush on the next read).
 */
export function measureBatch(
  articles: ParsedArticle[],
  ctx: MeasureContext,
  templates = new Map<string, HTMLTemplateElement>(),
): MeasureResult {
  const started = performance.now();
  const ledgers = new Map<string, LineLedger>();
  const headLines = new Map<string, number>();

  if (articles.length === 0) {
    return { ledgers, headLines, templates, elapsedMs: 0 };
  }

  const host = ensureHost(ctx.grid.colW);
  const options = {
    lineHeight: ctx.grid.lineHeight,
    colW: ctx.grid.colW,
    maxFigureLines: ctx.grid.maxFigureLines,
    images: ctx.images,
  };

  // ---- WRITE
  beginWrite('measureBatch');
  const attached: Array<{
    article: ParsedArticle;
    ribbon: HTMLElement;
    head: HTMLElement;
  }> = [];
  const nodes: HTMLElement[] = [];
  for (const article of articles) {
    const template = buildRibbonTemplate(article, options);
    templates.set(article.id, template);
    const ribbon = template.content.firstElementChild!.cloneNode(true) as HTMLElement;
    const head = buildHead(article, options);
    attached.push({ article, ribbon, head });
    nodes.push(head, ribbon);
  }
  host.replaceChildren(...nodes);

  // ---- FLUSH: the one and only forced layout of this pass.
  void host.offsetHeight;

  // ---- READ
  beginRead('measureBatch');
  const lh = ctx.grid.lineHeight;
  for (const { article, ribbon, head } of attached) {
    const ledger = readLedger(ribbon, article, ctx);
    ledgers.set(article.id, ledger);
    headLines.set(article.id, Math.ceil(head.offsetHeight / lh));
    snapAtomics(templates.get(article.id)!, ledger, lh);
  }
  endPhase();

  // ---- deferred WRITE
  idle(() => host.replaceChildren());

  return { ledgers, headLines, templates, elapsedMs: performance.now() - started };
}

/**
 * Force every atomic block to occupy exactly the baselines the ledger claims.
 *
 * This closes the one gap the slice-and-clip design cannot absorb. Splittable
 * text is inherently baseline-aligned because its line-height is the baseline;
 * atomic blocks are not, and a block half a baseline taller than the ledger
 * believes shows up as a line sliced through the middle at a column foot.
 *
 * Heights are written onto the *template*, so every fragment cloned from it
 * inherits the corrected geometry for free.
 */
function snapAtomics(
  template: HTMLTemplateElement,
  ledger: LineLedger,
  lh: number,
): void {
  const ribbon = template.content.firstElementChild;
  if (!ribbon) return;
  for (const metrics of ledger.blocks) {
    if (!metrics.atomic) continue;
    const node = ribbon.children[metrics.index] as HTMLElement | undefined;
    if (!node) continue;
    node.style.height = `${metrics.lines * lh}px`;
    node.style.overflow = 'hidden';
  }
}

/**
 * Measure a piece of furniture at an arbitrary width — the masthead, or a lead
 * story's head set across the full type block rather than one column.
 *
 * Returns whole baselines, because the planner subtracts it from a page's
 * capacity and capacity is counted in lines.
 */
export function measureFurniture(node: HTMLElement, width: number, lh: number): number {
  const host = ensureHost(width);
  beginWrite('measureFurniture');
  host.replaceChildren(node);
  void host.offsetHeight;
  beginRead('measureFurniture');
  const lines = Math.ceil(node.offsetHeight / lh);
  endPhase();
  idle(() => host.replaceChildren());
  return lines;
}
