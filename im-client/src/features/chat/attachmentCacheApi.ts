import { convertFileSrc, invoke, isTauri } from "@tauri-apps/api/core";

import type { DownloadAuthorization } from "./attachmentsApi";

export interface AttachmentCacheKey {
  apiBaseUrl: string;
  userId: number;
  conversationId: number;
  attachmentId: string;
}

export interface AttachmentCacheItem {
  attachmentId: string;
  filePath: string | null;
  errorCode?: string;
}

export interface AttachmentCacheAuthorization {
  attachmentId: string;
  downloadUrl: string;
  contentType: string;
  sizeBytes: number;
}

export interface AttachmentCacheAdapter {
  isDesktop(): boolean;
  lookup(key: Omit<AttachmentCacheKey, "attachmentId">, attachmentIds: string[]): Promise<AttachmentCacheItem[]>;
  download(key: Omit<AttachmentCacheKey, "attachmentId">, authorizations: AttachmentCacheAuthorization[]): Promise<AttachmentCacheItem[]>;
  invalidate(key: AttachmentCacheKey): Promise<void>;
  toAssetUrl(filePath: string): string;
}

export function normalizeAttachmentCacheApiBaseUrl(apiBaseUrl: string): string {
  return apiBaseUrl.replace(/\/+$/, "");
}

export const attachmentCacheAdapter: AttachmentCacheAdapter = {
  isDesktop: isTauri,
  lookup: (key, attachmentIds) => invoke<AttachmentCacheItem[]>("lookup_chat_image_cache", {
    apiBaseUrl: normalizeAttachmentCacheApiBaseUrl(key.apiBaseUrl),
    userId: key.userId,
    conversationId: key.conversationId,
    attachmentIds,
  }),
  download: (key, authorizations) => invoke<AttachmentCacheItem[]>("download_chat_images", {
    apiBaseUrl: normalizeAttachmentCacheApiBaseUrl(key.apiBaseUrl),
    userId: key.userId,
    conversationId: key.conversationId,
    authorizations,
  }),
  invalidate: (key) => invoke<void>("invalidate_chat_image_cache", {
    apiBaseUrl: normalizeAttachmentCacheApiBaseUrl(key.apiBaseUrl),
    userId: key.userId,
    conversationId: key.conversationId,
    attachmentId: key.attachmentId,
  }),
  toAssetUrl: convertFileSrc,
};

export function cacheAuthorization(auth: DownloadAuthorization): AttachmentCacheAuthorization {
  return {
    attachmentId: auth.attachment_id,
    downloadUrl: auth.download_url,
    contentType: auth.content_type,
    sizeBytes: auth.size_bytes,
  };
}
