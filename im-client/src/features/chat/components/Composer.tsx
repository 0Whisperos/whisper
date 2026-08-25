import { IconButton } from "./ui";

interface ComposerProps {
  draft: string;
  canSend: boolean;
  statusMessage: string;
  onChangeDraft: (value: string) => void;
  onToolPreview: (name: string) => void;
}

export function Composer({ draft, canSend, statusMessage, onChangeDraft, onToolPreview }: ComposerProps) {
  return (
    <footer className="auth-composer">
      <div className="auth-composer-actions">
        <IconButton icon="smile" label="表情" onClick={() => onToolPreview("表情")} />
        <IconButton icon="cut" label="截图" onClick={() => onToolPreview("截图")} />
        <IconButton icon="file" label="文件" onClick={() => onToolPreview("文件")} />
        <IconButton icon="voice" label="语音消息" onClick={() => onToolPreview("语音消息")} />
      </div>
      <label className="auth-message-input">
        <textarea
          rows={3}
          aria-label="输入消息"
          placeholder="输入消息"
          value={draft}
          onChange={(event) => onChangeDraft(event.target.value)}
        />
      </label>
      <output className="auth-interaction-status" aria-live="polite">{statusMessage}</output>
      <button
        className={`auth-send-button ${canSend ? "ready" : ""}`}
        type="button"
        aria-label="发送消息"
        title="发送消息"
        disabled={!canSend}
        onClick={() => onToolPreview("发送")}
      >
        发送
      </button>
    </footer>
  );
}
