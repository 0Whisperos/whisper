import { useCallback, useEffect, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent, RefObject } from "react";
import { clampTransform, rotateAtCenter, wheelDeltaPixels, zoomAt } from "../canvasTransform";
import type { CanvasSize, ImageTransform } from "../canvasTransform";

interface GestureOptions {
  stage: RefObject<HTMLDivElement | null>;
  enabled: boolean;
  transform?: ImageTransform;
  onTransform: (update: (current: ImageTransform) => ImageTransform) => void;
}
interface DragState { pointerId: number; x: number; y: number; panX: number; panY: number; element: HTMLDivElement }

export function useViewerGestures(options: GestureOptions) {
  const latest = useRef(options);
  latest.current = options;
  const drag = useRef<DragState | null>(null);
  const [dragging, setDragging] = useState(false);
  const viewport = useCallback((): CanvasSize => ({ width: latest.current.stage.current?.clientWidth ?? 0,
    height: latest.current.stage.current?.clientHeight ?? 0 }), []);
  const cancelDrag = useCallback(() => {
    const active = drag.current;
    drag.current = null;
    if (active) {
      const stage = active.element;
      try { if (stage?.hasPointerCapture(active.pointerId)) stage.releasePointerCapture(active.pointerId); } catch { /* Capture can end during native window blur. */ }
    }
    setDragging(false);
  }, []);
  const zoomBy = useCallback((delta: number) => {
    if (!latest.current.enabled) return;
    cancelDrag();
    latest.current.onTransform((current) => zoomAt(current, current.zoom + delta, { x: 0, y: 0 }, viewport()));
  }, [cancelDrag, viewport]);
  const rotate = useCallback(() => {
    if (!latest.current.enabled) return;
    cancelDrag(); latest.current.onTransform((current) => rotateAtCenter(current, viewport()));
  }, [cancelDrag, viewport]);
  useEffect(() => {
    const stage = options.stage.current;
    if (!stage) return;
    const wheel = (event: WheelEvent) => {
      if (!latest.current.enabled || !latest.current.transform || event.deltaY === 0) return;
      event.preventDefault(); cancelDrag();
      const bounds = stage.getBoundingClientRect();
      const area = viewport();
      const delta = wheelDeltaPixels(event.deltaY, event.deltaMode, area.height);
      const anchor = { x: event.clientX - bounds.left - area.width / 2, y: event.clientY - bounds.top - area.height / 2 };
      latest.current.onTransform((current) => zoomAt(current, current.zoom * Math.exp(-delta * .002), anchor, area));
    };
    stage.addEventListener("wheel", wheel, { passive: false });
    window.addEventListener("blur", cancelDrag);
    return () => { stage.removeEventListener("wheel", wheel); window.removeEventListener("blur", cancelDrag); cancelDrag(); };
  }, [options.stage, cancelDrag, viewport]);
  useEffect(() => {
    if (!options.enabled) { cancelDrag(); return; }
    latest.current.onTransform((current) => {
      const next = clampTransform(current, viewport());
      return next.panX === current.panX && next.panY === current.panY ? current : next;
    });
  }, [options.enabled, cancelDrag, viewport]);
  useEffect(() => {
    const stage = options.stage.current;
    if (!stage) return;
    const clamp = () => {
      if (latest.current.enabled) latest.current.onTransform((current) => {
        const next = clampTransform(current, viewport());
        return next.panX === current.panX && next.panY === current.panY ? current : next;
      });
    };
    const observer = typeof ResizeObserver !== "undefined" ? new ResizeObserver(clamp) : null;
    observer?.observe(stage); window.addEventListener("resize", clamp);
    return () => { observer?.disconnect(); window.removeEventListener("resize", clamp); };
  }, [options.stage, viewport]);
  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!latest.current.enabled || !latest.current.transform || event.button !== 0 || drag.current) return;
    const current = latest.current.transform;
    drag.current = { pointerId: event.pointerId, x: event.clientX, y: event.clientY, panX: current.panX, panY: current.panY,
      element: event.currentTarget };
    try { event.currentTarget.setPointerCapture(event.pointerId); } catch { drag.current = null; return; }
    event.preventDefault(); setDragging(true);
  };
  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!latest.current.enabled) { cancelDrag(); return; }
    const active = drag.current;
    if (!active || event.pointerId !== active.pointerId) return;
    event.preventDefault();
    latest.current.onTransform((current) => clampTransform({ ...current,
      panX: active.panX + event.clientX - active.x, panY: active.panY + event.clientY - active.y }, viewport()));
  };
  const endPointer = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (drag.current?.pointerId === event.pointerId) cancelDrag();
  };
  return { dragging, zoomBy, rotate, cancelDrag, pointerHandlers: { onPointerDown, onPointerMove,
    onPointerUp: endPointer, onPointerCancel: endPointer, onLostPointerCapture: endPointer } };
}
