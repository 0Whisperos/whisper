import { useEffect, useRef, useState } from "react";

import { ContextMenu } from "../../shared/ui/ContextMenu";
import { copyImage, saveImage } from "./api";
import { ViewerCanvas, type ImageTransform, type ViewerCanvasHandle } from "./components/ViewerCanvas";
import { ViewerToolbar } from "./components/ViewerToolbar";
import { useViewerSession } from "./hooks/useViewerSession";
import "./imageViewer.css";

export function ImageViewer() {
  const state = useViewerSession();
  return <ViewerSessionContent key={state.session?.sessionId ?? "empty"} {...state} />;
}

function ViewerSessionContent({ session, error, select }: ReturnType<typeof useViewerSession>) {
  const image = session?.images[session.currentIndex];
  const key = JSON.stringify([session?.sessionId, image?.id, image?.assetUrl]);
  const [selection, setSelection] = useState<{ key: string; generation: number; transform?: ImageTransform }>(() => ({ key, generation: 0 }));
  // Reset before children commit: a cached image may report load before a passive effect runs.
  if (selection.key !== key) setSelection({ key, generation: selection.generation + 1 });
  const generation = selection.generation;
  const transform = selection.key === key ? selection.transform : undefined;
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const [feedback, setFeedback] = useState("");
  const root = useRef<HTMLElement>(null);
  const canvas = useRef<ViewerCanvasHandle>(null);
  const currentSelection = useRef(selection);
  currentSelection.current = selection;
  useEffect(() => { setMenu(null); setFeedback(""); }, [key]);
  const navigate = (offset: number) => {
    if (!session) return;
    const next = session.images[session.currentIndex + offset];
    if (next) { setMenu(null); void select(next.id); }
  };
  const changeTransform = (update: (value: ImageTransform) => ImageTransform) => {
    setSelection((current) => current.key === key && current.generation === generation && current.transform
      ? { ...current, transform: update(current.transform) } : current);
  };
  const imageAction = async (action: "copy" | "save") => {
    if (!session || !image) return;
    const actionGeneration = generation;
    try {
      const target = { kind: "viewer" as const, sessionId: session.sessionId, imageId: image.id };
      if (action === "copy") await copyImage(target);
      else await saveImage(target);
    } catch {
      // Returning to the same image starts a new selection; ignore work from its previous visit.
      if (key === currentSelection.current.key && actionGeneration === currentSelection.current.generation) {
        setFeedback(action === "copy" ? "图片复制失败" : "图片保存失败");
      }
    }
  };
  return <main ref={root} className="image-viewer">
    <ViewerToolbar canPrevious={Boolean(session && session.currentIndex > 0)}
      canNext={Boolean(session && session.currentIndex < session.images.length - 1)}
      zoom={transform?.zoom} canDownload={Boolean(image?.assetUrl)}
      currentIndex={session?.currentIndex ?? 0} total={session?.images.length ?? 0}
      onPrevious={() => navigate(-1)} onNext={() => navigate(1)}
      onZoomIn={() => canvas.current?.zoomBy(25)} onZoomOut={() => canvas.current?.zoomBy(-25)}
      onRotate={() => canvas.current?.rotate()} onDownload={() => { void imageAction("save"); }}
      onWindowError={() => setFeedback("窗口操作失败，请重试")} />
    {(error || feedback) && <div className="image-viewer-feedback" role="alert">{error || feedback}</div>}
    {image ? <ViewerCanvas ref={canvas} key={key} src={image.assetUrl} transform={transform}
      onTransform={changeTransform}
      onLoad={(width, height, zoom) => setSelection((current) => current.key === key && current.generation === generation && !current.transform
        ? { key, generation, transform: { width, height, zoom, rotation: 0, panX: 0, panY: 0 } } : current)}
      onContextMenu={(event) => setMenu({ x: event.clientX, y: event.clientY })} />
      : <div className="image-viewer-empty" role="status">{error ? "暂无可查看的图片" : "正在加载图片…"}</div>}
    {menu && <ContextMenu position={menu} portalRoot={root.current ?? undefined} ariaLabel="图片菜单" onClose={() => setMenu(null)}
      items={[{ label: "复制图片", onSelect: () => { void imageAction("copy"); } }]} />}
  </main>;
}
