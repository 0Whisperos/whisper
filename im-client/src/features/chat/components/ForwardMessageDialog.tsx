import { useEffect, useId, useRef, type KeyboardEvent } from "react";
import type { ForwardTarget } from "../forwardTargets";
import { Avatar } from "./ui";
import "./forwardMessage.css";

interface ForwardMessageDialogProps {
  targets: ForwardTarget[];
  selectedConversationId: number | null;
  phase: "choosing" | "downloading" | "uploading" | "sending" | "failed";
  error: string;
  submitted: boolean;
  canSend: boolean;
  onSelectTarget: (conversationId: number) => void;
  onSubmit: () => void;
  onRetry: () => void;
  onClose: () => void;
  onRestoreFocus?: () => void;
}

export function ForwardMessageDialog({ targets, selectedConversationId, phase, error, submitted, canSend,
  onSelectTarget, onSubmit, onRetry, onClose, onRestoreFocus }: ForwardMessageDialogProps) {
  const dialogRef = useRef<HTMLElement>(null);
  const restoreFocusRef = useRef(onRestoreFocus);
  restoreFocusRef.current = onRestoreFocus;
  const titleId = useId();
  const choosing = phase === "choosing";
  const selected = targets.some((target) => target.conversationId === selectedConversationId && !target.disabledReason);
  useEffect(() => {
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const dialog = dialogRef.current;
    const focusInside = () => (dialog?.querySelector<HTMLElement>('input:not(:disabled)')
      ?? dialog?.querySelector<HTMLElement>("button"))?.focus();
    const containFocus = (event: FocusEvent) => {
      if (event.target instanceof Node && !dialog?.contains(event.target)) focusInside();
    };
    // An editor focus request queued before the modal opened must not reclaim focus.
    document.addEventListener("focusin", containFocus);
    focusInside();
    return () => {
      document.removeEventListener("focusin", containFocus);
      if (restoreFocusRef.current) restoreFocusRef.current();
      else if (previousFocus?.isConnected) previousFocus.focus({ preventScroll: true });
    };
  }, []);
  const handleKeys = (event: KeyboardEvent<HTMLElement>) => {
    if (event.key === "Escape") {
      event.preventDefault(); event.stopPropagation(); onClose();
    } else if (event.key === "Tab") {
      const elements = Array.from(dialogRef.current?.querySelectorAll<HTMLElement>("button:not(:disabled), input:not(:disabled)") ?? [])
        .filter((element) => element.tabIndex >= 0);
      const first = elements[0], last = elements[elements.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    }
  };
  const progress = phase === "downloading" ? "正在准备原图…" : phase === "uploading" ? "正在上传图片…"
    : phase === "sending" ? "正在等待发送确认…" : "";
  return <div className="auth-forward-backdrop" onMouseDown={(event) => {
    if (event.target === event.currentTarget) onClose();
  }}>
    <section ref={dialogRef} className="auth-forward-dialog" role="dialog" aria-modal="true" aria-labelledby={titleId}
      onKeyDown={handleKeys}>
      <header><h2 id={titleId}>转发消息</h2><button type="button" aria-label="关闭转发" onClick={onClose}>×</button></header>
      <p>选择一个好友或已有会话</p>
      <div className="auth-forward-targets" role="radiogroup" aria-label="转发目标">
        {targets.map((target) => <label key={target.key} className="auth-forward-target" data-disabled={Boolean(target.disabledReason)}>
          <input type="radio" name={titleId} value={target.key}
            aria-label={target.disabledReason ? `${target.name}，${target.disabledReason}` : target.name}
            disabled={!choosing || Boolean(target.disabledReason)} checked={target.conversationId !== null && selectedConversationId === target.conversationId}
            onChange={() => { if (target.conversationId !== null) onSelectTarget(target.conversationId); }} />
          <Avatar avatar={target.avatar} tone={target.tone} />
          <span>{target.name}{target.disabledReason ? <small>{target.disabledReason}</small> : null}</span>
        </label>)}
        {targets.length === 0 ? <p>暂无可转发的好友或会话</p> : null}
      </div>
      {!canSend ? <p role="status">聊天连接暂不可用，请连接后重试</p> : null}
      {progress ? <p role="status">{progress}</p> : null}
      {error ? <p className="auth-forward-error" role="status">{error}</p> : null}
      <footer>
        <button type="button" onClick={onClose}>{submitted ? "关闭" : "取消"}</button>
        {phase === "failed" ? <button type="button" className="auth-forward-primary" disabled={!canSend} onClick={onRetry}>重试转发</button>
          : <button type="button" className="auth-forward-primary" disabled={!choosing || !selected || !canSend} onClick={onSubmit}>确认转发</button>}
      </footer>
    </section>
  </div>;
}
