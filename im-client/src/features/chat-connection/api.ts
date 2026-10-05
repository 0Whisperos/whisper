import type {
  ChatAuthFrame,
  ChatBusinessServerFrame,
  ChatConnectionOptions,
  ChatHeartbeatFrame,
  ChatDeliveredAckFrame,
  ChatReadAckFrame,
  ChatDeliveredAckAcceptedFrame,
  ChatReadAckAcceptedFrame,
  ChatDeliveredAckRejectedFrame,
  ChatReadAckRejectedFrame,
  ChatConversationReceiptUpdatedFrame,
  ChatFriendRequestUpdatedFrame,
  ChatMessageCreatedFrame,
  ChatSendMessageFrame,
  ChatSendMessageRejectedFrame,
  ChatSendTextMessageInput,
  ChatServerFrame,
  ChatServerAcceptedFrame,
  ChatTextMessage,
  ChatWebSocket,
} from "./types";

const HEARTBEAT_INTERVAL_MS = 10_000;

export interface ChatConnectionController {
  close: () => void;
  sendTextMessage: (input: ChatSendTextMessageInput) => void;
  sendDeliveredAck: (conversationId: number, deliveredSeq: number) => void;
  sendReadAck: (conversationId: number, readSeq: number) => void;
}

export function connectChatWebSocket(options: ChatConnectionOptions): ChatConnectionController {
  const createRequestId = options.requestIdFactory ?? (() => crypto.randomUUID());
  const authRequestId = createRequestId();
  const socket = (options.webSocketFactory ?? ((url) => new WebSocket(url)))(options.session.imChatWsUrl);
  let completedAuth = false;
  let closedByClient = false;
  let heartbeatTimer: ReturnType<typeof setInterval> | null = null;

  options.onStateChange({ status: "connecting" });

  socket.onopen = () => {
    options.onStateChange({ status: "authenticating", requestId: authRequestId });
    const frame: ChatAuthFrame = {
      type: "auth",
      request_id: authRequestId,
      payload: {
        access_token: options.session.accessToken,
      },
    };
    socket.send(JSON.stringify(frame));
  };

  socket.onmessage = (event) => {
    const frame = parseServerFrame(event.data);
    if (!frame) {
      options.onStateChange({ status: "error", message: "invalid chat server frame" });
      stopHeartbeat();
      closeSocket(socket);
      return;
    }
    if (frame.type === "auth_ok") {
      completedAuth = true;
      options.onStateChange({
        status: "authenticated",
        userId: frame.payload.user_id,
        connectionId: frame.payload.connection_id,
        accessTokenExpiresAt: frame.payload.access_token_expires_at,
      });
      startHeartbeat();
      return;
    }
    if (frame.type === "heartbeat_ok" && completedAuth) {
      return;
    }
    if (isBusinessServerFrame(frame) && completedAuth) {
      options.onServerFrame?.(frame);
      return;
    }
    if (isBusinessServerFrame(frame) || frame.type === "heartbeat_ok") {
      rejectInvalidServerFrame();
      return;
    }
    options.onStateChange({
      status: "auth_failed",
      errorCode: frame.payload.error_code,
      message: frame.payload.message,
    });
    stopHeartbeat();
    closeSocket(socket);
  };

  socket.onerror = () => {
    stopHeartbeat();
    if (!closedByClient) {
      options.onStateChange({ status: "error", message: "chat connection error" });
    }
  };

  socket.onclose = () => {
    stopHeartbeat();
    if (closedByClient) {
      options.onStateChange({ status: "closed" });
      return;
    }
    if (!completedAuth) {
      return;
    }
    options.onStateChange({ status: "closed" });
  };

  return {
    close: () => {
      closedByClient = true;
      stopHeartbeat();
      closeSocket(socket);
    },
    sendTextMessage: (input) => {
      if (!completedAuth || socket.readyState !== WebSocket.OPEN) {
        throw new Error("chat connection is not authenticated");
      }
      const frame: ChatSendMessageFrame = {
        type: "send_message",
        request_id: createRequestId(),
        payload: {
          client_message_id: input.clientMessageId,
          conversation_id: input.conversationId,
          message_type: "text",
          content: { text: input.text },
          client_sent_at: input.clientSentAt,
        },
      };
      socket.send(JSON.stringify(frame));
    },
    sendDeliveredAck: (conversationId, deliveredSeq) => {
      sendCursorAck("delivered_ack", conversationId, deliveredSeq);
    },
    sendReadAck: (conversationId, readSeq) => {
      sendCursorAck("read_ack", conversationId, readSeq);
    },
  };

  function sendCursorAck(type: "delivered_ack" | "read_ack", conversationId: number, sequence: number) {
    if (!completedAuth || socket.readyState !== WebSocket.OPEN) {
      throw new Error("chat connection is not authenticated");
    }
    const frame: ChatDeliveredAckFrame | ChatReadAckFrame = type === "delivered_ack"
      ? { type, request_id: createRequestId(), payload: { conversation_id: conversationId, delivered_seq: sequence } }
      : { type, request_id: createRequestId(), payload: { conversation_id: conversationId, read_seq: sequence } };
    socket.send(JSON.stringify(frame));
  }

  function startHeartbeat() {
    stopHeartbeat();
    sendHeartbeat();
    heartbeatTimer = setInterval(sendHeartbeat, HEARTBEAT_INTERVAL_MS);
  }

  function stopHeartbeat() {
    if (heartbeatTimer === null) {
      return;
    }
    clearInterval(heartbeatTimer);
    heartbeatTimer = null;
  }

  function rejectInvalidServerFrame() {
    options.onStateChange({ status: "error", message: "invalid chat server frame" });
    stopHeartbeat();
    closeSocket(socket);
  }

  function sendHeartbeat() {
    if (!completedAuth || socket.readyState !== WebSocket.OPEN) {
      return;
    }
    const frame: ChatHeartbeatFrame = {
      type: "heartbeat",
      request_id: createRequestId(),
      payload: {
        sent_at: formatProtocolTimestamp(new Date()),
      },
    };
    socket.send(JSON.stringify(frame));
  }
}

