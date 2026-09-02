/**
 * Font readiness.
 *
 * The ledger is measured against real font metrics. Measuring while a fallback
 * face is still in place produces wrong line counts and a visible reflow when
 * the real face lands, so every measurement pass is gated on these faces being
 * genuinely loaded — not merely on `document.fonts.ready`, which resolves for
 * the faces the browser has decided to load, which is not the same question.
 */

/** Faces the paginator actually measures against. */
const REQUIRED: Array<[weight: string, style: string, family: string]> = [
  ['400', 'normal', 'Source Serif 4'],
  ['400', 'italic', 'Source Serif 4'],
  ['600', 'normal', 'Source Serif 4'],
  ['700', 'normal', 'Playfair Display'],
  ['900', 'normal', 'Playfair Display'],
];

let version = 'boot';

export function fontsVersion(): string {
  return version;
}

export async function waitForFonts(sizePx: number): Promise<string> {
  if (!('fonts' in document)) {
    version = 'nofontapi';
    return version;
  }
  try {
    await Promise.all(
      REQUIRED.map(([weight, style, family]) =>
        document.fonts.load(`${style} ${weight} ${sizePx}px "${family}"`),
      ),
    );
    await document.fonts.ready;
    version = `loaded-${document.fonts.size}`;
  } catch {
    // A metric-compatible fallback still renders; line counts shift slightly,
    // and the version token below keeps that from poisoning the cache.
    version = 'fallback';
  }
  return version;
}

/** Re-measure if faces arrive after first paint (a slow cold cache). */
export function onFontsSettled(cb: () => void): void {
  if (!('fonts' in document)) return;
  document.fonts.addEventListener('loadingdone', () => {
    const next = `loaded-${document.fonts.size}`;
    if (next !== version) {
      version = next;
      cb();
    }
  });
}
