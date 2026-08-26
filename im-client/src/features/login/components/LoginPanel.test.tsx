import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { AuthApiError } from "../api";
import { LoginPanel } from "./LoginPanel";

describe("LoginPanel", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("renders the login form fields, auto-login toggle, and saved-user area", () => {
    // Test goal: verify the login panel exposes password login controls and the saved-user entry area.
    // Construction: render LoginPanel with no saved users and query by user-visible labels and roles.
    // Input data: empty savedUsers and isLoadingSavedUsers=false.
    // Expected behavior: account/password fields, auto-login checkbox, login button, and saved-user area are present.
    renderLoginPanel();

    expect(screen.getByLabelText("账号")).toBeInTheDocument();
    expect(screen.getByLabelText("密码")).toBeInTheDocument();
    expect(screen.getByLabelText("自动登录")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "忘记密码" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "登录" })).toBeInTheDocument();
    expect(screen.getByLabelText("已保存用户")).toBeInTheDocument();
  });

  it("validates credentials before requesting password login", async () => {
    // Test goal: verify account must be 8-12 digits and password must be non-empty before submission.
    // Construction: render LoginPanel, type an invalid account, and submit the form.
    // Input data: account alice and password secret.
    // Expected behavior: a validation message is shown and onPasswordLogin is not called.
    const user = userEvent.setup();
    const onPasswordLogin = vi.fn();
    const onPauseGame = vi.fn();

    renderLoginPanel({ onPasswordLogin, onPauseGame });

    await user.type(screen.getByLabelText("账号"), "alice");
    await user.type(screen.getByLabelText("密码"), "secret");
    onPauseGame.mockClear();
    await user.click(screen.getByRole("button", { name: "登录" }));

    expect(onPauseGame).toHaveBeenCalled();
    expect(screen.getByText("账号必须是 8-12 位数字")).toBeInTheDocument();
    expect(onPasswordLogin).not.toHaveBeenCalled();
  });

  it("passes the auto-login choice with password login", async () => {
    // Test goal: verify the auto-login checkbox controls the flag sent with password login.
    // Construction: render LoginPanel, fill valid credentials, enable auto-login, and submit.
    // Input data: account 12345678, password secret, auto-login checked.
    // Expected behavior: onPasswordLogin receives account, password, and true.
    const user = userEvent.setup();
    const onPasswordLogin = vi.fn().mockResolvedValue(undefined);

    renderLoginPanel({ onPasswordLogin });

    await user.type(screen.getByLabelText("账号"), "12345678");
    await user.type(screen.getByLabelText("密码"), "secret");
    await user.click(screen.getByLabelText("自动登录"));
    await user.click(screen.getByRole("button", { name: "登录" }));

    await waitFor(() => {
      expect(onPasswordLogin).toHaveBeenCalledWith("12345678", "secret", true);
    });
  });

  it("disables submission while password login is pending", async () => {
    // Test goal: verify duplicate password-login submissions are blocked while the request is pending.
    // Construction: render LoginPanel with onPasswordLogin returning a never-resolving promise and submit valid credentials.
    // Input data: account 12345678 and password secret.
    // Expected behavior: the submit button shows 登录中... and is disabled.
    const user = userEvent.setup();
    const onPasswordLogin = vi.fn().mockReturnValue(new Promise(() => undefined));

    renderLoginPanel({ onPasswordLogin });

    await user.type(screen.getByLabelText("账号"), "12345678");
    await user.type(screen.getByLabelText("密码"), "secret");
    await user.click(screen.getByRole("button", { name: "登录" }));

    expect(screen.getByRole("button", { name: "登录中..." })).toBeDisabled();
  });

  it("logs in through a saved user button", async () => {
    // Test goal: verify clicking a saved user starts the saved refresh-token login flow.
    // Construction: render LoginPanel with one saved user and click its account button.
    // Input data: saved user { userId: 20001, account: "00123456" }.
    // Expected behavior: onSavedUserLogin receives userId 20001.
    const user = userEvent.setup();
    const onSavedUserLogin = vi.fn().mockResolvedValue(undefined);

    renderLoginPanel({
      savedUsers: [{ userId: 20001, account: "00123456" }],
      onSavedUserLogin,
    });

    await user.click(screen.getByRole("button", { name: "00123456" }));

    await waitFor(() => {
      expect(onSavedUserLogin).toHaveBeenCalledWith(20001);
    });
  });

  it("shows a saved-user expiration message when saved login is invalid", async () => {
    // Test goal: verify an invalid saved refresh token produces a user-facing recovery message.
    // Construction: render LoginPanel with one saved user and make onSavedUserLogin reject with invalid_refresh_token.
    // Input data: saved user 20001 and AuthApiError("invalid_refresh_token").
    // Expected behavior: the panel asks the user to enter account and password again.
    const user = userEvent.setup();
    const onSavedUserLogin = vi.fn().mockRejectedValue(new AuthApiError("invalid_refresh_token"));

    renderLoginPanel({
      savedUsers: [{ userId: 20001, account: "00123456" }],
      onSavedUserLogin,
    });

    await user.click(screen.getByRole("button", { name: "00123456" }));

    expect(await screen.findByText("保存的登录已失效，请重新输入账号密码。")).toBeInTheDocument();
  });

  it("prevents navigation when the forgot password link is clicked", async () => {
    // Test goal: verify the forgot-password link remains a local placeholder interaction.
    // Construction: render LoginPanel and click the forgot-password link.
    // Input data: link text 忘记密码.
    // Expected behavior: onPauseGame is called and the link still points to #.
    const user = userEvent.setup();
    const onPauseGame = vi.fn();

    renderLoginPanel({ onPauseGame });

    const forgotLink = screen.getByRole("link", { name: "忘记密码" });
    onPauseGame.mockClear();
    await user.click(forgotLink);

    expect(forgotLink).toHaveAttribute("href", "#");
    expect(onPauseGame).toHaveBeenCalled();
  });
});

function renderLoginPanel(overrides: Partial<Parameters<typeof LoginPanel>[0]> = {}) {
  return render(
    <LoginPanel
      savedUsers={[]}
      credentialWarning={null}
      isLoadingSavedUsers={false}
      onPasswordLogin={() => undefined}
      onSavedUserLogin={() => undefined}
      onPauseGame={() => undefined}
      {...overrides}
    />,
  );
}
