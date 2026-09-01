import {
  DeleteObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
} from "@aws-sdk/client-s3";

import { r2Client } from "../config/r2";
import { env } from "../config/env";

export function getPublicMediaUrl(key: string): string {
  const baseUrl = env.R2_PUBLIC_BASE_URL.replace(/\/+$/, "");

  return `${baseUrl}/${key
    .split("/")
    .map(encodeURIComponent)
    .join("/")}`;
}

export async function uploadToR2(
  key: string,
  body: Buffer,
  contentType: string,
) {
  await r2Client.send(
    new PutObjectCommand({
      Bucket: env.R2_BUCKET_NAME,
      Key: key,
      Body: body,
      ContentType: contentType,
    }),
  );

  return {
    key,
    url: getPublicMediaUrl(key),
  };
}

export async function deleteFromR2(key: string) {
  await r2Client.send(
    new DeleteObjectCommand({
      Bucket: env.R2_BUCKET_NAME,
      Key: key,
    }),
  );
}

export async function r2ObjectExists(key: string) {
  try {
    await r2Client.send(
      new HeadObjectCommand({
        Bucket: env.R2_BUCKET_NAME,
        Key: key,
      }),
    );

    return true;
  } catch {
    return false;
  }
}