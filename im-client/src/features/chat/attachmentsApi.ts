export interface UploadFileInput {
  file_name: string;
  content_type: string;
  size_bytes: number;
}

export interface UploadAuthorization {
  attachment_id: string;
  upload_url: string;
  method: "PUT";
  headers: Record<string, string>;
  expires_at: string;
}

export interface UploadCompletion {
  attachment_id: string;
  status: "uploaded" | "uploading" | "expired";
  size_bytes?: number;
  error_code?: string;
}

export interface DownloadAuthorization {
  attachment_id: string;
  download_url: string;
  expires_at: string;
  content_type: string;
  size_bytes: number;
}

export class AttachmentApiError extends Error {
  constructor(readonly code: string) { super(code); this.name = "AttachmentApiError"; }
}

export function downloadAuthorizationRefreshDelay(
  expiresAt: string,
  now = Date.now(),
  safetyMarginMs = 30_000,
): number {
  const expiry = Date.parse(expiresAt);
  if (Number.isNaN(expiry)) return 60_000;
  return Math.max(1_000, expiry - now - safetyMarginMs);
}

export async function requestUploadAuthorizations(
  apiBaseUrl: string, token: string, conversationId: number, files: UploadFileInput[],
): Promise<UploadAuthorization[]> {
  const body = await apiRequest(apiBaseUrl, token, "/v1/attachments/upload-authorizations", {
    conversation_id: conversationId, files,
  });
  const attachments = objectField(body, "attachments");
  if (!Array.isArray(attachments)) throw new AttachmentApiError("internal_error");
  const parsed = attachments.map(parseUploadAuthorization);
  if (parsed.some((item) => item === null) || parsed.length !== files.length) throw new AttachmentApiError("internal_error");
  return parsed as UploadAuthorization[];
}

export async function uploadSignedFile(auth: UploadAuthorization, file: File): Promise<void> {
  let response: Response;
  try {
    response = await fetch(auth.upload_url, { method: auth.method, headers: auth.headers, body: file });
  } catch {
    throw new AttachmentApiError("upload_failed");
  }
  if (!response.ok) throw new AttachmentApiError(response.status === 403 ? "upload_authorization_expired" : "upload_failed");
}

export async function confirmUploads(apiBaseUrl: string, token: string, ids: string[]): Promise<UploadCompletion[]> {
  const body = await apiRequest(apiBaseUrl, token, "/v1/attachments/upload-completions", { attachment_ids: ids });
  const attachments = objectField(body, "attachments");
  if (!Array.isArray(attachments)) throw new AttachmentApiError("internal_error");
  return attachments.map((item): UploadCompletion => {
    if (typeof item !== "object" || item === null || !("attachment_id" in item) || typeof item.attachment_id !== "string"
      || !("status" in item) || (item.status !== "uploaded" && item.status !== "uploading" && item.status !== "expired")) {
      throw new AttachmentApiError("internal_error");
    }
    return {
      attachment_id: item.attachment_id,
      status: item.status,
      ...(typeof item.size_bytes === "number" ? { size_bytes: item.size_bytes } : {}),
      ...(typeof item.error_code === "string" ? { error_code: item.error_code } : {}),
    };
  });
}

export async function requestDownloadAuthorizations(
  apiBaseUrl: string, token: string, conversationId: number, ids: string[],
): Promise<DownloadAuthorization[]> {
  if (ids.length === 0) return [];
  const body = await apiRequest(apiBaseUrl, token, `/v1/conversations/${conversationId}/attachments/download-authorizations`, {
    attachment_ids: ids,
  });
  const attachments = objectField(body, "attachments");
  if (!Array.isArray(attachments)) throw new AttachmentApiError("internal_error");
  const parsed = attachments.map(parseDownloadAuthorization);
  if (parsed.some((item) => item === null) || parsed.length !== ids.length) throw new AttachmentApiError("internal_error");
  return parsed as DownloadAuthorization[];
}

export async function fetchSignedImage(url: string): Promise<Blob> {
  let response: Response;
  try { response = await fetch(url); } catch { throw new AttachmentApiError("download_failed"); }
  if (!response.ok) throw new AttachmentApiError("download_failed");
  return response.blob();
}

async function apiRequest(apiBaseUrl: string, token: string, path: string, payload: unknown): Promise<Record<string, unknown>> {
  let response: Response;
  try {
    response = await fetch(`${apiBaseUrl.replace(/\/+$/, "")}${path}`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
  } catch { throw new AttachmentApiError("network_error"); }
  let value: unknown;
  try { value = await response.json(); } catch { throw new AttachmentApiError("internal_error"); }
  if (!response.ok) {
    throw new AttachmentApiError(typeof value === "object" && value !== null && "error_code" in value && typeof value.error_code === "string"
      ? value.error_code : "internal_error");
  }
  if (typeof value !== "object" || value === null) throw new AttachmentApiError("internal_error");
  return value as Record<string, unknown>;
}

function objectField(value: Record<string, unknown>, field: string): unknown { return value[field]; }

function parseUploadAuthorization(value: unknown): UploadAuthorization | null {
  if (typeof value !== "object" || value === null || !("attachment_id" in value) || typeof value.attachment_id !== "string"
    || !("upload_url" in value) || typeof value.upload_url !== "string" || !("method" in value) || value.method !== "PUT"
    || !("headers" in value) || typeof value.headers !== "object" || value.headers === null
    || !("expires_at" in value) || typeof value.expires_at !== "string") return null;
  const headers = Object.fromEntries(Object.entries(value.headers).filter(([, header]) => typeof header === "string")) as Record<string, string>;
  return { attachment_id: value.attachment_id, upload_url: value.upload_url, method: "PUT", headers, expires_at: value.expires_at };
}

function parseDownloadAuthorization(value: unknown): DownloadAuthorization | null {
  if (typeof value !== "object" || value === null || !("attachment_id" in value) || typeof value.attachment_id !== "string"
    || !("download_url" in value) || typeof value.download_url !== "string" || !("expires_at" in value) || typeof value.expires_at !== "string"
    || !("content_type" in value) || typeof value.content_type !== "string" || !("size_bytes" in value) || typeof value.size_bytes !== "number") return null;
  return { attachment_id: value.attachment_id, download_url: value.download_url, expires_at: value.expires_at, content_type: value.content_type, size_bytes: value.size_bytes };
}
