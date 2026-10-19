import { forwardRef, useImperativeHandle, useRef } from "react";
import { IconButton } from "./ui";
import { RichMessageEditor, type RichMessageEditorHandle } from "./RichMessageEditor";
import type { ChatDraftBlock, DraftImageBlock } from "../hooks/useChatDrafts";

interface ComposerProps {
  draft: string;
  canSend: boolean;
  statusMessage: string;
  onToolPreview: (name: string) => void;
  onSendText: (text: string) => void;
  blocks: ChatDraftBlock[];
  onChangeBlocks: (blocks: ChatDraftBlock[]) => void;
  onPickFiles: (files: File[]) => DraftImageBlock[];
  isBusy?: boolean;
  clipboardContextKey?: string;
}

export interface ComposerHandle { focus: () => void }

export const Composer = forwardRef<ComposerHandle, ComposerProps>(function Composer({ draft, canSend, statusMessage, onToolPreview, onSendText, blocks, onChangeBlocks, onPickFiles,
  isBusy: busy, clipboardContextKey }: ComposerProps, ref) {
  const editorRef = useRef<RichMessageEditorHandle | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const isBusy = busy ?? statusMessage.startsWith("正在上传图片");
  useImperativeHandle(ref, () => ({ focus: () => editorRef.current?.focus() }), []);
  const sendDraft = () => {
    if (canSend && !isBusy) onSendText(draft.trim());
  };

  return (
    <footer className="auth-composer">
      <div className="auth-composer-actions">
        <IconButton icon="smile" label="表情" onClick={() => onToolPreview("表情")} />
        <IconButton icon="cut" label="截图" onClick={() => onToolPreview("截图")} />
        <IconButton icon="file" label="发送图片" disabled={isBusy} onClick={() => fileInputRef.current?.click()} />
        <input ref={fileInputRef} id="chat-image-picker" aria-label="选择图片" type="file" accept="image/jpeg,image/png,image/webp" multiple hidden
          disabled={isBusy}
          onChange={(event) => {
            const input = event.currentTarget;
            editorRef.current?.insertFiles(Array.from(input.files ?? []));
            input.value = "";
          }} />
        <IconButton icon="voice" label="语音消息" onClick={() => onToolPreview("语音消息")} />
      </div>
      <RichMessageEditor
        ref={editorRef}
        blocks={blocks}
        disabled={isBusy}
        onChangeBlocks={onChangeBlocks}
        onPickFiles={onPickFiles}
        onSend={sendDraft}
        clipboardContextKey={clipboardContextKey}
      />
      <output className="auth-interaction-status" aria-live="polite">{statusMessage}</output>
      <button
        className={`auth-send-button ${canSend ? "ready" : ""}`}
        type="button"
        aria-label="发送消息"
        title="发送(Enter)"
        disabled={!canSend || isBusy}
        onClick={sendDraft}
      >
        发送
      </button>
    </footer>
  );
});
