import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from "react";

import type { ChatSelfProfile, EditableSelfProfile } from "../types";
import { Avatar, Icon } from "./ui";
import { AvatarCropper } from "./AvatarCropper";
import {
  IMAGE_FILE_ACCEPT,
  MAX_NICKNAME_LENGTH,
  MAX_SIGNATURE_LENGTH,
  getUnsupportedImageError,
  validateProfileText,
} from "./profileEditorValidation";

interface ProfileEditorProps {
  self: ChatSelfProfile;
  onSave: (profile: EditableSelfProfile) => Promise<void>;
  onCancel: () => void;
}

export function ProfileEditor({ self, onSave, onCancel }: ProfileEditorProps) {
  const [nickname, setNickname] = useState(self.name);
  const [signature, setSignature] = useState(self.signature ?? "");
  const [avatarImageUrl, setAvatarImageUrl] = useState(self.avatarImageUrl ?? null);
  const [avatar, setAvatar] = useState<EditableSelfProfile["avatar"]>({ action: "keep" });
  const [pendingCropFile, setPendingCropFile] = useState<File | null>(null);
  const [nicknameError, setNicknameError] = useState("");
  const [signatureError, setSignatureError] = useState("");
  const [imageError, setImageError] = useState("");
  const [saveError, setSaveError] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const nicknameInputRef = useRef<HTMLInputElement | null>(null);
  const dialogRef = useRef<HTMLElement | null>(null);
  const ownedPreviewUrlRef = useRef<string | null>(null);

  useEffect(() => {
    nicknameInputRef.current?.focus();
    return () => {
      if (ownedPreviewUrlRef.current) {
        URL.revokeObjectURL(ownedPreviewUrlRef.current);
      }
    };
  }, []);

  const handleImageChange = (event: FormEvent<HTMLInputElement>) => {
    const input = event.currentTarget;
    const file = input.files?.[0];
    input.value = "";
    if (!file) {
      return;
    }

    const unsupportedImageError = getUnsupportedImageError(file);
    if (unsupportedImageError) {
      setImageError(unsupportedImageError);
      return;
    }

    setPendingCropFile(file);
    setImageError("");
    setSaveError("");
  };

  const handleCropConfirm = (file: File) => {
    if (ownedPreviewUrlRef.current) {
      URL.revokeObjectURL(ownedPreviewUrlRef.current);
    }
    const previewUrl = URL.createObjectURL(file);
    ownedPreviewUrlRef.current = previewUrl;
    setAvatar({ action: "replace", file });
    setAvatarImageUrl(previewUrl);
    setPendingCropFile(null);
    setImageError("");
    setSaveError("");
  };

  const handleAvatarReset = () => {
    if (ownedPreviewUrlRef.current) {
      URL.revokeObjectURL(ownedPreviewUrlRef.current);
      ownedPreviewUrlRef.current = null;
    }
    setAvatar({ action: "remove" });
    setAvatarImageUrl(null);
    setPendingCropFile(null);
    setImageError("");
    setSaveError("");
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const normalizedNickname = nickname.trim();
    const { nicknameError: nextNicknameError, signatureError: nextSignatureError } = validateProfileText(nickname, signature);

    setNicknameError(nextNicknameError);
    setSignatureError(nextSignatureError);
    if (nextNicknameError || nextSignatureError || imageError) {
      return;
    }

    setIsSaving(true);
    setSaveError("");
    try {
      await onSave({
        name: normalizedNickname,
        signature,
        avatar,
      });
    } catch {
      setSaveError("资料保存失败，请稍后重试。");
      setIsSaving(false);
    }
  };

  const handleDialogKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (event.key === "Escape" && isSaving) {
      event.preventDefault();
      event.stopPropagation();
      return;
    }
    if (event.key !== "Tab") {
      return;
    }
    const focusable = Array.from(
      dialogRef.current?.querySelectorAll<HTMLElement>(
        "button:not([disabled]), input:not([disabled]), [href], [tabindex]:not([tabindex='-1'])",
      ) ?? [],
    ).filter((element) => {
      const style = window.getComputedStyle(element);
      return element.tabIndex >= 0 && style.display !== "none" && style.visibility !== "hidden";
    });
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (!first || !last) {
      return;
    }
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };

  const nicknameLength = Array.from(nickname.trim()).length;
  const signatureLength = Array.from(signature).length;

  return (
    <div
      className="auth-friend-dialog-backdrop auth-profile-editor-backdrop"
      onMouseDown={(event) => {
        if (!isSaving && !pendingCropFile && event.target === event.currentTarget) {
          onCancel();
        }
      }}
    >
      <section
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="auth-profile-editor-title"
        className="auth-friend-dialog auth-profile-editor"
        onKeyDown={handleDialogKeyDown}
      >
        <header className="auth-friend-dialog-head">
          <h2 id="auth-profile-editor-title">编辑资料</h2>
          <button className="auth-friend-dialog-close" type="button" aria-label="关闭编辑资料" onClick={onCancel} disabled={isSaving}>×</button>
        </header>

        <form onSubmit={handleSubmit} noValidate>
          <div className="auth-profile-editor-avatar-controls">
            <div className="auth-profile-editor-avatar-wrap">
              <Avatar
                avatar={self.avatar}
                tone={self.tone}
                imageUrl={avatarImageUrl}
                className="auth-profile-editor-avatar"
              />
              <button
                className="auth-profile-avatar-change"
                type="button"
                disabled={isSaving}
                aria-label="更换头像"
                title="更换头像"
                onClick={() => {
                  if (fileInputRef.current) {
                    fileInputRef.current.value = "";
                    fileInputRef.current.click();
                  }
                }}
              >
                <Icon name="camera" />
              </button>
              <input
                ref={fileInputRef}
                className="auth-profile-file-input"
                type="file"
                tabIndex={-1}
                disabled={isSaving}
                accept={IMAGE_FILE_ACCEPT}
                aria-label="选择头像图片"
                onChange={handleImageChange}
              />
            </div>
            <button
              className="auth-profile-avatar-reset"
              type="button"
              disabled={isSaving || avatar.action === "remove"}
              onClick={handleAvatarReset}
            >恢复默认头像</button>
          </div>
          {imageError ? <p id="auth-profile-image-error" className="auth-friend-dialog-error" role="alert">{imageError}</p> : null}

          <label className="auth-profile-editor-field">
            <span>昵称</span>
            <input
              ref={nicknameInputRef}
              type="text"
              value={nickname}
              aria-invalid={Boolean(nicknameError)}
              aria-describedby="auth-profile-nickname-count auth-profile-nickname-error"
              onChange={(event) => {
                setNickname(event.currentTarget.value);
                setNicknameError("");
                setSaveError("");
              }}
              disabled={isSaving}
            />
            <span id="auth-profile-nickname-count" className="auth-profile-editor-count">{nicknameLength}/{MAX_NICKNAME_LENGTH}</span>
          </label>
          {nicknameError ? <p id="auth-profile-nickname-error" className="auth-friend-dialog-error" role="alert">{nicknameError}</p> : <span id="auth-profile-nickname-error" className="auth-profile-editor-description" />}

          <label className="auth-profile-editor-field">
            <span>个签</span>
            <input
              type="text"
              value={signature}
              placeholder="编辑个签，展示我的独特态度"
              aria-invalid={Boolean(signatureError)}
              aria-describedby="auth-profile-signature-count auth-profile-signature-error"
              onChange={(event) => {
                setSignature(event.currentTarget.value);
                setSignatureError("");
                setSaveError("");
              }}
              disabled={isSaving}
            />
            <span id="auth-profile-signature-count" className="auth-profile-editor-count">{signatureLength}/{MAX_SIGNATURE_LENGTH}</span>
          </label>
          {signatureError ? <p id="auth-profile-signature-error" className="auth-friend-dialog-error" role="alert">{signatureError}</p> : <span id="auth-profile-signature-error" className="auth-profile-editor-description" />}
          {saveError ? <p className="auth-friend-dialog-error" role="alert">{saveError}</p> : null}

          <div className="auth-friend-dialog-actions">
            <button className="auth-friend-secondary" type="button" onClick={onCancel} disabled={isSaving}>取消</button>
            <button className="auth-friend-primary" type="submit" disabled={isSaving}>{isSaving ? "保存中..." : "保存"}</button>
          </div>
        </form>
      </section>
      {pendingCropFile ? (
        <AvatarCropper
          file={pendingCropFile}
          onCancel={() => setPendingCropFile(null)}
          onConfirm={handleCropConfirm}
        />
      ) : null}
    </div>
  );
}
