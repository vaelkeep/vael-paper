/**
 * Reader preferences. Persisted per-device in localStorage; nothing here ever
 * leaves the browser.
 */

import type { ReadingMode } from '../model/types';
import { DEFAULT_SCALE_INDEX, FONT_SCALES } from '../layout/geometry';

export type Theme = 'day' | 'sepia' | 'night';
export const THEMES: Theme[] = ['day', 'sepia', 'night'];

export interface Settings {
  scaleIndex: number;
  theme: Theme;
  /** null = follow the breakpoint. Anything else is the reader overruling it. */
  mode: ReadingMode | null;
  /**
   * Present the front page alone, like a folded paper on a doormat, rather
   * than paired with page two. It is the more faithful of the two and it
   * costs half the screen, so it is off by default and offered as a choice.
   */
  coverAlone: boolean;
}

const KEY = 'vael-paper.settings';

const DEFAULTS: Settings = {
  scaleIndex: DEFAULT_SCALE_INDEX,
  theme: 'day',
  mode: null,
  coverAlone: false,
};

export function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return { ...DEFAULTS };
    const parsed = JSON.parse(raw) as Partial<Settings>;
    return {
      scaleIndex:
        typeof parsed.scaleIndex === 'number' &&
        parsed.scaleIndex >= 0 &&
        parsed.scaleIndex < FONT_SCALES.length
          ? parsed.scaleIndex
          : DEFAULTS.scaleIndex,
      theme: THEMES.includes(parsed.theme as Theme) ? (parsed.theme as Theme) : 'day',
      mode:
        parsed.mode === 'scroll' || parsed.mode === 'single' || parsed.mode === 'spread'
          ? parsed.mode
          : null,
      coverAlone: parsed.coverAlone === true,
    };
  } catch {
    // Private browsing, cleared site data, or storage disabled entirely. The
    // reader must work regardless, so fall back rather than surfacing anything.
    return { ...DEFAULTS };
  }
}

export function saveSettings(settings: Settings): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(settings));
  } catch {
    /* not worth telling the reader about */
  }
}

export function fontScale(settings: Settings): number {
  return FONT_SCALES[settings.scaleIndex] ?? 1;
}

export function applyTheme(theme: Theme): void {
  document.documentElement.dataset.theme = theme;
}
