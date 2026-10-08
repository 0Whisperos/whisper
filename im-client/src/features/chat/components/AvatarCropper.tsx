import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";

import { AVATAR_CROP_VIEWPORT_SIZE, exportAvatarCrop } from "./avatarCrop";

interface AvatarCropperProps {
  file: File;
  onCancel: () => void;
  onConfirm: (file: File) => void;
}

const MIN_ZOOM = 1;
const MAX_ZOOM = 3;
const ZOOM_STEP = 0.25;

export function AvatarCropper({ file, onCancel, onConfirm }: AvatarCropperProps) {
  const [imageUrl, setImageUrl] = useState("");
  const [imageSize, setImageSize] = useState<{ width: number; height: number } | null>(null);
  const [zoom, setZoom] = useState(MIN_ZOOM);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [error, setError] = useState("");
  const [isExporting, setIsExporting] = useState(false);
  const imageRef = useRef<HTMLImageElement | null>(null);
  const dragRef = useRef<{ pointerId: number; x: number; y: number; panX: number; panY: number } | null>(null);
  const dialogRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    const url = URL.createObjectURL(file);
    setImageUrl(url);
    dialogRef.current?.focus();
    return () => URL.revokeObjectURL(url);
  }, [file]);

  const baseScale = imageSize
    ? Math.max(AVATAR_CROP_VIEWPORT_SIZE / imageSize.width, AVATAR_CROP_VIEWPORT_SIZE / imageSize.height)
    : 1;
  const imageWidth = (imageSize?.width ?? AVATAR_CROP_VIEWPORT_SIZE) * baseScale * zoom;
  const imageHeight = (imageSize?.height ?? AVATAR_CROP_VIEWPORT_SIZE) * baseScale * zoom;
  const imageLeft = (AVATAR_CROP_VIEWPORT_SIZE - imageWidth) / 2 + pan.x;
  const imageTop = (AVATAR_CROP_VIEWPORT_SIZE - imageHeight) / 2 + pan.y;

  const changeZoom = (nextZoom: number) => {
    const clampedZoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, nextZoom));
    const ratio = clampedZoom / zoom;
    setZoom(clampedZoom);
    setPan((current) => clampPan({ x: current.x * ratio, y: current.y * ratio }, imageSize, baseScale, clampedZoom));
  };

  const handlePointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!imageSize || isExporting) return;
    dragRef.current = { pointerId: event.pointerId, x: event.clientX, y: event.clientY, panX: pan.x, panY: pan.y };
    event.currentTarget.setPointerCapture?.(event.pointerId);
  };

  const handlePointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    setPan(clampPan({ x: drag.panX + event.clientX - drag.x, y: drag.panY + event.clientY - drag.y }, imageSize, baseScale, zoom));
  };

  const handleConfirm = async () => {
    const image = imageRef.current;
    if (!image || !imageSize) return;
    setIsExporting(true);
    setError("");
    try {
      const croppedFile = await exportAvatarCrop(image, {
        imageWidth: imageSize.width,
        imageHeight: imageSize.height,
        zoom,
        panX: pan.x,
        panY: pan.y,
      });
      onConfirm(croppedFile);
    } catch {
      setError("图片裁剪失败，请重新选择图片。");
      setIsExporting(false);
    }
  };

  return (
    <div className="auth-avatar-crop-backdrop" onMouseDown={(event) => event.stopPropagation()}>
      <section
        ref={dialogRef}
        className="auth-avatar-crop-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="auth-avatar-crop-title"
        tabIndex={-1}
        onKeyDown={(event) => {
          if (event.key === "Escape" && !isExporting) {
            event.preventDefault();
            event.stopPropagation();
            onCancel();
            return;
          }
          if (event.key === "Tab") {
            const focusable = Array.from(dialogRef.current?.querySelectorAll<HTMLElement>("button:not([disabled]), [tabindex='0']") ?? []);
            const first = focusable[0];
            const last = focusable[focusable.length - 1];
            if (event.shiftKey && document.activeElement === first) {
              event.preventDefault();
              last?.focus();
            } else if (!event.shiftKey && document.activeElement === last) {
              event.preventDefault();
              first?.focus();
            }
          }
        }}
      >
        <header className="auth-friend-dialog-head">
          <h2 id="auth-avatar-crop-title">裁剪头像</h2>
          <button className="auth-friend-dialog-close" type="button" aria-label="取消裁剪" disabled={isExporting} onClick={onCancel}>×</button>
        </header>
        <p className="auth-avatar-crop-hint">拖动图片调整位置，使用缩放按钮调整大小</p>
        <div
          className="auth-avatar-crop-viewport"
          style={{ width: AVATAR_CROP_VIEWPORT_SIZE, height: AVATAR_CROP_VIEWPORT_SIZE }}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={() => { dragRef.current = null; }}
          onPointerCancel={() => { dragRef.current = null; }}
          onKeyDown={(event) => {
            const delta = 12;
            const movement = {
              ArrowLeft: { x: delta, y: 0 },
              ArrowRight: { x: -delta, y: 0 },
              ArrowUp: { x: 0, y: delta },
              ArrowDown: { x: 0, y: -delta },
            }[event.key];
            if (movement) {
              event.preventDefault();
              setPan((current) => clampPan({ x: current.x + movement.x, y: current.y + movement.y }, imageSize, baseScale, zoom));
            }
          }}
          role="group"
          tabIndex={0}
          aria-label="头像裁剪区域"
        >
          {imageUrl ? (
            <img
              ref={imageRef}
              src={imageUrl}
              alt="待裁剪图片"
              draggable={false}
              onLoad={(event) => setImageSize({ width: event.currentTarget.naturalWidth, height: event.currentTarget.naturalHeight })}
              onError={() => setError("无法读取这张图片，请重新选择图片。")}
              style={{ left: imageLeft, top: imageTop, width: imageWidth, height: imageHeight }}
            />
          ) : null}
        </div>
        <div className="auth-avatar-crop-zoom" aria-label="缩放图片">
          <button type="button" aria-label="缩小" disabled={zoom <= MIN_ZOOM || !imageSize || isExporting} onClick={() => changeZoom(zoom - ZOOM_STEP)}>−</button>
          <output>{Math.round(zoom * 100)}%</output>
          <button type="button" aria-label="放大" disabled={zoom >= MAX_ZOOM || !imageSize || isExporting} onClick={() => changeZoom(zoom + ZOOM_STEP)}>+</button>
        </div>
        {error ? <p className="auth-friend-dialog-error" role="alert">{error}</p> : null}
        <div className="auth-friend-dialog-actions">
          <button className="auth-friend-secondary" type="button" disabled={isExporting} onClick={onCancel}>取消</button>
          <button className="auth-friend-primary" type="button" disabled={!imageSize || isExporting} onClick={() => void handleConfirm()}>{isExporting ? "处理中..." : "使用此头像"}</button>
        </div>
      </section>
    </div>
  );
}

function clampPan(
  pan: { x: number; y: number },
  imageSize: { width: number; height: number } | null,
  baseScale: number,
  zoom: number,
) {
  if (!imageSize) return { x: 0, y: 0 };
  const maxX = Math.max(0, (imageSize.width * baseScale * zoom - AVATAR_CROP_VIEWPORT_SIZE) / 2);
  const maxY = Math.max(0, (imageSize.height * baseScale * zoom - AVATAR_CROP_VIEWPORT_SIZE) / 2);
  return {
    x: Math.max(-maxX, Math.min(maxX, pan.x)),
    y: Math.max(-maxY, Math.min(maxY, pan.y)),
  };
}
