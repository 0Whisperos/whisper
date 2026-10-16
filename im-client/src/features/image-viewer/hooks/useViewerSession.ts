import { useCallback, useEffect, useRef, useState } from "react";

import { getImageViewerSession, listenImageViewerUpdates, selectImageViewerImage } from "../api";
import type { ImageViewerSession } from "../types";

export function useViewerSession() {
  const [session, setSession] = useState<ImageViewerSession | null>(null);
  const [error, setError] = useState("");
  const current = useRef<ImageViewerSession | null>(null);
  const mounted = useRef(false);
  const generation = useRef(0);
  const apply = useCallback((next: ImageViewerSession | null) => {
    const existing = current.current;
    if (next && existing?.sessionId === next.sessionId && next.version < existing.version) return;
    current.current = next;
    setSession(next);
    setError("");
  }, []);

  useEffect(() => {
    mounted.current = true;
    let disposed = false;
    let unlisten: (() => void) | undefined;
    const refresh = async (sessionId?: string) => {
      const request = ++generation.current;
      try {
        const next = await getImageViewerSession(sessionId);
        if (!disposed && request === generation.current) apply(next);
      } catch {
        if (!disposed && request === generation.current) setError("图片加载失败");
      }
    };
    void listenImageViewerUpdates((event) => {
      if (disposed) return;
      const existing = current.current;
      if (existing?.sessionId === event.sessionId && existing.version >= event.version) return;
      // Query the current session, so a delayed notification from a replaced session cannot erase it.
      void refresh();
    }).then((stop) => {
      if (disposed) { stop(); return; }
      unlisten = stop;
      void refresh();
    }).catch(() => { if (!disposed) setError("图片加载失败"); });
    return () => { disposed = true; mounted.current = false; ++generation.current; unlisten?.(); };
  }, [apply]);

  const select = useCallback(async (imageId: string) => {
    const existing = current.current;
    if (!existing) return;
    const request = ++generation.current;
    try {
      const next = await selectImageViewerImage(existing.sessionId, imageId);
      if (mounted.current && request === generation.current && current.current?.sessionId === existing.sessionId) apply(next);
    } catch {
      if (mounted.current && request === generation.current) setError("图片加载失败");
    }
  }, [apply]);
  return { session, error, select };
}
