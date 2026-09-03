/**
 * The paginator: orchestration.
 *
 * Owns the one piece of mutable state that matters — the current layout key —
 * and decides, on every viewport or setting change, whether that change needs a
 * remeasure, a repack, or nothing at all.
 *
 * The single most important behaviour here is not performance but continuity:
 * the reader's position is captured before every relayout and restored after,
 * so rotating an iPad or bumping the text size leaves them on the same
 * sentence rather than dumping them back at the front page.
 */

import type { Edition } from '../content/manifest';
import type { Cursor, GridMetrics, ImageAsset, LayoutKey, ReadingLayout } from '../model/types';
import { LedgerCache } from './ledger-cache';
import { measureBatch, measureFurniture } from './measure';
import { planEdition, type EditionPlan } from './planner';
import { baselineFor, computeGrid, layoutKey, onlyHeightChanged, sameKey } from './geometry';
import { applyDropCapMetrics } from './dropcap';
import { buildHead } from '../render/ribbon';
import { fontsVersion, waitForFonts } from '../util/fonts';

export type RelayoutReason =
  | 'init'
  | 'resize'
  | 'orientation'
  | 'fontScale'
  | 'fontsSettled'
  | 'mode'
  | 'layout';

export interface PaginateResult {
  plan: EditionPlan;
  grid: GridMetrics;
  templates: Map<string, HTMLTemplateElement>;
  measured: boolean;
  elapsedMs: number;
}

export interface PaginatorDeps {
  edition: Edition;
  images: Record<string, ImageAsset>;
  /** Built to fit the given band, in px. */
  mastheadFactory: (width: number, height: number) => HTMLElement;
}

export class Paginator {
  private cache = new LedgerCache();
  private templates = new Map<string, HTMLTemplateElement>();
  private headLines = new Map<string, number>();
  private key: LayoutKey | null = null;
  private deps: PaginatorDeps;

  constructor(deps: PaginatorDeps) {
    this.deps = deps;
  }

  get layoutKey(): LayoutKey | null {
    return this.key;
  }

  /** True when this viewport/scale differs from what is currently laid out. */
  needsRelayout(grid: GridMetrics): boolean {
    return !sameKey(layoutKey(grid, fontsVersion()), this.key);
  }

  async paginate(
    viewportW: number,
    viewportH: number,
    fontScale: number,
    modeOverride: 'single' | 'spread' | 'scroll' | null,
    layout: ReadingLayout = 'broadsheet',
  ): Promise<PaginateResult> {
    const started = performance.now();
    const grid = computeGrid(
      { w: viewportW, h: viewportH, modeOverride, layout },
      fontScale,
    );

    // Gate on the real faces. Measuring against a fallback metric produces
    // wrong line counts and a visible reflow when the real face lands.
    await waitForFonts(Math.round(17 * fontScale));
    const version = fontsVersion();

    // A drop cap is sized from the face's actual cap-height, which is only
    // knowable once the face is loaded — and it changes the height of the
    // paragraph it starts, so it must be settled before anything is measured.
    applyDropCapMetrics(grid.lineHeight, baselineFor(fontScale).fontSize);
    const nextKey = layoutKey(grid, version);

    const articles = this.deps.edition.order;
    const heightOnly = onlyHeightChanged(nextKey, this.key);
    let measured = false;

    if (!heightOnly) {
      const missing = this.cache.missing(articles, grid, version);
      if (missing.length > 0) {
        const result = measureBatch(
          missing,
          { grid, images: this.deps.images, fontsVersion: version },
          this.templates,
        );
        for (const ledger of result.ledgers.values()) this.cache.set(ledger);
        for (const [id, lines] of result.headLines) this.headLines.set(id, lines);
        measured = true;
      }
      // Ledgers measured at a width we have left will never be asked for again.
      this.cache.evictExcept(grid);
    }

    // Furniture measured at band width rather than column width: the masthead,
    // and the lead story's head. Neither lives in block space, so neither
    // disturbs a cursor.
    const typeW = grid.pageW - grid.margins.l - grid.margins.r;
    const mastheadLines = measureFurniture(
      this.deps.mastheadFactory(typeW, grid.pageH),
      typeW,
      grid.lineHeight,
    );
    const lead = articles[0];
    const leadHeadLines = lead
      ? measureFurniture(
          buildHead(lead, {
            lineHeight: grid.lineHeight,
            colW: typeW,
            maxFigureLines: grid.maxFigureLines,
            images: this.deps.images,
            lead: true,
          }),
          typeW,
          grid.lineHeight,
        )
      : 0;

    const sectionOf = new Map<string, string>();
    const sectionNames = new Map<string, string>();
    for (const section of this.deps.edition.sections) {
      sectionNames.set(section.id, section.name);
      for (const id of section.articles) sectionOf.set(id, section.id);
    }

    const plan = planEdition({
      order: articles,
      ledgers: this.cache.view(articles, grid, version),
      headLines: this.headLines,
      leadHeadLines,
      mastheadLines,
      sectionOf,
      sectionNames,
      grid,
    });

    this.key = nextKey;

    return {
      plan,
      grid,
      templates: this.templates,
      measured,
      elapsedMs: performance.now() - started,
    };
  }

  /** Discard everything — used when the edition itself changes. */
  reset(edition: Edition): void {
    this.deps.edition = edition;
    this.cache = new LedgerCache();
    this.templates.clear();
    this.headLines.clear();
    this.key = null;
  }
}

/** Nearest usable cursor when a stored anchor no longer exists. */
export function reconcileAnchor(plan: EditionPlan, anchor: Cursor | null): number {
  if (!anchor) return 0;
  return plan.anchorToPage(anchor);
}
