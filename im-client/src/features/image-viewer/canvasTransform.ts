export interface ImageTransform {
  width: number;
  height: number;
  zoom: number;
  rotation: number;
  panX: number;
  panY: number;
}
export interface CanvasSize { width: number; height: number }
export interface CanvasPoint { x: number; y: number }

export function fitZoom(width: number, height: number, availableWidth: number, availableHeight: number): number {
  return Math.max(25, Math.min(100, Math.min(availableWidth / width, availableHeight / height) * 100));
}
export function imageBounds(transform: ImageTransform): CanvasSize {
  const rotated = transform.rotation % 180 !== 0;
  const scale = transform.zoom / 100;
  return { width: (rotated ? transform.height : transform.width) * scale,
    height: (rotated ? transform.width : transform.height) * scale };
}
export function clampTransform(transform: ImageTransform, viewport: CanvasSize): ImageTransform {
  const bounds = imageBounds(transform);
  const limit = (size: number, available: number) => Math.max(0, (size + available) / 2 - Math.min(32, size, available));
  const clamp = (value: number, bound: number) => Math.min(bound, Math.max(-bound, value));
  return { ...transform, panX: clamp(transform.panX, limit(bounds.width, viewport.width)),
    panY: clamp(transform.panY, limit(bounds.height, viewport.height)) };
}
/** Anchor coordinates are relative to the viewport center, in CSS pixels. */
export function zoomAt(transform: ImageTransform, zoom: number, anchor: CanvasPoint, viewport: CanvasSize): ImageTransform {
  const nextZoom = Math.min(500, Math.max(25, zoom));
  const ratio = nextZoom / transform.zoom;
  return clampTransform({ ...transform, zoom: nextZoom,
    panX: anchor.x - (anchor.x - transform.panX) * ratio,
    panY: anchor.y - (anchor.y - transform.panY) * ratio }, viewport);
}
export function rotateAtCenter(transform: ImageTransform, viewport: CanvasSize): ImageTransform {
  return clampTransform({ ...transform, rotation: (transform.rotation + 90) % 360 }, viewport);
}
export function wheelDeltaPixels(deltaY: number, deltaMode: number, viewportHeight: number): number {
  return deltaY * (deltaMode === 1 ? 16 : deltaMode === 2 ? viewportHeight : 1);
}
