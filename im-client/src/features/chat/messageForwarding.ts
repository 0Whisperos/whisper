import { fetchSignedImage, requestDownloadAuthorizations } from "./attachmentsApi";
import type { ChatDraftBlock } from "./hooks/useChatDrafts";
import type { ChatMessage, ChatMessageContent } from "./types";

export interface ForwardMessageBody {
  messageType: "text" | "rich";
  content: ChatMessageContent;
}

export interface ForwardMessageDraft {
  messageType: "text" | "rich";
  blocks: ChatDraftBlock[];
}

const MIME_EXTENSIONS: Record<string, string> = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" };
const MAX_IMAGE_BYTES = 20 * 1024 * 1024;
const MAX_MESSAGE_BYTES = 50 * 1024 * 1024;

export function canForwardMessage(message: ChatMessage): boolean {
  return Boolean(message.messageId && message.localStatus === "accepted" && message.content);
}

/** Download independently of the display cache: every attempt needs fresh source authorization. */
export async function prepareForwardMessage(message: ChatMessage, apiBaseUrl: string,
  getAccessToken: () => string, assertActive: () => void = () => undefined): Promise<ForwardMessageDraft> {
  assertActive();
  if (!canForwardMessage(message) || !message.content) throw new Error("原消息已不可用");
  if (message.messageType === "text" && "text" in message.content) {
    return { messageType: "text", blocks: [{ type: "text", id: crypto.randomUUID(), text: message.content.text }] };
  }
  if (!("blocks" in message.content)) throw new Error("原消息格式无效");
  const blocks = message.content.blocks;
  const images = blocks.filter((block) => block.type === "image");
  if (images.length > 10 || images.some((image) => !image.attachment_id)) throw new Error("原消息图片格式无效");
  const ids = [...new Set(images.map((image) => image.attachment_id))];
  const files = new Map<string, File>();
  if (ids.length) {
    const authorizations = await requestDownloadAuthorizations(apiBaseUrl, getAccessToken(), message.conversationId, ids);
    assertActive();
    const byId = new Map(authorizations.map((authorization) => [authorization.attachment_id, authorization]));
    if (authorizations.length !== ids.length || byId.size !== ids.length || ids.some((id) => !byId.has(id))) {
      throw new Error("原消息图片授权不完整，请重试");
    }
    let totalBytes = 0;
    for (const image of images) {
      const authorization = byId.get(image.attachment_id)!;
      if (!MIME_EXTENSIONS[authorization.content_type] || !Number.isSafeInteger(authorization.size_bytes)
        || authorization.size_bytes <= 0 || authorization.size_bytes > MAX_IMAGE_BYTES) {
        throw new Error("原消息图片格式或大小无效");
      }
      totalBytes += authorization.size_bytes;
    }
    if (totalBytes > MAX_MESSAGE_BYTES) throw new Error("消息图片总量不能超过 50 MiB");
    for (const id of ids) {
      assertActive();
      const authorization = byId.get(id)!;
      const blob = await fetchSignedImage(authorization.download_url);
      assertActive();
      if (blob.type !== authorization.content_type || blob.size !== authorization.size_bytes) {
        throw new Error("原消息图片校验失败，请重试");
      }
      files.set(id, new File([blob], `${id}.${MIME_EXTENSIONS[blob.type]}`, { type: blob.type }));
    }
  }
  return { messageType: "rich", blocks: blocks.map((block): ChatDraftBlock => block.type === "text"
    ? { type: "text", id: crypto.randomUUID(), text: block.text }
    : { type: "image", localId: crypto.randomUUID(), file: files.get(block.attachment_id)!, previewUrl: "" }) };
}

/** Build only the new body; references and local preview URLs never enter the forwarded payload. */
export function forwardMessageBody(draft: ForwardMessageDraft): ForwardMessageBody {
  if (draft.messageType === "text") return { messageType: "text", content: {
    text: draft.blocks.filter((block) => block.type === "text").map((block) => block.text).join(""),
  } };
  return { messageType: "rich", content: { blocks: draft.blocks.map((block) => {
    if (block.type === "text") return { type: "text" as const, text: block.text };
    if (!block.uploaded || !block.attachmentId) throw new Error("图片上传未完成，请重试");
    return { type: "image" as const, attachment_id: block.attachmentId };
  }) } };
}
