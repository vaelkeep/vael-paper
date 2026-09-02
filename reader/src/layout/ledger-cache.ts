/**
 * Ledger cache.
 *
 * The key deliberately excludes page height. Line breaking depends only on the
 * measure, so a height-only change — an iPad Safari toolbar collapsing, Stage
 * Manager resizing a window, a desktop window dragged shorter — reuses every
 * ledger and costs a repack of a few milliseconds instead of a full remeasure.
 */

import type { GridMetrics, LedgerKey, LineLedger, ParsedArticle } from '../model/types';

export function ledgerKeyOf(
  article: ParsedArticle,
  grid: GridMetrics,
  fontsVersion: string,
): LedgerKey {
  return {
    articleId: article.id,
    contentHash: article.hash,
    colW: grid.colW,
    fontScale: grid.fontScale,
    fontsVersion,
  };
}

export function keyString(key: LedgerKey): string {
  return `${key.articleId}:${key.contentHash}:${key.colW}:${key.fontScale}:${key.fontsVersion}`;
}

export class LedgerCache {
  private store = new Map<string, LineLedger>();

  has(article: ParsedArticle, grid: GridMetrics, fontsVersion: string): boolean {
    return this.store.has(keyString(ledgerKeyOf(article, grid, fontsVersion)));
  }

  get(article: ParsedArticle, grid: GridMetrics, fontsVersion: string): LineLedger | undefined {
    return this.store.get(keyString(ledgerKeyOf(article, grid, fontsVersion)));
  }

  set(ledger: LineLedger): void {
    this.store.set(keyString(ledger.key), ledger);
  }

  /** Ledgers for one layout, indexed by article id — what the planner wants. */
  view(
    articles: ParsedArticle[],
    grid: GridMetrics,
    fontsVersion: string,
  ): Map<string, LineLedger> {
    const out = new Map<string, LineLedger>();
    for (const article of articles) {
      const ledger = this.get(article, grid, fontsVersion);
      if (ledger) out.set(article.id, ledger);
    }
    return out;
  }

  missing(
    articles: ParsedArticle[],
    grid: GridMetrics,
    fontsVersion: string,
  ): ParsedArticle[] {
    return articles.filter((a) => !this.has(a, grid, fontsVersion));
  }

  /** Drop everything measured at a width we have moved away from. */
  evictExcept(colW: number, fontScale: number): void {
    for (const [key, ledger] of this.store) {
      if (ledger.key.colW !== colW || ledger.key.fontScale !== fontScale) {
        this.store.delete(key);
      }
    }
  }

  get size(): number {
    return this.store.size;
  }
}
