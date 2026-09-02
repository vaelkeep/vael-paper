/**
 * Continuous reading mode.
 *
 * This is the phone default, and the fallback everywhere. It bypasses exactly
 * two things — the packer and the page surface — and reuses the parser, the
 * ribbon builder, the templates' source order, the image pipeline and all the
 * typography. That shared lineage is why switching modes preserves the reader's
 * position instead of dumping them at the top.
 *
 * It is also the first thing built, deliberately: it puts the full broadsheet
 * typography on screen so it can be tuned before the pagination engine exists
 * to complicate the feedback.
 */

import type { Edition } from '../content/manifest';
import type { Cursor, GridMetrics, ParsedArticle } from '../model/types';
import { buildHead, buildRibbon } from '../render/ribbon';
import { h } from '../util/dom';

export interface ContinuousHandle {
  /** Where the reader currently is, for preserving position across a relayout. */
  anchor(): Cursor | null;
  /** Scroll to a position produced by `anchor()` (or any other cursor). */
  goTo(cursor: Cursor): void;
  destroy(): void;
}

function mastheadEl(edition: Edition): HTMLElement {
  const { manifest } = edition;
  const head = h('header', 'masthead');
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

function sectionRule(name: string): HTMLElement {
  const rule = h('div', 'section-rule');
  rule.append(h('span', 'section-rule__name', name));
  rule.append(h('span', 'section-rule__fill'));
  return rule;
}

export function renderContinuous(
  host: HTMLElement,
  edition: Edition,
  grid: GridMetrics,
): ContinuousHandle {
  const paper = h('div', 'paper paper--scroll');
  paper.append(mastheadEl(edition));

  const options = {
    lineHeight: grid.lineHeight,
    colW: grid.colW,
    maxFigureLines: grid.maxFigureLines,
    images: edition.manifest.images ?? {},
  };

  const blockNodes: Array<{ node: Element; cursor: Cursor }> = [];

  const emit = (article: ParsedArticle, lead: boolean) => {
    const wrap = h('article', 'story');
    wrap.dataset.article = article.id;
    wrap.append(buildHead(article, { ...options, lead }));
    const ribbon = buildRibbon(article, options);
    wrap.append(ribbon);
    paper.append(wrap);

    // Ribbon children map one-to-one onto article.blocks, so a scroll position
    // maps straight back to a cursor with no offset arithmetic.
    Array.from(ribbon.children).forEach((node, blockIndex) => {
      blockNodes.push({
        node,
        cursor: { articleId: article.id, blockIndex, lineIndex: 0 },
      });
    });
  };

  let first = true;
  for (const section of edition.sections) {
    paper.append(sectionRule(section.name));
    for (const id of section.articles) {
      const article = edition.byId.get(id);
      if (!article) continue;
      emit(article, first);
      first = false;
    }
  }

  host.replaceChildren(paper);

  // Track the topmost visible block. IntersectionObserver rather than a scroll
  // listener: it reports without forcing layout, so it cannot fight the
  // measurement phases.
  let current: Cursor | null = blockNodes[0]?.cursor ?? null;
  const visible = new Set<Element>();
  const observer = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (entry.isIntersecting) visible.add(entry.target);
        else visible.delete(entry.target);
      }
      let best: { top: number; cursor: Cursor } | null = null;
      for (const { node, cursor } of blockNodes) {
        if (!visible.has(node)) continue;
        const top = node.getBoundingClientRect().top;
        if (!best || top < best.top) best = { top, cursor };
      }
      if (best) current = best.cursor;
    },
    { rootMargin: '0px 0px -70% 0px', threshold: 0 },
  );
  for (const { node } of blockNodes) observer.observe(node);

  return {
    anchor: () => current,
    goTo(cursor) {
      const match =
        blockNodes.find(
          (b) =>
            b.cursor.articleId === cursor.articleId &&
            b.cursor.blockIndex === cursor.blockIndex,
        ) ?? blockNodes.find((b) => b.cursor.articleId === cursor.articleId);
      match?.node.scrollIntoView({ block: 'start', behavior: 'auto' });
    },
    destroy() {
      observer.disconnect();
    },
  };
}
