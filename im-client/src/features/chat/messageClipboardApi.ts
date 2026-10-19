import { invoke, isTauri } from "@tauri-apps/api/core";
import { normalizeAttachmentCacheApiBaseUrl } from "./attachmentCacheApi";
import type { AttachmentLoadContext, AttachmentResourceCache } from "./attachmentResourceCache";
import { assertClipboardHtmlSize, MAX_CLIPBOARD_IMAGE_BYTES, MAX_CLIPBOARD_TOTAL_IMAGE_BYTES } from "./clipboardFormat";
import type { ChatMessage } from "./types";

type ClipboardImageSource = { kind: "cache"; attachmentId: string } | { kind: "inline"; contentType: string; base64: string };
type NativeClipboardBlock = { type: "text"; text: string } | { type: "image"; source: ClipboardImageSource };

export async function copyChatMessage(message: ChatMessage, context: AttachmentLoadContext, cache: AttachmentResourceCache): Promise<void> {
  const content = "text" in message.content ? [{ type: "text" as const, text: message.content.text }] : message.content.blocks;
  let inlineBytes = 0;
  const blocks: NativeClipboardBlock[] = [];
  const cachedIds: string[] = [];
  for (const block of content) {
    if (block.type === "text") { blocks.push({ type: "text", text: block.text }); continue; }
    if (message.localStatus !== "accepted" && block.previewUrl?.startsWith("blob:")) {
      const response = await fetch(block.previewUrl);
      if (!response.ok) throw new Error("image_unavailable");
      const blob = await response.blob();
      if (!["image/jpeg", "image/png", "image/webp"].includes(blob.type)) throw new Error("unsupported_media_type");
      inlineBytes += blob.size;
      if (!blob.size || blob.size > MAX_CLIPBOARD_IMAGE_BYTES || inlineBytes > MAX_CLIPBOARD_TOTAL_IMAGE_BYTES) throw new Error("clipboard_content_too_large");
      blocks.push({ type: "image", source: { kind: "inline", contentType: blob.type, base64: await blobBase64(blob) } });
    } else {
      cachedIds.push(block.attachment_id);
      blocks.push({ type: "image", source: { kind: "cache", attachmentId: block.attachment_id } });
    }
  }
  if (!blocks.some((block) => block.type === "image" || block.text.length > 0)) throw new Error("clipboard_empty");
  if (!isTauri()) {
    if (blocks.some((block) => block.type === "image")) throw new Error("clipboard_unavailable");
    await navigator.clipboard.writeText(blocks.map((block) => block.type === "text" ? block.text : "").join(""));
    return;
  }
  const ids = [...new Set(cachedIds)];
  if (ids.length) {
    const resources = await cache.loadMany(context, ids);
    for (const id of ids) {
      if (resources.find((resource) => resource.attachmentId === id)?.resource?.source !== "asset") {
        if ((await cache.recoverOnce(context, id)).source !== "asset") throw new Error("image_unavailable");
      }
    }
  }
  const write = () => invoke<void>("write_chat_message_clipboard", { apiBaseUrl: normalizeAttachmentCacheApiBaseUrl(context.apiBaseUrl),
    userId: context.userId, conversationId: context.conversationId, blocks });
  try { await write(); }
  catch (error) {
    const code = typeof error === "string" ? error : error instanceof Error ? error.message : "";
    if (!ids.length || !["image_not_cached", "image_unavailable"].includes(code)) throw error;
    for (const id of ids) if ((await cache.recoverOnce(context, id)).source !== "asset") throw new Error("image_unavailable");
    await write();
  }
}

/** Only call from a user's paste handler when that event did not expose HTML. */
export async function readChatClipboardHtml(): Promise<string | null> {
  if (!isTauri()) return null;
  const result = await invoke<{ html: string | null }>("read_chat_clipboard_html");
  if (result.html !== null) assertClipboardHtmlSize(result.html);
  return result.html;
}

function blobBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("image_unavailable"));
    reader.onload = () => {
      const result = typeof reader.result === "string" ? reader.result : "";
      const separator = result.indexOf(",");
      if (separator < 0) reject(new Error("image_unavailable")); else resolve(result.slice(separator + 1));
    };
    reader.readAsDataURL(blob);
  });
}
