import { useEffect, useLayoutEffect, useRef } from "react";

import { imageViewerCoordinator } from "../image-viewer/coordinator";
import { completeAppExit, listenAppExitRequested, setAppAuthenticated } from "./api";

export function useAppLifecycle(cleanupBeforeAppClose: () => void | Promise<void>, authenticated: boolean): void {
  const cleanupRef = useRef(cleanupBeforeAppClose);
  const isExitingRef = useRef(false);
  const authenticationQueueRef = useRef(Promise.resolve());
  const synchronizedAuthenticationRef = useRef<boolean | undefined>(undefined);

  useLayoutEffect(() => {
    cleanupRef.current = cleanupBeforeAppClose;
  }, [cleanupBeforeAppClose]);

  useEffect(() => {
    let isDisposed = false;
    // Serialize IPC: an older login must finish before a newer logout reaches Rust.
    authenticationQueueRef.current = authenticationQueueRef.current.then(async () => {
      if (isDisposed || synchronizedAuthenticationRef.current === authenticated) return;
      for (let attempt = 0; attempt < 2 && !isDisposed; attempt += 1) {
        try {
          await setAppAuthenticated(authenticated);
          synchronizedAuthenticationRef.current = authenticated;
          return;
        } catch (error) {
          // Native visibility changes can partly succeed before an error is returned.
          synchronizedAuthenticationRef.current = undefined;
          console.error("Failed to synchronize app authentication", error);
        }
      }
    });
    return () => { isDisposed = true; };
  }, [authenticated]);

  useEffect(() => {
    let isDisposed = false;
    let unlisten: (() => void) | undefined;

    async function handleExitRequested() {
      if (isDisposed || isExitingRef.current) return;
      isExitingRef.current = true;
      try {
        // Schedule independently so a synchronous failure cannot skip the other cleanup.
        await Promise.allSettled([
          Promise.resolve().then(() => imageViewerCoordinator.close()),
          Promise.resolve().then(() => cleanupRef.current()),
        ]);
      } finally {
        try {
          await completeAppExit();
        } catch (error) {
          // The native exit watchdog still terminates the process if acknowledgement fails.
          console.error("Failed to complete app exit", error);
        }
      }
    }

    void Promise.resolve()
      .then(() => listenAppExitRequested(handleExitRequested))
      .then((nextUnlisten) => {
        if (isDisposed) nextUnlisten();
        else unlisten = nextUnlisten;
      })
      .catch((error) => {
        if (!isDisposed) console.error("Failed to listen for app exit", error);
      });

    return () => {
      isDisposed = true;
      unlisten?.();
    };
  }, []);
}
