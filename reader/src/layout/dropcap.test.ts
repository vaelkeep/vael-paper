/**
 * Drop-cap metric tests.
 *
 * `computeDropCap` is pure arithmetic over font metrics, so the geometry can
 * be verified exactly without a browser. What matters is the two alignments —
 * cap-top to line one, baseline to line three — and that the letter never
 * needs to sit above the paragraph, since a column clips at its edge.
 */

import { describe, expect, it } from 'vitest';
import { solveDropCap, type FaceMetrics } from './dropcap';

// The real ratios, as Chrome reports them for the two self-hosted faces.
const BODY: FaceMetrics = {
  ascentRatio: 18 / 17,
  descentRatio: 6 / 17,
  capRatio: 12.54 / 17,
};
const DISPLAY: FaceMetrics = {
  ascentRatio: 84 / 78,
  descentRatio: 20 / 78,
  capRatio: 56.32 / 78,
};

/** Recompute where the cap actually lands, from the returned metrics. */
function geometry(lineHeight: number, bodyFontSize: number, display = DISPLAY) {
  const m = solveDropCap(lineHeight, bodyFontSize, BODY, display);

  const bodyAscent = BODY.ascentRatio * bodyFontSize;
  const bodyDescent = BODY.descentRatio * bodyFontSize;
  const baselineInLine = (lineHeight - (bodyAscent + bodyDescent)) / 2 + bodyAscent;

  const capAscent = display.ascentRatio * m.fontSize;
  const capDescent = display.descentRatio * m.fontSize;
  const capBaseline = (m.lineHeight - (capAscent + capDescent)) / 2 + capAscent;
  const capInkTop = capBaseline - display.capRatio * m.fontSize;

  return {
    metrics: m,
    capBaseline,
    capInkTop,
    firstLineCapTop: baselineInLine - BODY.capRatio * bodyFontSize,
    thirdBaseline: 2 * lineHeight + baselineInLine,
  };
}

describe('computeDropCap', () => {
  it('lands the cap baseline on the third line', () => {
    const g = geometry(26, 17);
    expect(g.capBaseline).toBeCloseTo(g.thirdBaseline, 1);
  });

  it('aligns the cap top with the capitals on the first line', () => {
    const g = geometry(26, 17);
    expect(g.capInkTop).toBeCloseTo(g.firstLineCapTop, 1);
  });

  it('never places ink above the paragraph, which a column would clip', () => {
    for (const scale of [0.85, 0.92, 1, 1.09, 1.2, 1.32]) {
      const fontSize = Math.round(17 * scale);
      const lineHeight = Math.round(fontSize * 1.52);
      expect(geometry(lineHeight, fontSize).capInkTop).toBeGreaterThanOrEqual(0);
    }
  });

  it('is larger than the naive three-baselines setting', () => {
    const m = solveDropCap(26, 17, BODY, DISPLAY);
    // The whole point: a cap-height is ~0.72 em, so 3 × lh is far too small.
    expect(m.fontSize).toBeGreaterThan(26 * 3);
    expect(m.fontSize).toBeCloseTo(89.4, 0);
  });

  it('scales with the reader’s text size', () => {
    const small = solveDropCap(21, 14, BODY, DISPLAY);
    const large = solveDropCap(34, 22, BODY, DISPLAY);
    expect(large.fontSize).toBeGreaterThan(small.fontSize);
    expect(large.fontSize / small.fontSize).toBeCloseTo(34 / 21, 1);
  });

  it('holds both alignments for any face, not just this one', () => {
    // A condensed face with a tall cap-height and a squat one with a short
    // cap-height must both come out aligned.
    for (const capRatio of [0.62, 0.7, 0.72, 0.78]) {
      const face: FaceMetrics = { ascentRatio: 1.05, descentRatio: 0.28, capRatio };
      const g = geometry(26, 17, face);
      expect(g.capBaseline).toBeCloseTo(g.thirdBaseline, 1);
      expect(g.capInkTop).toBeCloseTo(g.firstLineCapTop, 1);
    }
  });
});
