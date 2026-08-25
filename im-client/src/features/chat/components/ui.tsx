import type { ButtonHTMLAttributes, ReactNode } from "react";

import type { AvatarTone } from "../types";

export type IconName =
  | "back"
  | "check"
  | "contact"
  | "file"
  | "info"
  | "message"
  | "plus"
  | "search"
  | "settings"
  | "smile"
  | "voice"
  | "video"
  | "cut";

interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  icon: IconName;
  label: string;
  active?: boolean;
  children?: ReactNode;
}

export function IconSprite() {
  return (
    <svg data-icon-sprite aria-hidden="true" className="auth-icon-sprite">
      <symbol id="auth-icon-message" viewBox="0 0 24 24"><path d="M4 5h16v11H8l-4 3V5z" /></symbol>
      <symbol id="auth-icon-contact" viewBox="0 0 24 24"><circle cx="12" cy="8" r="3" /><path d="M5 20c1-4 3-6 7-6s6 2 7 6" /></symbol>
      <symbol id="auth-icon-settings" viewBox="0 0 24 24"><circle cx="12" cy="12" r="3" /><path d="M12 3v3m0 12v3m9-9h-3M6 12H3m15.4-6.4-2.1 2.1M7.7 16.3l-2.1 2.1m0-12.8 2.1 2.1m8.6 8.6 2.1 2.1" /></symbol>
      <symbol id="auth-icon-search" viewBox="0 0 24 24"><circle cx="10.5" cy="10.5" r="5.5" /><path d="m15 15 5 5" /></symbol>
      <symbol id="auth-icon-plus" viewBox="0 0 24 24"><path d="M12 5v14M5 12h14" /></symbol>
      <symbol id="auth-icon-back" viewBox="0 0 24 24"><path d="m14 5-7 7 7 7M7 12h12" /></symbol>
      <symbol id="auth-icon-voice" viewBox="0 0 24 24"><rect x="9" y="4" width="6" height="11" rx="3" /><path d="M6 12a6 6 0 0 0 12 0m-6 6v3" /></symbol>
      <symbol id="auth-icon-video" viewBox="0 0 24 24"><rect x="3" y="6" width="12" height="12" rx="2" /><path d="m15 10 5-3v10l-5-3z" /></symbol>
      <symbol id="auth-icon-info" viewBox="0 0 24 24"><circle cx="12" cy="12" r="8" /><path d="M12 11v5m0-8h.01" /></symbol>
      <symbol id="auth-icon-smile" viewBox="0 0 24 24"><circle cx="12" cy="12" r="8" /><path d="M9 10h.01M15 10h.01M8.5 14c1 1.5 2.2 2 3.5 2s2.5-.5 3.5-2" /></symbol>
      <symbol id="auth-icon-cut" viewBox="0 0 24 24"><path d="m4 4 16 16M4 20 20 4M5 8h5m4 8h5" /></symbol>
      <symbol id="auth-icon-file" viewBox="0 0 24 24"><path d="M6 3h8l4 4v14H6zM14 3v5h5" /></symbol>
      <symbol id="auth-icon-check" viewBox="0 0 24 24"><path d="m5 12 4 4 10-10" /></symbol>
    </svg>
  );
}

export function Icon({ name }: { name: IconName }) {
  return (
    <svg aria-hidden="true">
      <use href={`#auth-icon-${name}`} />
    </svg>
  );
}

export function IconButton({ icon, label, active, className, children, ...props }: IconButtonProps) {
  const classes = ["auth-icon-button", active ? "is-active" : "", className ?? ""].filter(Boolean).join(" ");
  return (
    <button type="button" aria-label={label} title={label} className={classes} {...props}>
      <Icon name={icon} />
      {children}
    </button>
  );
}

export function Avatar({ avatar, tone, className = "" }: { avatar: string; tone: AvatarTone; className?: string }) {
  return <span className={`auth-person-avatar ${tone} ${className}`.trim()}>{avatar}</span>;
}
