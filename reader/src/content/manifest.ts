/**
 * Fetch an edition and turn it into something the layout engine can trust.
 *
 * Like the server's scanner, nothing here throws on content. The server has
 * already recorded its own warnings; this pass adds the ones only the client
 * can see, and both lists end up behind the same printer's-marks affordance.
 */

import type {
  Block,
  EditionManifest,
  EditionSummary,
  ParsedArticle,
  Section,
  Warning,
} from '../model/types';
import { hashString, parseMarkdown } from './markdown';

export interface Edition {
  manifest: EditionManifest;
  /** Reading order: sections in manifest order, articles within each. */
  order: ParsedArticle[];
  byId: Map<string, ParsedArticle>;
  sections: Section[];
  warnings: Warning[];
}

async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url, { headers: { accept: 'application/json' } });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText} for ${url}`);
  return (await res.json()) as T;
}

export function fetchArchive(): Promise<EditionSummary[]> {
  return getJson<EditionSummary[]>('/api/editions');
}

export async function fetchEdition(id = 'latest'): Promise<Edition> {
  return prepare(await getJson<EditionManifest>(`/api/editions/${id}`));
}

export function prepare(manifest: EditionManifest): Edition {
  const warnings: Warning[] = [...(manifest.warnings ?? [])];
  const byId = new Map<string, ParsedArticle>();

  for (const meta of manifest.articles ?? []) {
    const blocks = parseMarkdown(meta.body ?? '');

    // An article's frontmatter image becomes a real block rather than separate
    // furniture. Block indices are the currency of every cursor, ledger and
    // slice in the layout engine, so anything occupying vertical space has to
    // live in this list or the indices stop lining up with the rendered DOM.
    if (meta.image) {
      if (manifest.images?.[meta.image]) {
        const figure: Block = { kind: 'figure', imageKey: meta.image, scope: 'region' };
        if (meta.caption) figure.caption = meta.caption;
        if (meta.focus) figure.focus = meta.focus;
        blocks.unshift(figure);
      } else {
        warnings.push({
          scope: `article:${meta.id}`,
          code: 'missing_lead_image',
          message: `Lead image ${meta.image} is not in the manifest; dropped.`,
        });
      }
    }
    // The credit line is a block, not chrome: it occupies vertical space, so
    // the paginator has to measure and place it like anything else.
    if (meta.sources?.length) {
      blocks.push({ kind: 'sources', sources: meta.sources });
    }

    if (blocks.length === 0) {
      warnings.push({
        scope: `article:${meta.id}`,
        code: 'empty_body',
        message: 'Article has a headline but no body.',
      });
    }
    // A figure referencing an image the server never resolved would reserve
    // space for something that will never arrive, so drop it here.
    const kept = blocks.filter((b) => {
      if (b.kind !== 'figure') return true;
      if (manifest.images?.[b.imageKey]) return true;
      warnings.push({
        scope: `article:${meta.id}`,
        code: 'missing_inline_image',
        message: `Inline image ${b.imageKey} is not in the manifest; dropped.`,
      });
      return false;
    });
    byId.set(meta.id, {
      id: meta.id,
      meta,
      blocks: kept,
      hash: hashString(meta.body ?? ''),
    });
  }

  const sections = (manifest.sections ?? []).filter((s) => s.articles.length > 0);
  const order: ParsedArticle[] = [];
  for (const section of sections) {
    for (const id of section.articles) {
      const article = byId.get(id);
      if (article) order.push(article);
    }
  }

  if (order.length === 0 && byId.size > 0) {
    // Sections are empty or nonsensical; fall back to manifest order so the
    // paper still prints rather than showing a blank page.
    warnings.push({
      scope: 'edition',
      code: 'no_reading_order',
      message: 'No usable sections; falling back to manifest article order.',
    });
    order.push(...byId.values());
  }

  return { manifest, order, byId, sections, warnings };
}

/** Front-page candidates, most important first. Used by the template matcher. */
export function byPriority(edition: Edition): ParsedArticle[] {
  return [...edition.order].sort((a, b) => {
    const p = a.meta.priority - b.meta.priority;
    if (p !== 0) return p;
    return edition.order.indexOf(a) - edition.order.indexOf(b);
  });
}
