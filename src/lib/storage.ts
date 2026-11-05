import "server-only";
import fs from "node:fs/promises";
import path from "node:path";
import { GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";

/**
 * File storage. STORAGE_DRIVER=local (dev: ./storage folder) or s3
 * (AWS S3 Mumbai / Cloudflare R2 via S3_ENDPOINT). Keys starting with
 * "public/" may be served without login (logo on public offer pages);
 * everything else requires a logged-in user.
 */
const LOCAL_ROOT = path.join(process.cwd(), "storage");

function s3() {
  return new S3Client({
    region: process.env.S3_REGION || "ap-south-1",
    endpoint: process.env.S3_ENDPOINT || undefined,
    forcePathStyle: !!process.env.S3_ENDPOINT,
    credentials: { accessKeyId: process.env.S3_ACCESS_KEY_ID ?? "", secretAccessKey: process.env.S3_SECRET_ACCESS_KEY ?? "" },
  });
}

export function isSafeKey(key: string): boolean {
  return /^(public|private)\/[A-Za-z0-9/_.-]+$/.test(key) && !key.includes("..");
}

export async function putFile(key: string, body: Buffer, contentType: string): Promise<void> {
  if (!isSafeKey(key)) throw new Error("Invalid storage key");
  if (process.env.STORAGE_DRIVER === "s3") {
    await s3().send(new PutObjectCommand({ Bucket: process.env.S3_BUCKET, Key: key, Body: body, ContentType: contentType }));
    return;
  }
  const file = path.join(LOCAL_ROOT, key);
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, body);
}

export async function getFile(key: string): Promise<Buffer | null> {
  if (!isSafeKey(key)) return null;
  try {
    if (process.env.STORAGE_DRIVER === "s3") {
      const res = await s3().send(new GetObjectCommand({ Bucket: process.env.S3_BUCKET, Key: key }));
      return Buffer.from(await res.Body!.transformToByteArray());
    }
    return await fs.readFile(path.join(LOCAL_ROOT, key));
  } catch {
    return null;
  }
}

export function fileUrl(key: string | null | undefined): string | null {
  return key ? `/api/files/${key}` : null;
}

const MIME: Record<string, string> = { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", webp: "image/webp", pdf: "application/pdf" };
export function mimeFor(key: string): string {
  return MIME[key.split(".").pop()?.toLowerCase() ?? ""] ?? "application/octet-stream";
}

export { sniffImage } from "./file-types";
