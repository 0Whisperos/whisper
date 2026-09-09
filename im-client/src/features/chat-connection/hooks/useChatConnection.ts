import { useEffect, useRef, useState } from "react";

import { connectChatWebSocket, type ChatConnectionController } from "../api";
import type { ChatBusinessServerFrame, ChatConnectionState, ChatSendTextMessageInput, WebSocketFactory } from "../types";
import type { AuthSession } from "../../login/types";

interface UseChatConnectionOptions {
  session: AuthSession;
  refreshSession: () => Promise<AuthSession | null>;
  onServerFrame?: (frame: ChatBusinessServerFrame) => void;
  webSocketFactory?: WebSocketFactory;
  requestIdFactory?: () => string;
}

export function useChatConnection({
  session,
  refreshSession,
  onServerFrame,
  webSocketFactory,
  requestIdFactory,
}: UseChatConnectionOptions) {
  const [state, setState] = useState<ChatConnectionState>({ status: "idle" });
  const controllerRef = useRef<ChatConnectionController | null>(null);
  const sessionRef = useRef(session);
  const refreshSessionRef = useRef(refreshSession);
  const onServerFrameRef = useRef(onServerFrame);
  const reconnectAttemptRef = useRef(0);

  sessionRef.current = session;
  refreshSessionRef.current = refreshSession;
  onServerFrameRef.current = onServerFrame;

  useEffect(() => {
    let cancelled = false;

    function connect(nextSession: AuthSession) {
      controllerRef.current?.close();
      controllerRef.current = connectChatWebSocket({
        session: nextSession,
        webSocketFactory,
        requestIdFactory,
        onStateChange: (nextState) => {
          if (cancelled) {
            return;
          }
          setState(nextState);
          if (nextState.status === "auth_failed" && nextState.errorCode === "token_expired") {
            void refreshAndReconnect();
          }
        },
        onServerFrame: (frame) => onServerFrameRef.current?.(frame),
      });
    }

    async function refreshAndReconnect() {
      reconnectAttemptRef.current += 1;
      const attempt = reconnectAttemptRef.current;
      setState({ status: "refreshing", errorCode: "token_expired" });
      controllerRef.current?.close();
      const refreshed = await refreshSessionRef.current();
      if (cancelled || attempt !== reconnectAttemptRef.current) {
        return;
      }
      if (!refreshed) {
        setState({ status: "auth_failed", errorCode: "token_expired", message: "access token expired" });
      }
    }

    connect(sessionRef.current);

    return () => {
      cancelled = true;
      reconnectAttemptRef.current += 1;
      controllerRef.current?.close();
      controllerRef.current = null;
    };
  }, [session, webSocketFactory, requestIdFactory]);

  return {
    state,
    close: () => controllerRef.current?.close(),
    sendTextMessage: (input: ChatSendTextMessageInput) => {
      if (!controllerRef.current) {
        throw new Error("chat connection is not available");
      }
      controllerRef.current.sendTextMessage(input);
    },
  };
}
