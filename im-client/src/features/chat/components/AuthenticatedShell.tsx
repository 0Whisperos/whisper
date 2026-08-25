import { useEffect, useRef, useState } from "react";

import { chatMockData } from "../mockData";
import type { StatusScope } from "../types";
import { useChatDrafts } from "../hooks/useChatDrafts";
import { useChatLayout } from "../hooks/useChatLayout";
import { useChatWorkspace } from "../hooks/useChatWorkspace";
import { useThemeMode } from "../hooks/useThemeMode";
import { AccountMenu } from "./AccountMenu";
import { BottomNav } from "./BottomNav";
import { ChatPanel } from "./ChatPanel";
import { ContactsPanel } from "./ContactsPanel";
import { ConversationDetailPanel } from "./ConversationDetailPanel";
import { FunctionRail } from "./FunctionRail";
import { IconSprite } from "./ui";
import { SessionPanel } from "./SessionPanel";

interface AuthenticatedShellProps {
  connectionLabel: string;
  isLoggingOut: boolean;
  onLogout: () => void;
}

export function AuthenticatedShell({ connectionLabel, isLoggingOut, onLogout }: AuthenticatedShellProps) {
  const data = chatMockData;
  const workspace = useChatWorkspace(data);
  const drafts = useChatDrafts(workspace.activeConversationId);
  const layout = useChatLayout();
  const theme = useThemeMode();
  const [isAccountMenuOpen, setIsAccountMenuOpen] = useState(false);
  const [isDetailOpen, setIsDetailOpen] = useState(false);
  const desktopAccountTriggerRef = useRef<HTMLButtonElement | null>(null);
  const mobileAccountTriggerRef = useRef<HTMLButtonElement | null>(null);
  const lastAccountTriggerRef = useRef<HTMLButtonElement | null>(null);
  const detailTriggerRef = useRef<HTMLButtonElement | null>(null);
  const accountMenuRef = useRef<HTMLDivElement | null>(null);
  const detailPanelRef = useRef<HTMLDivElement | null>(null);

  const showToolPreview = (name: string, scope?: StatusScope) => {
    const resolvedScope = scope ?? (workspace.view === "contacts" ? "contacts" : "session");
    workspace.showToolPreview(name, resolvedScope);
  };

  const openAccountMenu = (trigger: HTMLButtonElement) => {
    lastAccountTriggerRef.current = trigger;
    setIsDetailOpen(false);
    setIsAccountMenuOpen((current) => !current);
  };

  const closeAccountMenu = (returnFocus: boolean) => {
    setIsAccountMenuOpen(false);
    if (returnFocus) {
      const fallback = window.innerWidth < 680 ? mobileAccountTriggerRef.current : desktopAccountTriggerRef.current;
      window.setTimeout(() => (fallback ?? lastAccountTriggerRef.current)?.focus(), 0);
    }
  };

  const openDetailPanel = (trigger: HTMLButtonElement) => {
    detailTriggerRef.current = trigger;
    setIsDetailOpen((current) => !current);
  };

  const closeDetailPanel = (returnFocus: boolean) => {
    setIsDetailOpen(false);
    if (returnFocus) {
      window.setTimeout(() => detailTriggerRef.current?.focus(), 0);
    }
  };

  useEffect(() => {
    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (
        isAccountMenuOpen
        && !accountMenuRef.current?.contains(target)
        && !desktopAccountTriggerRef.current?.contains(target)
        && !mobileAccountTriggerRef.current?.contains(target)
      ) {
        closeAccountMenu(false);
      }
      if (
        isDetailOpen
        && !detailPanelRef.current?.contains(target)
        && !detailTriggerRef.current?.contains(target)
      ) {
        closeDetailPanel(false);
      }
    };

    const handleKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key !== "Escape") {
        return;
      }
      if (isDetailOpen) {
        closeDetailPanel(true);
      }
      if (isAccountMenuOpen) {
        closeAccountMenu(true);
      }
    };

    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [isAccountMenuOpen, isDetailOpen]);

  const handleSelectView = (nextView: "messages" | "contacts") => {
    setIsAccountMenuOpen(false);
    setIsDetailOpen(false);
    workspace.setView(nextView);
  };

  const handleEnterContactConversation = (contact = workspace.activeContact) => {
    if (workspace.enterContactConversation(contact)) {
      setIsDetailOpen(false);
    }
  };

  return (
    <main
      className="auth-shell"
      data-view={workspace.view}
      data-mobile-panel={workspace.mobilePanel}
      data-rail-expanded={layout.railExpanded}
      data-auth-theme={theme.appliedTheme}
      style={layout.style}
    >
      <IconSprite />
      <FunctionRail
        self={data.self}
        view={workspace.view}
        accountButtonRef={desktopAccountTriggerRef}
        isAccountMenuOpen={isAccountMenuOpen}
        onOpenAccountMenu={openAccountMenu}
        onSelectView={handleSelectView}
        onToolPreview={(name) => showToolPreview(name)}
      />
      <div className="auth-layout-resizer auth-rail-resizer" aria-label="调整功能栏宽度" {...layout.resizerProps("rail")} />
      <SessionPanel
        sessions={data.sessions}
        activeConversationId={workspace.activeConversationId}
        statusMessage={workspace.statusMessages.session}
        onSelectConversation={workspace.selectConversation}
        onToolPreview={(name) => showToolPreview(name, "session")}
      />
      <div className="auth-layout-resizer auth-sidebar-resizer" aria-label="调整会话或联系人列表宽度" {...layout.resizerProps("sidebar")} />
      <ChatPanel
        conversation={workspace.activeConversation}
        self={data.self}
        connectionLabel={connectionLabel}
        draft={drafts.draft}
        canSend={drafts.canSend}
        statusMessage={workspace.statusMessages.chat}
        isDetailOpen={isDetailOpen}
        onReturnToSessions={workspace.returnToSessions}
        onOpenDetail={openDetailPanel}
        onToolPreview={(name) => showToolPreview(name, "chat")}
        onChangeDraft={drafts.setDraft}
      />
      <div className="auth-layout-resizer auth-composer-resizer" aria-label="调整消息输入区高度" {...layout.resizerProps("composer")} />
      <ContactsPanel
        hidden={workspace.view !== "contacts"}
        contacts={data.contacts}
        sections={data.contactSections}
        activeContact={workspace.activeContact}
        activeContactId={workspace.activeContactId}
        statusMessage={workspace.statusMessages.contacts}
        onSelectContact={workspace.selectContact}
        onEnterConversation={handleEnterContactConversation}
        onReturnToContacts={workspace.returnToContacts}
        onToolPreview={(name) => showToolPreview(name, "contacts")}
      />
      <ConversationDetailPanel
        panelRef={detailPanelRef}
        hidden={!isDetailOpen}
        onToolPreview={(name) => showToolPreview(name, "chat")}
      />
      <AccountMenu
        self={data.self}
        menuRef={accountMenuRef}
        hidden={!isAccountMenuOpen}
        themeMode={theme.themeMode}
        isLoggingOut={isLoggingOut}
        onSelectTheme={theme.setThemeMode}
        onLogout={onLogout}
      />
      <BottomNav
        view={workspace.view}
        accountButtonRef={mobileAccountTriggerRef}
        isAccountMenuOpen={isAccountMenuOpen}
        onSelectView={handleSelectView}
        onOpenAccountMenu={openAccountMenu}
      />
    </main>
  );
}
