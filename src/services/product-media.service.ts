import crypto from "node:crypto";
import path from "node:path";
import { PutObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

import { env } from "../config/env";
import { r2Client } from "../config/r2";

type MediaType = "IMAGE" | "VIDEO";

const ALLOWED_MEDIA_TYPES: Record<string, MediaType> = {
  "image/jpeg": "IMAGE",
  "image/png": "IMAGE",
  "image/webp": "IMAGE",
  "image/avif": "IMAGE",

  "video/mp4": "VIDEO",
  "video/webm": "VIDEO",
  "video/quicktime": "VIDEO",
};

const MAX_IMAGE_SIZE = 10 * 1024 * 1024; // 10 MB
const MAX_VIDEO_SIZE = 100 * 1024 * 1024; // 100 MB

function cleanSlug(value: string): string {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function getSafeExtension(
  fileName: string,
  mediaType: MediaType,
): string {
  const extension = path.extname(fileName).toLowerCase();

  if (extension) {
    return extension;
  }

  return mediaType === "IMAGE" ? ".jpg" : ".mp4";
}

export async function createProductMediaUploadUrl(input: {
  slug: string;
  fileName: string;
  contentType: string;
  size: number;
}) {
  const mediaType = ALLOWED_MEDIA_TYPES[input.contentType];

  if (!mediaType) {
    throw new Error(
      "Unsupported file type. Allowed images: JPG, PNG, WEBP, AVIF. Allowed videos: MP4, WEBM, MOV.",
    );
  }

  if (!input.fileName?.trim()) {
    throw new Error("File name is required");
  }

  if (!Number.isFinite(input.size) || input.size <= 0) {
    throw new Error("Invalid file size");
  }

  const maxSize =
    mediaType === "IMAGE"
      ? MAX_IMAGE_SIZE
      : MAX_VIDEO_SIZE;

  if (input.size > maxSize) {
    throw new Error(
      `${mediaType === "IMAGE" ? "Image" : "Video"} size cannot exceed ${
        maxSize / (1024 * 1024)
      } MB`,
    );
  }

  const safeSlug = cleanSlug(input.slug);

  if (!safeSlug) {
    throw new Error("Valid product slug is required");
  }

  const extension = getSafeExtension(
    input.fileName,
    mediaType,
  );

  const fileId = crypto.randomUUID();

  const key = `products/${safeSlug}/${fileId}${extension}`;

  const command = new PutObjectCommand({
    Bucket: env.R2_BUCKET_NAME,
    Key: key,
    ContentType: input.contentType,
  });

  const uploadUrl = await getSignedUrl(
    r2Client,
    command,
    {
      expiresIn: 10 * 60,
    },
  );

  const publicBaseUrl =
    env.R2_PUBLIC_BASE_URL.replace(/\/+$/, "");

  const publicUrl = `${publicBaseUrl}/${key
    .split("/")
    .map(encodeURIComponent)
    .join("/")}`;

  return {
    uploadUrl,
    key,
    url: publicUrl,
    type: mediaType,
    mimeType: input.contentType,
    size: input.size,
  };
}