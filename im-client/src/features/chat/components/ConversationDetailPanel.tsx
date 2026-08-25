import type { RefObject } from "react";

interface ConversationDetailPanelProps {
  panelRef: RefObject<HTMLDivElement | null>;
  hidden: boolean;
  onToolPreview: (name: string) => void;
}

export function ConversationDetailPanel({ panelRef, hidden, onToolPreview }: ConversationDetailPanelProps) {
  return (
    <div
      ref={panelRef}
      id="conversation-detail-panel"
      className="auth-detail-panel"
      role="dialog"
      aria-modal="false"
      aria-label="会话详情"
      hidden={hidden}
    >
      <strong>会话详情</strong>
      {["搜索聊天记录", "置顶聊天", "消息免打扰"].map((name) => (
        <button key={name} type="button" onClick={() => onToolPreview(name)}>
          {name}
        </button>
      ))}
    </div>
  );
}
