import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";

import type { ChatApiError } from "../api";
import type { ChatConversation, ChatSelfProfile } from "../types";
import { formatHoverMessageTime, isCompactMessage } from "../hooks/messageTimeline";
import { Avatar, Icon, IconButton } from "./ui";
import { Composer } from "./Composer";
import type { ChatDraftBlock, DraftImageBlock } from "../hooks/useChatDrafts";
import { AttachmentResourceCache, attachmentResourceKey } from "../attachmentResourceCache";
import type { AttachmentResource } from "../attachmentResourceCache";

const MESSAGE_LIST_BOTTOM_THRESHOLD = 32;
const EMPTY_DRAFT_BLOCKS: ChatDraftBlock[] = [{ type: "text", id: "text-0", text: "" }];

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
  onChangeDraft?: (value: string) => void;
  onSendText: (text: string) => void;
  onRetryMessage: (clientMessageId: string) => void;
  onReadThrough?: (conversationId: number, readSeq: number) => void;
  draftBlocks?: ChatDraftBlock[];
  onChangeDraftBlocks?: (blocks: ChatDraftBlock[]) => void;
  onPickFiles?: (files: File[]) => DraftImageBlock[];
  onSendRich?: () => void;
  apiBaseUrl?: string;
  accessToken?: string;
  userId?: number;
  attachmentResourceCache?: AttachmentResourceCache;
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
  onSendText,
  onRetryMessage,
  onReadThrough,
  draftBlocks = EMPTY_DRAFT_BLOCKS, onChangeDraftBlocks = () => undefined, onPickFiles = () => [],
  onSendRich = () => undefined, apiBaseUrl = "", accessToken = "", userId = self.userId, attachmentResourceCache,
}: ChatPanelProps) {
  const messageListRef = useRef<HTMLElement | null>(null);
  const [hoveredMessageKey, setHoveredMessageKey] = useState<string | null>(null);
  const [isAtBottom, setIsAtBottom] = useState(true);
  const isAtBottomRef = useRef(true);
  const shouldStickToBottomRef = useRef(true);
  const previousConversationRef = useRef<number | null>(null);
  const previousLatestMessageKeyRef = useRef<string | null>(null);
  const previousHistoryLoadingRef = useRef(isHistoryLoading);
  const unreadCount = unreadIncomingCount(conversation, self.userId);
  const attachmentIds = useMemo(() => Array.from(new Set(conversation.messages.flatMap((message) =>
    message.messageId !== null && message.localStatus === "accepted" && "blocks" in message.content
      ? message.content.blocks.filter((block) => block.type === "image").map((block) => block.attachment_id)
      : []
  ))).sort(), [conversation.messages]);
  const fallbackAttachmentCacheRef = useRef<AttachmentResourceCache | null>(null);
  if (!fallbackAttachmentCacheRef.current) fallbackAttachmentCacheRef.current = new AttachmentResourceCache();
  const resolvedAttachmentCache = attachmentResourceCache ?? fallbackAttachmentCacheRef.current;
  const [imageResources, setImageResources] = useState<Record<string, AttachmentResource>>({});
  const [imageFailures, setImageFailures] = useState<Record<string, boolean>>({});
  const imageContext = { apiBaseUrl, accessToken, userId, conversationId: conversation.conversationId };
  const imageContextKey = JSON.stringify([apiBaseUrl.replace(/\/+$/, ""), accessToken, userId, conversation.conversationId]);
  const currentImageContextRef = useRef(imageContextKey);
  currentImageContextRef.current = imageContextKey;
  useEffect(() => {
    let cancelled = false;
    const imageKeys = attachmentIds.map((id) => attachmentResourceKey(imageContext, id));
    setImageResources((current) => Object.fromEntries(Object.entries(current).filter(([key]) => imageKeys.includes(key))));
    setImageFailures((current) => Object.fromEntries(Object.entries(current).filter(([key]) => imageKeys.includes(key))));
    if (attachmentIds.length === 0 || !apiBaseUrl || !accessToken) return () => { cancelled = true; };
    void resolvedAttachmentCache.loadMany(imageContext, attachmentIds)
      .then((results) => {
        if (cancelled || currentImageContextRef.current !== imageContextKey) return;
        setImageResources((current) => {
          const next = { ...current };
          for (const result of results) if (result.resource) next[attachmentResourceKey(imageContext, result.attachmentId)] = result.resource;
          return next;
        });
        setImageFailures((current) => {
          const next = { ...current };
          for (const result of results) {
            const key = attachmentResourceKey(imageContext, result.attachmentId);
            if (result.error) next[key] = true;
            else if (result.resource) delete next[key];
          }
          return next;
        });
      });
    return () => {
      cancelled = true;
    };
  }, [accessToken, apiBaseUrl, attachmentIds, conversation.conversationId, resolvedAttachmentCache, userId]);
  const retryImage = (attachmentId: string) => {
    const contextKey = imageContextKey;
    const resourceKey = attachmentResourceKey(imageContext, attachmentId);
    setImageFailures((current) => ({ ...current, [resourceKey]: false }));
    void resolvedAttachmentCache.retry(imageContext, attachmentId)
      .then((resource) => {
        if (currentImageContextRef.current === contextKey) setImageResources((current) => ({ ...current, [resourceKey]: resource }));
      })
      .catch(() => {
        if (currentImageContextRef.current === contextKey) {
          setImageResources((current) => {
            const next = { ...current };
            delete next[resourceKey];
            return next;
          });
          setImageFailures((current) => ({ ...current, [resourceKey]: true }));
        }
      });
  };
  const recoverImage = (attachmentId: string) => {
    const contextKey = imageContextKey;
    const resourceKey = attachmentResourceKey(imageContext, attachmentId);
    void resolvedAttachmentCache.recoverOnce(imageContext, attachmentId)
      .then((resource) => {
        if (currentImageContextRef.current === contextKey) setImageResources((current) => ({ ...current, [resourceKey]: resource }));
      })
      .catch(() => {
        if (currentImageContextRef.current === contextKey) {
          setImageResources((current) => {
            const next = { ...current };
            delete next[resourceKey];
            return next;
          });
          setImageFailures((current) => ({ ...current, [resourceKey]: true }));
        }
      });
  };
  const updateBottomState = useCallback((list: HTMLElement) => {
    const atBottom = list.scrollHeight - list.clientHeight - list.scrollTop <= MESSAGE_LIST_BOTTOM_THRESHOLD;
    isAtBottomRef.current = atBottom;
    shouldStickToBottomRef.current = atBottom;
    setIsAtBottom(atBottom);
  }, []);
  const keepBottomAfterLayoutChange = useCallback(() => {
    const list = messageListRef.current;
    if (!list || !shouldStickToBottomRef.current) {
      return;
    }
    list.scrollTop = list.scrollHeight;
    updateBottomState(list);
  }, [updateBottomState]);

  useEffect(() => {
    const list = messageListRef.current;
    if (!list || typeof ResizeObserver === "undefined") {
      return;
    }
    const observer = new ResizeObserver(() => keepBottomAfterLayoutChange());
    list.querySelectorAll<HTMLElement>(".auth-message-group").forEach((group) => observer.observe(group));
    return () => observer.disconnect();
  }, [conversation.conversationId, conversation.messages, keepBottomAfterLayoutChange]);
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
    const hasJustFinishedLoadingHistory = previousHistoryLoadingRef.current && !isHistoryLoading;

    previousConversationRef.current = conversation.conversationId;
    previousLatestMessageKeyRef.current = latestMessageKey;
    previousHistoryLoadingRef.current = isHistoryLoading;

    if (!list) {
      return;
    }
    if (isConversationChange) {
      shouldStickToBottomRef.current = true;
      list.scrollTop = list.scrollHeight;
      updateBottomState(list);
    } else if (hasJustFinishedLoadingHistory && shouldStickToBottomRef.current) {
      list.scrollTop = list.scrollHeight;
      updateBottomState(list);
    } else if (isNewLatestMessage && latestMessage?.senderUserId === self.userId) {
      list.scrollTop = list.scrollHeight;
      updateBottomState(list);
    } else if (isNewLatestMessage && isAtBottomRef.current) {
      list.scrollTop = list.scrollHeight;
      updateBottomState(list);
    }
  }, [conversation.conversationId, conversation.messages, isHistoryLoading, self.userId, updateBottomState]);

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
                <Avatar avatar={profile?.avatar ?? "?"} tone={profile?.tone ?? "gray"} imageUrl={isSelf ? self.avatarImageUrl : undefined} className="auth-message-avatar" />
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
                      {"text" in message.content ? <p className="auth-message-bubble">{message.content.text}</p> : (
                        <div className="auth-message-bubble auth-rich-message-bubble" role="group" aria-label="富文本消息">
                          <div className="auth-rich-message-blocks">
                            {message.content.blocks.map((block, blockIndex) => {
                              if (block.type === "text") {
                                return <p className="auth-rich-message-text" key={`text-${blockIndex}`}>{block.text}</p>;
                              }
                              const localPreview = message.localStatus === "accepted" ? undefined : block.previewUrl;
                              const imageKey = attachmentResourceKey(imageContext, block.attachment_id);
                              const image = imageResources[imageKey];
                              const imageFailed = imageFailures[imageKey];
                              const imageUrl = localPreview ?? image?.src;
                              return imageUrl
                                ? <img key={block.attachment_id} className="auth-message-image" alt="聊天图片" src={imageUrl}
                                  onLoad={keepBottomAfterLayoutChange}
                                  onError={() => {
                                    if (!localPreview && !imageFailed) recoverImage(block.attachment_id);
                                    keepBottomAfterLayoutChange();
                                  }} />
                                : imageFailed
                                  ? <span key={block.attachment_id} className="auth-message-image-error" role="group" aria-label="图片加载失败">
                                    <span>图片加载失败</span><button type="button" onClick={() => retryImage(block.attachment_id)}>重试图片</button>
                                  </span>
                                  : <span key={block.attachment_id} className="auth-message-image-placeholder" role="img" aria-label="图片加载中" />;
                            })}
                          </div>
                        </div>
                      )}
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
        key={conversation.conversationId}
        draft={draft}
        canSend={canSend}
        statusMessage={statusMessage}
        onToolPreview={onToolPreview}
        blocks={draftBlocks}
        onChangeBlocks={onChangeDraftBlocks}
        onPickFiles={onPickFiles}
        onSendText={(text) => draftBlocks.some((block) => block.type === "image") ? onSendRich() : onSendText(text)}
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
