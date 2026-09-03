/**
 * Boot and the top-level controller.
 *
 * Responsibilities, in order of importance:
 *  1. Keep the reader's place. Every relayout captures an anchor before and
 *     restores it after, so a rotation or a text-size change leaves them on the
 *     same sentence.
 *  2. Decide between paged and continuous mode, and honour an explicit
 *     override over the breakpoint in both directions.
 *  3. Never relayout while a page turn is in flight.
 */

import './styles/tokens.css';
import './fonts/fonts.css';
import './styles/type.css';
import './styles/page.css';
import './styles/overlay.css';
import './styles/source.css';

import { fetchArchive, fetchEdition, type Edition } from './content/manifest';
import { applyRhythm, chooseMode, PAGINATION_MIN_WIDTH } from './layout/geometry';
import { Paginator } from './layout/paginator';
import type { EditionPlan } from './layout/planner';
import type { Cursor, EditionSummary, ReadingMode } from './model/types';
import { renderContinuous, type ContinuousHandle } from './scroll/continuous-view';
import { renderPaged, type PagedHandle } from './render/paged-view';
import {
  applyLayout,
  applyTheme,
  fontScale,
  loadSettings,
  saveSettings,
  type Settings,
} from './app/settings';
import { articleHref, onRouteChange, parseRoute, replaceRoute, sectionHref } from './app/router';
import { mountOverlay, type OverlayHandle } from './ui/overlay';
import { mountToolbar, type ToolbarHandle } from './ui/toolbar';
import { mountPrintersMarks } from './ui/printers-marks';
import { mountSourceView, type SourceViewHandle } from './ui/source-view';
import { onFontsSettled } from './util/fonts';
import { toggleFullscreen } from './util/fullscreen';
import { debounce, h } from './util/dom';

const app = document.querySelector<HTMLElement>('#app')!;

/** Ignore width jitter below this; see the repagination-storm risk. */
const WIDTH_EPSILON = 4;

class Reader {
  private settings: Settings = loadSettings();
  private edition!: Edition;
  private paginator!: Paginator;
  private plan: EditionPlan | null = null;

  private paged: PagedHandle | null = null;
  private scroll: ContinuousHandle | null = null;
  private toolbar: ToolbarHandle | null = null;
  private overlay: OverlayHandle | null = null;
  private source: SourceViewHandle | null = null;

  private lastW = 0;
  private lastH = 0;
  private archive: EditionSummary[] | null = null;
  private busy = false;

