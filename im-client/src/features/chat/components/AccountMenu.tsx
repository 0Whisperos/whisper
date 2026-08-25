import type { KeyboardEvent, RefObject } from "react";

import type { ChatSelfProfile, ThemeMode } from "../types";
import { Avatar, Icon } from "./ui";

interface AccountMenuProps {
  self: ChatSelfProfile;
  menuRef: RefObject<HTMLDivElement | null>;
  hidden: boolean;
  themeMode: ThemeMode;
  isLoggingOut: boolean;
  onSelectTheme: (mode: ThemeMode) => void;
  onLogout: () => void;
}

const themeOptions: Array<{ mode: ThemeMode; label: string }> = [
  { mode: "system", label: "跟随系统" },
  { mode: "light", label: "浅色" },
  { mode: "dark", label: "深色" },
];

export function AccountMenu({ self, menuRef, hidden, themeMode, isLoggingOut, onSelectTheme, onLogout }: AccountMenuProps) {
  const handleThemeKeyDown = (event: KeyboardEvent<HTMLFieldSetElement>) => {
    if (!["ArrowDown", "ArrowRight", "ArrowUp", "ArrowLeft", "Home", "End"].includes(event.key)) {
      return;
    }
    const buttons = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>("[role='radio']"));
    const currentIndex = buttons.indexOf(event.target as HTMLButtonElement);
    if (currentIndex === -1) {
      return;
    }
    event.preventDefault();
    const nextIndex = event.key === "Home"
      ? 0
      : event.key === "End"
        ? buttons.length - 1
        : (currentIndex + (event.key === "ArrowDown" || event.key === "ArrowRight" ? 1 : -1) + buttons.length) % buttons.length;
    buttons[nextIndex]?.focus();
    buttons[nextIndex]?.click();
  };

  return (
    <div
      ref={menuRef}
      className="auth-account-menu"
      id="account-menu"
      role="dialog"
      aria-modal="false"
      aria-label="账号与设置"
      hidden={hidden}
    >
      <div className="auth-account-summary">
        <Avatar avatar={self.avatar} tone={self.tone} />
        <span>
          <strong>{self.name}</strong>
          <small>{self.account}</small>
        </span>
      </div>
      <fieldset className="auth-theme-options" role="radiogroup" onKeyDown={handleThemeKeyDown}>
        <legend>外观</legend>
        {themeOptions.map((option) => (
          <button
            key={option.mode}
            type="button"
            role="radio"
            aria-checked={themeMode === option.mode}
            onClick={() => onSelectTheme(option.mode)}
          >
            {option.label}
            <Icon name="check" />
          </button>
        ))}
      </fieldset>
      <button className="auth-logout-button" type="button" disabled={isLoggingOut} onClick={onLogout}>
        {isLoggingOut ? "退出中" : "退出登录"}
      </button>
    </div>
  );
}
