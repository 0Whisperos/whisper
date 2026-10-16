import { useViewerWindow } from "../hooks/useViewerWindow";

function WindowIcon({ name }: { name: "minimize" | "maximize" | "restore" | "close" }) {
  return <svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor"
    strokeWidth="1.3" aria-hidden="true" focusable="false">
    {name === "minimize" && <path d="M4 9h10" />}
    {name === "maximize" && <rect x="4" y="4" width="10" height="10" />}
    {name === "restore" && <><path d="M6 4V2.5h9.5V12H14" /><rect x="3" y="5" width="10" height="10" /></>}
    {name === "close" && <path d="m4 4 10 10M14 4 4 14" />}
  </svg>;
}

export function ViewerWindowControls({ onError }: { onError?: () => void }) {
  const window = useViewerWindow(onError);
  return <div className="image-viewer-window-controls" data-tauri-drag-region="false">
    <button type="button" className="image-viewer-window-control" data-tauri-drag-region="false"
      aria-label="最小化" title="最小化" onClick={() => { void window.minimize(); }}><WindowIcon name="minimize" /></button>
    <button type="button" className="image-viewer-window-control" data-tauri-drag-region="false"
      aria-label={window.isMaximized ? "还原" : "最大化"} title={window.isMaximized ? "还原" : "最大化"}
      onClick={() => { void window.toggleMaximize(); }}><WindowIcon name={window.isMaximized ? "restore" : "maximize"} /></button>
    <button type="button" className="image-viewer-window-control is-close" data-tauri-drag-region="false"
      aria-label="关闭" title="关闭" onClick={() => { void window.close(); }}><WindowIcon name="close" /></button>
  </div>;
}
