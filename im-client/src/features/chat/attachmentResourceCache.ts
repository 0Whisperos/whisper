import { fetchSignedImage, requestDownloadAuthorizations, type DownloadAuthorization } from "./attachmentsApi";
import {
  attachmentCacheAdapter,
  cacheAuthorization,
  normalizeAttachmentCacheApiBaseUrl,
  type AttachmentCacheAdapter,
  type AttachmentCacheKey,
} from "./attachmentCacheApi";

export interface AttachmentResource {
  attachmentId: string;
  src: string;
  source: "asset" | "blob";
}

export interface AttachmentLoadContext {
  apiBaseUrl: string;
  accessToken: string;
  userId: number;
  conversationId: number;
}

export type AttachmentLoadResult =
  | { attachmentId: string; resource: AttachmentResource; error?: never }
  | { attachmentId: string; resource?: never; error: unknown };

interface ResourceEntry {
  promise: Promise<AttachmentResource>;
  accessToken: string;
  resource?: AttachmentResource;
}

interface BatchResult {
  resources: Map<string, AttachmentResource>;
  errors: Map<string, unknown>;
}

const AUTHORIZATION_BATCH_SIZE = 10;

/** Owns image resources for one authenticated page, independent of ChatPanel mounts. */
export class AttachmentResourceCache {
  private readonly entries = new Map<string, ResourceEntry>();
  private readonly failures = new Map<string, number>();
  private readonly recoveries = new Map<string, Promise<AttachmentResource>>();
  private readonly adapter: AttachmentCacheAdapter;
  private generation = 0;

  constructor(adapter: AttachmentCacheAdapter = attachmentCacheAdapter) {
    this.adapter = adapter;
  }

  async loadMany(context: AttachmentLoadContext, attachmentIds: string[]): Promise<AttachmentLoadResult[]> {
    const ids = [...new Set(attachmentIds)];
    const results = new Map<string, Promise<AttachmentLoadResult>>();
    const pending: string[] = [];
    for (const attachmentId of ids) {
      const key = makeKey(context, attachmentId);
      const entry = this.entries.get(keyString(key));
      if (entry && (entry.resource || entry.accessToken === context.accessToken)) {
        results.set(attachmentId, entry.promise.then(
          (resource) => ({ attachmentId, resource }),
          (error) => ({ attachmentId, error }),
        ));
      } else {
        pending.push(attachmentId);
      }
    }

    for (let offset = 0; offset < pending.length; offset += AUTHORIZATION_BATCH_SIZE) {
      const generation = this.generation;
      const batch = pending.slice(offset, offset + AUTHORIZATION_BATCH_SIZE);
      const deferred = new Map<string, {
        promise: Promise<AttachmentResource>;
        resolve: (resource: AttachmentResource) => void;
        reject: (error: unknown) => void;
      }>();
      for (const attachmentId of batch) {
        let resolve!: (resource: AttachmentResource) => void;
        let reject!: (error: unknown) => void;
        const promise = new Promise<AttachmentResource>((res, rej) => { resolve = res; reject = rej; });
        const key = makeKey(context, attachmentId);
        this.entries.set(keyString(key), { promise, accessToken: context.accessToken });
        deferred.set(attachmentId, { promise, resolve, reject });
        results.set(attachmentId, promise.then(
          (resource) => ({ attachmentId, resource }),
          (error) => ({ attachmentId, error }),
        ));
      }
      void this.processBatch(context, batch).then(({ resources, errors }) => {
        for (const attachmentId of batch) {
          const key = keyString(makeKey(context, attachmentId));
          const entry = this.entries.get(key);
          const resource = resources.get(attachmentId);
          if (generation !== this.generation) {
            if (resource?.source === "blob") URL.revokeObjectURL(resource.src);
            deferred.get(attachmentId)?.reject(new Error("cache_cleared"));
            continue;
          }
          if (resource) {
            if (entry && entry.promise === deferred.get(attachmentId)?.promise) entry.resource = resource;
            else if (resource.source === "blob") URL.revokeObjectURL(resource.src);
            deferred.get(attachmentId)?.resolve(resource);
          } else {
            const error = errors.get(attachmentId);
            if (entry?.promise === deferred.get(attachmentId)?.promise) this.entries.delete(key);
            deferred.get(attachmentId)?.reject(error ?? new Error("image_load_failed"));
          }
        }
      });
    }
    return Promise.all(ids.map((id) => results.get(id)!));
  }

  async recoverOnce(context: AttachmentLoadContext, attachmentId: string): Promise<AttachmentResource> {
    const generation = this.generation;
    const key = keyString(makeKey(context, attachmentId));
    const currentRecovery = this.recoveries.get(key);
    if (currentRecovery) return currentRecovery;
    const attempts = this.failures.get(key) ?? 0;
    if (attempts >= 1) throw new Error("image_recovery_exhausted");
    this.failures.set(key, attempts + 1);
    const recovery = (async () => {
      await this.invalidate(context, attachmentId);
      if (generation !== this.generation) throw new Error("cache_cleared");
      const [result] = await this.loadMany(context, [attachmentId]);
      if (!result || !result.resource) throw result?.error ?? new Error("image_load_failed");
      return result.resource.source === "asset"
        ? { ...result.resource, src: addRetryQuery(result.resource.src, Date.now()) }
        : result.resource;
    })();
    this.recoveries.set(key, recovery);
    try { return await recovery; }
    finally { if (this.recoveries.get(key) === recovery) this.recoveries.delete(key); }
  }