  async start(): Promise<void> {
    applyTheme(this.settings.theme);
    applyLayout(this.settings.layout);
    applyRhythm(fontScale(this.settings));

    const route = parseRoute();
    const wanted = route.kind === 'latest' ? 'latest' : route.edition;

    try {
      this.edition = await fetchEdition(wanted);
    } catch (err) {
      this.showNotice(
        'No edition to print',
        'The reader could not reach the paper server, or there are no editions on disk.',
        err instanceof Error ? err.message : String(err),
      );
      return;
    }

    document.title = `${this.edition.manifest.masthead} — ${this.edition.manifest.date}`;

    this.paginator = new Paginator({
      edition: this.edition,
      images: this.edition.manifest.images ?? {},
      mastheadFactory: (w, hgt) => this.masthead(w, hgt),
    });

    this.mountChrome();
    await this.relayout('init');
    this.applyRoute();

    window.addEventListener('keydown', (e) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const target = e.target as HTMLElement | null;
      if (target && /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)) return;
      if (e.key === 'f' || e.key === 'F') {
        e.preventDefault();
        void toggleFullscreen();
      }
      if (e.key === 's' || e.key === 'S') {
        e.preventDefault();
        this.source?.show(this.visibleArticleIds());
      }
    });

    window.addEventListener('resize', this.onResize);
    window.matchMedia('(orientation: portrait)').addEventListener('change', () => {
      void this.relayout('orientation');
    });
    onFontsSettled(() => void this.relayout('fontsSettled'));
    onRouteChange(() => this.applyRoute());
  }

  // ---------------------------------------------------------------- chrome

  /**
   * The masthead, sized to the band it will occupy rather than to the
   * viewport. In a spread the band is half the window wide, so a `vw`-based
   * size wraps to two lines and swallows a third of the page.
   */
  private masthead(width = window.innerWidth, height = window.innerHeight): HTMLElement {
    const { manifest } = this.edition;
    const head = h('header', 'masthead');
    // Fit the name to the band: Playfair at weight 900 runs close to 0.53em per
    // character, so the size that fills a given width scales inversely with
    // the name's length. Held back so a short window never gives the masthead
    // more than it deserves.
    const perChar = 0.53 * Math.max(8, manifest.masthead.length);
    const size = Math.round(Math.max(28, Math.min((width * 0.92) / perChar, height * 0.1, 132)));
    head.style.setProperty('--fs-masthead', `${size}px`);
    head.append(h('h1', 'masthead__name', manifest.masthead));
    head.append(h('div', 'masthead__rules'));

    const date = new Date(`${manifest.date}T12:00:00`);
    const pretty = Number.isNaN(date.getTime())
      ? manifest.date
      : date.toLocaleDateString(undefined, {
          weekday: 'long',
          day: 'numeric',
          month: 'long',
          year: 'numeric',
        });

    const meta = h('div', 'masthead__meta');
    meta.append(h('span', undefined, `Vol. ${manifest.volume} · No. ${manifest.number}`));
    if (manifest.motto) meta.append(h('span', 'masthead__motto', manifest.motto));
    meta.append(h('span', undefined, pretty));
    head.append(meta);
    return head;
  }

  private mountChrome(): void {
    this.toolbar = mountToolbar(document.body, this.settings, {
      onScale: (index) => {
        if (index === this.settings.scaleIndex) return;
        this.settings.scaleIndex = index;
        saveSettings(this.settings);
        void this.relayout('fontScale');
      },
      onTheme: (theme) => {
        this.settings.theme = theme;
        applyTheme(theme);
        saveSettings(this.settings);
      },
      onContents: () => this.overlay?.showContents(),
      onArchive: () => void this.openArchive(),
      onMode: () => this.toggleMode(),
      onLayout: () => {
        this.settings.layout = this.settings.layout === 'magazine' ? 'broadsheet' : 'magazine';
        saveSettings(this.settings);
        applyLayout(this.settings.layout);
        this.toolbar?.setLayout(this.settings.layout);
        void this.relayout('layout');
      },
      onCover: () => {
        this.settings.coverAlone = !this.settings.coverAlone;
        saveSettings(this.settings);
        this.toolbar?.setCover(this.settings.coverAlone);
        void this.relayout('mode');
      },
    });

    this.overlay = mountOverlay(
      document.body,
      this.edition,
      () => this.plan!,
      {
        goToSection: (id) => {
          location.hash = sectionHref(this.edition.manifest.id, id);
        },
        goToArticle: (id) => {
          location.hash = articleHref(this.edition.manifest.id, id);
        },
        openEdition: (id) => {
          location.hash = `#/${id}`;
          location.reload();
        },
      },
    );

    mountPrintersMarks(document.body, this.edition.warnings, this.edition.manifest.lint ?? []);
    this.source = mountSourceView(document.body, this.edition, () => this.visibleArticleIds());
  }

  /** The stories on screen right now, in page order, for the source view. */
  private visibleArticleIds(): string[] {
    const ids: string[] = [];
    const add = (id: string | undefined) => {
      if (id && !id.startsWith('§') && this.edition.byId.has(id) && !ids.includes(id)) ids.push(id);
    };
    if (this.paged && this.plan) {
      for (const index of this.paged.visiblePages()) {
        for (const column of this.plan.pages[index]?.columns ?? []) {
          for (const item of column.items) add(item.articleId);
        }
      }
    } else {
      add(this.scroll?.anchor()?.articleId);
    }
    if (ids.length === 0) add(this.edition.order[0]?.id);
    return ids;
  }

  private async openArchive(): Promise<void> {
    if (!this.archive) {
      try {
        this.archive = await fetchArchive();
      } catch {
        this.archive = [];
      }
    }
    this.overlay?.showArchive(this.archive);
  }

  // ---------------------------------------------------------------- layout

  private currentMode(): ReadingMode {
    return chooseMode({
      w: window.innerWidth,
      h: window.innerHeight,
      modeOverride: this.settings.mode,
    });
  }

  private toggleMode(): void {
    const natural = chooseMode({ w: window.innerWidth, h: window.innerHeight });
    const current = this.currentMode();
    this.settings.mode = current === 'scroll' ? (natural === 'scroll' ? 'single' : natural) : 'scroll';
    saveSettings(this.settings);
    void this.relayout('mode');
  }

  /** Where the reader is right now, whichever view is mounted. */
  private anchor(): Cursor | null {
    return this.paged?.anchor() ?? this.scroll?.anchor() ?? null;
  }

  private onResize = debounce(() => {
    const w = window.innerWidth;
    const h = window.innerHeight;
    // Height-only changes are cheap (the ledger key excludes height), but they
    // are also the common case on iOS as the URL bar collapses. Width jitter
    // below the quantum is not worth reacting to at all.
    if (Math.abs(w - this.lastW) < WIDTH_EPSILON && h === this.lastH) return;
    void this.relayout('resize');
  }, 150);

  private async relayout(reason: string): Promise<void> {
    if (this.busy) return;

    // Never relayout mid-turn: queue behind the animation instead.
    if (this.paged?.defer && reason !== 'init') {
      let deferred = false;
      this.paged.defer(() => {
        deferred = true;
      });
      if (!deferred) {
        window.setTimeout(() => void this.relayout(reason), 80);
        return;
      }
    }

    this.busy = true;
    try {
      const anchor = this.anchor();
      const scale = fontScale(this.settings);
      applyRhythm(scale);

      this.lastW = window.innerWidth;
      this.lastH = window.innerHeight;

      const mode = this.currentMode();
      const started = performance.now();

      if (mode === 'scroll') {
        this.tearDown();
        const result = await this.paginator.paginate(
          window.innerWidth,
          window.innerHeight,
          scale,
          'scroll',
        );
        this.plan = result.plan;
        this.scroll = renderContinuous(app, this.edition, result.grid);
        if (anchor) this.scroll.goTo(anchor);
        this.toolbar?.setMode('Scroll');
        this.toolbar?.setPage(0, 0);
      } else {
        this.tearDown();
        const result = await this.paginator.paginate(
          window.innerWidth,
          window.innerHeight,
          scale,
          mode,
          this.settings.layout,
        );
        this.plan = result.plan;
        this.paged = renderPaged(app, {
          edition: this.edition,
          plan: result.plan,
          grid: result.grid,
          templates: result.templates,
          images: this.edition.manifest.images ?? {},
          masthead: (w, hgt) => this.masthead(w, hgt),
          mastheadName: this.edition.manifest.masthead,
          coverAlone: this.settings.coverAlone,
          onPageChange: (index) => {
            this.toolbar?.setPage(index, result.plan.pages.length);
          },
        });
        if (anchor) this.paged.goToAnchor(anchor);
        this.toolbar?.setMode('Paged');
        this.toolbar?.setLayout(this.settings.layout);
        this.toolbar?.setCover(this.settings.coverAlone);
        this.toolbar?.setPage(this.paged.pageIndex(), result.plan.pages.length);
      }

      if (import.meta.env.DEV) {
        // eslint-disable-next-line no-console
        console.info(
          `[paginate] ${reason}: ${Math.round(performance.now() - started)}ms, ` +
            `${this.plan?.pages.length ?? 0} pages, mode=${mode}, layout=${this.settings.layout}`,
        );
        this.auditColumns();
        this.exposeForDebug(reason, anchor);
      }
    } finally {
      this.busy = false;
    }
  }

  /**
   * Development hook. The engine's own view of where the reader is is far more
   * trustworthy than scraping the DOM for it, and anchor continuity is the
   * property most worth being able to check directly.
   */
  private exposeForDebug(reason: string, restoredFrom: Cursor | null): void {
    (window as unknown as { __vael: unknown }).__vael = {
      reason,
      restoredFrom,
      anchor: () => this.anchor(),
      pageIndex: () => this.paged?.pageIndex() ?? -1,
      pageCount: () => this.plan?.pages.length ?? 0,
      mode: this.currentMode(),
      layout: this.settings.layout,
      plan: this.plan,
      layoutKey: this.paginator.layoutKey,
      setScale: (i: number) => {
        this.settings.scaleIndex = i;
        saveSettings(this.settings);
        return this.relayout('fontScale');
      },
    };
  }

  private tearDown(): void {
    this.paged?.destroy();
    this.paged = null;
    this.scroll?.destroy();
    this.scroll = null;
  }

  /**
   * Development assertions. Both catch the same underlying fault from
   * different sides: the packer and the renderer disagreeing about how much
   * space something occupies, which is the one class of bug the slice-and-clip
   * design exists to prevent.
   *
   *  1. No rendered column may overflow its box.
   *  2. Every slice and every atomic block must be a whole number of
   *     baselines. A block half a baseline off shows up as a line sliced
   *     through the middle at a column foot, and it is far easier to catch
   *     here than to diagnose from a screenshot.
   */
  private auditColumns(): void {
    requestAnimationFrame(() => {
      const lh = Number.parseFloat(
        getComputedStyle(document.documentElement).getPropertyValue('--lh'),
      );
      const bad: string[] = [];

      for (const col of document.querySelectorAll<HTMLElement>('.stage .col')) {
        if (col.scrollHeight > col.clientHeight + 1) {
          bad.push(`col ${col.dataset.col} overflows: ${col.scrollHeight} > ${col.clientHeight}`);
        }
      }
      if (lh > 0) {
        const offGrid = (el: HTMLElement, what: string) => {
          if (el.offsetHeight % lh !== 0) {
            bad.push(`${what} is ${el.offsetHeight}px, not a multiple of ${lh}`);
          }
        };
        for (const slice of document.querySelectorAll<HTMLElement>('.stage .slice')) {
          offGrid(slice, 'slice');
        }
        for (const atom of document.querySelectorAll<HTMLElement>('.stage [data-atomic]')) {
          offGrid(atom, atom.className || atom.tagName.toLowerCase());
        }
      }

      if (bad.length) {
        // eslint-disable-next-line no-console
        console.warn('[audit]\n  ' + [...new Set(bad)].join('\n  '));
      }
    });
  }

  // ---------------------------------------------------------------- routing

  private applyRoute(): void {
    if (!this.plan) return;
    const route = parseRoute();
    const editionId = this.edition.manifest.id;

    switch (route.kind) {
      case 'article': {
        const entry = this.plan.byArticle.get(route.articleId);
        if (entry) this.goTo(entry.startPage, route.articleId);
        break;
      }
      case 'section': {
        const cursor = this.plan.bySection.get(route.sectionId);
        if (cursor) {
          const page = this.plan.anchorToPage(cursor);
          this.goTo(page, cursor.articleId);
        }
        break;
      }
      case 'page': {
        // A page route is lossy: resolve it, then rewrite to the canonical
        // article address so a reload on another device lands on the same text.
        const index = Math.min(route.page - 1, this.plan.pages.length - 1);
        const anchor = this.plan.pages[index]?.topAnchor;
        this.goTo(index, anchor?.articleId);
        if (anchor) replaceRoute(articleHref(editionId, anchor.articleId));
        break;
      }
      default:
        break;
    }
  }

  private goTo(page: number, articleId?: string): void {
    if (this.paged) {
      this.paged.goToPage(page, { animate: false });
    } else if (this.scroll && articleId) {
      this.scroll.goTo({ articleId, blockIndex: 0, lineIndex: 0 });
    }
  }

  // ---------------------------------------------------------------- errors

  private showNotice(title: string, detail: string, hint?: string): void {
    const notice = h('div', 'notice');
    notice.append(h('h2', undefined, title));
    notice.append(h('p', undefined, detail));
    if (hint) {
      const p = h('p');
      p.append(h('code', undefined, hint));
      notice.append(p);
    }
    app.replaceChildren(notice);
  }
}

void new Reader().start();

// Referenced so the constant documents itself in one place.
export { PAGINATION_MIN_WIDTH };
