import type { ChatSessionItem } from "../types";
import { Avatar, Icon, IconButton } from "./ui";

interface SessionPanelProps {
  sessions: ChatSessionItem[];
  activeConversationId: number;
  statusMessage: string;
  onSelectConversation: (conversationId: number) => void;
  onToolPreview: (name: string) => void;
}

export function SessionPanel({ sessions, activeConversationId, statusMessage, onSelectConversation, onToolPreview }: SessionPanelProps) {
  return (
    <section className="auth-session-panel" aria-label="会话">
      <header className="auth-session-head">
        <label className="auth-search-field">
          <Icon name="search" />
          <input
            type="search"
            placeholder="搜索"
            aria-label="搜索会话"
            onChange={() => onToolPreview("搜索")}
          />
        </label>
        <IconButton icon="plus" label="新建消息" onClick={() => onToolPreview("新建消息")} />
      </header>
      <output className="auth-panel-status" aria-live="polite">{statusMessage}</output>
      <div className="auth-session-list">
        {sessions.map((session) => (
          <button
            key={session.id}
            type="button"
            className={`auth-session-row ${session.conversationId === activeConversationId ? "is-active" : ""}`}
            aria-current={session.conversationId === activeConversationId ? "true" : undefined}
            onClick={() => onSelectConversation(session.conversationId)}
          >
            <Avatar avatar={session.avatar} tone={session.tone} />
            <span className="auth-session-copy">
              <strong>{session.name}</strong>
              <small>{session.preview}</small>
            </span>
            <span className="auth-session-meta">
              <time>{session.time}</time>
              {session.unread ? <b aria-label={`${session.unread} 条未读`}>{session.unread}</b> : null}
              <span className="auth-session-flags" aria-label="会话状态">
                {session.pinned ? <span title="置顶">置顶</span> : null}
                {session.mentionsMe ? <span title="@我">@我</span> : null}
                {session.draft ? <span title="草稿">草稿</span> : null}
                {session.muted ? <span title="免打扰">免打扰</span> : null}
              </span>
            </span>
          </button>
        ))}
      </div>
    </section>
  );
}
