export interface ViewerImageInput {
  id: string;
  messageId: string;
  attachmentId: string;
}

export interface ImageViewerSession {
  sessionId: string;
  version: number;
  conversationId: number;
  currentIndex: number;
  images: (ViewerImageInput & { assetUrl: string | null })[];
}

export type ImageTarget =
  | { kind: "chat"; apiBaseUrl: string; userId: number; conversationId: number; attachmentId: string }
  | { kind: "viewer"; sessionId: string; imageId: string };

export interface ViewerSessionUpdate {
  sessionId: string;
  version: number;
}
