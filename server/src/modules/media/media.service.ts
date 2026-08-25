import { createHash, randomUUID } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import WebSocket from "ws";
import type { Prisma } from "../../generated/prisma/client.js";
import { env } from "../../config/env.js";
import { prisma } from "../../lib/prisma.js";
import { AdminApiError } from "../admin/admin.errors.js";

const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const MIME_EXTENSIONS = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
} as const;

let client: SupabaseClient | null = null;
let bucketReady: Promise<void> | null = null;

function storageClient() {
  if (!env.supabaseSecretKey) {
    throw new AdminApiError(503, "STORAGE_NOT_CONFIGURED", "Le stockage des images n'est pas configuré.");
  }
  client ??= createClient(env.supabaseUrl, env.supabaseSecretKey, {
    auth: { autoRefreshToken: false, persistSession: false },
    realtime: { transport: WebSocket as unknown as typeof globalThis.WebSocket },
  });
  return client;
}

function signatureValid(buffer: Buffer, mimeType: keyof typeof MIME_EXTENSIONS) {
  if (mimeType === "image/jpeg") return buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;
  if (mimeType === "image/png") return buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  return buffer.subarray(0, 4).toString("ascii") === "RIFF" && buffer.subarray(8, 12).toString("ascii") === "WEBP";
}

export function validateRoomTypeImage(buffer: Buffer, mimeType: string) {
  if (!(mimeType in MIME_EXTENSIONS)) {
    throw new AdminApiError(400, "INVALID_IMAGE_TYPE", "Choisissez une image JPEG, PNG ou WebP.");
  }
  if (buffer.length < 12 || buffer.length > MAX_IMAGE_BYTES) {
    throw new AdminApiError(400, "INVALID_IMAGE_SIZE", "L'image doit peser au maximum 5 Mo.");
  }
  if (!signatureValid(buffer, mimeType as keyof typeof MIME_EXTENSIONS)) {
    throw new AdminApiError(400, "INVALID_IMAGE_CONTENT", "Le contenu du fichier image est invalide.");
  }
  return mimeType as keyof typeof MIME_EXTENSIONS;
}

async function ensurePublicBucket() {
  if (bucketReady) return bucketReady;
  bucketReady = (async () => {
    const supabase = storageClient();
    const { data, error } = await supabase.storage.getBucket(env.supabaseStorageBucket);
    if (!error && data) {
      if (!data.public) throw new AdminApiError(503, "STORAGE_BUCKET_PRIVATE", `Le bucket ${env.supabaseStorageBucket} doit être public pour les images du catalogue.`);
      return;
    }
    const created = await supabase.storage.createBucket(env.supabaseStorageBucket, {
      public: true,
      fileSizeLimit: MAX_IMAGE_BYTES,
      allowedMimeTypes: Object.keys(MIME_EXTENSIONS),
    });
    if (created.error && !/already exists/i.test(created.error.message)) {
      throw new AdminApiError(503, "STORAGE_BUCKET_UNAVAILABLE", "Le bucket public des images n'a pas pu être préparé.");
    }
  })().catch((error) => {
    bucketReady = null;
    throw error;
  });
  return bucketReady;
}

export async function storeRoomTypeCover(propertyId: string, buffer: Buffer, mimeType: string) {
  const validatedMime = validateRoomTypeImage(buffer, mimeType);
  await ensurePublicBucket();
  const supabase = storageClient();
  const extension = MIME_EXTENSIONS[validatedMime];
  const objectKey = `properties/${propertyId}/room-types/${randomUUID()}.${extension}`;
  const uploaded = await supabase.storage.from(env.supabaseStorageBucket).upload(objectKey, buffer, {
    contentType: validatedMime,
    cacheControl: "31536000",
    upsert: false,
  });
  if (uploaded.error) throw new AdminApiError(502, "IMAGE_UPLOAD_FAILED", "L'image n'a pas pu être envoyée vers le stockage.");
  const { data: publicData } = supabase.storage.from(env.supabaseStorageBucket).getPublicUrl(objectKey);
  const checksumSha256 = createHash("sha256").update(buffer).digest("hex");
  try {
    const storedFile = await prisma.storedFile.create({
      data: {
        propertyId,
        kind: "ROOM_TYPE_COVER",
        visibility: "PUBLIC",
        bucket: env.supabaseStorageBucket,
        objectKey,
        publicUrl: publicData.publicUrl,
        mimeType: validatedMime,
        sizeBytes: buffer.length,
        checksumSha256,
        altText: "Image de couverture d'un type de chambre",
      },
    });
    return { storedFileId: storedFile.id, url: publicData.publicUrl, mimeType: validatedMime, sizeBytes: buffer.length };
  } catch (error) {
    await supabase.storage.from(env.supabaseStorageBucket).remove([objectKey]).catch(() => undefined);
    throw error;
  }
}

export async function attachRoomTypeCover(
  transaction: Prisma.TransactionClient,
  propertyId: string,
  roomTypeId: string,
  storedFileId: string | null,
) {
  if (!storedFileId) return;
  const file = await transaction.storedFile.findFirst({
    where: { id: storedFileId, propertyId, kind: "ROOM_TYPE_COVER", visibility: "PUBLIC", deletedAt: null },
  });
  if (!file) throw new AdminApiError(400, "INVALID_COVER_FILE", "L'image téléversée est introuvable.");
  await transaction.storedFile.updateMany({
    where: { propertyId, roomTypeId, kind: "ROOM_TYPE_COVER", deletedAt: null, id: { not: file.id } },
    data: { deletedAt: new Date() },
  });
  await transaction.storedFile.update({ where: { id: file.id }, data: { roomTypeId } });
}
