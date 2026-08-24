export const PRODUCT_IMAGE_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
] as const;

export const PRODUCT_VIDEO_TYPES = [
  "video/mp4",
  "video/webm",
] as const;

export const MAX_IMAGE_SIZE = 10 * 1024 * 1024; // 10 MB

export function validateImageMimeType(mimeType: string) {
  return PRODUCT_IMAGE_TYPES.includes(
    mimeType as (typeof PRODUCT_IMAGE_TYPES)[number],
  );
}

export function validateVideoMimeType(mimeType: string) {
  return PRODUCT_VIDEO_TYPES.includes(
    mimeType as (typeof PRODUCT_VIDEO_TYPES)[number],
  );
}

export function getExtensionFromMimeType(mimeType: string) {
  const extensions: Record<string, string> = {
    "image/jpeg": "jpg",
    "image/png": "png",
    "image/webp": "webp",
    "video/mp4": "mp4",
    "video/webm": "webm",
  };

  return extensions[mimeType];
}