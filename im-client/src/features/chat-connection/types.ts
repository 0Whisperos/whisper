import type { AuthSession } from "../login/types";

export type ChatAuthErrorCode =
  | "invalid_request"
  | "invalid_token"
  | "token_expired"
  | "internal_error";

export type ChatConnectionState =
  | { status: "idle" }
  | { status: "connecting" }
  | { status: "authenticating"; requestId: string }
  | { status: "authenticated"; userId: number; connectionId: string; accessTokenExpiresAt: string }
  | { status: "refreshing"; errorCode: "token_expired" }
  | { status: "auth_failed"; errorCode: ChatAuthErrorCode; message: string }
  | { status: "closed" }
  | { status: "error"; message: string };

export interface ChatAuthFrame {
  type: "auth";
  request_id: string;
  payload: {
    access_token: string;
  };
}

export interface ChatHeartbeatFrame {
  type: "heartbeat";
  request_id: string;
  payload: {
    sent_at: string;
  };
}

export interface ChatAuthOkFrame {
  type: "auth_ok";
  request_id: string;
  payload: {
    user_id: number;
    connection_id: string;
    access_token_expires_at: string;
  };
}

export interface ChatAuthFailedFrame {
  type: "auth_failed";
  request_id?: string;
  payload: {
    error_code: ChatAuthErrorCode;
    message: string;
  };
}

export interface ChatHeartbeatOkFrame {
  type: "heartbeat_ok";
  request_id: string;
  payload: {
    sent_at: string;
  };
}

export type ChatServerFrame = ChatAuthOkFrame | ChatAuthFailedFrame | ChatHeartbeatOkFrame;

export interface ChatConnectionOptions {
  session: AuthSession;
  onStateChange: (state: ChatConnectionState) => void;
  webSocketFactory?: WebSocketFactory;
  requestIdFactory?: () => string;
}

export type WebSocketFactory = (url: string) => ChatWebSocket;

export interface ChatWebSocket {
  readonly readyState: number;
  onopen: ((event: Event) => void) | null;
  onmessage: ((event: MessageEvent) => void) | null;
  onerror: ((event: Event) => void) | null;
  onclose: ((event: CloseEvent) => void) | null;
  send(data: string): void;
  close(): void;
}
