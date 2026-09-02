/**
 * Geometry tests.
 *
 * The column rule is the one piece of layout policy a reader actually feels,
 * so it is pinned against the real devices this paper is read on rather than
 * against abstract breakpoints.
 */

import { describe, expect, it } from 'vitest';
import { baselineFor, chooseMode, columnsFor, computeGrid, quantise } from './geometry';

/** Roughly what a column of this width holds, for asserting on readability. */
function chars(colW: number, fontSize: number): number {
  return Math.round(colW / (fontSize * 0.49));
}

const DEVICES = [
  { name: 'ultrawide, full screen', w: 3440, h: 1384 },
  { name: 'mac studio, windowed', w: 1630, h: 1050 },
  { name: 'mac studio, landscape', w: 1440, h: 960 },
  { name: 'macbook, landscape', w: 1512, h: 900 },
  { name: 'ipad pro 11, landscape', w: 1194, h: 834 },
  { name: 'ipad pro 11, portrait', w: 834, h: 1194 },
  { name: 'ipad gen 7, landscape', w: 1080, h: 810 },
  { name: 'ipad gen 7, portrait', w: 810, h: 1080 },
];

describe('baseline grid', () => {
  it('always yields an integer line height', () => {
    for (const scale of [0.85, 0.92, 1, 1.09, 1.2, 1.32]) {
      const { lineHeight } = baselineFor(scale);
      expect(Number.isInteger(lineHeight)).toBe(true);
    }
  });

  it('quantises widths so chrome jitter cannot churn the cache key', () => {
    expect(quantise(720)).toBe(720);
    expect(quantise(721)).toBe(720);
    expect(quantise(722)).toBe(724); // Math.round breaks the tie upward
    expect(quantise(723)).toBe(724);
    // The property that matters: jitter inside a quantum cannot change the key.
    for (let w = 718; w <= 721; w++) expect(quantise(w)).toBe(720);
  });
});

describe('column count', () => {
  it('is one column when two would be unreadably narrow', () => {
    expect(columnsFor(400, 17, 22, 'single')).toBe(1);
  });

  it('drops a column as the reader turns the text up', () => {
    const inner = 700;
    expect(columnsFor(inner, 15, 22, 'single')).toBe(2);
    expect(columnsFor(inner, 26, 22, 'single')).toBe(1);
  });

  it('is always one column in continuous mode', () => {
    expect(columnsFor(4000, 17, 22, 'scroll')).toBe(1);
  });

  it('grows columns rather than line length on a very wide page', () => {
    // The whole point of the rule: an ultrawide leaf must not answer with one
    // enormous line, nor with two 97-character ones.
    const inner = 1642; // a 3440px display in spread
    const cols = columnsFor(inner, 17, 22, 'spread');
    expect(cols).toBeGreaterThanOrEqual(3);
    expect(chars((inner - 22 * (cols - 1)) / cols, 17)).toBeLessThanOrEqual(75);
  });

  it('prefers the count closest to the ideal, not the most that fit', () => {
    // Four columns would fit here, but three reads better, so three wins.
    const inner = 1642;
    expect(columnsFor(inner, 17, 22, 'spread')).toBe(3);
  });

  it('never picks a count that overruns the readable band when one exists', () => {
    for (let inner = 300; inner <= 4000; inner += 37) {
      for (const fs of [14, 17, 22]) {
        const n = columnsFor(inner, fs, 22, 'single');
        const measure = chars((inner - 22 * (n - 1)) / n, fs);
        // Either it found a count inside the band, or no count could be.
        const anyInBand = [1, 2, 3, 4, 5, 6].some((k) => {
          const m = chars((inner - 22 * (k - 1)) / k, fs);
          return m >= 34 && m <= 75;
        });
        if (anyInBand) {
          expect(measure).toBeGreaterThanOrEqual(34);
          expect(measure).toBeLessThanOrEqual(75);
        }
      }
    }
  });
});

describe('measure on real devices', () => {
  it.each(DEVICES)('$name holds a readable measure', ({ w, h }) => {
    const grid = computeGrid({ w, h }, 1);
    const measure = chars(grid.colW, 17);
    // Wide enough that justification does not open rivers, narrow enough that
    // the eye can find the next line without effort.
    expect(measure).toBeGreaterThanOrEqual(34);
    expect(measure).toBeLessThanOrEqual(75);
  });

  it('fills the display rather than capping the paper width', () => {
    // An ultrawide in full screen must not letterbox: two leaves should span
    // the whole surface between them.
    const grid = computeGrid({ w: 3440, h: 1384 }, 1);
    expect(grid.mode).toBe('spread');
    expect(grid.pageW * 2).toBeGreaterThanOrEqual(3440 - 8);
  });

  it('keeps two columns per leaf at the sizes actually read on', () => {
    for (const { w, h } of [
      { w: 1630, h: 1050 },
      { w: 1440, h: 960 },
      { w: 1512, h: 900 },
      { w: 810, h: 1080 },
      { w: 834, h: 1194 },
    ]) {
      expect(computeGrid({ w, h }, 1).cols).toBe(2);
    }
  });

  it.each(DEVICES)('$name still fits its columns inside the page', ({ w, h }) => {
    const grid = computeGrid({ w, h }, 1);
    const used =
      grid.colW * grid.cols + grid.gutter * (grid.cols - 1) + grid.margins.l + grid.margins.r;
    expect(used).toBeLessThanOrEqual(grid.pageW + 4); // within one quantum
  });

  it('never lets a plate be taller than the shortest column it could land in', () => {
    // A figure is atomic. One taller than its column cannot be broken, so it
    // gets force-placed and overflows the page. Front-page columns are the
    // shortest — masthead and lead headline take the top — so the cap has to
    // clear those, not just a full-height column.
    for (const { w, h } of DEVICES) {
      for (const scale of [0.85, 1, 1.32]) {
        const grid = computeGrid({ w, h }, scale);
        expect(grid.maxFigureLines).toBeGreaterThanOrEqual(2);
        // Roughly half a page is the worst case a front page imposes.
        expect(grid.maxFigureLines).toBeLessThan(grid.linesPerPage * 0.5);
      }
    }
  });

  it('gives a landscape tablet a spread and a portrait one a single page', () => {
    expect(chooseMode({ w: 1194, h: 834 })).toBe('spread');
    expect(chooseMode({ w: 834, h: 1194 })).toBe('single');
    expect(chooseMode({ w: 390, h: 844 })).toBe('scroll');
  });

  it('holds a readable measure at every text size on every device', () => {
    for (const { w, h } of DEVICES) {
      for (const scale of [0.85, 0.92, 1, 1.09, 1.2, 1.32]) {
        const grid = computeGrid({ w, h }, scale);
        const { fontSize } = baselineFor(scale);
        const measure = chars(grid.colW, fontSize);
        expect(measure).toBeGreaterThanOrEqual(30);
        expect(measure).toBeLessThanOrEqual(95);
      }
    }
  });
});
