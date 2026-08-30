import type {
  ChatFriendDto,
  ChatMessageDto,
  ChatMessagePageDto,
  ChatUserProfileDto,
} from "./types";

export type ChatApiErrorCode =
  | "invalid_token"
  | "token_expired"
  | "user_not_found"
  | "conversation_not_found"
  | "not_conversation_member"
  | "invalid_pagination"
  | "internal_error"
  | "network_error";

export class ChatApiError extends Error {
  constructor(readonly code: ChatApiErrorCode) {
    super(code);
    this.name = "ChatApiError";
  }
}

export async function loadCurrentUser(apiBaseUrl: string, accessToken: string): Promise<ChatUserProfileDto> {
  const response = await request(`${joinApiPath(apiBaseUrl)}/v1/me`, accessToken);
  if (!response.ok) {
    throw new ChatApiError(await readErrorCode(response));
  }
  const value = await readJson(response);
  const profile = parseUserProfile(value);
  if (!profile) {
    throw new ChatApiError("internal_error");
  }
  return profile;
}

export async function loadFriends(apiBaseUrl: string, accessToken: string): Promise<ChatFriendDto[]> {
  const response = await request(`${joinApiPath(apiBaseUrl)}/v1/friends`, accessToken);
  if (!response.ok) {
    throw new ChatApiError(await readErrorCode(response));
  }
  const value = await readJson(response);
  const friends = parseFriends(value);
  if (!friends) {
    throw new ChatApiError("internal_error");
  }
  return friends;
}

export async function loadConversationMessages(
  apiBaseUrl: string,
  accessToken: string,
  conversationId: number,
  options: { beforeSeq?: number; fromSeq?: number; limit?: number } = {},
): Promise<ChatMessagePageDto> {
  const query = new URLSearchParams();
  if (options.beforeSeq !== undefined) {
    query.set("before_seq", String(options.beforeSeq));
  }
  if (options.fromSeq !== undefined) {
    query.set("from_seq", String(options.fromSeq));
  }
  if (options.limit !== undefined) {
    query.set("limit", String(options.limit));
  }
  const suffix = query.toString() ? `?${query.toString()}` : "";
  const response = await request(
    `${joinApiPath(apiBaseUrl)}/v1/conversations/${conversationId}/messages${suffix}`,
    accessToken,
  );
  if (!response.ok) {
    throw new ChatApiError(await readErrorCode(response));
  }
  const value = await readJson(response);
  const page = parseMessagePage(value);
  if (!page) {
    throw new ChatApiError("internal_error");
  }
  return page;
}

async function request(url: string, accessToken: string): Promise<Response> {
  try {
    return await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
  } catch {
    throw new ChatApiError("network_error");
  }
}

async function readJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    throw new ChatApiError("internal_error");
  }
}

async function readErrorCode(response: Response): Promise<ChatApiErrorCode> {
  try {
    const body: unknown = await response.json();
    if (typeof body === "object" && body !== null && "error_code" in body && isChatApiErrorCode(body.error_code)) {
      return body.error_code;
    }
  } catch {
    return "internal_error";
  }
  return "internal_error";
}

function isChatApiErrorCode(value: unknown): value is ChatApiErrorCode {
  return value === "invalid_token"
    || value === "token_expired"
    || value === "user_not_found"
    || value === "conversation_not_found"
    || value === "not_conversation_member"
    || value === "invalid_pagination"
    || value === "internal_error"
    || value === "network_error";
}

function parseUserProfile(value: unknown): ChatUserProfileDto | null {
  if (typeof value !== "object" || value === null
    || !("user_id" in value) || typeof value.user_id !== "number"
    || !("account" in value) || typeof value.account !== "string"
    || !("nickname" in value) || typeof value.nickname !== "string"
    || !("signature" in value) || typeof value.signature !== "string"
    || !("avatar_object_key" in value) || (value.avatar_object_key !== null && typeof value.avatar_object_key !== "string")) {
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

function parseFriends(value: unknown): ChatFriendDto[] | null {
  if (typeof value !== "object" || value === null || !("friends" in value) || !Array.isArray(value.friends)) {
    return null;
  }
  const friends: ChatFriendDto[] = [];
  for (const friend of value.friends) {
    const profile = parseUserProfile(friend);
    if (!profile || typeof friend !== "object" || friend === null
      || !("friendship_state" in friend) || friend.friendship_state !== "active"
      || !("conversation_id" in friend)
      || (friend.conversation_id !== null && typeof friend.conversation_id !== "number")) {
      return null;
    }
    friends.push({
      ...profile,
      friendshipState: "active",
      conversationId: friend.conversation_id,
    });
  }
  return friends;
}

function parseMessagePage(value: unknown): ChatMessagePageDto | null {
  if (typeof value !== "object" || value === null || !("messages" in value) || !Array.isArray(value.messages)) {
    return null;
  }
  if (!("has_more" in value) || typeof value.has_more !== "boolean") {
    return null;
  }
  const payload = value as Record<string, unknown>;
  if ("next_before_seq" in payload && payload.next_before_seq !== undefined && typeof payload.next_before_seq !== "number") {
    return null;
  }
  if ("next_from_seq" in payload && payload.next_from_seq !== undefined && typeof payload.next_from_seq !== "number") {
    return null;
  }
  const messages: ChatMessageDto[] = [];
  for (const message of value.messages) {
    if (!isMessage(message)) {
      return null;
    }
    messages.push({
      messageId: message.message_id,
      conversationId: message.conversation_id,
      conversationSeq: message.conversation_seq,
      senderUserId: message.sender_user_id,
      clientMessageId: message.client_message_id,
      messageType: message.message_type,
      content: message.content,
      createdAt: message.created_at,
    });
  }
  return {
    messages,
    hasMore: value.has_more,
    nextBeforeSeq: payload.next_before_seq as number | undefined,
    nextFromSeq: payload.next_from_seq as number | undefined,
  };
}

function isMessage(value: unknown): value is {
  message_id: string;
  conversation_id: number;
  conversation_seq: number;
  sender_user_id: number;
  client_message_id: string;
  message_type: "text";
  content: { text: string };
  created_at: string;
} {
  return typeof value === "object"
    && value !== null
    && "message_id" in value && typeof value.message_id === "string"
    && "conversation_id" in value && typeof value.conversation_id === "number"
    && "conversation_seq" in value && typeof value.conversation_seq === "number"
    && "sender_user_id" in value && typeof value.sender_user_id === "number"
    && "client_message_id" in value && typeof value.client_message_id === "string"
    && "message_type" in value && value.message_type === "text"
    && "content" in value && isTextContent(value.content)
    && "created_at" in value && typeof value.created_at === "string";
}

function isTextContent(value: unknown): value is { text: string } {
  return typeof value === "object" && value !== null && "text" in value && typeof value.text === "string";
}

function joinApiPath(apiBaseUrl: string): string {
  return apiBaseUrl.replace(/\/+$/, "");
}
