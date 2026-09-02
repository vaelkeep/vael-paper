/**
 * Contents and archive: one modal sheet, two lists.
 *
 * Section entries resolve through the plan rather than storing page numbers,
 * because a page number is only true for the layout that produced it.
 */

import type { Edition } from '../content/manifest';
import type { EditionSummary } from '../model/types';
import type { EditionPlan } from '../layout/planner';
import { h } from '../util/dom';

export interface OverlayActions {
  goToSection(sectionId: string): void;
  goToArticle(articleId: string): void;
  openEdition(id: string): void;
}

export interface OverlayHandle {
  showContents(): void;
  showArchive(editions: EditionSummary[]): void;
  hide(): void;
  destroy(): void;
}

export function mountOverlay(
  host: HTMLElement,
  edition: Edition,
  plan: () => EditionPlan,
  actions: OverlayActions,
): OverlayHandle {
  const scrim = h('div', 'overlay');
  scrim.hidden = true;
  const sheet = h('div', 'overlay__sheet');
  sheet.setAttribute('role', 'dialog');
  sheet.setAttribute('aria-modal', 'true');
  scrim.append(sheet);
  host.append(scrim);

  const hide = () => {
    scrim.hidden = true;
  };

  scrim.addEventListener('click', (e) => {
    if (e.target === scrim) hide();
  });
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !scrim.hidden) hide();
  });

  const open = (title: string, body: HTMLElement) => {
    sheet.replaceChildren();
    const header = h('div', 'overlay__head');
    header.append(h('h2', 'overlay__title', title));
    const close = h('button', 'overlay__close', '×') as HTMLButtonElement;
    close.type = 'button';
    close.setAttribute('aria-label', 'Close');
    close.addEventListener('click', hide);
    header.append(close);
    sheet.append(header, body);
    scrim.hidden = false;
    close.focus();
  };

  return {
    showContents() {
      const list = h('ul', 'contents');
      const current = plan();

      for (const section of edition.sections) {
        const item = h('li', 'contents__section');
        const label = h('button', 'contents__section-name', section.name) as HTMLButtonElement;
        label.type = 'button';
        label.addEventListener('click', () => {
          hide();
          actions.goToSection(section.id);
        });
        item.append(label);

        const stories = h('ul', 'contents__stories');
        for (const id of section.articles) {
          const article = edition.byId.get(id);
          if (!article) continue;
          const row = h('li');
          const link = h('button', 'contents__story') as HTMLButtonElement;
          link.type = 'button';
          link.append(h('span', 'contents__headline', article.meta.headline));
          const page = current.byArticle.get(id)?.startPage;
          if (page !== undefined) {
            link.append(h('span', 'contents__page', String(page + 1)));
          }
          link.addEventListener('click', () => {
            hide();
            actions.goToArticle(id);
          });
          row.append(link);
          stories.append(row);
        }
        item.append(stories);
        list.append(item);
      }
      open('Contents', list);
    },

    showArchive(editions) {
      const list = h('ul', 'archive');
      for (const summary of editions) {
        const row = h('li');
        const link = h('button', 'archive__row') as HTMLButtonElement;
        link.type = 'button';
        const date = new Date(`${summary.date}T12:00:00`);
        const label = Number.isNaN(date.getTime())
          ? summary.date
          : date.toLocaleDateString(undefined, {
              weekday: 'short',
              day: 'numeric',
              month: 'long',
              year: 'numeric',
            });
        link.append(h('span', 'archive__date', label));
        link.append(
          h('span', 'archive__meta', `No. ${summary.number} · ${summary.article_count} stories`),
        );
        if (summary.id === edition.manifest.id) link.dataset.current = 'true';
        link.addEventListener('click', () => {
          hide();
          actions.openEdition(summary.id);
        });
        row.append(link);
        list.append(row);
      }
      open('Earlier editions', list);
    },

    hide,
    destroy() {
      scrim.remove();
    },
  };
}
