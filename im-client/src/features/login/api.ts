import type { AuthErrorCode, AuthSession, LoginCredentials } from "./types";

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

  try {
    const session: unknown = await response.json();
    if (!isAuthSession(session)) {
      throw new AuthApiError("internal_error");
    }
    return session;
  } catch (error) {
    if (error instanceof AuthApiError) {
      throw error;
    }
    throw new AuthApiError("internal_error");
  }
}

export async function logout(apiBaseUrl: string, accessToken: string): Promise<void> {
  const response = await request(`${joinApiPath(apiBaseUrl)}/v1/auth/logout`, {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}` },
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

async function readErrorCode(response: Response): Promise<AuthErrorCode> {
  try {
    const body: unknown = await response.json();
    if (
      typeof body === "object"
      && body !== null
      && "error" in body
      && isAuthErrorCode(body.error)
    ) {
      return body.error;
    }
  } catch {
    return "internal_error";
  }
  return "internal_error";
}

function isAuthErrorCode(value: unknown): value is AuthErrorCode {
  return value === "invalid_request"
    || value === "invalid_credentials"
    || value === "internal_error";
}

function isAuthSession(value: unknown): value is AuthSession {
  return (
    typeof value === "object"
    && value !== null
    && "accessToken" in value
    && typeof value.accessToken === "string"
    && "account" in value
    && typeof value.account === "string"
    && "expiresAt" in value
    && typeof value.expiresAt === "string"
  );
}

function joinApiPath(apiBaseUrl: string): string {
  return apiBaseUrl.replace(/\/+$/, "");
}
