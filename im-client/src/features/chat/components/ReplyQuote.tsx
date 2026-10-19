import type { ChatConversation, ChatReplyTarget, ChatSelfProfile } from "../types";
import { replySummary } from "../messageReply";
import "./messageReplies.css";

export function replyAuthor(target: ChatReplyTarget, conversation: ChatConversation, self: ChatSelfProfile): string {
  return (target.senderUserId === self.userId ? self : conversation.participants[target.senderUserId])?.name
    ?? `用户 ${target.senderUserId}`;
}

export function ReplyQuote({ target, authorName, onLocate }: { target: ChatReplyTarget; authorName: string; onLocate: () => void }) {
  return <button type="button" className="auth-reply-quote" aria-label="定位被回复消息" onClick={onLocate}>
    <span>回复 {authorName}：{replySummary(target.content)}</span>
  </button>;
}
