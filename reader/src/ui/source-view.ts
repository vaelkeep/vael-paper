/**
 * View source.
 *
 * A small button in the top-left corner opens a sheet showing the markdown
 * behind whatever is on the page, one tab per story on the visible sheet plus
 * the manifest. The point is that the demo explains itself: anyone can see
 * that an edition is nothing more than a folder of markdown and one JSON file,
 * and that what they are reading is exactly what was written.
 */

import type { Edition } from '../content/manifest';
import { highlightSource, type SourceKind } from '../content/highlight';
import { h } from '../util/dom';

export interface SourceViewHandle {
  /** Open the sheet on these stories (visible ones first), or on the manifest. */
  show(articleIds: string[]): void;
  hide(): void;
  destroy(): void;
}

const FORMAT_DOC = 'https://github.com/vaelkeep/vael-paper/blob/main/docs/FORMAT.md';

interface Tab {
  key: string;
  label: string;
  kind: SourceKind;
  text: string;
}

export function mountSourceView(
  host: HTMLElement,
  edition: Edition,
  onOpen: () => string[],
): SourceViewHandle {
  const trigger = h('button', 'source-button', 'Source') as HTMLButtonElement;
  trigger.type = 'button';
  trigger.title = 'View the markdown behind this page (S)';
  trigger.setAttribute('aria-label', 'View source');

  const scrim = h('div', 'overlay overlay--source');
  scrim.hidden = true;
  const sheet = h('div', 'overlay__sheet overlay__sheet--wide');
  sheet.setAttribute('role', 'dialog');
  sheet.setAttribute('aria-modal', 'true');
  scrim.append(sheet);
  host.append(trigger, scrim);

  const hide = () => {
    scrim.hidden = true;
  };

  const tabFor = (id: string): Tab | null => {
    const article = edition.byId.get(id);
    if (!article) return null;
    return {
      key: id,
      label: article.meta.file,
      kind: 'article',
      text: article.meta.source ?? article.meta.body,
    };
  };

  const manifestTab = (): Tab => ({
    key: 'edition.json',
    label: 'edition.json',
    kind: 'manifest',
    text:
      edition.manifest.manifest_source ??
      JSON.stringify(
        { schema: edition.manifest.schema, sections: edition.sections },
        null,
        2,
      ),
  });

  const render = (tabs: Tab[], active: number) => {
    sheet.replaceChildren();

    const header = h('div', 'overlay__head');
    header.append(h('h2', 'overlay__title', 'Source'));
    const close = h('button', 'overlay__close', '×') as HTMLButtonElement;
    close.type = 'button';
    close.setAttribute('aria-label', 'Close');
    close.addEventListener('click', hide);
    header.append(close);

    const strip = h('div', 'source__tabs');
    strip.setAttribute('role', 'tablist');
    tabs.forEach((tab, i) => {
      const button = h('button', 'source__tab', tab.label) as HTMLButtonElement;
      button.type = 'button';
      button.setAttribute('role', 'tab');
      button.setAttribute('aria-selected', String(i === active));
      button.addEventListener('click', () => render(tabs, i));
      strip.append(button);
    });

    // Stories not on this sheet are a menu away rather than a tab each.
    const elsewhere = edition.order.filter((a) => !tabs.some((t) => t.key === a.id));
    if (elsewhere.length > 0) {
      const select = h('select', 'source__more') as HTMLSelectElement;
      select.setAttribute('aria-label', 'Other stories');
      const placeholder = h('option', undefined, 'Other stories…') as HTMLOptionElement;
      placeholder.value = '';
      select.append(placeholder);
      for (const article of elsewhere) {
        const option = h('option', undefined, article.meta.headline) as HTMLOptionElement;
        option.value = article.id;
        select.append(option);
      }
      select.addEventListener('change', () => {
        const tab = tabFor(select.value);
        if (tab) render([tab, ...tabs.filter((t) => t.kind !== 'manifest'), manifestTab()], 0);
      });
      strip.append(select);
    }

    const current = tabs[active] ?? tabs[0]!;
    const pre = h('pre', 'source__code');
    const code = h('code', `language-${current.kind === 'manifest' ? 'json' : 'markdown'}`);
    code.innerHTML = highlightSource(current.text, current.kind);
    pre.append(code);

    const foot = h('div', 'source__foot');
    const copy = h('button', 'source__copy', 'Copy') as HTMLButtonElement;
    copy.type = 'button';
    copy.addEventListener('click', () => {
      void navigator.clipboard?.writeText(current.text).then(() => {
        copy.textContent = 'Copied';
        window.setTimeout(() => (copy.textContent = 'Copy'), 1400);
      });
    });
    const note = h('p', 'source__note');
    note.append(
      'An edition is a folder of files like this one and a manifest. The format is documented in ',
    );
    const link = h('a', undefined, 'FORMAT.md') as HTMLAnchorElement;
    link.href = FORMAT_DOC;
    link.target = '_blank';
    link.rel = 'noopener';
    note.append(link, '.');
    foot.append(note, copy);

    sheet.append(header, strip, pre, foot);
    scrim.hidden = false;
    pre.scrollTop = 0;
    close.focus({ preventScroll: true });
  };

  const show = (articleIds: string[]) => {
    const tabs = articleIds.map(tabFor).filter((t): t is Tab => t !== null);
    tabs.push(manifestTab());
    render(tabs, 0);
  };

  trigger.addEventListener('click', () => show(onOpen()));
  scrim.addEventListener('click', (e) => {
    if (e.target === scrim) hide();
  });
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape' && !scrim.hidden) hide();
  };
  window.addEventListener('keydown', onKey);

  return {
    show,
    hide,
    destroy() {
      window.removeEventListener('keydown', onKey);
      trigger.remove();
      scrim.remove();
    },
  };
}
