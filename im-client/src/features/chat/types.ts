export type ConversationType = "assistant" | "direct" | "group";
export type AvatarTone = "blue" | "gray" | "gold" | "green" | "orange" | "purple" | "rose" | "teal";
export type ThemeMode = "system" | "light" | "dark";
export type WorkspaceView = "messages" | "contacts";
export type MobilePanel = "sessions" | "chat" | "contacts" | "contact-detail";
export type StatusScope = "session" | "chat" | "contacts";

export interface ChatProfile {
  userId: number;
  name: string;
  avatar: string;
  tone: AvatarTone;
}

export interface ChatSelfProfile extends ChatProfile {
  account: string;
}

export interface ChatSessionItem {
  id: string;
  conversationId: number;
  name: string;
  avatar: string;
  tone: AvatarTone;
  type: ConversationType;
  preview: string;
  time: string;
  pinned?: boolean;
  unread?: number;
  mentionsMe?: boolean;
  muted?: boolean;
  draft?: boolean;
}

export interface TextMessageContent {
  text: string;
}

export interface ChatMessage {
  messageId: string;
  conversationId: number;
  conversationSeq: number;
  senderUserId: number;
  clientMessageId: string;
  messageType: "text";
  content: TextMessageContent;
  createdAt: string;
  displayTime: string;
  showTime: boolean;
  showAvatar: boolean;
  receipt?: "已读" | "已送达";
}

export interface ChatConversation {
  conversationId: number;
  type: ConversationType;
  name: string;
  avatar: string;
  tone: AvatarTone;
  status: string;
  participants: Record<number, ChatProfile>;
  messages: ChatMessage[];
}

export interface ChatContact {
  id: string;
  userId: number;
  name: string;
  avatar: string;
  tone: AvatarTone;
  account: string;
  region: string;
  status: string;
  conversationId?: number;
  section: string;
}

export interface ChatContactSection {
  id: string;
  label: string;
}

export interface ChatMockData {
  self: ChatSelfProfile;
  sessions: ChatSessionItem[];
  conversations: Record<number, ChatConversation>;
  contacts: ChatContact[];
  contactSections: ChatContactSection[];
}
