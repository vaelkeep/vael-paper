/**
 * Drop-cap metrics, derived from the actual font rather than assumed.
 *
 * A three-line drop cap has two obligations, and they are both about *ink*,
 * not about boxes:
 *
 *   1. the top of the capital aligns with the top of the capitals on line one;
 *   2. its baseline sits on the baseline of line three.
 *
 * The naive setting — `font-size: 3 × lineHeight` — satisfies neither, because
 * a font's cap-height is only ever a fraction of its em size (about 0.72 for
 * Playfair Display). Set that way the letter is roughly 8px short over three
 * lines, so it hangs below the first line's capitals and stops above the third
 * line's baseline. It reads as though it has slipped.
 *
 * So we measure the faces and solve for the size. Everything here is computed
 * from `measureText`, which reports the same metrics the layout engine uses,
 * and the result is written to CSS custom properties *before* the paginator
 * measures anything — a drop cap changes a paragraph's height, so it has to be
 * settled before the ledger is taken.
 */

/** How many lines the cap occupies. */
const DROP_CAP_LINES = 3;
/** Probe size for ratio measurements; any size works, this one keeps error low. */
const PROBE_PX = 200;
/** A flat-topped capital is the right reference — round letters overshoot by design. */
const REFERENCE_GLYPH = 'H';

export interface FaceMetrics {
  /** Ascent and descent as the layout engine sees them, per px of font size. */
  ascentRatio: number;
  descentRatio: number;
  /** Cap-height (ink above the baseline), per px of font size. */
  capRatio: number;
}

let ctx: CanvasRenderingContext2D | null = null;

function measureFace(family: string, weight: number): FaceMetrics | null {
  ctx ??= document.createElement('canvas').getContext('2d');
  if (!ctx) return null;

  ctx.font = `${weight} ${PROBE_PX}px "${family}"`;
  const m = ctx.measureText(REFERENCE_GLYPH);
  const ascent = m.fontBoundingBoxAscent;
  const descent = m.fontBoundingBoxDescent;
  const cap = m.actualBoundingBoxAscent;

  // A face that failed to load reports the fallback's metrics, or zero. Either
  // way, refusing here is better than sizing a drop cap from the wrong font.
  if (!ascent || !cap) return null;

  return {
    ascentRatio: ascent / PROBE_PX,
    descentRatio: descent / PROBE_PX,
    capRatio: cap / PROBE_PX,
  };
}

export interface DropCapMetrics {
  fontSize: number;
  lineHeight: number;
  /** Distance from the paragraph's top to the cap's ink top, in px. */
  inkTop: number;
}

/**
 * The solve, separated from the measuring so it can be checked without a DOM.
 *
 * Given the two faces' metrics, returns the font size and line height that put
 * the cap's ink top on line one's cap-height and its baseline on line three's.
 */
export function solveDropCap(
  lineHeight: number,
  bodyFontSize: number,
  body: FaceMetrics,
  display: FaceMetrics,
): DropCapMetrics {
  const bodyAscent = body.ascentRatio * bodyFontSize;
  const bodyDescent = body.descentRatio * bodyFontSize;
  const bodyCap = body.capRatio * bodyFontSize;

  // Where a baseline sits inside its own line box, and hence where line one's
  // capitals begin and line three's baseline falls, both measured from the top
  // of the paragraph.
  const baselineInLine = (lineHeight - (bodyAscent + bodyDescent)) / 2 + bodyAscent;
  const firstLineCapTop = baselineInLine - bodyCap;
  const lastBaseline = (DROP_CAP_LINES - 1) * lineHeight + baselineInLine;

  // The cap must span exactly that, in ink.
  const targetInk = lastBaseline - firstLineCapTop;
  const fontSize = targetInk / display.capRatio;

  // Now choose a line height that drops the cap's baseline onto line three's:
  //   halfLeading + ascent = lastBaseline, where halfLeading = (lh − (a+d)) / 2
  const ascent = display.ascentRatio * fontSize;
  const descent = display.descentRatio * fontSize;
  const capLineHeight = 2 * (lastBaseline - ascent) + (ascent + descent);

  return {
    fontSize,
    // A negative line height is meaningless; clamp and accept a lower cap
    // rather than emitting something the browser will reject.
    lineHeight: Math.max(0, capLineHeight),
    inkTop: firstLineCapTop,
  };
}

/**
 * Measure the two faces and solve.
 *
 * Returns null when a face cannot be measured, in which case the CSS fallbacks
 * stand and the cap is merely imperfect rather than broken.
 */
export function computeDropCap(
  lineHeight: number,
  bodyFontSize: number,
  displayFamily = 'Playfair Display',
  bodyFamily = 'Source Serif 4',
): DropCapMetrics | null {
  const body = measureFace(bodyFamily, 400);
  const display = measureFace(displayFamily, 900);
  if (!body || !display) return null;
  return solveDropCap(lineHeight, bodyFontSize, body, display);
}

/**
 * Write the metrics onto the document.
 *
 * Must run *before* the paginator measures, because a drop cap changes the
 * height of the paragraph it starts.
 */
export function applyDropCapMetrics(lineHeight: number, bodyFontSize: number): void {
  const metrics = computeDropCap(lineHeight, bodyFontSize);
  const root = document.documentElement.style;
  if (!metrics) {
    root.removeProperty('--drop-cap-size');
    root.removeProperty('--drop-cap-lh');
    return;
  }
  root.setProperty('--drop-cap-size', `${metrics.fontSize.toFixed(2)}px`);
  root.setProperty('--drop-cap-lh', `${metrics.lineHeight.toFixed(2)}px`);
}
