import { useEffect } from "react";

import type { ChatConversation } from "../features/chat/types";
import type { AttachmentResourceCache } from "../features/chat/attachmentResourceCache";
import { imageViewerCoordinator } from "../features/image-viewer/coordinator";

/** The viewer belongs to the authenticated account, not to the selected chat panel. */
export function useImageViewerLifecycle(
  apiBaseUrl: string,
  userId: number,
  conversations: Record<number, ChatConversation> | undefined,
  accessToken: string,
  cache: AttachmentResourceCache,
) {
  useEffect(() => {
    if (conversations) {
      void imageViewerCoordinator.sync(conversations, { apiBaseUrl, userId, accessToken }, cache).catch(() => undefined);
    }
  }, [conversations, apiBaseUrl, userId, accessToken, cache]);

  useEffect(() => () => {
    void imageViewerCoordinator.close().catch(() => undefined);
  }, [apiBaseUrl, userId]);
}
