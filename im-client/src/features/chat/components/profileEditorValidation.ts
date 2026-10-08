const ACCEPTED_IMAGE_EXTENSIONS = new Set(["png", "jpg", "jpeg", "webp", "bmp"]);

export const MAX_NICKNAME_LENGTH = 15;
export const MAX_SIGNATURE_LENGTH = 80;
export const IMAGE_FILE_ACCEPT = ".png,.jpg,.jpeg,.webp,.bmp,image/png,image/jpeg,image/webp,image/bmp";

export interface ProfileTextErrors {
  nicknameError: string;
  signatureError: string;
}

export function validateProfileText(nickname: string, signature: string): ProfileTextErrors {
  const normalizedNickname = nickname.trim();
  const nicknameLength = Array.from(normalizedNickname).length;
  const signatureLength = Array.from(signature).length;
  return {
    nicknameError: nicknameLength === 0
      ? "请输入昵称。"
      : nicknameLength > MAX_NICKNAME_LENGTH
        ? `昵称不能超过 ${MAX_NICKNAME_LENGTH} 个字符。`
        : "",
    signatureError: signatureLength > MAX_SIGNATURE_LENGTH
      ? `个签不能超过 ${MAX_SIGNATURE_LENGTH} 个字符。`
      : "",
  };
}

export function getUnsupportedImageError(file: File): string | null {
  const extension = file.name.split(".").pop()?.toLowerCase();
  return extension && ACCEPTED_IMAGE_EXTENSIONS.has(extension)
    ? null
    : "请选择 PNG、JPG、WebP 或 BMP 图片。";
}
