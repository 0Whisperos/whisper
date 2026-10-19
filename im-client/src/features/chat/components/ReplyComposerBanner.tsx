import type { ChatReplyTarget } from "../types";
import { replySummary } from "../messageReply";
import "./messageReplies.css";

export function ReplyComposerBanner({ target, authorName, onCancel }: {
  target: ChatReplyTarget; authorName: string; onCancel: () => void;
}) {
  return <div className="auth-reply-composer" role="group" aria-label="回复消息">
    <span className="auth-reply-composer-text" title={replySummary(target.content)}>
      <strong>回复 {authorName}</strong><span>{replySummary(target.content)}</span>
    </span>
    <button type="button" aria-label="取消回复" title="取消回复" onClick={onCancel}>×</button>
  </div>;
}