  async retry(context: AttachmentLoadContext, attachmentId: string): Promise<AttachmentResource> {
    const generation = this.generation;
    const key = keyString(makeKey(context, attachmentId));
    this.failures.delete(key);
    await this.invalidate(context, attachmentId);
    if (generation !== this.generation) throw new Error("cache_cleared");
    const [result] = await this.loadMany(context, [attachmentId]);
    if (!result || !result.resource) throw result?.error ?? new Error("image_load_failed");
    return result.resource.source === "asset"
      ? { ...result.resource, src: addRetryQuery(result.resource.src, Date.now()) }
      : result.resource;
  }

  clear(): void {
    this.generation += 1;
    for (const entry of this.entries.values()) {
      if (entry.resource?.source === "blob") URL.revokeObjectURL(entry.resource.src);
    }
    this.entries.clear();
    this.failures.clear();
    this.recoveries.clear();
  }

  private async invalidate(context: AttachmentLoadContext, attachmentId: string): Promise<void> {
    const key = makeKey(context, attachmentId);
    const stringKey = keyString(key);
    const entry = this.entries.get(stringKey);
    this.entries.delete(stringKey);
    if (entry?.resource?.source === "blob") URL.revokeObjectURL(entry.resource.src);
    if (this.adapter.isDesktop()) {
      try { await this.adapter.invalidate(key); } catch { /* A missing/unavailable index falls back to network below. */ }
    }
  }

  private async processBatch(context: AttachmentLoadContext, attachmentIds: string[]): Promise<BatchResult> {
    const resources = new Map<string, AttachmentResource>();
    const errors = new Map<string, unknown>();
    const key = {
      apiBaseUrl: normalizeAttachmentCacheApiBaseUrl(context.apiBaseUrl),
      userId: context.userId,
      conversationId: context.conversationId,
    };
    const desktop = this.adapter.isDesktop();
    const cached = new Map<string, string>();
    if (desktop) {
      try {
        const records = await this.adapter.lookup(key, attachmentIds);
        for (const record of records) {
          if (record.filePath) cached.set(record.attachmentId, this.adapter.toAssetUrl(record.filePath));
        }
      } catch { /* Continue through authorized network download if SQLite is unavailable. */ }
    }
    for (const [attachmentId, src] of cached) resources.set(attachmentId, { attachmentId, src, source: "asset" });
    const missing = attachmentIds.filter((id) => !cached.has(id));
    if (!missing.length) return { resources, errors };

    let authorizations: DownloadAuthorization[];
    try {
      authorizations = await requestDownloadAuthorizations(
        context.apiBaseUrl, context.accessToken, context.conversationId, missing,
      );
    } catch (error) {
      for (const id of missing) errors.set(id, error);
      return { resources, errors };
    }
    const authById = new Map(authorizations.map((auth) => [auth.attachment_id, auth]));
    const persistenceResults = new Map<string, string>();
    if (desktop) {
      try {
        const records = await this.adapter.download(key, authorizations.map(cacheAuthorization));
        for (const record of records) if (record.filePath) persistenceResults.set(record.attachmentId, record.filePath);
      } catch { /* Per-image network Blob fallback below. */ }
    }
    await Promise.all(missing.map(async (id) => {
      const localPath = persistenceResults.get(id);
      if (localPath) {
        resources.set(id, { attachmentId: id, src: this.adapter.toAssetUrl(localPath), source: "asset" });
        return;
      }
      const auth = authById.get(id);
      if (!auth) {
        errors.set(id, new Error("download_authorization_missing"));
        return;
      }
      try {
        const blob = await fetchSignedImage(auth.download_url);
        const src = URL.createObjectURL(blob);
        resources.set(id, { attachmentId: id, src, source: "blob" });
      } catch (error) { errors.set(id, error); }
    }));
    return { resources, errors };
  }
}

function makeKey(context: AttachmentLoadContext, attachmentId: string): AttachmentCacheKey {
  return { ...context, apiBaseUrl: normalizeAttachmentCacheApiBaseUrl(context.apiBaseUrl), attachmentId };
}

export function attachmentResourceKey(context: AttachmentLoadContext, attachmentId: string): string {
  return keyString(makeKey(context, attachmentId));
}

function keyString(key: AttachmentCacheKey): string {
  return JSON.stringify([key.apiBaseUrl, key.userId, key.conversationId, key.attachmentId]);
}

function addRetryQuery(src: string, value: number): string {
  const separator = src.includes("?") ? "&" : "?";
  return `${src}${separator}retry=${value}`;
}
