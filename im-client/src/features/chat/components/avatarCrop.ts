export const AVATAR_CROP_VIEWPORT_SIZE = 280;
const MAX_AVATAR_OUTPUT_SIZE = 1024;

export interface AvatarCropTransform {
  imageWidth: number;
  imageHeight: number;
  zoom: number;
  panX: number;
  panY: number;
}

export interface AvatarCropRect {
  x: number;
  y: number;
  size: number;
}

export function getAvatarCropRect(transform: AvatarCropTransform): AvatarCropRect {
  const { imageWidth, imageHeight, zoom, panX, panY } = transform;
  const scale = Math.max(
    AVATAR_CROP_VIEWPORT_SIZE / imageWidth,
    AVATAR_CROP_VIEWPORT_SIZE / imageHeight,
  ) * zoom;
  const size = Math.min(imageWidth, imageHeight, AVATAR_CROP_VIEWPORT_SIZE / scale);
  const x = Math.max(0, Math.min(imageWidth - size, (imageWidth - size) / 2 - panX / scale));
  const y = Math.max(0, Math.min(imageHeight - size, (imageHeight - size) / 2 - panY / scale));
  return { x, y, size };
}

export async function exportAvatarCrop(image: HTMLImageElement, transform: AvatarCropTransform): Promise<File> {
  const rect = getAvatarCropRect(transform);
  const outputSize = Math.max(1, Math.min(MAX_AVATAR_OUTPUT_SIZE, Math.round(rect.size)));
  const canvas = document.createElement("canvas");
  canvas.width = outputSize;
  canvas.height = outputSize;
  const context = canvas.getContext("2d");
  if (!context) {
    throw new Error("avatar_crop_unavailable");
  }
  context.drawImage(image, rect.x, rect.y, rect.size, rect.size, 0, 0, outputSize, outputSize);
  const blob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((result) => result ? resolve(result) : reject(new Error("avatar_crop_failed")), "image/png");
  });
  return new File([blob], "avatar.png", { type: "image/png" });
}
