import type { FriendRequestDirection, FriendRequestPageDto, FriendRequestUserDto } from "./types";
import { ChatApiError } from "./api";

export async function searchUserByAccount(apiBaseUrl: string, accessToken: string, account: string): Promise<FriendRequestUserDto | null> {
  const response = await request(`${joinApiPath(apiBaseUrl)}/v1/users/by-account/${encodeURIComponent(account)}`, accessToken);
  if (response.status === 404) {
    return null;
  }
  if (!response.ok) {
    throw new ChatApiError(await readErrorCode(response));
  }
  const profile = parseUser(await readJson(response));
  if (!profile) {
    throw new ChatApiError("internal_error");
  }
  return profile;
}

export async function loadFriendRequests(
  apiBaseUrl: string,
  accessToken: string,
  direction: FriendRequestDirection,
  cursor?: string | null,
): Promise<FriendRequestPageDto> {
  const query = new URLSearchParams({ direction, limit: "20" });
  if (cursor) query.set("cursor", cursor);
  const response = await request(`${joinApiPath(apiBaseUrl)}/v1/friend-requests?${query.toString()}`, accessToken);
  if (!response.ok) {
    throw new ChatApiError(await readErrorCode(response));
  }
  const page = parseRequestPage(await readJson(response));
  if (!page) throw new ChatApiError("internal_error");
  return page;
}

export async function createFriendRequest(apiBaseUrl: string, accessToken: string, account: string, verificationMessage: string): Promise<void> {
  const response = await request(`${joinApiPath(apiBaseUrl)}/v1/friend-requests`, accessToken, {
    method: "POST",
    body: JSON.stringify({ account, verification_message: verificationMessage }),
  });
  if (!response.ok) throw new ChatApiError(response.status === 409 ? "friend_request_pending" : await readErrorCode(response));
}

export async function respondToFriendRequest(
  apiBaseUrl: string,
  accessToken: string,
  requestId: string,
  action: "accept" | "reject",
): Promise<void> {
  const response = await request(`${joinApiPath(apiBaseUrl)}/v1/friend-requests/${encodeURIComponent(requestId)}/${action}`, accessToken, { method: "POST" });
  if (!response.ok) throw new ChatApiError(await readErrorCode(response));
}

async function request(url: string, accessToken: string, init: RequestInit = {}): Promise<Response> {
  try {
    return await fetch(url, {
      ...init,
      headers: {
        Authorization: `Bearer ${accessToken}`,
        ...(init.body ? { "Content-Type": "application/json" } : {}),
        ...init.headers,
      },
    });
  } catch {
    throw new ChatApiError("network_error");
  }
}

async function readJson(response: Response): Promise<unknown> {
  try { return await response.json(); } catch { throw new ChatApiError("internal_error"); }
}

async function readErrorCode(response: Response): Promise<"invalid_token" | "token_expired" | "user_not_found" | "conversation_not_found" | "not_conversation_member" | "invalid_pagination" | "internal_error" | "network_error" | "friend_request_pending"> {
  try {
    const body: unknown = await response.json();
    if (typeof body === "object" && body !== null && "error_code" in body && typeof body.error_code === "string") {
      const code = body.error_code;
      if (code === "request_pending" || code === "friend_request_pending") return "friend_request_pending";
      if (["invalid_token", "token_expired", "user_not_found", "conversation_not_found", "not_conversation_member", "invalid_pagination", "internal_error", "network_error"].includes(code)) {
        return code as "invalid_token" | "token_expired" | "user_not_found" | "conversation_not_found" | "not_conversation_member" | "invalid_pagination" | "internal_error" | "network_error";
      }
    }
  } catch { /* use the stable fallback below */ }
  return "internal_error";
}

function parseUser(value: unknown): FriendRequestUserDto | null {
  if (!isRecord(value) || typeof value.user_id !== "number" || typeof value.account !== "string"
    || typeof value.nickname !== "string" || typeof value.signature !== "string"
    || (value.avatar_object_key !== null && typeof value.avatar_object_key !== "string")) return null;
  return { userId: value.user_id, account: value.account, nickname: value.nickname, signature: value.signature, avatarObjectKey: value.avatar_object_key };
}

function parseRequestPage(value: unknown): FriendRequestPageDto | null {
  if (!isRecord(value) || !Array.isArray(value.requests) || typeof value.pending_count !== "number"
    || (value.next_cursor !== null && typeof value.next_cursor !== "string") || typeof value.has_more !== "boolean") return null;
  const requests = value.requests.map((entry) => {
    if (!isRecord(entry)) return null;
    const sender = parseUser(entry.sender);
    const recipient = parseUser(entry.recipient);
    if (!sender || !recipient || typeof entry.request_id !== "string" || typeof entry.verification_message !== "string"
      || (entry.status !== "pending" && entry.status !== "accepted" && entry.status !== "rejected")
      || typeof entry.created_at !== "string") return null;
    return { requestId: entry.request_id, sender, recipient, verificationMessage: entry.verification_message, status: entry.status, createdAt: entry.created_at };
  });
  if (requests.some((entry) => entry === null)) return null;
  return { requests: requests as FriendRequestPageDto["requests"], pendingCount: value.pending_count, nextCursor: value.next_cursor, hasMore: value.has_more };
}

function isRecord(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null; }
function joinApiPath(apiBaseUrl: string): string { return apiBaseUrl.replace(/\/+$/, ""); }
