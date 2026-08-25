import { useEffect, useRef } from "react";

import type { ChatConversation, ChatSelfProfile } from "../types";
import { Avatar, Icon, IconButton } from "./ui";
import { Composer } from "./Composer";

interface ChatPanelProps {
  conversation: ChatConversation;
  self: ChatSelfProfile;
  connectionLabel: string;
  draft: string;
  canSend: boolean;
  statusMessage: string;
  isDetailOpen: boolean;
  onReturnToSessions: () => void;
  onOpenDetail: (trigger: HTMLButtonElement) => void;
  onToolPreview: (name: string) => void;
  onChangeDraft: (value: string) => void;
}

export function ChatPanel({
  conversation,
  self,
  connectionLabel,
  draft,
  canSend,
  statusMessage,
  isDetailOpen,
  onReturnToSessions,
  onOpenDetail,
  onToolPreview,
  onChangeDraft,
}: ChatPanelProps) {
  const messageListRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    const list = messageListRef.current;
    if (list) {
      list.scrollTop = list.scrollHeight;
    }
  }, [conversation.conversationId]);

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
      <section ref={messageListRef} className="auth-message-list" aria-label="消息列表" aria-live="polite">
        {conversation.messages.map((message, index) => {
          const profile = message.senderUserId === self.userId ? self : conversation.participants[message.senderUserId];
          const isSelf = message.senderUserId === self.userId;
          const previous = conversation.messages[index - 1];
          const compact = Boolean(previous && previous.senderUserId === message.senderUserId && !message.showTime);
          return (
            <div key={message.messageId} className="auth-message-group">
              {message.showTime ? <time className="auth-message-time">{message.displayTime}</time> : null}
              <article className={`auth-message-row ${isSelf ? "self" : ""} ${compact ? "compact" : ""}`}>
                <Avatar avatar={profile?.avatar ?? "?"} tone={profile?.tone ?? "gray"} className="auth-message-avatar" />
                <div className={`auth-message-body ${message.receipt ? "has-receipt" : ""}`}>
                  {!isSelf && conversation.type === "group" && !compact ? <small className="auth-message-sender">{profile?.name}</small> : null}
                  <p className="auth-message-bubble">{message.content.text}</p>
                  {message.receipt ? (
                    <footer className="auth-message-footer">
                      <span className={`auth-message-receipt ${message.receipt === "已读" ? "is-read" : "is-pending"}`} aria-label={message.receipt}>
                        {message.receipt === "已读" ? <Icon name="check" /> : null}
                      </span>
                    </footer>
                  ) : null}
                </div>
              </article>
            </div>
          );
        })}
      </section>
      <Composer
        draft={draft}
        canSend={canSend}
        statusMessage={statusMessage}
        onChangeDraft={onChangeDraft}
        onToolPreview={onToolPreview}
      />
    </section>
  );
}
