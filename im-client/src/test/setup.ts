import "@testing-library/jest-dom/vitest";

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
