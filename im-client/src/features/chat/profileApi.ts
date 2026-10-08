import type { ChatUserProfileDto, EditableAvatar } from "./types";

export interface AvatarUploadAuthorization {
  objectKey: string;
  uploadUrl: string;
  method: "PUT";
  headers: Record<string, string>;
  expiresAt: string;
}

export interface AvatarDownloadAuthorization {
  objectKey: string;
  downloadUrl: string;
  expiresAt: string;
}

export interface UpdateCurrentProfileInput {
  nickname: string;
  signature: string;
  avatarObjectKey?: string | null;
}

export interface SaveCurrentProfileInput {
  nickname: string;
  signature: string;
  avatar: EditableAvatar;
}

export class ProfileApiError extends Error {
  constructor(readonly code: string) {
    super(code);
    this.name = "ProfileApiError";
  }
}

export async function authorizeAvatarUpload(
  apiBaseUrl: string,
  accessToken: string,
): Promise<AvatarUploadAuthorization> {
  const response = await authorizedRequest(
    `${joinApiPath(apiBaseUrl)}/v1/me/avatar-upload-authorization`,
    accessToken,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        content_type: "image/png",
      }),
    },
  );
  await ensureSuccess(response);
  const authorization = parseUploadAuthorization(await readJson(response));
  if (!authorization) {
    throw new ProfileApiError("internal_error");
  }
  return authorization;
}

export async function uploadAvatarFile(authorization: AvatarUploadAuthorization, file: File): Promise<void> {
  let response: Response;
  try {
    response = await fetch(authorization.uploadUrl, {
      method: authorization.method,
      headers: authorization.headers,
      body: file,
    });
  } catch {
    throw new ProfileApiError("avatar_upload_failed");
  }
  if (!response.ok) {
    throw new ProfileApiError("avatar_upload_failed");
  }
}

export async function updateCurrentProfile(
  apiBaseUrl: string,
  accessToken: string,
  input: UpdateCurrentProfileInput,
): Promise<ChatUserProfileDto> {
  const body: Record<string, unknown> = {
    nickname: input.nickname,
    signature: input.signature,
  };
  if (Object.hasOwn(input, "avatarObjectKey")) {
    body.avatar_object_key = input.avatarObjectKey;
  }
  const response = await authorizedRequest(`${joinApiPath(apiBaseUrl)}/v1/me/profile`, accessToken, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  await ensureSuccess(response);
  const profile = parseUserProfile(await readJson(response));
  if (!profile) {
    throw new ProfileApiError("internal_error");
  }
  return profile;
}

export async function saveCurrentProfile(
  apiBaseUrl: string,
  accessToken: string,
  input: SaveCurrentProfileInput,
): Promise<ChatUserProfileDto> {
  if (input.avatar.action === "keep") {
    return updateCurrentProfile(apiBaseUrl, accessToken, {
      nickname: input.nickname,
      signature: input.signature,
    });
  }

  if (input.avatar.action === "remove") {
    return updateCurrentProfile(apiBaseUrl, accessToken, {
      nickname: input.nickname,
      signature: input.signature,
      avatarObjectKey: null,
    });
  }

  const authorization = await authorizeAvatarUpload(apiBaseUrl, accessToken);
  await uploadAvatarFile(authorization, input.avatar.file);
  return updateCurrentProfile(apiBaseUrl, accessToken, {
    nickname: input.nickname,
    signature: input.signature,
    avatarObjectKey: authorization.objectKey,
  });
}

export async function authorizeAvatarDownload(
  apiBaseUrl: string,
  accessToken: string,
): Promise<AvatarDownloadAuthorization> {
  const response = await authorizedRequest(
    `${joinApiPath(apiBaseUrl)}/v1/me/avatar-download-authorization`,
    accessToken,
    { method: "POST" },
  );
  await ensureSuccess(response);
  const authorization = parseDownloadAuthorization(await readJson(response));
  if (!authorization) {
    throw new ProfileApiError("internal_error");
  }
  return authorization;
}

async function authorizedRequest(
  url: string,
  accessToken: string,
  init: RequestInit,
): Promise<Response> {
  try {
    return await fetch(url, {
      ...init,
      headers: {
        Authorization: `Bearer ${accessToken}`,
        ...init.headers,
      },
    });
  } catch {
    throw new ProfileApiError("network_error");
  }
}

async function ensureSuccess(response: Response): Promise<void> {
  if (!response.ok) {
    throw new ProfileApiError(await readErrorCode(response));
  }
}

async function readJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    throw new ProfileApiError("internal_error");
  }
}

async function readErrorCode(response: Response): Promise<string> {
  try {
    const body: unknown = await response.json();
    if (typeof body === "object" && body !== null && "error_code" in body && typeof body.error_code === "string") {
      return body.error_code;
    }
  } catch {
    return "internal_error";
  }
  return "internal_error";
}

function parseUploadAuthorization(value: unknown): AvatarUploadAuthorization | null {
  if (!isRecord(value)
    || typeof value.object_key !== "string"
    || typeof value.upload_url !== "string"
    || value.method !== "PUT"
    || typeof value.expires_at !== "string"
    || !isStringRecord(value.headers)) {
    return null;
  }
  return {
    objectKey: value.object_key,
    uploadUrl: value.upload_url,
    method: value.method,
    headers: value.headers,
    expiresAt: value.expires_at,
  };
}

function parseDownloadAuthorization(value: unknown): AvatarDownloadAuthorization | null {
  if (!isRecord(value)
    || typeof value.object_key !== "string"
    || typeof value.download_url !== "string"
    || typeof value.expires_at !== "string") {
    return null;
  }
  return {
    objectKey: value.object_key,
    downloadUrl: value.download_url,
    expiresAt: value.expires_at,
  };
}

function parseUserProfile(value: unknown): ChatUserProfileDto | null {
  if (!isRecord(value)
    || typeof value.user_id !== "number"
    || typeof value.account !== "string"
    || typeof value.nickname !== "string"
    || typeof value.signature !== "string"
    || (value.avatar_object_key !== null && typeof value.avatar_object_key !== "string")) {
    return null;
  }
  return {
    userId: value.user_id,
    account: value.account,
    nickname: value.nickname,
    signature: value.signature,
    avatarObjectKey: value.avatar_object_key,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isStringRecord(value: unknown): value is Record<string, string> {
  return isRecord(value) && Object.values(value).every((item) => typeof item === "string");
}

function joinApiPath(apiBaseUrl: string): string {
  return apiBaseUrl.replace(/\/+$/, "");
}
