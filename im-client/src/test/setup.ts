import "@testing-library/jest-dom/vitest";
import { act } from "@testing-library/react";

class TestIntersectionObserver {
  readonly root = null;
  readonly rootMargin = "0px";
  readonly thresholds: number[] = [];
  private readonly targets = new Set<Element>();
  private notificationScheduled = false;

  constructor(private readonly callback: IntersectionObserverCallback) {}

  observe(target: Element) {
    this.targets.add(target);
    if (this.notificationScheduled) return;
    this.notificationScheduled = true;
    queueMicrotask(() => {
      this.notificationScheduled = false;
      const entries = [...this.targets].map((observed): IntersectionObserverEntry => ({
        boundingClientRect: observed.getBoundingClientRect(),
        intersectionRatio: 1,
        intersectionRect: observed.getBoundingClientRect(),
        isIntersecting: true,
        rootBounds: null,
        target: observed,
        time: 0,
      }));
      act(() => this.callback(entries, this as unknown as IntersectionObserver));
    });
  }
  unobserve(target: Element) { this.targets.delete(target); }
  disconnect() { this.targets.clear(); }
  takeRecords(): IntersectionObserverEntry[] { return []; }
}

Object.defineProperty(globalThis, "IntersectionObserver", {
  configurable: true,
  value: TestIntersectionObserver as unknown as typeof IntersectionObserver,
});

const originalGetBoundingClientRect = HTMLElement.prototype.getBoundingClientRect;
Object.defineProperty(HTMLElement.prototype, "getBoundingClientRect", {
  configurable: true,
  value: function getBoundingClientRect(this: HTMLElement) {
    const part = this.getAttribute("data-epr-part");
    if (part && this.closest('[data-epr-part="root"]')) {
      if (part === "viewport") return new DOMRect(0, 0, 320, 320);
      if (part === "category-label") return new DOMRect(0, 0, 320, 24);
      if (part === "emoji") return new DOMRect(32, 40, 24, 24);
    }
    return originalGetBoundingClientRect.call(this);
  },
});

Object.defineProperty(document, "elementFromPoint", {
  configurable: true,
  value: () => document.body,
});
Object.defineProperty(Range.prototype, "getBoundingClientRect", {
  configurable: true,
  value: () => new DOMRect(0, 0, 0, 0),
});
Object.defineProperty(Range.prototype, "getClientRects", {
  configurable: true,
  value: () => [],
});
