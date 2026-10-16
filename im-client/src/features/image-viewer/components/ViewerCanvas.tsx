import { forwardRef, useImperativeHandle, useRef } from "react";
import type { MouseEvent } from "react";
import type { ImageTransform } from "../canvasTransform";
import { useViewerGestures } from "../hooks/useViewerGestures";
import { useViewerImage } from "../hooks/useViewerImage";
import "./viewerCanvas.css";

export { fitZoom } from "../canvasTransform";
export type { ImageTransform } from "../canvasTransform";
export interface ViewerCanvasHandle { zoomBy(delta: number): void; rotate(): void }

interface ViewerCanvasProps {
  src: string | null; transform?: ImageTransform;
  onLoad: (width: number, height: number, zoom: number) => void;
  onContextMenu: (event: MouseEvent<HTMLImageElement>) => void;
  onTransform: (update: (current: ImageTransform) => ImageTransform) => void;
}

export const ViewerCanvas = forwardRef<ViewerCanvasHandle, ViewerCanvasProps>(function ViewerCanvas(
  props, ref,
) {
  return <SourceCanvas key={props.src} {...props} ref={ref} />;
});

const SourceCanvas = forwardRef<ViewerCanvasHandle, ViewerCanvasProps>(function SourceCanvas(
  { src, transform, onLoad, onContextMenu, onTransform }, ref,
) {
  const stage = useRef<HTMLDivElement>(null);
  const { image, loaded, failed, complete, fail } = useViewerImage(stage, onLoad);
  const gestures = useViewerGestures({ stage, enabled: loaded && !failed && Boolean(transform), transform, onTransform });
  useImperativeHandle(ref, () => ({ zoomBy: gestures.zoomBy, rotate: gestures.rotate }), [gestures.zoomBy, gestures.rotate]);
  const scale = (transform?.zoom ?? 100) / 100;
  return <div ref={stage} className={`image-viewer-stage image-viewer-canvas${loaded && !failed ? " is-ready" : ""}${gestures.dragging ? " is-dragging" : ""}`}
    aria-label="图片画布" {...gestures.pointerHandlers}>
    {!src || failed ? <p role="alert">图片加载失败</p> : <>
      {!loaded && <p className="image-viewer-loading" role="status">正在加载图片…</p>}
      <div className="image-viewer-pan" style={{ transform: `translate(${transform?.panX ?? 0}px, ${transform?.panY ?? 0}px)` }}>
          <img ref={image} src={src} alt="聊天图片" draggable={false}
            style={{ width: transform?.width, height: transform?.height, visibility: loaded ? "visible" : "hidden",
              transform: `translate(-50%, -50%) rotate(${transform?.rotation ?? 0}deg) scale(${scale})` }}
            onLoad={(event) => complete(event.currentTarget)}
            onError={(event) => { fail(event.currentTarget); gestures.cancelDrag(); }}
            onContextMenu={(event) => { event.preventDefault(); event.stopPropagation(); if (loaded && !failed) onContextMenu(event); }} />
      </div>
    </>}
  </div>;
});
