import type { RefObject } from "react";

import type { WorkspaceView } from "../types";
import { Icon } from "./ui";

interface BottomNavProps {
  view: WorkspaceView;
  accountButtonRef: RefObject<HTMLButtonElement | null>;
  isAccountMenuOpen: boolean;
  onSelectView: (view: WorkspaceView) => void;
  onOpenAccountMenu: (trigger: HTMLButtonElement) => void;
}

export function BottomNav({ view, accountButtonRef, isAccountMenuOpen, onSelectView, onOpenAccountMenu }: BottomNavProps) {
  return (
    <nav className="auth-bottom-nav" aria-label="移动导航">
      <button
        type="button"
        aria-label="消息"
        title="消息"
        className={view === "messages" ? "is-active" : ""}
        onClick={() => onSelectView("messages")}
      >
        <Icon name="message" />
        <small>消息</small>
      </button>
      <button
        type="button"
        aria-label="好友"
        title="好友"
        className={view === "contacts" ? "is-active" : ""}
        onClick={() => onSelectView("contacts")}
      >
        <Icon name="contact" />
        <small>通讯录</small>
      </button>
      <button
        ref={accountButtonRef}
        type="button"
        aria-label="账号与设置"
        title="账号与设置"
        aria-haspopup="dialog"
        aria-expanded={isAccountMenuOpen}
        aria-controls="account-menu"
        onClick={(event) => onOpenAccountMenu(event.currentTarget)}
      >
        <Icon name="settings" />
        <small>账号</small>
      </button>
    </nav>
  );
}
