import type { ViewerIconName } from "./ViewerIcon";
import { ViewerIcon } from "./ViewerIcon";
import { ViewerWindowControls } from "./ViewerWindowControls";
import "./viewerToolbar.css";

export interface ViewerToolbarProps {
  canPrevious: boolean;
  canNext: boolean;
  zoom?: number;
  canDownload: boolean;
  currentIndex: number;
  total: number;
  onPrevious: () => void;
  onNext: () => void;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onRotate: () => void;
  onDownload: () => void;
  onWindowError?: () => void;
}

function ToolButton({ label, icon, disabled, onClick }: {
  label: string; icon: ViewerIconName; disabled: boolean; onClick: () => void;
}) {
  return <button className="image-viewer-tool-button" type="button" aria-label={label} title={label}
    disabled={disabled} onClick={onClick} data-tauri-drag-region="false">
    <ViewerIcon name={icon} />
  </button>;
}

export function ViewerToolbar(props: ViewerToolbarProps) {
  const { zoom } = props;
  return <div className="image-viewer-toolbar" role="toolbar" aria-label="图片工具栏" data-tauri-drag-region="false">
    <div className="image-viewer-tool-group" data-tauri-drag-region="false">
      <ToolButton label="上一张" icon="previous" disabled={!props.canPrevious} onClick={props.onPrevious} />
      <ToolButton label="下一张" icon="next" disabled={!props.canNext} onClick={props.onNext} />
    </div>
    <span className="image-viewer-divider" aria-hidden="true" />
    <div className="image-viewer-tool-group" data-tauri-drag-region="false">
      <ToolButton label="缩小" icon="zoom-out" disabled={zoom === undefined || zoom <= 25} onClick={props.onZoomOut} />
      <output className="image-viewer-zoom" aria-label="缩放比例" data-tauri-drag-region="false">
        {zoom === undefined ? "—" : `${Math.round(zoom)}%`}
      </output>
      <ToolButton label="放大" icon="zoom-in" disabled={zoom === undefined || zoom >= 500} onClick={props.onZoomIn} />
    </div>
    <span className="image-viewer-divider" aria-hidden="true" />
    <div className="image-viewer-tool-group" data-tauri-drag-region="false">
      <ToolButton label="顺时针旋转" icon="rotate" disabled={zoom === undefined} onClick={props.onRotate} />
      <ToolButton label="下载原图" icon="download" disabled={!props.canDownload} onClick={props.onDownload} />
    </div>
    <div className="image-viewer-drag-spacer" data-tauri-drag-region="true" aria-hidden="true" />
    <span className="image-viewer-counter" data-tauri-drag-region="false">
      {props.total > 0 ? `${props.currentIndex + 1} / ${props.total}` : ""}
    </span>
    <ViewerWindowControls onError={props.onWindowError} />
  </div>;
}
