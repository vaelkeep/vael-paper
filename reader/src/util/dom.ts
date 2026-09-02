/** Small DOM helpers. Deliberately tiny — this project has no framework. */

export function h(tag: string, className?: string, text?: string): HTMLElement {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

export function clear(node: HTMLElement): void {
  node.replaceChildren();
}

/** Run on the next idle slot, or soon after, whichever the browser supports. */
export function idle(fn: () => void): void {
  if ('requestIdleCallback' in window) {
    (window as unknown as { requestIdleCallback: (f: () => void) => void })
      .requestIdleCallback(fn);
  } else {
    setTimeout(fn, 48);
  }
}

export function debounce<A extends unknown[]>(
  fn: (...args: A) => void,
  ms: number,
): (...args: A) => void {
  let timer: number | undefined;
  return (...args: A) => {
    if (timer !== undefined) clearTimeout(timer);
    timer = window.setTimeout(() => fn(...args), ms);
  };
}
