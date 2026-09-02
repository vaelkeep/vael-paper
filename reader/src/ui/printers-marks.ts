/**
 * Printer's marks: the warnings from the scan, tucked behind one small
 * affordance.
 *
 * The generator runs unattended overnight. A malformed article should be
 * *visible* the next morning without being fatal, which is the whole reason
 * both the server and the client collect warnings instead of throwing.
 */

import type { Warning } from '../model/types';
import { h } from '../util/dom';

export function mountPrintersMarks(
  host: HTMLElement,
  warnings: Warning[],
  lint: Warning[] = [],
): void {
  if (warnings.length === 0 && lint.length === 0) return;

  const wrap = h('div', 'marks');
  const parts: string[] = [];
  if (warnings.length > 0) {
    parts.push(`${warnings.length} printer's mark${warnings.length === 1 ? '' : 's'}`);
  }
  if (lint.length > 0) parts.push(`${lint.length} lint`);
  const toggle = h('button', 'marks__toggle', parts.join(' · ')) as HTMLButtonElement;
  toggle.type = 'button';
  toggle.setAttribute('aria-expanded', 'false');

  const list = h('ul', 'marks__list');
  list.hidden = true;
  const where = (w: Warning) =>
    w.file ? (w.line ? `${w.file}:${w.line}` : w.file) : w.scope;
  for (const [kind, items] of [
    ['mark', warnings],
    ['lint', lint],
  ] as const) {
    for (const warning of items) {
      const item = h('li', `marks__item marks__item--${kind}`);
      item.append(h('span', 'marks__scope', `${where(warning)} · ${warning.code}`));
      item.append(document.createTextNode(warning.message));
      list.append(item);
    }
  }

  toggle.addEventListener('click', () => {
    list.hidden = !list.hidden;
    toggle.setAttribute('aria-expanded', String(!list.hidden));
  });

  wrap.append(toggle, list);
  host.append(wrap);
}
