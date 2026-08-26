import type {
  AuthErrorCode,
  AuthSession,
  LoginCredentials,
  LoginResponseDto,
  RefreshResponseDto,
} from "./types";

export class AuthApiError extends Error {
  constructor(readonly code: AuthErrorCode) {
    super(code);
    this.name = "AuthApiError";
  }
}

export async function login(apiBaseUrl: string, credentials: LoginCredentials): Promise<AuthSession> {
  const response = await request(`${joinApiPath(apiBaseUrl)}/v1/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(credentials),
  });
  if (!response.ok) {
    throw new AuthApiError(await readErrorCode(response));
  }
  return mapLoginResponse(await readJson(response));
}

export async function refresh(apiBaseUrl: string, refreshToken: string): Promise<AuthSession> {
  const response = await request(`${joinApiPath(apiBaseUrl)}/v1/auth/refresh`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ refresh_token: refreshToken }),
  });
  if (!response.ok) {
    throw new AuthApiError(await readErrorCode(response));
  }
  return mapRefreshResponse(await readJson(response), refreshToken);
}

export async function logout(apiBaseUrl: string, refreshToken: string): Promise<void> {
  const response = await request(`${joinApiPath(apiBaseUrl)}/v1/auth/logout`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ refresh_token: refreshToken }),
  });
  if (!response.ok) {
    throw new AuthApiError(await readErrorCode(response));
  }
}

async function request(input: RequestInfo | URL, init: RequestInit): Promise<Response> {
  try {
    return await fetch(input, init);
  } catch {
    throw new AuthApiError("network_error");
  }
}

async function readJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    throw new AuthApiError("internal_error");
  }
}

async function readErrorCode(response: Response): Promise<AuthErrorCode> {
  try {
    const body: unknown = await response.json();
    if (
      typeof body === "object"
      && body !== null
      && "error_code" in body
      && isAuthErrorCode(body.error_code)
    ) {
      return body.error_code;
    }
  } catch {
    return "internal_error";
  }
  return "internal_error";
}

function mapLoginResponse(value: unknown): AuthSession {
  if (!isLoginResponseDto(value)) {
    throw new AuthApiError("internal_error");
  }
  return {
    userId: value.user_id,
    accessToken: value.access_token,
    refreshToken: value.refresh_token,
    accessTokenExpiresAt: value.access_token_expires_at,
    imChatWsUrl: value.im_chat_ws_url,
    refreshTokenPersistence: "session_only",
  };
}

function mapRefreshResponse(value: unknown, refreshToken: string): AuthSession {
  if (!isRefreshResponseDto(value)) {
    throw new AuthApiError("internal_error");
  }
  return {
    userId: value.user_id,
    accessToken: value.access_token,
    refreshToken,
    accessTokenExpiresAt: value.access_token_expires_at,
    imChatWsUrl: value.im_chat_ws_url,
    refreshTokenPersistence: "session_only",
  };
}

function isAuthErrorCode(value: unknown): value is AuthErrorCode {
  return value === "invalid_request"
    || value === "invalid_credentials"
    || value === "invalid_refresh_token"
    || value === "refresh_token_expired"
    || value === "no_available_chat_node"
    || value === "internal_error";
}

function isLoginResponseDto(value: unknown): value is LoginResponseDto {
  return (
    typeof value === "object"
    && value !== null
    && "user_id" in value
    && typeof value.user_id === "number"
    && "access_token" in value
    && typeof value.access_token === "string"
    && "refresh_token" in value
    && typeof value.refresh_token === "string"
    && "access_token_expires_at" in value
    && typeof value.access_token_expires_at === "string"
    && "im_chat_ws_url" in value
    && typeof value.im_chat_ws_url === "string"
  );
}

function isRefreshResponseDto(value: unknown): value is RefreshResponseDto {
  return (
    typeof value === "object"
    && value !== null
    && "user_id" in value
    && typeof value.user_id === "number"
    && "access_token" in value
    && typeof value.access_token === "string"
    && "access_token_expires_at" in value
    && typeof value.access_token_expires_at === "string"
    && "im_chat_ws_url" in value
    && typeof value.im_chat_ws_url === "string"
  );
}

function joinApiPath(apiBaseUrl: string): string {
  return apiBaseUrl.replace(/\/+$/, "");
}
