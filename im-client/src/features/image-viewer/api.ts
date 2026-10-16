import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

import { normalizeAttachmentCacheApiBaseUrl } from "../chat/attachmentCacheApi";
import type { ImageTarget, ImageViewerSession, ViewerImageInput, ViewerSessionUpdate } from "./types";

export function prepareImageViewerSession(input: {
  apiBaseUrl: string; userId: number; conversationId: number; images: ViewerImageInput[]; selectedImageId: string;
}): Promise<ImageViewerSession> {
  return invoke("prepare_image_viewer_session", {
    ...input, apiBaseUrl: normalizeAttachmentCacheApiBaseUrl(input.apiBaseUrl),
  });
}

export function getImageViewerSession(sessionId?: string): Promise<ImageViewerSession | null> {
  return invoke("get_image_viewer_session", { sessionId });
}

export function updateImageViewerSession(sessionId: string, images: ViewerImageInput[]): Promise<ImageViewerSession | null> {
  return invoke("update_image_viewer_session", { sessionId, images });
}

export function selectImageViewerImage(sessionId: string, imageId: string): Promise<ImageViewerSession> {
  return invoke("select_image_viewer_image", { sessionId, imageId });
}

export function closeImageViewerSession(sessionId?: string): Promise<void> {
  return invoke("close_image_viewer_session", { sessionId });
}

export function copyImage(target: ImageTarget): Promise<void> {
  return invoke("copy_chat_image", { target: normalizeTarget(target) });
}

export function saveImage(target: ImageTarget): Promise<{ saved: boolean; filePath?: string }> {
  return invoke("save_chat_image", { target: normalizeTarget(target) });
}

export function listenImageViewerUpdates(handler: (update: ViewerSessionUpdate) => void): Promise<() => void> {
  return listen<ViewerSessionUpdate>("image-viewer-session-updated", (event) => handler(event.payload));
}

function normalizeTarget(target: ImageTarget): ImageTarget {
  return target.kind === "chat"
    ? { ...target, apiBaseUrl: normalizeAttachmentCacheApiBaseUrl(target.apiBaseUrl) }
    : target;
}
