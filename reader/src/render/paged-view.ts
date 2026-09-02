/**
 * The paged reading mode: a stage, a pool of page surfaces, and a flip.
 *
 * Only a small window of pages exists in the DOM at once, and surfaces are
 * recycled rather than rebuilt, so turning pages quickly never triggers a burst
 * of allocation mid-animation.
 */

import type { Edition } from '../content/manifest';
import type { Cursor, GridMetrics, ImageAsset } from '../model/types';
import type { EditionPlan } from '../layout/planner';
import { FlipController } from './flip/flip-controller';
import { renderPage, type RenderContext } from './page-view';
import { h } from '../util/dom';

export interface PagedHandle {
  /** The reader's position, for restoring it across a relayout. */
  anchor(): Cursor | null;
  pageIndex(): number;
  pageCount(): number;
  goToPage(index: number, opts?: { animate?: boolean }): void;
  goToAnchor(anchor: Cursor): void;
  next(): void;
  previous(): void;
  /** Run a relayout, waiting for any turn in flight to settle first. */
  defer(fn: () => void): void;
  destroy(): void;
}

export interface PagedOptions {
  edition: Edition;
  plan: EditionPlan;
  grid: GridMetrics;
  templates: Map<string, HTMLTemplateElement>;
  images: Record<string, ImageAsset>;
  /** Built to fit the given band, in px. */
  masthead: (width: number, height: number) => HTMLElement;
  onPageChange?: (index: number) => void;
  /** Present page one alone rather than paired with page two. */
  coverAlone?: boolean;
}

function dateLabelOf(edition: Edition): string {
  const date = new Date(`${edition.manifest.date}T12:00:00`);
  return Number.isNaN(date.getTime())
    ? edition.manifest.date
    : date.toLocaleDateString(undefined, {
        day: 'numeric',
        month: 'long',
        year: 'numeric',
      });
}

export function renderPaged(host: HTMLElement, options: PagedOptions): PagedHandle {
  const { plan, grid, edition } = options;

  const stage = h('div', 'stage');
  stage.style.setProperty('--page-w', `${grid.pageW}px`);
  stage.style.setProperty('--page-h', `${grid.pageH}px`);
  host.replaceChildren(stage);

  const sectionNames = new Map<string, string>();
  for (const section of edition.sections) sectionNames.set(section.id, section.name);

  const ctx: RenderContext = {
    grid,
    templates: options.templates,
    articles: edition.byId,
    images: options.images,
    sectionNames,
    masthead: options.masthead,
    startPageOf: (id) => plan.byArticle.get(id)?.startPage,
  };

  const dateLabel = dateLabelOf(edition);

  // A *sheet* is what actually turns: one leaf in single mode, two in a spread.
  //
  // Pairing starts at the front page by default. Standing the cover alone is
  // the more faithful gesture — it is how a folded paper arrives — but on a
  // screen it leaves half the display empty, and the front page is the one
  // page a reader lingers on. `coverAlone` restores it for those who prefer it.
  const sheets: number[][] = [];
  if (grid.mode === 'spread') {
    let start = 0;
    if (options.coverAlone && plan.pages.length > 0) {
      sheets.push([0]);
      start = 1;
    }
    for (let i = start; i < plan.pages.length; i += 2) {
      sheets.push(plan.pages[i + 1] ? [i, i + 1] : [i]);
    }
  } else {
    for (let i = 0; i < plan.pages.length; i++) sheets.push([i]);
  }

  const sheetOfPage = new Map<number, number>();
  sheets.forEach((pages, index) => {
    for (const page of pages) sheetOfPage.set(page, index);
  });

  // Surfaces are cached by sheet and reused. A sheet's DOM is a pure function
  // of the plan, so there is never a reason to rebuild one.
  const pool = new Map<number, HTMLElement>();
  const surfaceFor = (index: number): HTMLElement | null => {
    const group = sheets[index];
    if (!group) return null;

    let surface = pool.get(index);
    if (!surface) {
      surface = h('div', `sheet${group.length > 1 ? ' sheet--pair' : ''}`);
      surface.dataset.page = String(index);
      for (const pageIndex of group) {
        const page = plan.pages[pageIndex];
        if (page) surface.append(renderPage(page, ctx, dateLabel));
      }
      pool.set(index, surface);
    }
    // Evict distant sheets so a long edition does not accumulate DOM.
    for (const [key, node] of pool) {
      if (Math.abs(key - index) > 2 && !node.isConnected) pool.delete(key);
    }
    return surface;
  };

  const flip = new FlipController(stage, {
    surfaceFor,
    pageCount: () => sheets.length,
    onChange: (index) => options.onPageChange?.(sheets[index]?.[0] ?? 0),
  });

  flip.measureStage();
  flip.show(0, { animate: false });

  const onKey = (e: KeyboardEvent) => {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    const target = e.target as HTMLElement | null;
    if (target && /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)) return;

    switch (e.key) {
      case 'ArrowRight':
      case 'PageDown':
      case ' ':
        e.preventDefault();
        flip.next();
        break;
      case 'ArrowLeft':
      case 'PageUp':
        e.preventDefault();
        flip.previous();
        break;
      case 'Home':
        e.preventDefault();
        flip.show(0);
        break;
      case 'End':
        e.preventDefault();
        flip.show(sheets.length - 1);
        break;
    }
  };
  window.addEventListener('keydown', onKey);

  const showPage = (pageIndex: number, animate: boolean) => {
    const sheet = sheetOfPage.get(Math.max(0, Math.min(plan.pages.length - 1, pageIndex)));
    flip.show(sheet ?? 0, { animate });
  };

  return {
    anchor: () => {
      const first = sheets[flip.pageIndex]?.[0] ?? 0;
      return plan.pages[first]?.topAnchor ?? null;
    },
    pageIndex: () => sheets[flip.pageIndex]?.[0] ?? 0,
    pageCount: () => plan.pages.length,
    goToPage: (index, opts) => showPage(index, opts?.animate ?? true),
    goToAnchor: (anchor) => showPage(plan.anchorToPage(anchor), false),
    next: () => flip.next(),
    previous: () => flip.previous(),
    defer: (fn) => flip.deferRelayout(fn),
    destroy() {
      window.removeEventListener('keydown', onKey);
      pool.clear();
    },
  };
}
