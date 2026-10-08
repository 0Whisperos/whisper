import { authorizeAvatarDownload } from "./profileApi";

interface AvatarResourceEntry {
  referenceCount: number;
  objectUrl: string | null;
  promise: Promise<string>;
}

export class AvatarResourceCache {
  private readonly entries = new Map<string, AvatarResourceEntry>();

  acquire(apiBaseUrl: string, getAccessToken: () => string, objectKey: string): Promise<string> {
    const cached = this.entries.get(objectKey);
    if (cached) {
      cached.referenceCount += 1;
      return cached.promise;
    }

    const entry: AvatarResourceEntry = {
      referenceCount: 1,
      objectUrl: null,
      promise: Promise.resolve(""),
    };
    entry.promise = this.download(apiBaseUrl, getAccessToken, objectKey)
      .then((blob) => {
        const objectUrl = URL.createObjectURL(blob);
        entry.objectUrl = objectUrl;
        if (entry.referenceCount === 0 || this.entries.get(objectKey) !== entry) {
          URL.revokeObjectURL(objectUrl);
        }
        return objectUrl;
      })
      .catch((error) => {
        if (this.entries.get(objectKey) === entry) {
          this.entries.delete(objectKey);
        }
        throw error;
      });
    this.entries.set(objectKey, entry);
    return entry.promise;
  }

  release(objectKey: string): void {
    const entry = this.entries.get(objectKey);
    if (!entry) {
      return;
    }
    entry.referenceCount = Math.max(0, entry.referenceCount - 1);
    if (entry.referenceCount !== 0) {
      return;
    }
    this.entries.delete(objectKey);
    if (entry.objectUrl) {
      URL.revokeObjectURL(entry.objectUrl);
    }
  }

  prime(objectKey: string, file: Blob): void {
    if (this.entries.has(objectKey)) {
      return;
    }
    const objectUrl = URL.createObjectURL(file);
    this.entries.set(objectKey, {
      referenceCount: 0,
      objectUrl,
      promise: Promise.resolve(objectUrl),
    });
  }

  clear(): void {
    for (const entry of this.entries.values()) {
      if (entry.objectUrl) {
        URL.revokeObjectURL(entry.objectUrl);
      }
      entry.referenceCount = 0;
    }
    this.entries.clear();
  }

  private async download(apiBaseUrl: string, getAccessToken: () => string, objectKey: string): Promise<Blob> {
    let lastError: unknown = new Error("avatar_download_failed");
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        const authorization = await authorizeAvatarDownload(apiBaseUrl, getAccessToken());
        if (authorization.objectKey !== objectKey) {
          throw new Error("avatar_object_key_mismatch");
        }
        const response = await fetch(authorization.downloadUrl);
        if (!response.ok) {
          throw new Error("avatar_download_failed");
        }
        return await response.blob();
      } catch (error) {
        lastError = error;
      }
    }
    throw lastError;
  }
}
