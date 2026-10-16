import { useEffect, useLayoutEffect, useState } from "react";
import type { MouseEvent } from "react";
import "./chatImageInteractions.css";

interface ChatMessageImageProps {
  src?: string;
  failed?: boolean;
  interactive: boolean;
  onOpen: () => void;
  onMenu: (event: MouseEvent<HTMLElement>) => void;
  onCloseMenu: () => void;
  onLayout: () => void;
  onError: () => void;
  onRetry: () => void;
}

export function ChatMessageImage({ src, failed, interactive, onOpen, onMenu, onCloseMenu, onLayout, onError, onRetry }: ChatMessageImageProps) {
  const [loadedSource, setLoadedSource] = useState<string | null>(null);
  const loaded = Boolean(src && loadedSource === src);
  useLayoutEffect(() => { setLoadedSource(null); onCloseMenu(); }, [src, onCloseMenu]);
  useEffect(() => () => onCloseMenu(), []);
  const contextMenu = (event: MouseEvent<HTMLElement>) => {
    event.preventDefault(); event.stopPropagation();
    if (loaded && interactive) onMenu(event); else onCloseMenu();
  };
  if (!src) return failed
    ? <span className="auth-message-image-error" role="group" aria-label="图片加载失败" onContextMenu={contextMenu}>
      <span>图片加载失败</span><button type="button" onClick={onRetry}>重试图片</button>
    </span>
    : <span className="auth-message-image-placeholder" role="img" aria-label="图片加载中" onContextMenu={contextMenu} />;
  return <img className={`auth-message-image${loaded && interactive ? " is-interactive" : ""}`} alt="聊天图片" src={src}
    tabIndex={loaded && interactive ? 0 : undefined}
    onLoad={() => { setLoadedSource(src); onLayout(); }}
    onError={() => { setLoadedSource(null); onCloseMenu(); onError(); onLayout(); }}
    onClick={(event) => { if (event.button === 0 && loaded && interactive) onOpen(); }}
    onContextMenu={contextMenu}
    onKeyDown={(event) => {
      if ((event.key === "Enter" || event.key === " ") && loaded && interactive) { event.preventDefault(); onOpen(); }
    }} />;
}
