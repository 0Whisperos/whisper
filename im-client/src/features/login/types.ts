export interface LoginCredentials {
  account: string;
  password: string;
}

export interface LoginResponseDto {
  user_id: number;
  access_token: string;
  refresh_token: string;
  access_token_expires_at: string;
  im_chat_ws_url: string;
}

export interface RefreshResponseDto {
  user_id: number;
  access_token: string;
  access_token_expires_at: string;
  im_chat_ws_url: string;
}

export interface AuthSession {
  userId: number;
  accessToken: string;
  refreshToken: string;
  accessTokenExpiresAt: string;
  imChatWsUrl: string;
  refreshTokenPersistence: RefreshTokenPersistence;
}

export interface SavedUser {
  userId: number;
  account: string;
}

export type RefreshTokenPersistence = "saved" | "session_only";

export type AuthErrorCode =
  | "invalid_request"
  | "invalid_credentials"
  | "invalid_refresh_token"
  | "refresh_token_expired"
  | "no_available_chat_node"
  | "internal_error"
  | "network_error";
