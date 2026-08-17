import { invoke } from "@tauri-apps/api/core";

export class CredentialError extends Error {
  constructor() {
    super("credential_unavailable");
    this.name = "CredentialError";
  }
}

export async function loadSavedRefreshToken(): Promise<string | null> {
  try {
    const value = await invoke<unknown>("load_saved_refresh_token");
    if (value === null || typeof value === "string") {
      return value;
    }
    throw new CredentialError();
  } catch (error) {
    if (error instanceof CredentialError) {
      throw error;
    }
    throw new CredentialError();
  }
}

export async function saveRefreshToken(refreshToken: string): Promise<void> {
  try {
    await invoke("save_refresh_token", { refreshToken });
  } catch {
    throw new CredentialError();
  }
}

export async function deleteRefreshToken(): Promise<void> {
  try {
    await invoke("delete_refresh_token");
  } catch {
    throw new CredentialError();
  }
}
