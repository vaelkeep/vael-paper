/**
 * Viewport → grid metrics, and the baseline unit everything derives from.
 *
 * Two rules hold this together:
 *  1. `--lh` is an integer number of pixels. Fractional baselines reintroduce
 *     the float drift the packer exists to avoid.
 *  2. Column width is quantised before it reaches a cache key, so browser
 *     chrome jitter (an iPad toolbar, a Stage Manager drag) cannot trigger a
 *     storm of remeasures.
 */

import type { GridMetrics, LayoutKey, ReadingMode } from '../model/types';

/** Body size at scale 1. Everything else is a ratio of this. */
const BASE_FONT_PX = 17;
/** Body leading. 1.52 lands on a comfortable 26px at the default size. */
const LEADING = 1.52;
/** Width bucket for cache keys — see rule 2 above. */
const WIDTH_QUANTUM = 4;

/**
 * The measure, in characters, expressed as a target and a tolerance.
 *
 * `IDEAL` is where a line is most comfortable to read. `MIN` is where
 * justification starts opening rivers and the hyphenator breaks a word on most
 * lines. `MAX` is where the eye starts losing its place returning to the next
 * line — the reason a very wide window should grow *columns*, not lines.
 */
const IDEAL_COLUMN_CHARS = 62;
const MIN_COLUMN_CHARS = 34;
const MAX_COLUMN_CHARS = 75;

/** Source Serif 4 averages close to this per character at text sizes. */
const AVG_CHAR_EM = 0.49;

/** A ceiling, not a target. The measure rule below rarely gets near it. */
const MAX_COLUMNS = 6;

/**
 * The largest share of a page's type block one plate may occupy.
 *
 * Not a cosmetic limit. A figure is atomic, so a figure taller than the column
 * it lands in cannot be broken and must be force-placed, overflowing the page.
 * Front-page columns are the shortest in the paper — the masthead and the lead
 * headline take the top of the page — so the cap has to leave room for that,
 * not merely for a full-height column.
 */
const MAX_FIGURE_SHARE = 0.42;

export const FONT_SCALES = [0.85, 0.92, 1, 1.09, 1.2, 1.32] as const;
export const DEFAULT_SCALE_INDEX = 2;

/**
 * Narrower than this, pagination stops being a good idea and the reader
 * scrolls instead.
 *
 * It is a *width* threshold, deliberately. The reason a phone should scroll is
 * that at a ~340px measure a page holds about sixteen lines, so a story
 * becomes a dozen flips — and that is a function of width alone. Keying on the
 * shorter edge, as an earlier version did, also caught a short-but-wide
 * desktop window and silently dropped it into scroll mode, where the arrow
 * keys do nothing and the reader looks broken.
 */
export const PAGINATION_MIN_WIDTH = 700;

export interface ViewportInfo {
  w: number;
  h: number;
  /** True when the reader has explicitly chosen, so we skip the breakpoint. */
  modeOverride?: ReadingMode | null;
}

export function quantise(px: number): number {
  return Math.round(px / WIDTH_QUANTUM) * WIDTH_QUANTUM;
}

export function baselineFor(fontScale: number): { fontSize: number; lineHeight: number } {
  const fontSize = Math.round(BASE_FONT_PX * fontScale);
  return { fontSize, lineHeight: Math.round(fontSize * LEADING) };
}

/** Write the rhythm onto the document. Everything in CSS derives from these. */
export function applyRhythm(fontScale: number): { fontSize: number; lineHeight: number } {
  const rhythm = baselineFor(fontScale);
  const root = document.documentElement.style;
  root.setProperty('--font-scale', String(fontScale));
  root.setProperty('--fs-body', `${rhythm.fontSize}px`);
  root.setProperty('--lh', `${rhythm.lineHeight}px`);
  return rhythm;
}

export function chooseMode(view: ViewportInfo): ReadingMode {
  if (view.modeOverride) return view.modeOverride;
  if (view.w < PAGINATION_MIN_WIDTH) return 'scroll';
  return view.w >= view.h * 1.15 ? 'spread' : 'single';
}

/**
 * How many columns, chosen by measure rather than by breakpoints.
 *
 * The rule is: pick the column count whose resulting line length lands closest
 * to the ideal — *not* the most columns that will fit, which is what produces
 * the cramped five-column grid of a printed broadsheet on a screen, and not a
 * fixed number, which produces a 97-character line on an ultrawide display.
 *
 * Because it is expressed in characters rather than pixels it also scales with
 * the reader's text-size setting for free: turn the type up far enough and a
 * column drops away on its own, which is correct and one fewer breakpoint to
 * maintain.
 */
