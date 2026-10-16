import type { AttachmentLoadContext, AttachmentResourceCache } from "../chat/attachmentResourceCache";
import type { ChatConversation } from "../chat/types";
import { closeImageViewerSession, prepareImageViewerSession, updateImageViewerSession } from "./api";
import type { ImageViewerSession, ViewerImageInput } from "./types";

export function collectViewerImages(conversation: ChatConversation): ViewerImageInput[] {
  return conversation.messages
    .filter((message) => message.localStatus === "accepted" && message.messageId !== null && message.conversationSeq !== null)
    .slice().sort((a, b) => a.conversationSeq! - b.conversationSeq!)
    .flatMap((message) => "blocks" in message.content
      ? message.content.blocks.flatMap((block, index) => block.type === "image"
        ? [{ id: `${message.messageId}:${index}`, messageId: message.messageId!, attachmentId: block.attachment_id }]
        : [])
      : []);
}

/** Main-window owner. Serializes IPC mutations while allowing obsolete cache requests to finish harmlessly. */
class ImageViewerCoordinator {
  private generation = 0;
  private session: ImageViewerSession | null = null;
  private serial: Promise<unknown> = Promise.resolve();
  private latestConversations: Record<number, ChatConversation> = {};
  private signature = "";
  private context: AttachmentLoadContext | null = null;
  private cache: AttachmentResourceCache | null = null;
  private revision = 0;

  async open(context: AttachmentLoadContext, conversation: ChatConversation, imageId: string, cache: AttachmentResourceCache): Promise<void> {
    const generation = ++this.generation;
    this.context = context;
    this.cache = cache;
    const images = collectViewerImages(conversation);
    const selected = images.find((image) => image.id === imageId);
    if (!selected || context.conversationId !== conversation.conversationId) throw new Error("image_load_failed");
    try {
      const [result] = await cache.loadMany(context, [selected.attachmentId]);
      if (generation !== this.generation) return;
      let resource = result?.resource;
      if (!resource || resource.source !== "asset") resource = await cache.recoverOnce(context, selected.attachmentId);
      if (generation !== this.generation) return;
      if (!resource || resource.source !== "asset") throw new Error("image_load_failed");
    } catch (error) {
      if (generation !== this.generation) return;
      throw error;
    }
    if (generation !== this.generation) return;
    await this.enqueue(async () => {
      if (generation !== this.generation) return;
      const input = {
        apiBaseUrl: context.apiBaseUrl, userId: context.userId, conversationId: context.conversationId,
        images, selectedImageId: imageId,
      };
      let session: ImageViewerSession;
      try { session = await prepareImageViewerSession(input); }
      catch (error) {
        if (generation !== this.generation) return;
        if (!isMissingCachedImage(error)) throw error;
        const recovered = await cache.recoverOnce(context, selected.attachmentId);
        if (recovered.source !== "asset") throw new Error("image_load_failed");
        if (generation !== this.generation) return;
        session = await prepareImageViewerSession(input);
      }
      if (generation !== this.generation) {
        // The native prepare may already have opened a window. Clear only that obsolete session.
        await closeImageViewerSession(session.sessionId).catch(() => undefined);
        return;
      }
      this.session = session;
      this.signature = JSON.stringify(images);
      await this.refresh(generation);
    }).catch((error: unknown) => { if (generation === this.generation) throw error; });
  }

  async sync(conversations: Record<number, ChatConversation>,
    credentials?: Omit<AttachmentLoadContext, "conversationId">, cache?: AttachmentResourceCache): Promise<void> {
    ++this.revision;
    this.latestConversations = conversations;
    if (credentials && this.context) this.context = { ...credentials, conversationId: this.context.conversationId };
    if (cache) this.cache = cache;
    const generation = this.generation;
    await this.enqueue(() => this.refresh(generation));
  }

  async close(): Promise<void> {
    ++this.generation;
    this.session = null;
    this.signature = "";
    this.latestConversations = {};
    this.context = null;
    this.cache = null;
    await this.enqueue(() => closeImageViewerSession());
  }

  private async refresh(generation: number): Promise<void> {
    const revision = this.revision;
    const session = this.session;
    if (!session || generation !== this.generation) return;
    const conversation = this.latestConversations[session.conversationId];
    if (!conversation) return;
    const images = collectViewerImages(conversation);
    const signature = JSON.stringify(images);
    if (signature === this.signature) return;
    const context = this.context;
    const cache = this.cache;
    if (context && cache) {
      await cache.loadMany({ ...context, conversationId: session.conversationId }, images.map((image) => image.attachmentId));
      if (generation !== this.generation || revision !== this.revision || this.session?.sessionId !== session.sessionId) return;
    }
    const updated = await updateImageViewerSession(session.sessionId, images);
    if (generation !== this.generation || revision !== this.revision || this.session?.sessionId !== session.sessionId) return;
    this.session = updated;
    this.signature = signature;
  }

  private enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const next = this.serial.catch(() => undefined).then(operation);
    this.serial = next;
    return next;
  }
}

export const imageViewerCoordinator = new ImageViewerCoordinator();

function isMissingCachedImage(error: unknown): boolean {
  const code = typeof error === "string" ? error : error instanceof Error ? error.message
    : error && typeof error === "object" && "code" in error ? String(error.code) : "";
  return ["image_not_cached", "image_unavailable", "image_cache_missing", "invalid_cached_image"].includes(code);
}
