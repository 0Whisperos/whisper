import { useCallback, useEffect, useRef, useState } from "react";

import { connectChatWebSocket, type ChatConnectionController } from "../api";
import type { ChatBusinessServerFrame, ChatConnectionState, ChatSendTextMessageInput, WebSocketFactory } from "../types";
import type { AuthSession } from "../../login/types";

const TOKEN_REFRESH_LEAD_TIME_MS = 60_000;

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
  const renewalTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  function clearRenewalTimer() {
    if (renewalTimerRef.current !== null) {
      clearTimeout(renewalTimerRef.current);
      renewalTimerRef.current = null;
    }
  }

  sessionRef.current = session;
  refreshSessionRef.current = refreshSession;
  onServerFrameRef.current = onServerFrame;

  useEffect(() => {
    let cancelled = false;
    let refreshPromise: Promise<void> | null = null;

    function scheduleRenewal(accessTokenExpiresAt: string) {
      clearRenewalTimer();
      const expiresAt = Date.parse(accessTokenExpiresAt);
      const delay = Number.isNaN(expiresAt)
        ? 0
        : Math.max(0, expiresAt - Date.now() - TOKEN_REFRESH_LEAD_TIME_MS);
      renewalTimerRef.current = setTimeout(() => {
        renewalTimerRef.current = null;
        void refreshAndReconnect("scheduled");
      }, delay);
    }

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
          if (nextState.status === "authenticated") {
            scheduleRenewal(nextState.accessTokenExpiresAt);
          }
          if (nextState.status === "auth_failed" && nextState.errorCode === "token_expired") {
            void refreshAndReconnect("token_expired");
          }
        },
        onServerFrame: (frame) => onServerFrameRef.current?.(frame),
      });
    }

    function refreshAndReconnect(reason: "scheduled" | "token_expired"): Promise<void> {
      if (refreshPromise) {
        return refreshPromise;
      }
      reconnectAttemptRef.current += 1;
      const attempt = reconnectAttemptRef.current;
      clearRenewalTimer();
      controllerRef.current?.close();
      setState({ status: "refreshing", reason });
      refreshPromise = (async () => {
        const refreshed = await refreshSessionRef.current();
        if (cancelled || attempt !== reconnectAttemptRef.current) {
          return;
        }
        if (!refreshed) {
          setState({ status: "auth_failed", errorCode: "token_expired", message: "access token expired" });
        }
      })();
      return refreshPromise;
    }

    connect(sessionRef.current);

    return () => {
      cancelled = true;
      clearRenewalTimer();
      reconnectAttemptRef.current += 1;
      controllerRef.current?.close();
      controllerRef.current = null;
    };
  }, [session, webSocketFactory, requestIdFactory]);

  const sendDeliveredAck = useCallback((conversationId: number, deliveredSeq: number) => {
    if (!controllerRef.current) {
      throw new Error("chat connection is not available");
    }
    controllerRef.current.sendDeliveredAck(conversationId, deliveredSeq);
  }, []);
  const sendReadAck = useCallback((conversationId: number, readSeq: number) => {
    if (!controllerRef.current) {
      throw new Error("chat connection is not available");
    }
    controllerRef.current.sendReadAck(conversationId, readSeq);
  }, []);

  return {
    state,
    close: () => {
      clearRenewalTimer();
      controllerRef.current?.close();
    },
    sendTextMessage: (input: ChatSendTextMessageInput) => {
      if (!controllerRef.current) {
        throw new Error("chat connection is not available");
      }
      controllerRef.current.sendTextMessage(input);
    },
    sendDeliveredAck,
    sendReadAck,
  };
}