export function columnsFor(
  innerWidth: number,
  fontSize: number,
  gutter: number,
  mode: ReadingMode,
): number {
  if (mode === 'scroll') return 1;

  const charWidth = AVG_CHAR_EM * fontSize;
  const measureAt = (n: number) => (innerWidth - gutter * (n - 1)) / n / charWidth;

  let best = 1;
  let bestScore = Infinity;

  // First pass: only counts that land inside the readable band.
  for (let n = 1; n <= MAX_COLUMNS; n++) {
    const chars = measureAt(n);
    if (chars <= 0) break;
    if (chars < MIN_COLUMN_CHARS || chars > MAX_COLUMN_CHARS) continue;
    const score = Math.abs(chars - IDEAL_COLUMN_CHARS);
    if (score < bestScore) {
      bestScore = score;
      best = n;
    }
  }
  if (bestScore < Infinity) return best;

  // Nothing fits the band — a very narrow or very wide page. Take whatever
  // comes closest rather than defaulting to one enormous column.
  for (let n = 1; n <= MAX_COLUMNS; n++) {
    const chars = measureAt(n);
    if (chars <= 0) break;
    const score = Math.abs(chars - IDEAL_COLUMN_CHARS);
    if (score < bestScore) {
      bestScore = score;
      best = n;
    }
  }
  return best;
}

export function computeGrid(view: ViewportInfo, fontScale: number): GridMetrics {
  const mode = chooseMode(view);
  const { fontSize, lineHeight } = baselineFor(fontScale);

  // In spread mode each leaf is half the surface; that changes colW, which is
  // why spread and single are different LayoutKeys with different ledgers.
  //
  // The surface is deliberately uncapped: the paper fills the display, and the
  // column rule above keeps the measure honest by growing columns rather than
  // line length.
  const pageW = quantise(mode === 'spread' ? view.w / 2 : view.w);
  const pageH = view.h;

  const margin = Math.round(lineHeight * (mode === 'scroll' ? 1 : 1.5));
  const margins = { t: margin, r: margin, b: margin, l: margin };
  const gutter = Math.round(lineHeight * 0.85);
  const ruleW = 1;

  const inner = pageW - margins.l - margins.r;
  const cols = columnsFor(inner, fontSize, gutter, mode);
  const colW = quantise((inner - gutter * (cols - 1)) / cols);

  const typeBlockH = pageH - margins.t - margins.b;
  const linesPerPage = Math.max(1, Math.floor(typeBlockH / lineHeight));
  const maxFigureLines = Math.max(2, Math.floor(linesPerPage * MAX_FIGURE_SHARE));

  return {
    pageW,
    pageH,
    margins,
    cols,
    gutter,
    colW,
    ruleW,
    lineHeight,
    linesPerPage,
    maxFigureLines,
    fontScale,
    mode,
  };
}

export function layoutKey(
  grid: GridMetrics,
  fontsVersion: string,
  templateSetId = 'v1',
): LayoutKey {
  return {
    colW: grid.colW,
    pageW: grid.pageW,
    pageH: grid.pageH,
    fontScale: grid.fontScale,
    mode: grid.mode,
    fontsVersion,
    templateSetId,
  };
}

export function sameKey(a: LayoutKey | null, b: LayoutKey | null): boolean {
  if (!a || !b) return false;
  return (
    a.colW === b.colW &&
    a.pageW === b.pageW &&
    a.pageH === b.pageH &&
    a.fontScale === b.fontScale &&
    a.mode === b.mode &&
    a.fontsVersion === b.fontsVersion &&
    a.templateSetId === b.templateSetId
  );
}

/**
 * True when only the page height moved. The ledger cache key excludes height,
 * so this case skips measurement entirely and costs a repack.
 */
export function onlyHeightChanged(next: LayoutKey, prev: LayoutKey | null): boolean {
  if (!prev) return false;
  return (
    next.pageH !== prev.pageH &&
    next.colW === prev.colW &&
    next.pageW === prev.pageW &&
    next.fontScale === prev.fontScale &&
    next.mode === prev.mode &&
    next.fontsVersion === prev.fontsVersion
  );
}

export function viewportOf(el: HTMLElement): ViewportInfo {
  const rect = el.getBoundingClientRect();
  return { w: Math.round(rect.width), h: Math.round(rect.height) };
}
