import { confirmUploads, requestUploadAuthorizations, uploadSignedFile } from "../attachmentsApi";
import type { ChatDraftBlock, DraftImageBlock } from "./useChatDrafts";

export interface UploadDraftImageOptions {
  getAccessToken?: () => string;
  assertActive?: () => void;
}

export async function uploadDraftImages(apiBaseUrl: string, accessToken: string, conversationId: number,
  blocks: ChatDraftBlock[], onMetadata: (blocks: ChatDraftBlock[]) => void,
  options: UploadDraftImageOptions = {}): Promise<ChatDraftBlock[]> {
  const assertActive = options.assertActive ?? (() => undefined);
  const getAccessToken = options.getAccessToken ?? (() => accessToken);
  assertActive();
  let next = [...blocks];
  let pending = next.filter((block): block is DraftImageBlock => block.type === "image" && !block.uploaded);
  const unauthorized = pending.filter((image) => !image.attachmentId || !image.uploadUrl
    || !Number.isFinite(Date.parse(image.uploadExpiresAt ?? "")) || Date.parse(image.uploadExpiresAt ?? "") <= Date.now());
  if (unauthorized.length) {
    const authorizations = await requestUploadAuthorizations(apiBaseUrl, getAccessToken(), conversationId,
      unauthorized.map((image) => ({ file_name: image.file.name, content_type: image.file.type, size_bytes: image.file.size })));
    assertActive();
    if (authorizations.length !== unauthorized.length
      || new Set(authorizations.map((authorization) => authorization.attachment_id)).size !== unauthorized.length) {
      throw new Error("图片上传授权不完整，请重试");
    }
    next = next.map((block) => {
      if (block.type !== "image") return block;
      const index = unauthorized.findIndex((image) => image.localId === block.localId);
      if (index < 0) return block;
      const auth = authorizations[index];
      if (!auth) throw new Error("图片上传授权不完整，请重试");
      return { ...block, attachmentId: auth.attachment_id, uploadUrl: auth.upload_url,
        uploadHeaders: auth.headers, uploadExpiresAt: auth.expires_at };
    });
    onMetadata(next);
    pending = next.filter((block): block is DraftImageBlock => block.type === "image" && !block.uploaded);
  }
  const successful: DraftImageBlock[] = [];
  const results = await Promise.allSettled(pending.map(async (image) => {
    assertActive();
    await uploadSignedFile({ attachment_id: image.attachmentId!, upload_url: image.uploadUrl!, method: "PUT",
      headers: image.uploadHeaders ?? {}, expires_at: image.uploadExpiresAt ?? "" }, image.file);
    assertActive();
    successful.push(image);
  }));
  assertActive();
  if (successful.length) {
    const completions = await confirmUploads(apiBaseUrl, getAccessToken(), successful.map((image) => image.attachmentId!));
    assertActive();
    const requested = new Set(successful.map((image) => image.attachmentId!));
    if (completions.length !== requested.size || new Set(completions.map((item) => item.attachment_id)).size !== requested.size
      || completions.some((item) => !requested.has(item.attachment_id))) throw new Error("图片上传确认不完整，请重试");
    const ready = new Set(completions.filter((item) => item.status === "uploaded").map((item) => item.attachment_id));
    next = next.map((block) => block.type === "image"
      ? { ...block, uploaded: block.uploaded || ready.has(block.attachmentId ?? "") } : block);
    onMetadata(next);
  }
  if (results.some((result) => result.status === "rejected")
    || next.some((block) => block.type === "image" && !block.uploaded)) throw new Error("图片上传未完成，请重试");
  return next;
}
