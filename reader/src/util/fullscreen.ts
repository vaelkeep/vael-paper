/**
 * Fullscreen, with the vendor-prefix and platform reality wrapped up.
 *
 * Safari still needs the `webkit` spellings, and iOS Safari does not implement
 * the API for ordinary elements at all — only for video. On iOS the equivalent
 * is "Add to Home Screen", which the app is already set up for
 * (`apple-mobile-web-app-capable`), so the control hides itself rather than
 * offering a button that does nothing.
 */

interface WebkitDocument extends Document {
  webkitFullscreenEnabled?: boolean;
  webkitFullscreenElement?: Element | null;
  webkitExitFullscreen?: () => Promise<void>;
}

interface WebkitElement extends HTMLElement {
  webkitRequestFullscreen?: () => Promise<void>;
}

const doc = document as WebkitDocument;

export function fullscreenSupported(): boolean {
  return Boolean(doc.fullscreenEnabled ?? doc.webkitFullscreenEnabled);
}

export function isFullscreen(): boolean {
  return Boolean(doc.fullscreenElement ?? doc.webkitFullscreenElement);
}

export async function toggleFullscreen(): Promise<boolean> {
  try {
    if (isFullscreen()) {
      await (doc.exitFullscreen?.() ?? doc.webkitExitFullscreen?.());
      return false;
    }
    const root = document.documentElement as WebkitElement;
    await (root.requestFullscreen?.() ?? root.webkitRequestFullscreen?.());
    return true;
  } catch {
    // Denied (not a user gesture, or blocked by policy). The reader is still
    // perfectly usable windowed, so this is not worth surfacing.
    return isFullscreen();
  }
}

export function onFullscreenChange(fn: (active: boolean) => void): void {
  const handler = () => fn(isFullscreen());
  document.addEventListener('fullscreenchange', handler);
  document.addEventListener('webkitfullscreenchange', handler);
}
