export interface LoginCredentials {
  account: string;
  password: string;
}

export interface AuthSession {
  accessToken: string;
  account: string;
  expiresAt: string;
}

export type AuthErrorCode =
  | "invalid_request"
  | "invalid_credentials"
  | "internal_error"
  | "network_error";
