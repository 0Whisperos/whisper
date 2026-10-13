import { useEffect, useRef, useState } from "react";

import type { ChatApiError } from "../api";
import type { ChatContact, ChatData, StatusScope } from "../types";
import { useChatDrafts } from "../hooks/useChatDrafts";
import { useChatLayout } from "../hooks/useChatLayout";
import { useChatWorkspace } from "../hooks/useChatWorkspace";
import { useThemeMode } from "../hooks/useThemeMode";
import { useAvatarObjectUrl } from "../hooks/useAvatarObjectUrl";
import type { useFriendRequests } from "../hooks/useFriendRequests";
import { AvatarResourceCache } from "../avatarResourceCache";
import { AttachmentResourceCache } from "../attachmentResourceCache";
import type { EditableSelfProfile } from "../types";
import { AccountMenu } from "./AccountMenu";
import { BottomNav } from "./BottomNav";
import { ChatPanel } from "./ChatPanel";
import { ContactsPanel } from "./ContactsPanel";
import { ConversationDetailPanel } from "./ConversationDetailPanel";
import { FunctionRail } from "./FunctionRail";
import { IconSprite } from "./ui";
import { ProfileEditor } from "./ProfileEditor";
import { SessionPanel } from "./SessionPanel";
import { confirmUploads, requestUploadAuthorizations, uploadSignedFile } from "../attachmentsApi";
import type { ChatDraftBlock, DraftImageBlock } from "../hooks/useChatDrafts";

interface AuthenticatedShellProps {
  data: ChatData;
  connectionLabel: string;
  canSendMessages?: boolean;
  isLoggingOut: boolean;
  onLogout: () => void;
  onSendText?: (conversationId: number, text: string) => boolean | void;
  onSendRich?: (conversationId: number, blocks: Array<{ type: "text"; text: string } | { type: "image"; attachment_id: string; previewUrl?: string }>) => string | null | boolean | void;
  onRetryMessage?: (clientMessageId: string) => void;
  loadConversationHistory?: (conversationId: number) => Promise<number | null>;
  loadOlderConversationHistory?: (conversationId: number) => Promise<number | null>;
  hasMoreConversationHistory?: (conversationId: number) => boolean;
  onDeliveredAck?: (conversationId: number, deliveredSeq: number) => void;
  onReadAck?: (conversationId: number, readSeq: number) => void;
  retryConversationHistory?: (conversationId: number) => void;
  loadingConversationId?: number | null;
  getConversationHistoryError?: (conversationId: number) => ChatApiError | null;
  friendRequests?: ReturnType<typeof useFriendRequests>;
  onRefreshFriends?: () => Promise<void>;
  apiBaseUrl?: string;
  accessToken?: string;
  avatarResourceCache?: AvatarResourceCache;
  attachmentResourceCache?: AttachmentResourceCache;
  onSaveProfile: (profile: EditableSelfProfile) => Promise<void>;
}