function parseServerFrame(data: unknown): ChatServerFrame | null {
  if (typeof data !== "string") {
    return null;
  }
  let value: unknown;
  try {
    value = JSON.parse(data);
  } catch {
    return null;
  }
  if (
    isAuthOkFrame(value)
    || isAuthFailedFrame(value)
    || isHeartbeatOkFrame(value)
    || isServerAcceptedFrame(value)
    || isSendMessageRejectedFrame(value)
    || isMessageCreatedFrame(value)
    || isDeliveredAckAcceptedFrame(value)
    || isReadAckAcceptedFrame(value)
    || isDeliveredAckRejectedFrame(value)
    || isReadAckRejectedFrame(value)
    || isConversationReceiptUpdatedFrame(value)
    || isFriendRequestUpdatedFrame(value)
  ) {
    return value;
  }
  return null;
}

function isBusinessServerFrame(frame: ChatServerFrame): frame is ChatBusinessServerFrame {
  return frame.type === "server_accepted"
    || frame.type === "send_message_rejected"
    || frame.type === "message_created"
    || frame.type === "delivered_ack_accepted"
    || frame.type === "read_ack_accepted"
    || frame.type === "delivered_ack_rejected"
    || frame.type === "read_ack_rejected"
    || frame.type === "conversation_receipt_updated"
    || frame.type === "friend_request_updated";
}

function isDeliveredAckAcceptedFrame(value: unknown): value is ChatDeliveredAckAcceptedFrame {
  return hasFrameEnvelope(value, "delivered_ack_accepted", true)
    && hasNumberProperty(value.payload, "conversation_id")
    && hasNumberProperty(value.payload, "delivered_seq")
    && hasStringProperty(value.payload, "delivered_at");
}

function isReadAckAcceptedFrame(value: unknown): value is ChatReadAckAcceptedFrame {
  return hasFrameEnvelope(value, "read_ack_accepted", true)
    && hasNumberProperty(value.payload, "conversation_id")
    && hasNumberProperty(value.payload, "read_seq")
    && hasStringProperty(value.payload, "read_at");
}

function isDeliveredAckRejectedFrame(value: unknown): value is ChatDeliveredAckRejectedFrame {
  return isAckRejectedFrame(value, "delivered_ack_rejected");
}

function isReadAckRejectedFrame(value: unknown): value is ChatReadAckRejectedFrame {
  return isAckRejectedFrame(value, "read_ack_rejected");
}

function isAckRejectedFrame(value: unknown, type: string): value is ChatDeliveredAckRejectedFrame | ChatReadAckRejectedFrame {
  return hasFrameEnvelope(value, type, true)
    && hasStringProperty(value.payload, "error_code")
    && hasStringProperty(value.payload, "message")
    && (!("conversation_id" in value.payload) || hasNumberProperty(value.payload, "conversation_id"));
}

function isConversationReceiptUpdatedFrame(value: unknown): value is ChatConversationReceiptUpdatedFrame {
  return hasFrameEnvelope(value, "conversation_receipt_updated", false)
    && hasNumberProperty(value.payload, "conversation_id")
    && hasNumberProperty(value.payload, "user_id")
    && hasNumberProperty(value.payload, "delivered_seq")
    && hasNumberProperty(value.payload, "read_seq");
}

function isFriendRequestUpdatedFrame(value: unknown): value is ChatFriendRequestUpdatedFrame {
  return hasFrameEnvelope(value, "friend_request_updated", false)
    && hasNumberProperty(value.payload, "request_id")
    && "status" in value.payload
    && (value.payload.status === "pending"
      || value.payload.status === "accepted"
      || value.payload.status === "rejected");
}

