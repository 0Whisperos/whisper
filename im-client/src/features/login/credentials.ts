import { invoke } from "@tauri-apps/api/core";

import type { SavedUser } from "./types";

export class CredentialError extends Error {
  constructor() {
    super("credential_unavailable");
    this.name = "CredentialError";
  }
}

export async function listSavedUsers(): Promise<SavedUser[]> {
  try {
    const value = await invoke<unknown>("list_saved_users");
    if (Array.isArray(value) && value.every(isSavedUser)) {
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

export async function loadSavedRefreshToken(userId: number): Promise<string | null> {
  try {
    const value = await invoke<unknown>("load_saved_refresh_token", { userId });
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

export async function saveRefreshToken(userId: number, account: string, refreshToken: string): Promise<void> {
  try {
    await invoke("save_refresh_token", { userId, account, refreshToken });
  } catch {
    throw new CredentialError();
  }
}

export async function deleteRefreshToken(userId: number): Promise<void> {
  try {
    await invoke("delete_refresh_token", { userId });
  } catch {
    throw new CredentialError();
  }
}

function isSavedUser(value: unknown): value is SavedUser {
  return (
    typeof value === "object"
    && value !== null
    && "userId" in value
    && typeof value.userId === "number"
    && "account" in value
    && typeof value.account === "string"
  );
}
