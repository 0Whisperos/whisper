import type {
  ChatAuthFrame,
  ChatConnectionOptions,
  ChatConnectionState,
  ChatServerAuthFrame,
  ChatWebSocket,
} from "./types";

export interface ChatConnectionController {
  close: () => void;
}

export function connectChatWebSocket(options: ChatConnectionOptions): ChatConnectionController {
  const requestId = options.requestIdFactory?.() ?? crypto.randomUUID();
  const socket = (options.webSocketFactory ?? ((url) => new WebSocket(url)))(options.session.imChatWsUrl);
  let completedAuth = false;
  let closedByClient = false;

  options.onStateChange({ status: "connecting" });

  socket.onopen = () => {
    options.onStateChange({ status: "authenticating", requestId });
    const frame: ChatAuthFrame = {
      type: "auth",
      request_id: requestId,
      payload: {
        access_token: options.session.accessToken,
      },
    };
    socket.send(JSON.stringify(frame));
  };

  socket.onmessage = (event) => {
    const frame = parseServerAuthFrame(event.data);
    if (!frame) {
      options.onStateChange({ status: "error", message: "invalid chat server frame" });
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
      return;
    }
    options.onStateChange({
      status: "auth_failed",
      errorCode: frame.payload.error_code,
      message: frame.payload.message,
    });
    closeSocket(socket);
  };

  socket.onerror = () => {
    if (!closedByClient) {
      options.onStateChange({ status: "error", message: "chat connection error" });
    }
  };

  socket.onclose = () => {
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
      closeSocket(socket);
    },
  };
}

function parseServerAuthFrame(data: unknown): ChatServerAuthFrame | null {
  if (typeof data !== "string") {
    return null;
  }
  let value: unknown;
  try {
    value = JSON.parse(data);
  } catch {
    return null;
  }
  if (isAuthOkFrame(value) || isAuthFailedFrame(value)) {
    return value;
  }
  return null;
}

function isAuthOkFrame(value: unknown): value is ChatServerAuthFrame {
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

function isAuthFailedFrame(value: unknown): value is ChatServerAuthFrame {
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
