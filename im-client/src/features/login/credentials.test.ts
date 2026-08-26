import { invoke } from "@tauri-apps/api/core";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { deleteRefreshToken, listSavedUsers, loadSavedRefreshToken, saveRefreshToken } from "./credentials";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));

const invokeMock = vi.mocked(invoke);

describe("login credential API", () => {
  beforeEach(() => {
    invokeMock.mockReset();
  });

  it("lists saved users through a Tauri command", async () => {
    // Test goal: verify the frontend reads saved user labels through the credentials wrapper.
    // Construction: mock Tauri invoke to return a valid saved-user array and call listSavedUsers.
    // Input data: command response [{ userId: 20001, account: "00123456" }].
    // Expected behavior: list_saved_users is invoked and the saved-user array is returned.
    invokeMock.mockResolvedValueOnce([{ userId: 20001, account: "00123456" }]);

    await expect(listSavedUsers()).resolves.toEqual([{ userId: 20001, account: "00123456" }]);

    expect(invokeMock).toHaveBeenCalledWith("list_saved_users");
  });

  it("loads a saved refresh token for a user through a Tauri command", async () => {
    // Test goal: verify refresh tokens are loaded by user_id instead of a single global slot.
    // Construction: mock Tauri invoke to return refresh-token and call loadSavedRefreshToken.
    // Input data: userId 20001 and command response "refresh-token".
    // Expected behavior: load_saved_refresh_token receives { userId } and returns refresh-token.
    invokeMock.mockResolvedValueOnce("refresh-token");

    await expect(loadSavedRefreshToken(20001)).resolves.toBe("refresh-token");

    expect(invokeMock).toHaveBeenCalledWith("load_saved_refresh_token", { userId: 20001 });
  });

  it("saves the refresh token with its user and account label through a Tauri command", async () => {
    // Test goal: verify saving a refresh token also sends the account label needed by the saved-user selector.
    // Construction: mock Tauri invoke to resolve and call saveRefreshToken.
    // Input data: userId 20001, account 00123456, refresh token refresh-token.
    // Expected behavior: save_refresh_token receives userId, account, and refreshToken.
    invokeMock.mockResolvedValueOnce(undefined);

    await expect(saveRefreshToken(20001, "00123456", "refresh-token")).resolves.toBeUndefined();

    expect(invokeMock).toHaveBeenCalledWith("save_refresh_token", {
      userId: 20001,
      account: "00123456",
      refreshToken: "refresh-token",
    });
  });

  it("deletes a saved refresh token for a user through a Tauri command", async () => {
    // Test goal: verify deleting local auto-login credentials targets one saved user.
    // Construction: mock Tauri invoke to resolve and call deleteRefreshToken.
    // Input data: userId 20001.
    // Expected behavior: delete_refresh_token receives { userId }.
    invokeMock.mockResolvedValueOnce(undefined);

    await expect(deleteRefreshToken(20001)).resolves.toBeUndefined();

    expect(invokeMock).toHaveBeenCalledWith("delete_refresh_token", { userId: 20001 });
  });
});