export function AuthenticatedShell({
  data,
  connectionLabel,
  canSendMessages = false,
  isLoggingOut,
  onLogout,
  onSendText = () => false,
  onSendRich = () => false,
  onRetryMessage = () => undefined,
  loadConversationHistory,
  loadOlderConversationHistory,
  hasMoreConversationHistory = () => false,
  onDeliveredAck,
  onReadAck,
  retryConversationHistory,
  loadingConversationId = null,
  getConversationHistoryError = () => null,
  friendRequests = EMPTY_FRIEND_REQUESTS,
  onRefreshFriends = async () => undefined,
  apiBaseUrl = "",
  accessToken = "",
  avatarResourceCache,
  attachmentResourceCache,
  onSaveProfile,
}: AuthenticatedShellProps) {
  const workspace = useChatWorkspace(data);
  const drafts = useChatDrafts(workspace.activeConversationId);
  const layout = useChatLayout();
  const theme = useThemeMode();
  const fallbackAvatarCacheRef = useRef<AvatarResourceCache | null>(null);
  if (!fallbackAvatarCacheRef.current) {
    fallbackAvatarCacheRef.current = new AvatarResourceCache();
  }
  const resolvedAvatarCache = avatarResourceCache ?? fallbackAvatarCacheRef.current;
  const avatarImageUrl = useAvatarObjectUrl(
    resolvedAvatarCache,
    apiBaseUrl,
    accessToken,
    data.self.avatarObjectKey,
  );
  const selfProfile = {
    ...data.self,
    avatarImageUrl: avatarImageUrl ?? data.self.avatarImageUrl ?? null,
  };
  const [isAccountMenuOpen, setIsAccountMenuOpen] = useState(false);
  const [isProfileEditorOpen, setIsProfileEditorOpen] = useState(false);
  const [isDetailOpen, setIsDetailOpen] = useState(false);
  const [attachmentStatus, setAttachmentStatus] = useState("");
  const desktopAccountTriggerRef = useRef<HTMLButtonElement | null>(null);
  const mobileAccountTriggerRef = useRef<HTMLButtonElement | null>(null);
  const lastAccountTriggerRef = useRef<HTMLButtonElement | null>(null);
  const detailTriggerRef = useRef<HTMLButtonElement | null>(null);
  const accountMenuRef = useRef<HTMLDivElement | null>(null);
  const detailPanelRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => () => {
    if (!avatarResourceCache) {
      fallbackAvatarCacheRef.current?.clear();
    }
  }, [avatarResourceCache]);
  useEffect(() => {
    if (workspace.activeConversationId > 0 && loadConversationHistory) {
      void Promise.resolve(loadConversationHistory(workspace.activeConversationId)).then((deliveredSeq) => {
        if (deliveredSeq !== null) {
          onDeliveredAck?.(workspace.activeConversationId, deliveredSeq);
        }
      });
    }
  }, [loadConversationHistory, onDeliveredAck, workspace.activeConversationId]);

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

  const openProfileEditor = () => {
    setIsAccountMenuOpen(false);
    setIsDetailOpen(false);
    setIsProfileEditorOpen(true);
  };

  const closeProfileEditor = () => {
    setIsProfileEditorOpen(false);
    window.setTimeout(() => lastAccountTriggerRef.current?.focus(), 0);
  };

  const saveProfile = async (profile: EditableSelfProfile) => {
    await onSaveProfile(profile);
    setIsProfileEditorOpen(false);
    window.setTimeout(() => lastAccountTriggerRef.current?.focus(), 0);
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
      if (isProfileEditorOpen) {
        closeProfileEditor();
      }
    };

    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [isAccountMenuOpen, isDetailOpen, isProfileEditorOpen]);

  const handleSelectView = (nextView: "messages" | "contacts") => {
    setIsAccountMenuOpen(false);
    setIsDetailOpen(false);
    workspace.setView(nextView);
  };

  const handleEnterContactConversation = (contact: ChatContact) => {
    if (workspace.enterContactConversation(contact)) {
      setIsDetailOpen(false);
    }
  };

  const handleSendText = (text: string) => {
    const accepted = onSendText(workspace.activeConversationId, text);
    if (accepted !== false) {
      drafts.setDraft("");
    }
  };

  const handleSendEditor = async () => {
    const conversationId = workspace.activeConversationId;
    const blocks = drafts.blocks;
    const textLength = [...blocks.filter((block) => block.type === "text").map((block) => block.text).join("")].length;
    if (textLength > 4096) {
      setAttachmentStatus("消息文字不能超过 4096 个字符");
      return;
    }
    const images = blocks.filter((block): block is DraftImageBlock => block.type === "image");
    if (images.length === 0) {
      handleSendText(blocks.filter((block) => block.type === "text").map((block) => block.text).join("").trim());
      return;
    }
    try {
      setAttachmentStatus("正在上传图片…");
      let nextBlocks: ChatDraftBlock[] = [...blocks];
      let pending = images.filter((image) => !image.uploaded);
      const needsAuthorization = pending.filter((image) => !image.attachmentId || !image.uploadUrl
        || Date.parse(image.uploadExpiresAt ?? "") <= Date.now());
      if (needsAuthorization.length > 0) {
        const authorizations = await requestUploadAuthorizations(apiBaseUrl, accessToken, conversationId, needsAuthorization.map((image) => ({
          file_name: image.file.name,
          content_type: image.file.type,
          size_bytes: image.file.size,
        })));
        nextBlocks = nextBlocks.map((block) => {
          if (block.type !== "image") return block;
          const index = needsAuthorization.findIndex((item) => item.localId === block.localId);
          if (index < 0) return block;
          const auth = authorizations[index];
          return { ...block, attachmentId: auth.attachment_id, uploadUrl: auth.upload_url, uploadHeaders: auth.headers, uploadExpiresAt: auth.expires_at };
        });
        drafts.setBlocks(nextBlocks);
        pending = nextBlocks.filter((block): block is DraftImageBlock => block.type === "image" && !block.uploaded);
      }
      const successfulPuts: DraftImageBlock[] = [];
      const putResults = await Promise.allSettled(pending.map(async (image) => {
        const auth = { attachment_id: image.attachmentId!, upload_url: image.uploadUrl!, method: "PUT" as const, headers: image.uploadHeaders ?? {}, expires_at: image.uploadExpiresAt ?? "" };
        await uploadSignedFile(auth, image.file);
        successfulPuts.push(image);
      }));
      if (successfulPuts.length > 0) {
        const completions = await confirmUploads(apiBaseUrl, accessToken, successfulPuts.map((image) => image.attachmentId!));
        const ready = new Set(completions.filter((result) => result.status === "uploaded").map((result) => result.attachment_id));
        nextBlocks = nextBlocks.map((block) => block.type === "image" ? { ...block, uploaded: ready.has(block.attachmentId ?? "") } : block);
        drafts.setBlocks(nextBlocks);
      }
      const hasPutFailure = putResults.some((result) => result.status === "rejected");
      const allReady = nextBlocks.filter((block): block is DraftImageBlock => block.type === "image").every((block) => block.uploaded);
      if (hasPutFailure || !allReady) throw new Error("图片上传未完成，请重试");
      const richBlocks: Array<{ type: "text"; text: string } | { type: "image"; attachment_id: string; previewUrl?: string }> = [];
      for (const block of nextBlocks) {
        if (block.type === "text") {
          if (block.text) richBlocks.push({ type: "text", text: block.text });
        } else {
          // Draft URLs are revoked when the accepted draft is cleared; the message bubble loads its own authorized URL.
          richBlocks.push({ type: "image", attachment_id: block.attachmentId! });
        }
      }
      const accepted = onSendRich(conversationId, richBlocks);
      if (accepted !== false && accepted !== null) drafts.clear();
      setAttachmentStatus("");
    } catch (error) {
      setAttachmentStatus(error instanceof Error ? error.message : "图片上传失败，请重试");
    }
  };

  const handlePickImages = (files: File[]): DraftImageBlock[] => {
    const currentImages = drafts.blocks.filter((block): block is DraftImageBlock => block.type === "image");
    const allowedTypes = new Set(["image/jpeg", "image/png", "image/webp"]);
    if (currentImages.length + files.length > 10) {
      setAttachmentStatus("每条消息最多发送 10 张图片");
      return [];
    }
    if (files.some((file) => !allowedTypes.has(file.type))) {
      setAttachmentStatus("仅支持 JPEG、PNG 或 WebP 图片");
      return [];
    }
    if (files.some((file) => file.size > 20 * 1024 * 1024)
      || [...currentImages.map((image) => image.file), ...files].reduce((sum, file) => sum + file.size, 0) > 50 * 1024 * 1024) {
      setAttachmentStatus("单张图片不能超过 20 MiB，消息图片总量不能超过 50 MiB");
      return [];
    }
    setAttachmentStatus("");
    return drafts.createImageBlocks(files);
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
        self={selfProfile}
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
      {workspace.activeConversation ? (
        <>
          <ChatPanel
            conversation={workspace.activeConversation}
            self={selfProfile}
            connectionLabel={connectionLabel}
            draft={drafts.draft}
            canSend={drafts.canSend && canSendMessages}
            statusMessage={attachmentStatus || workspace.statusMessages.chat}
            isHistoryLoading={loadingConversationId === workspace.activeConversationId}
            historyError={getConversationHistoryError(workspace.activeConversationId)}
            hasMoreHistory={hasMoreConversationHistory(workspace.activeConversationId)}
            onLoadOlderHistory={() => { void loadOlderConversationHistory?.(workspace.activeConversationId); }}
            onRetryHistory={() => retryConversationHistory?.(workspace.activeConversationId)}
            isDetailOpen={isDetailOpen}
            onReturnToSessions={workspace.returnToSessions}
            onOpenDetail={openDetailPanel}
            onToolPreview={(name) => showToolPreview(name, "chat")}
            onChangeDraftBlocks={drafts.setBlocks}
            onSendText={handleSendText}
            onSendRich={handleSendEditor}
            draftBlocks={drafts.blocks}
            onPickFiles={handlePickImages}
            apiBaseUrl={apiBaseUrl}
            accessToken={accessToken}
            userId={data.self.userId}
            attachmentResourceCache={attachmentResourceCache}
            onRetryMessage={onRetryMessage}
            onReadThrough={onReadAck}
          />
          <div className="auth-layout-resizer auth-composer-resizer" aria-label="调整消息输入区高度" {...layout.resizerProps("composer")} />
        </>
      ) : (
        <div className="auth-empty-chat-region" aria-label="空白聊天区域" />
      )}
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
        self={selfProfile}
        friendRequests={friendRequests}
        onRefreshFriends={onRefreshFriends}
        apiBaseUrl={apiBaseUrl}
        accessToken={accessToken}
      />
      <ConversationDetailPanel
        panelRef={detailPanelRef}
        hidden={!isDetailOpen}
        onToolPreview={(name) => showToolPreview(name, "chat")}
      />
      <AccountMenu
        self={selfProfile}
        menuRef={accountMenuRef}
        hidden={!isAccountMenuOpen}
        themeMode={theme.themeMode}
        isLoggingOut={isLoggingOut}
        onEditProfile={openProfileEditor}
        onSelectTheme={theme.setThemeMode}
        onLogout={onLogout}
      />
      {isProfileEditorOpen ? <ProfileEditor self={selfProfile} onSave={saveProfile} onCancel={closeProfileEditor} /> : null}
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

const EMPTY_FRIEND_REQUESTS = {
  incoming: [], outgoing: [], incomingHasMore: false, outgoingHasMore: false,
  pendingCount: 0, loading: false, error: null,
  refresh: async () => undefined,
  loadMore: async () => undefined,
} as unknown as ReturnType<typeof useFriendRequests>;
