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

export function mountPrintersMarks(host: HTMLElement, warnings: Warning[]): void {
  if (warnings.length === 0) return;

  const wrap = h('div', 'marks');
  const toggle = h(
    'button',
    'marks__toggle',
    `${warnings.length} printer's mark${warnings.length === 1 ? '' : 's'}`,
  ) as HTMLButtonElement;
  toggle.type = 'button';
  toggle.setAttribute('aria-expanded', 'false');

  const list = h('ul', 'marks__list');
  list.hidden = true;
  for (const warning of warnings) {
    const item = h('li');
    item.append(h('span', 'marks__scope', `${warning.scope} · ${warning.code}`));
    item.append(document.createTextNode(warning.message));
    list.append(item);
  }

  toggle.addEventListener('click', () => {
    list.hidden = !list.hidden;
    toggle.setAttribute('aria-expanded', String(!list.hidden));
  });

  wrap.append(toggle, list);
  host.append(wrap);
}
