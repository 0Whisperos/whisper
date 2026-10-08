import { useEffect, useRef, useState } from "react";

import type { AvatarResourceCache } from "../avatarResourceCache";

export function useAvatarObjectUrl(
  cache: AvatarResourceCache,
  apiBaseUrl: string,
  accessToken: string,
  objectKey: string | null | undefined,
) {
  const [objectUrl, setObjectUrl] = useState<string | null>(null);
  const [retryGeneration, setRetryGeneration] = useState(0);
  const accessTokenRef = useRef(accessToken);
  const loadStateRef = useRef<{
    objectKey: string | null;
    state: "idle" | "loading" | "loaded" | "failed";
    failedToken: string | null;
  }>({ objectKey: null, state: "idle", failedToken: null });
  accessTokenRef.current = accessToken;

  useEffect(() => {
    setObjectUrl(null);
    if (!apiBaseUrl || !accessTokenRef.current || !objectKey) {
      loadStateRef.current = { objectKey: objectKey ?? null, state: "idle", failedToken: null };
      return;
    }
    let isActive = true;
    const tokenAtRequestStart = accessTokenRef.current;
    loadStateRef.current = { objectKey, state: "loading", failedToken: null };
    void cache.acquire(apiBaseUrl, () => accessTokenRef.current, objectKey)
      .then((url) => {
        if (isActive) {
          loadStateRef.current = { objectKey, state: "loaded", failedToken: null };
          setObjectUrl(url);
        }
      })
      .catch(() => {
        if (isActive) {
          loadStateRef.current = { objectKey, state: "failed", failedToken: tokenAtRequestStart };
          setObjectUrl(null);
          if (accessTokenRef.current !== tokenAtRequestStart) {
            setRetryGeneration((current) => current + 1);
          }
        }
      });
    return () => {
      isActive = false;
      cache.release(objectKey);
    };
  }, [apiBaseUrl, cache, objectKey, retryGeneration]);

  useEffect(() => {
    const loadState = loadStateRef.current;
    if (objectKey
      && loadState.objectKey === objectKey
      && loadState.state === "failed"
      && loadState.failedToken !== accessToken) {
      loadState.state = "loading";
      setRetryGeneration((current) => current + 1);
    }
  }, [accessToken, objectKey]);

  return objectUrl;
}
