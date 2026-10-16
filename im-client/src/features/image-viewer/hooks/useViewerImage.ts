import { useCallback, useLayoutEffect, useRef, useState } from "react";
import type { RefObject } from "react";
import { fitZoom } from "../canvasTransform";

/** Used within a source-keyed canvas so completion always belongs to one image element. */
export function useViewerImage(stage: RefObject<HTMLDivElement | null>, onLoad: (width: number, height: number, zoom: number) => void) {
  const image = useRef<HTMLImageElement>(null);
  const settled = useRef<HTMLImageElement | null>(null);
  const [status, setStatus] = useState<"loading" | "loaded" | "failed">("loading");
  const fail = useCallback((target: HTMLImageElement) => {
    if (!target.isConnected || (image.current && target !== image.current)) return;
    settled.current = target;
    setStatus("failed");
  }, []);
  const complete = useCallback((target: HTMLImageElement) => {
    // A connected image can report load before React attaches its ref; detached old images are ignored.
    if (!target.isConnected || (image.current && target !== image.current) || settled.current === target) return;
    if (target.naturalWidth <= 0 || target.naturalHeight <= 0) { fail(target); return; }
    settled.current = target;
    setStatus("loaded");
    // A very early load can precede the stage ref being attached in the same commit.
    const area = stage.current ?? target.parentElement?.parentElement;
    onLoad(target.naturalWidth, target.naturalHeight,
      fitZoom(target.naturalWidth, target.naturalHeight, Math.max(1, (area?.clientWidth ?? 0) - 40), Math.max(1, (area?.clientHeight ?? 0) - 40)));
  }, [fail, onLoad, stage]);
  useLayoutEffect(() => {
    // Cached resources may already be complete. Never reset a load that arrived before this effect.
    const target = image.current;
    if (target?.complete) complete(target);
  }, [complete]);
  return { image, loaded: status === "loaded", failed: status === "failed", complete, fail };
}
