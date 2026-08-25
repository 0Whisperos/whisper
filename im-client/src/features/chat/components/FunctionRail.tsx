import type { RefObject } from "react";

import type { ChatSelfProfile, WorkspaceView } from "../types";
import { Avatar, IconButton } from "./ui";

interface FunctionRailProps {
  self: ChatSelfProfile;
  view: WorkspaceView;
  accountButtonRef: RefObject<HTMLButtonElement | null>;
  isAccountMenuOpen: boolean;
  onOpenAccountMenu: (trigger: HTMLButtonElement) => void;
  onSelectView: (view: WorkspaceView) => void;
  onToolPreview: (name: string) => void;
}

export function FunctionRail({
  self,
  view,
  accountButtonRef,
  isAccountMenuOpen,
  onOpenAccountMenu,
  onSelectView,
  onToolPreview,
}: FunctionRailProps) {
  return (
    <aside className="auth-function-rail" aria-label="主导航">
      <button
        ref={accountButtonRef}
        className="auth-avatar-button"
        type="button"
        aria-label="账号与设置"
        aria-haspopup="dialog"
        aria-expanded={isAccountMenuOpen}
        aria-controls="account-menu"
        title="账号与设置"
        onClick={(event) => onOpenAccountMenu(event.currentTarget)}
      >
        <Avatar avatar={self.avatar} tone={self.tone} className="rail-mark" />
        <span className="auth-rail-label">{self.name}</span>
      </button>
      <a className="auth-brand" href="#messages" aria-label="Whisper 首页" title="Whisper">
        <span className="auth-rail-mark">W</span>
        <span className="auth-rail-label">Whisper</span>
      </a>
      <nav className="auth-rail-nav" aria-label="功能">
        <IconButton icon="message" label="消息" active={view === "messages"} onClick={() => onSelectView("messages")}>
          <span className="auth-rail-label">消息</span>
        </IconButton>
        <IconButton icon="contact" label="好友" active={view === "contacts"} onClick={() => onSelectView("contacts")}>
          <span className="auth-rail-label">通讯录</span>
        </IconButton>
      </nav>
      <div className="auth-rail-bottom">
        <IconButton icon="settings" label="设置" onClick={() => onToolPreview("设置")}>
          <span className="auth-rail-label">设置</span>
        </IconButton>
      </div>
    </aside>
  );
}
