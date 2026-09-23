import { useState } from "react";

import { AuthApiError } from "../api";

export function useRegisterForm(
  onRegister: (nickname: string, password: string) => void | Promise<void>,
) {
  const [nickname, setNickname] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const submit = async () => {
    const normalizedNickname = nickname.trim();
    const validationError = validateRegistration(normalizedNickname, password, confirmPassword);
    if (validationError) {
      setErrorMessage(validationError);
      return;
    }

    setErrorMessage(null);
    setIsSubmitting(true);
    try {
      await onRegister(normalizedNickname, password);
      setPassword("");
      setConfirmPassword("");
    } catch (error) {
      setErrorMessage(toErrorMessage(error));
    } finally {
      setIsSubmitting(false);
    }
  };

  return {
    nickname,
    password,
    confirmPassword,
    errorMessage,
    isSubmitting,
    setNickname,
    setPassword,
    setConfirmPassword,
    submit,
  };
}

function validateRegistration(nickname: string, password: string, confirmPassword: string): string | null {
  if (nickname.length === 0) {
    return "请输入昵称";
  }
  if (Array.from(nickname).length > 15) {
    return "昵称不能超过 15 个字符";
  }
  if (password.length === 0) {
    return "请输入密码";
  }
  if (password !== confirmPassword) {
    return "两次输入的密码不一致";
  }
  return null;
}

function toErrorMessage(error: unknown): string {
  if (error instanceof AuthApiError) {
    switch (error.code) {
      case "invalid_request":
        return "注册信息无效，请检查后重试";
      case "network_error":
        return "网络连接失败，请检查服务是否启动";
      default:
        return "注册失败，请稍后重试";
    }
  }
  return "网络连接失败，请检查服务是否启动";
}
