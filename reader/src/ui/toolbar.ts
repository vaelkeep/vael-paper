/**
 * The reader's controls: text size, ground, contents, archive, page position.
 *
 * It hides itself while reading and returns on any interaction — a newspaper
 * has no chrome, and the closer this gets to that the better.
 */

import { FONT_SCALES } from '../layout/geometry';
import { THEMES, type Settings, type Theme } from '../app/settings';
import { fullscreenSupported, isFullscreen, toggleFullscreen, onFullscreenChange } from '../util/fullscreen';
import { h } from '../util/dom';

export interface ToolbarActions {
  onScale(index: number): void;
  onTheme(theme: Theme): void;
  onContents(): void;
  onArchive(): void;
  onMode(): void;
  onCover(): void;
}

export interface ToolbarHandle {
  setPage(index: number, count: number): void;
  setMode(label: string): void;
  setCover(alone: boolean): void;
  reveal(): void;
  destroy(): void;
}

const THEME_LABEL: Record<Theme, string> = {
  day: 'Day',
  sepia: 'Sepia',
  night: 'Night',
};

function button(label: string, title: string, onClick: () => void): HTMLButtonElement {
  const node = h('button', undefined, label) as HTMLButtonElement;
  node.type = 'button';
  node.title = title;
  node.setAttribute('aria-label', title);
  node.addEventListener('click', onClick);
  return node;
}

export function mountToolbar(
  host: HTMLElement,
  settings: Settings,
  actions: ToolbarActions,
): ToolbarHandle {
  const bar = h('div', 'toolbar');
  bar.setAttribute('role', 'toolbar');
  bar.setAttribute('aria-label', 'Reader controls');

  const smaller = button('A', 'Smaller text', () => {
    actions.onScale(Math.max(0, settings.scaleIndex - 1));
  });
  smaller.classList.add('toolbar__a-small');

  const larger = button('A', 'Larger text', () => {
    actions.onScale(Math.min(FONT_SCALES.length - 1, settings.scaleIndex + 1));
  });
  larger.classList.add('toolbar__a-large');

  const theme = button(THEME_LABEL[settings.theme], 'Change the ground', () => {
    const next = THEMES[(THEMES.indexOf(settings.theme) + 1) % THEMES.length]!;
    theme.textContent = THEME_LABEL[next];
    actions.onTheme(next);
  });

  const contents = button('Contents', 'Contents and sections', actions.onContents);
  const archive = button('Archive', 'Earlier editions', actions.onArchive);
  const mode = button('Paged', 'Switch between paged and scrolling', actions.onMode);

  const cover = button('Cover', 'Show the front page alone, or paired', actions.onCover);
  cover.setAttribute('aria-pressed', String(settings.coverAlone));

  // iOS Safari implements the Fullscreen API for video only. There, the
  // equivalent is Add to Home Screen, which this app already supports — so
  // offer nothing rather than a button that silently fails.
  const full = fullscreenSupported()
    ? button('⛶', 'Full screen', () => {
        void toggleFullscreen();
      })
    : null;
  if (full) {
    full.classList.add('toolbar__glyph');
    full.setAttribute('aria-pressed', String(isFullscreen()));
    onFullscreenChange((active) => {
      full.setAttribute('aria-pressed', String(active));
      full.title = active ? 'Leave full screen' : 'Full screen';
    });
  }

  const position = h('span', 'toolbar__position');
  position.setAttribute('aria-live', 'polite');

  bar.append(
    smaller,
    larger,
    h('span', 'toolbar__sep'),
    theme,
    h('span', 'toolbar__sep'),
    contents,
    archive,
    mode,
    cover,
  );
  if (full) bar.append(full);
  bar.append(h('span', 'toolbar__sep'), position);
  host.append(bar);

  // Fade away while reading; any pointer movement or key brings it back.
  let timer: number | undefined;
  const reveal = () => {
    bar.dataset.hidden = 'false';
    if (timer !== undefined) clearTimeout(timer);
    timer = window.setTimeout(() => {
      bar.dataset.hidden = 'true';
    }, 2600);
  };
  reveal();

  const onActivity = () => reveal();
  window.addEventListener('pointermove', onActivity, { passive: true });
  window.addEventListener('keydown', onActivity);
  window.addEventListener('pointerdown', onActivity, { passive: true });

  return {
    setPage(index, count) {
      position.textContent = count > 0 ? `${index + 1} / ${count}` : '';
    },
    setMode(label) {
      mode.textContent = label;
      // Pairing only means anything in a spread.
      cover.hidden = label !== 'Paged';
    },
    setCover(alone) {
      cover.setAttribute('aria-pressed', String(alone));
    },
    reveal,
    destroy() {
      window.removeEventListener('pointermove', onActivity);
      window.removeEventListener('keydown', onActivity);
      window.removeEventListener('pointerdown', onActivity);
      bar.remove();
    },
  };
}
