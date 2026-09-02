/**
 * Page turns.
 *
 * A crisp slide/push: the outgoing spread translates off, the incoming one
 * follows it in, with a soft shadow at the gutter. Swipes track the finger and
 * rubber-band at the ends.
 *
 * Two rules make it smooth, and both are about what does *not* happen:
 *
 *  1. Only `transform` and `opacity` are animated, via WAAPI, so the whole turn
 *     runs on the compositor.
 *  2. No layout is read between the start of an animation and its finish. Every
 *     number needed was computed by the planner; page surfaces carry
 *     `contain: strict` so preparing the next page cannot disturb the current
 *     one.
 *
 * Surfaces are pooled rather than created and destroyed, so a fast reader
 * turning pages never triggers a burst of allocation mid-animation.
 */

const DURATION = 320;
const EASING = 'cubic-bezier(0.22, 0.61, 0.36, 1)';
/** Past this fraction of the surface, a drag commits to the turn on release. */
const COMMIT_RATIO = 0.22;
const RUBBER_BAND = 0.35;

export interface FlipHost {
  /** Build (or fetch from the pool) the surface for a page index. */
  surfaceFor(index: number): HTMLElement | null;
  pageCount(): number;
  onChange(index: number): void;
}

export class FlipController {
  private stage: HTMLElement;
  private host: FlipHost;
  private index = 0;
  private flipping = false;
  private width = 0;

  /** Queued while a turn is in flight, applied once it settles. */
  private pendingRelayout: (() => void) | null = null;

  private dragging = false;
  private dragStartX = 0;
  private dragDx = 0;
  private current: HTMLElement | null = null;
  private incoming: HTMLElement | null = null;

  constructor(stage: HTMLElement, host: FlipHost) {
    this.stage = stage;
    this.host = host;
    this.bindGestures();
  }

  get pageIndex(): number {
    return this.index;
  }

  get isFlipping(): boolean {
    return this.flipping;
  }

  /** Defer a relayout until no animation is in flight. */
  deferRelayout(fn: () => void): void {
    if (!this.flipping) fn();
    else this.pendingRelayout = fn;
  }

  measureStage(): void {
    this.width = this.stage.clientWidth;
  }

  show(index: number, { animate = true } = {}): void {
    const clamped = Math.max(0, Math.min(this.host.pageCount() - 1, index));
    if (clamped === this.index && this.current) return;
    if (this.flipping) return;

    const direction = clamped > this.index ? 1 : -1;
    const next = this.host.surfaceFor(clamped);
    if (!next) return;

    if (!animate || !this.current) {
      this.stage.replaceChildren(next);
      this.current = next;
      this.index = clamped;
      this.host.onChange(clamped);
      return;
    }

    this.animateTo(next, clamped, direction);
  }

  next(): void {
    this.show(this.index + 1);
  }

  previous(): void {
    this.show(this.index - 1);
  }

  private animateTo(next: HTMLElement, target: number, direction: 1 | -1): void {
    const outgoing = this.current!;
    this.flipping = true;
    this.measureStage();

    // Render the incoming page *before* the animation begins. Doing this
    // during the turn is what produces a visible hitch.
    next.style.transform = `translate3d(${direction * this.width}px, 0, 0)`;
    this.stage.append(next);
    this.armShadow(next, direction);

    for (const el of [outgoing, next]) el.style.willChange = 'transform';

    const outAnim = outgoing.animate(
      [
        { transform: 'translate3d(0,0,0)' },
        { transform: `translate3d(${-direction * this.width * 0.35}px,0,0)` },
      ],
      { duration: DURATION, easing: EASING, fill: 'forwards' },
    );
    const inAnim = next.animate(
      [
        { transform: `translate3d(${direction * this.width}px,0,0)` },
        { transform: 'translate3d(0,0,0)' },
      ],
      { duration: DURATION, easing: EASING, fill: 'forwards' },
    );

    void Promise.all([outAnim.finished, inAnim.finished])
      .catch(() => undefined)
      .then(() => {
        outAnim.cancel();
        inAnim.cancel();
        outgoing.remove();
        next.style.transform = '';
        for (const el of [outgoing, next]) el.style.willChange = '';
        this.current = next;
        this.index = target;
        this.flipping = false;
        this.host.onChange(target);

        const deferred = this.pendingRelayout;
        this.pendingRelayout = null;
        deferred?.();
      });
  }

  /** The gutter shadow is a compositor-only gradient, never a box-shadow. */
  private armShadow(surface: HTMLElement, direction: 1 | -1): void {
    surface.classList.add(direction > 0 ? 'page--from-right' : 'page--from-left');
    window.setTimeout(
      () => surface.classList.remove('page--from-right', 'page--from-left'),
      DURATION + 40,
    );
  }

  // ------------------------------------------------------------------ gestures

  private bindGestures(): void {
    const stage = this.stage;

    stage.addEventListener('pointerdown', (e) => {
      if (this.flipping || e.pointerType === 'mouse') return;
      this.dragging = true;
      this.dragStartX = e.clientX;
      this.dragDx = 0;
      this.measureStage();
      stage.setPointerCapture(e.pointerId);
    });

    stage.addEventListener('pointermove', (e) => {
      if (!this.dragging || !this.current) return;
      this.dragDx = e.clientX - this.dragStartX;

      // Resist at the ends rather than refusing to move: the reader should
      // feel the edge of the paper, not a dead surface.
      const atStart = this.index === 0 && this.dragDx > 0;
      const atEnd = this.index === this.host.pageCount() - 1 && this.dragDx < 0;
      const dx = atStart || atEnd ? this.dragDx * RUBBER_BAND : this.dragDx;

      this.current.style.transform = `translate3d(${dx}px,0,0)`;
      this.ensurePeek(dx);
    });

    const release = () => {
      if (!this.dragging || !this.current) return;
      this.dragging = false;
      const dx = this.dragDx;
      const committed = Math.abs(dx) > this.width * COMMIT_RATIO;

      this.current.style.transform = '';
      this.incoming?.remove();
      this.incoming = null;

      if (committed) {
        if (dx < 0) this.next();
        else this.previous();
      }
    };

    stage.addEventListener('pointerup', release);
    stage.addEventListener('pointercancel', release);
  }

  /** Show the edge of the page being dragged toward, without laying it out. */
  private ensurePeek(dx: number): void {
    const target = dx < 0 ? this.index + 1 : this.index - 1;
    if (target < 0 || target >= this.host.pageCount()) return;

    if (!this.incoming || this.incoming.dataset.page !== String(target)) {
      this.incoming?.remove();
      const surface = this.host.surfaceFor(target);
      if (!surface) return;
      this.incoming = surface;
      this.stage.append(surface);
    }
    const offset = dx < 0 ? this.width + dx : -this.width + dx;
    this.incoming.style.transform = `translate3d(${offset}px,0,0)`;
  }
}
