import type { MouseEvent } from "react";
import type { AttachmentLoadContext, AttachmentResource } from "../attachmentResourceCache";
import { attachmentResourceKey } from "../attachmentResourceCache";
import type { ChatConversation, ChatMessage, ChatSelfProfile } from "../types";
import { richMessageDisplayBlocksWithIndexes } from "./richMessageLayout";
import { ChatMessageImage } from "./ChatMessageImage";
import { ReplyQuote, replyAuthor } from "./ReplyQuote";

interface ChatMessageBubbleProps {
  message: ChatMessage;
  conversation: ChatConversation;
  self: ChatSelfProfile;
  imageContext: AttachmentLoadContext;
  imageResources: Record<string, AttachmentResource>;
  imageFailures: Record<string, boolean>;
  onMessageMenu: (event: MouseEvent<HTMLElement>, message: ChatMessage) => void;
  onImageMenu: (event: MouseEvent<HTMLElement>, message: ChatMessage, attachmentId: string) => void;
  onCloseMenu: () => void;
  onOpenImage: (message: ChatMessage, blockIndex: number) => void;
  onImageLayout: () => void;
  onRecoverImage: (attachmentId: string) => void;
  onRetryImage: (attachmentId: string) => void;
  onLocateReply: (messageId: string) => void;
}

export function ChatMessageBubble({ message, conversation, self, imageContext, imageResources, imageFailures,
  onMessageMenu, onImageMenu, onCloseMenu, onOpenImage, onImageLayout, onRecoverImage, onRetryImage, onLocateReply }: ChatMessageBubbleProps) {
  const quote = message.replyTo ? <ReplyQuote target={message.replyTo}
    authorName={replyAuthor(message.replyTo, conversation, self)} onLocate={() => onLocateReply(message.replyTo!.messageId)} />
    : message.replyToMessageId ? <button type="button" className="auth-reply-quote" aria-label="定位被回复消息"
      onClick={() => onLocateReply(message.replyToMessageId!)}>原消息暂不可用</button> : null;
  if ("text" in message.content && !quote) return <p className="auth-message-bubble"
    onContextMenu={(event) => onMessageMenu(event, message)}>{message.content.text}</p>;
  return <div className={`auth-message-bubble${"blocks" in message.content ? " auth-rich-message-bubble" : ""}`}
    role="group" aria-label={"blocks" in message.content ? "富文本消息" : "回复消息气泡"}
    onContextMenu={(event) => onMessageMenu(event, message)}>
    {quote}
    {"text" in message.content ? <span>{message.content.text}</span> : <div className="auth-rich-message-blocks">
      {richMessageDisplayBlocksWithIndexes(message.content.blocks).map(({ block, blockIndex }) => {
        if (block.type === "text") return <p className="auth-rich-message-text" key={`text-${blockIndex}`}>{block.text}</p>;
        const localPreview = message.localStatus === "accepted" ? undefined : block.previewUrl;
        const key = attachmentResourceKey(imageContext, block.attachment_id);
        const imageUrl = localPreview ?? imageResources[key]?.src;
        return <ChatMessageImage key={`${message.localKey}:${blockIndex}`} src={imageUrl} failed={imageFailures[key]}
          interactive={message.localStatus === "accepted" && message.messageId !== null}
          onLayout={onImageLayout}
          onError={() => { if (!localPreview && !imageFailures[key]) onRecoverImage(block.attachment_id); }}
          onRetry={() => onRetryImage(block.attachment_id)} onCloseMenu={onCloseMenu}
          onOpen={() => onOpenImage(message, blockIndex)}
          onMenu={(event) => onImageMenu(event, message, block.attachment_id)}
          onPendingMenu={(event) => onImageMenu(event, message, block.attachment_id)} />;
      })}
    </div>}
  </div>;
}
