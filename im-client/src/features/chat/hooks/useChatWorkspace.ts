import { useCallback, useMemo, useState } from "react";

import type { ChatContact, ChatData, MobilePanel, StatusScope, WorkspaceView } from "../types";

function isNarrowViewport(): boolean {
  return window.innerWidth < 680;
}

interface StatusMessages {
  session: string;
  chat: string;
  contacts: string;
}

export function useChatWorkspace(data: ChatData) {
  const initialSession = data.sessions[1] ?? data.sessions[0];
  const initialContact = data.contacts.find((contact) => contact.conversationId === initialSession?.conversationId) ?? data.contacts[0];
  const [view, setViewState] = useState<WorkspaceView>("messages");
  const [activeConversationId, setActiveConversationId] = useState(initialSession?.conversationId ?? 0);
  const [activeContactId, setActiveContactId] = useState(initialContact?.id ?? "");
  const [mobilePanel, setMobilePanel] = useState<MobilePanel>("sessions");
  const [statusMessages, setStatusMessages] = useState<StatusMessages>({ session: "", chat: "", contacts: "" });

  const activeConversation = data.sessions.length === 0
    ? null
    : data.conversations[activeConversationId] ?? data.conversations[initialSession?.conversationId ?? 0] ?? null;
  const activeContact = data.contacts.find((contact) => contact.id === activeContactId) ?? data.contacts[0] ?? null;

  const showStatus = useCallback((message: string, scope: StatusScope) => {
    setStatusMessages((current) => ({ ...current, [scope]: message }));
  }, []);

  const selectConversation = useCallback((conversationId: number) => {
    if (!data.conversations[conversationId]) {
      return false;
    }
    setActiveConversationId(conversationId);
    setViewState("messages");
    if (isNarrowViewport()) {
      setMobilePanel("chat");
    }
    return true;
  }, [data.conversations]);

  const selectContact = useCallback((contactId: string) => {
    if (!data.contacts.some((contact) => contact.id === contactId)) {
      return;
    }
    setActiveContactId(contactId);
    if (isNarrowViewport()) {
      setMobilePanel("contact-detail");
    }
  }, [data.contacts]);

  const setView = useCallback((nextView: WorkspaceView) => {
    setViewState(nextView);
    setMobilePanel(nextView === "contacts" ? "contacts" : "sessions");
  }, []);

  const enterContactConversation = useCallback((contact: ChatContact) => {
    if (!contact.conversationId || !data.conversations[contact.conversationId]) {
      return false;
    }
    setActiveConversationId(contact.conversationId);
    setViewState("messages");
    if (isNarrowViewport()) {
      setMobilePanel("chat");
    }
    return true;
  }, [data.conversations]);

  const showToolPreview = useCallback((toolName: string, scope: StatusScope) => {
    showStatus(`${toolName}仅作界面预览`, scope);
  }, [showStatus]);

  return useMemo(() => ({
    view,
    activeConversationId,
    activeConversation,
    activeContactId,
    activeContact,
    mobilePanel,
    statusMessages,
    showStatus,
    showToolPreview,
    selectConversation,
    selectContact,
    enterContactConversation,
    setView,
    returnToSessions: () => setMobilePanel("sessions"),
    returnToContacts: () => setMobilePanel("contacts"),
  }), [
    activeContact,
    activeContactId,
    activeConversation,
    activeConversationId,
    enterContactConversation,
    mobilePanel,
    selectContact,
    selectConversation,
    setView,
    showStatus,
    showToolPreview,
    statusMessages,
    view,
  ]);
}
