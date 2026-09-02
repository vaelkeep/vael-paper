/**
 * Hash routing.
 *
 * Page numbers are a function of the layout key — viewport, font size, mode —
 * so they cannot be identity. The canonical address is the article slug, which
 * is stable across every device; a page route is accepted, resolved under the
 * current pagination, and immediately rewritten to the canonical form.
 */

export type Route =
  | { kind: 'latest' }
  | { kind: 'edition'; edition: string }
  | { kind: 'article'; edition: string; articleId: string }
  | { kind: 'section'; edition: string; sectionId: string }
  | { kind: 'page'; edition: string; page: number };

export function parseRoute(hash = location.hash): Route {
  const path = hash.replace(/^#\/?/, '').split('/').filter(Boolean);
  if (path.length === 0) return { kind: 'latest' };

  const edition = path[0]!;
  if (path.length === 1) return { kind: 'edition', edition };

  const [, kind, value] = path;
  if (kind === 'a' && value) return { kind: 'article', edition, articleId: value };
  if (kind === 's' && value) return { kind: 'section', edition, sectionId: value };
  if (kind === 'p' && value) {
    const page = Number.parseInt(value, 10);
    if (Number.isFinite(page) && page > 0) return { kind: 'page', edition, page };
  }
  if (kind?.startsWith('p')) {
    const page = Number.parseInt(kind.slice(1), 10);
    if (Number.isFinite(page) && page > 0) return { kind: 'page', edition, page };
  }
  return { kind: 'edition', edition };
}

export function articleHref(edition: string, articleId: string): string {
  return `#/${edition}/a/${articleId}`;
}

export function sectionHref(edition: string, sectionId: string): string {
  return `#/${edition}/s/${sectionId}`;
}

/** Rewrite without adding a history entry — used when normalising a page route. */
export function replaceRoute(href: string): void {
  history.replaceState(null, '', href);
}

export function pushRoute(href: string): void {
  if (location.hash !== href) history.pushState(null, '', href);
}

export function onRouteChange(fn: (route: Route) => void): void {
  window.addEventListener('hashchange', () => fn(parseRoute()));
  window.addEventListener('popstate', () => fn(parseRoute()));
}
