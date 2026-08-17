import { useState } from "react";

import { AuthApiError, login } from "../api";
import type { AuthSession } from "../types";

export function useLoginForm(apiBaseUrl: string, onAuthenticated: (session: AuthSession) => void | Promise<void>) {
  const [account, setAccount] = useState("");
  const [password, setPassword] = useState("");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const submit = async () => {
    const validationError = validateCredentials(account, password);
    if (validationError) {
      setErrorMessage(validationError);
      return;
    }
    setErrorMessage(null);
    setIsSubmitting(true);
    try {
      await onAuthenticated(await login(apiBaseUrl, { account, password }));
    } catch (error) {
      setErrorMessage(toErrorMessage(error));
    } finally {
      setIsSubmitting(false);
    }
  };

  return { account, password, errorMessage, isSubmitting, setAccount, setPassword, submit };
}

function validateCredentials(account: string, password: string): string | null {
  if (!/^\d{8,12}$/.test(account)) {
    return "账号必须是 8-12 位数字";
  }
  if (password.length === 0) {
    return "请输入密码";
  }
  return null;
}

function toErrorMessage(error: unknown): string {
  if (error instanceof AuthApiError) {
    switch (error.code) {
      case "invalid_credentials":
        return "账号或密码错误";
      case "network_error":
        return "网络连接失败，请检查服务是否启动";
      case "no_available_chat_node":
        return "当前没有可用的聊天服务，请稍后重试";
      default:
        return "登录失败，请稍后重试";
    }
  }
  return "网络连接失败，请检查服务是否启动";
}
