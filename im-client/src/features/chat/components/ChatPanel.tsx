import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";

import type { ChatApiError } from "../api";
import type { ChatConversation, ChatSelfProfile } from "../types";
import { formatHoverMessageTime, isCompactMessage } from "../hooks/messageTimeline";
import { Avatar, Icon, IconButton } from "./ui";
import { Composer } from "./Composer";

const MESSAGE_LIST_BOTTOM_THRESHOLD = 32;

interface ChatPanelProps {
  conversation: ChatConversation;
  self: ChatSelfProfile;
  connectionLabel: string;
  draft: string;
  canSend: boolean;
  statusMessage: string;
  isHistoryLoading: boolean;
  historyError: ChatApiError | null;
  hasMoreHistory: boolean;
  onLoadOlderHistory: () => void;
  onRetryHistory: () => void;
  isDetailOpen: boolean;
  onReturnToSessions: () => void;
  onOpenDetail: (trigger: HTMLButtonElement) => void;
  onToolPreview: (name: string) => void;
  onChangeDraft: (value: string) => void;
  onSendText: (text: string) => void;
  onRetryMessage: (clientMessageId: string) => void;
  onReadThrough?: (conversationId: number, readSeq: number) => void;
}

export function ChatPanel({
  conversation,
  self,
  connectionLabel,
  draft,
  canSend,
  statusMessage,
  isHistoryLoading,
  historyError,
  hasMoreHistory,
  onLoadOlderHistory,
  onRetryHistory,
  isDetailOpen,
  onReturnToSessions,
  onOpenDetail,
  onToolPreview,
  onChangeDraft,
  onSendText,
  onRetryMessage,
  onReadThrough,
}: ChatPanelProps) {
  const messageListRef = useRef<HTMLElement | null>(null);
  const [hoveredMessageKey, setHoveredMessageKey] = useState<string | null>(null);
  const [isAtBottom, setIsAtBottom] = useState(true);
  const isAtBottomRef = useRef(true);
  const previousConversationRef = useRef<number | null>(null);
  const previousLatestMessageKeyRef = useRef<string | null>(null);
  const unreadCount = unreadIncomingCount(conversation, self.userId);
  const updateBottomState = useCallback((list: HTMLElement) => {
    const atBottom = list.scrollHeight - list.clientHeight - list.scrollTop <= MESSAGE_LIST_BOTTOM_THRESHOLD;
    isAtBottomRef.current = atBottom;
    setIsAtBottom(atBottom);
  }, []);
  const pendingScrollAnchorRef = useRef<{
    conversationId: number;
    messageKey: string | null;
    offset: number;
    scrollTop: number;
    scrollHeight: number;
    messages: ChatConversation["messages"];
  } | null>(null);

  useLayoutEffect(() => {
    const anchor = pendingScrollAnchorRef.current;
    if (!anchor) {
      return;
    }
    const list = messageListRef.current;
    if (anchor.conversationId !== conversation.conversationId) {
      pendingScrollAnchorRef.current = null;
      return;
    }
    if (conversation.messages !== anchor.messages && list) {
      const listTop = list.getBoundingClientRect().top;
      const anchoredMessage = anchor.messageKey
        ? Array.from(list.querySelectorAll<HTMLElement>("[data-message-key]")).find((message) => (
          message.dataset.messageKey === anchor.messageKey
        )) ?? null
        : null;
      if (anchoredMessage) {
        list.scrollTop += anchoredMessage.getBoundingClientRect().top - listTop - anchor.offset;
      } else {
        list.scrollTop = anchor.scrollTop + list.scrollHeight - anchor.scrollHeight;
      }
      updateBottomState(list);
      pendingScrollAnchorRef.current = null;
    } else if (!isHistoryLoading) {
      pendingScrollAnchorRef.current = null;
    }
  }, [conversation.conversationId, conversation.messages, isHistoryLoading, updateBottomState]);

  useLayoutEffect(() => {
    const list = messageListRef.current;
    const latestMessage = conversation.messages[conversation.messages.length - 1];
    const latestMessageKey = latestMessage?.localKey ?? null;
    const isConversationChange = previousConversationRef.current !== conversation.conversationId;
    const isNewLatestMessage = previousLatestMessageKeyRef.current !== latestMessageKey;

    previousConversationRef.current = conversation.conversationId;
    previousLatestMessageKeyRef.current = latestMessageKey;

    if (!list) {
      return;
    }
    if (isConversationChange || (isNewLatestMessage && latestMessage?.senderUserId === self.userId)) {
      list.scrollTop = list.scrollHeight;
      updateBottomState(list);
    } else if (isNewLatestMessage && isAtBottomRef.current) {
      list.scrollTop = list.scrollHeight;
      updateBottomState(list);
    }
  }, [conversation.conversationId, conversation.messages, self.userId, updateBottomState]);

  useEffect(() => {
    const list = messageListRef.current;
    if (!list || typeof IntersectionObserver === "undefined" || !onReadThrough) {
      return;
    }
    const observer = new IntersectionObserver((entries) => {
      const visibleSeqs = entries
        .filter((entry) => entry.isIntersecting)
        .map((entry) => Number((entry.target as HTMLElement).dataset.conversationSeq))
        .filter(Number.isFinite);
      if (visibleSeqs.length > 0) {
        onReadThrough(conversation.conversationId, Math.max(...visibleSeqs));
      }
    }, { root: list, threshold: 0.5 });
    list.querySelectorAll<HTMLElement>("[data-conversation-seq]").forEach((message) => observer.observe(message));
    return () => observer.disconnect();
  }, [conversation.conversationId, conversation.messages, onReadThrough]);

  const handleMessageListScroll = () => {
    const list = messageListRef.current;
    if (!list) {
      return;
    }
    updateBottomState(list);
    if (list.scrollTop > MESSAGE_LIST_BOTTOM_THRESHOLD || !hasMoreHistory || isHistoryLoading || historyError) {
      return;
    }
    if (!pendingScrollAnchorRef.current) {
      const listTop = list.getBoundingClientRect().top;
      const visibleMessage = Array.from(list.querySelectorAll<HTMLElement>("[data-message-key]")).find((message) => (
        message.getBoundingClientRect().bottom > listTop
      ));
      pendingScrollAnchorRef.current = {
        conversationId: conversation.conversationId,
        messageKey: visibleMessage?.dataset.messageKey ?? null,
        offset: visibleMessage ? visibleMessage.getBoundingClientRect().top - listTop : 0,
        scrollTop: list.scrollTop,
        scrollHeight: list.scrollHeight,
        messages: conversation.messages,
      };
    }
    onLoadOlderHistory();
  };

  return (
    <section className="auth-chat-panel" aria-label="聊天详情">
      <header className="auth-chat-head">
        <IconButton icon="back" label="返回会话" className="auth-back-button" onClick={onReturnToSessions} />
        <div className="auth-chat-identity">
          <Avatar avatar={conversation.avatar} tone={conversation.tone} className="auth-chat-avatar" />
          <div>
            <h1>{conversation.name}</h1>
            <p>{conversation.status} · {connectionLabel}</p>
          </div>
        </div>
        <div className="auth-chat-tools" aria-label="会话工具">
          <IconButton icon="search" label="搜索聊天记录" onClick={() => onToolPreview("搜索聊天记录")} />
          <IconButton icon="voice" label="发起语音通话" onClick={() => onToolPreview("语音通话")} />
          <IconButton icon="video" label="发起视频通话" onClick={() => onToolPreview("视频通话")} />
          <IconButton
            icon="info"
            label="会话详情"
            id="conversation-detail-trigger"
            aria-controls="conversation-detail-panel"
            aria-expanded={isDetailOpen}
            onClick={(event) => onOpenDetail(event.currentTarget)}
          />
        </div>
      </header>
      <section ref={messageListRef} className="auth-message-list" aria-label="消息列表" aria-live="polite" onScroll={handleMessageListScroll}>
        {conversation.messages.length === 0 && !isHistoryLoading && !historyError ? (
          <p className="auth-empty-state">暂无聊天记录</p>
        ) : null}
        {conversation.messages.map((message, index) => {
          const profile = message.senderUserId === self.userId ? self : conversation.participants[message.senderUserId];
          const isSelf = message.senderUserId === self.userId;
          const previous = conversation.messages[index - 1];
          const compact = isCompactMessage(previous, message);
          const hoverTime = formatHoverMessageTime(message.createdAt ?? message.clientSentAt, !compact);
          return (
            <div key={message.localKey} className="auth-message-group">
              {message.showTime ? <time className="auth-message-time">{message.displayTime}</time> : null}
              <article
                data-message-key={message.localKey}
                data-conversation-seq={message.conversationSeq ?? undefined}
                className={`auth-message-row ${isSelf ? "self" : ""} ${compact ? "compact" : ""}`}
              >
                <Avatar avatar={profile?.avatar ?? "?"} tone={profile?.tone ?? "gray"} className="auth-message-avatar" />
                <div className={`auth-message-body ${message.receipt ? "has-receipt" : ""}`}>
                  {!isSelf && conversation.type === "group" && !compact ? <small className="auth-message-sender">{profile?.name}</small> : null}
                  <div
                    className={`auth-message-bubble-line ${isSelf ? "self" : ""}`}
                    onMouseEnter={() => setHoveredMessageKey(message.localKey)}
                    onMouseLeave={() => setHoveredMessageKey(null)}
                  >
                    {hoveredMessageKey === message.localKey && compact && hoverTime ? (
                      <time className={`auth-message-side-time ${isSelf ? "right" : "left"}`} dateTime={message.createdAt ?? message.clientSentAt}>
                        {hoverTime}
                      </time>
                    ) : null}
                    <div className="auth-message-bubble-wrap">
                      {hoveredMessageKey === message.localKey && !compact && hoverTime ? (
                        <time className="auth-message-hover-time" dateTime={message.createdAt ?? message.clientSentAt}>
                          {hoverTime}
                        </time>
                      ) : null}
                      <p className="auth-message-bubble">{message.content.text}</p>
                    </div>
                  </div>
                  {message.receipt ? (
                    <footer className="auth-message-footer">
                      <span className={`auth-message-receipt ${message.receipt === "已读" ? "is-read" : "is-pending"}`} aria-label={message.receipt}>
                        {message.receipt === "已读" ? <Icon name="check" /> : null}
                      </span>
                    </footer>
                  ) : null}
                  {isSelf && message.localStatus === "sending" ? (
                    <footer className="auth-message-footer">
                      <span className="auth-message-status" aria-label="发送中">发送中</span>
                    </footer>
                  ) : null}
                  {isSelf && message.localStatus === "failed" ? (
                    <footer className="auth-message-footer">
                      <span className="auth-message-status" aria-label="发送失败">发送失败</span>
                      <button type="button" className="auth-message-retry" onClick={() => onRetryMessage(message.clientMessageId)}>重试</button>
                    </footer>
                  ) : null}
                </div>
              </article>
            </div>
          );
        })}
      </section>
      {!isAtBottom && unreadCount > 0 ? (
        <button
          type="button"
          className="auth-new-messages-button"
          aria-label={`跳转到最新消息，${unreadCount} 条未读`}
          onClick={() => {
            const list = messageListRef.current;
            if (list) {
              list.scrollTop = list.scrollHeight;
              updateBottomState(list);
            }
          }}
        >
          <svg className="auth-new-messages-arrow" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
            <path d="m5 2 7 7 7-7" />
            <path d="m5 12 7 7 7-7" />
          </svg>
          <span className="auth-new-messages-count">{unreadCount}</span>
        </button>
      ) : null}
      {isHistoryLoading ? <output className="auth-panel-status" aria-live="polite">正在加载消息...</output> : null}
      {historyError ? (
        <div className="auth-panel-error" role="alert">
          <span>消息加载失败：{historyError.code}</span>
          <button type="button" onClick={onRetryHistory}>重试</button>
        </div>
      ) : null}
      <Composer
        draft={draft}
        canSend={canSend}
        statusMessage={statusMessage}
        onChangeDraft={onChangeDraft}
        onToolPreview={onToolPreview}
        onSendText={onSendText}
      />
    </section>
  );
}

function unreadIncomingCount(conversation: ChatConversation, selfUserId: number): number {
  const readSeq = conversation.readSeq ?? 0;
  return conversation.messages.filter((message) => (
    message.senderUserId !== selfUserId
    && message.conversationSeq !== null
    && message.conversationSeq > readSeq
  )).length;
}
