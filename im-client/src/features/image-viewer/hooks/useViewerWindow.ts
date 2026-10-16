import { useCallback, useEffect, useRef, useState } from "react";

import {
  closeViewerWindow, isViewerWindowMaximized, listenViewerWindowResized,
  minimizeViewerWindow, toggleViewerWindowMaximized,
} from "../windowApi";

export function useViewerWindow(onError?: () => void) {
  const [isMaximized, setIsMaximized] = useState(false);
  const errorHandler = useRef(onError);
  errorHandler.current = onError;
  const lifecycle = useRef(0);
  const refresh = useRef<(() => Promise<void>) | null>(null);

  useEffect(() => {
    const generation = ++lifecycle.current;
    let sequence = 0;
    let unlisten: (() => void) | undefined;
    const active = () => lifecycle.current === generation;
    const readState = async () => {
      const request = ++sequence;
      try {
        const maximized = await isViewerWindowMaximized();
        if (active() && request === sequence) setIsMaximized(maximized);
      } catch {
        if (active() && request === sequence) errorHandler.current?.();
      }
    };
    refresh.current = readState;
    // Subscribe first: a resize between subscription and snapshot is resolved by the latest query.
    void (async () => {
      try {
        const stop = await listenViewerWindowResized(() => { if (active()) void readState(); });
        if (!active()) { stop(); return; }
        unlisten = stop;
        await readState();
      } catch {
        if (active()) errorHandler.current?.();
      }
    })();
    return () => {
      ++lifecycle.current;
      refresh.current = null;
      unlisten?.();
    };
  }, []);

  const run = useCallback(async (action: () => Promise<void>, updateState = false) => {
    const generation = lifecycle.current;
    try {
      await action();
      if (generation === lifecycle.current && updateState) await refresh.current?.();
    } catch {
      if (generation === lifecycle.current) errorHandler.current?.();
    }
  }, []);

  return {
    isMaximized,
    minimize: useCallback(() => run(minimizeViewerWindow), [run]),
    toggleMaximize: useCallback(() => run(toggleViewerWindowMaximized, true), [run]),
    close: useCallback(() => run(closeViewerWindow), [run]),
  };
}