function isAuthOkFrame(value: unknown): value is ChatServerFrame {
  return (
    typeof value === "object"
    && value !== null
    && "type" in value
    && value.type === "auth_ok"
    && "request_id" in value
    && typeof value.request_id === "string"
    && "payload" in value
    && typeof value.payload === "object"
    && value.payload !== null
    && "user_id" in value.payload
    && typeof value.payload.user_id === "number"
    && "connection_id" in value.payload
    && typeof value.payload.connection_id === "string"
    && "access_token_expires_at" in value.payload
    && typeof value.payload.access_token_expires_at === "string"
  );
}

function isAuthFailedFrame(value: unknown): value is ChatServerFrame {
  return (
    typeof value === "object"
    && value !== null
    && "type" in value
    && value.type === "auth_failed"
    && "payload" in value
    && typeof value.payload === "object"
    && value.payload !== null
    && "error_code" in value.payload
    && isChatAuthErrorCode(value.payload.error_code)
    && "message" in value.payload
    && typeof value.payload.message === "string"
  );
}

function isHeartbeatOkFrame(value: unknown): value is ChatServerFrame {
  return (
    typeof value === "object"
    && value !== null
    && "type" in value
    && value.type === "heartbeat_ok"
    && "request_id" in value
    && typeof value.request_id === "string"
    && "payload" in value
    && typeof value.payload === "object"
    && value.payload !== null
    && "sent_at" in value.payload
    && typeof value.payload.sent_at === "string"
  );
}

function isServerAcceptedFrame(value: unknown): value is ChatServerAcceptedFrame {
  const isValid = hasFrameEnvelope(value, "server_accepted", true)
    && hasStringProperty(value.payload, "client_message_id")
    && hasTextMessageProperty(value.payload, "message");
  if (!isValid) {
    return false;
  }
  const payload = value.payload as { client_message_id: string; message: ChatTextMessage };
  return payload.client_message_id === payload.message.client_message_id;
}

function isSendMessageRejectedFrame(value: unknown): value is ChatSendMessageRejectedFrame {
  return hasFrameEnvelope(value, "send_message_rejected", true)
    && hasStringProperty(value.payload, "client_message_id")
    && hasStringProperty(value.payload, "error_code")
    && hasStringProperty(value.payload, "message");
}

function isMessageCreatedFrame(value: unknown): value is ChatMessageCreatedFrame {
  return hasFrameEnvelope(value, "message_created", false)
    && hasStringProperty(value.payload, "event_id")
    && hasTextMessageProperty(value.payload, "message");
}

function hasFrameEnvelope(value: unknown, type: string, requiresRequestId: boolean): value is {
  type: string;
  request_id?: string;
  payload: Record<string, unknown>;
} {
  return typeof value === "object"
    && value !== null
    && "type" in value
    && value.type === type
    && (!requiresRequestId || ("request_id" in value && typeof value.request_id === "string"))
    && "payload" in value
    && typeof value.payload === "object"
    && value.payload !== null;
}

function hasStringProperty(value: object, property: string): boolean {
  return property in value && typeof (value as Record<string, unknown>)[property] === "string";
}

function hasNumberProperty(value: object, property: string): boolean {
  return property in value && typeof (value as Record<string, unknown>)[property] === "number";
}

function hasTextMessageProperty(value: object, property: string): boolean {
  if (!(property in value)) {
    return false;
  }
  return isTextMessage((value as Record<string, unknown>)[property]);
}

function isTextMessage(value: unknown): value is ChatTextMessage {
  return typeof value === "object"
    && value !== null
    && hasStringProperty(value, "message_id")
    && hasNumberProperty(value, "conversation_id")
    && hasNumberProperty(value, "conversation_seq")
    && hasNumberProperty(value, "sender_user_id")
    && hasStringProperty(value, "client_message_id")
    && "message_type" in value
    && value.message_type === "text"
    && "content" in value
    && typeof value.content === "object"
    && value.content !== null
    && hasStringProperty(value.content, "text")
    && hasStringProperty(value, "created_at");
}

function isChatAuthErrorCode(value: unknown): boolean {
  return value === "invalid_request"
    || value === "invalid_token"
    || value === "token_expired"
    || value === "internal_error";
}

function closeSocket(socket: ChatWebSocket) {
  if (socket.readyState === WebSocket.CLOSED || socket.readyState === WebSocket.CLOSING) {
    return;
  }
  socket.close();
}

function formatProtocolTimestamp(date: Date): string {
  const timezoneOffsetMinutes = -date.getTimezoneOffset();
  const offsetSign = timezoneOffsetMinutes >= 0 ? "+" : "-";
  const absoluteOffsetMinutes = Math.abs(timezoneOffsetMinutes);
  const offsetHours = Math.floor(absoluteOffsetMinutes / 60);
  const offsetMinutes = absoluteOffsetMinutes % 60;

  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`
    + `T${pad2(date.getHours())}:${pad2(date.getMinutes())}:${pad2(date.getSeconds())}`
    + `.${pad3(date.getMilliseconds())}${offsetSign}${pad2(offsetHours)}:${pad2(offsetMinutes)}`;
}

function pad2(value: number): string {
  return value.toString().padStart(2, "0");
}

function pad3(value: number): string {
  return value.toString().padStart(3, "0");
}
