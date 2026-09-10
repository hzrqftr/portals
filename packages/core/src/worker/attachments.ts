/**
 * File attachments: the bytes half. Portal-agnostic on purpose.
 *
 * This module knows about MIME types, size limits and R2 object keys. It knows
 * nothing about garages or ledgers, and it must stay that way -- Odometry
 * scopes on garage_id and Coinbox on ledger_id, and the whole point of
 * BaseScopedRepo taking its predicate as an abstract method is that neither
 * portal can inherit the other's answer. Ownership is decided by the caller's
 * repository, which is already scoped; this file just moves bytes.
 *
 * Shaped like backup.ts: it takes the bucket as a plain parameter rather than
 * importing an app's Env. A binding only one portal has must not widen CoreEnv
 * (see types.ts).
 *
 * Note it does NOT import drizzle-orm/d1. scripts/check-db-imports.mjs pins
 * that import to repo.ts alone, and nothing here needs a database.
 */

/**
 * 10 MB. A phone-scanned PDF invoice is well under 1 MB and a photo of a
 * receipt is a few MB, so this is generous rather than tight. The Workers
 * request body limit is far higher; this cap exists to keep one mis-selected
 * video out of R2, not to fight the platform.
 */
export const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;

/** Kept in step with the CHECK constraint in migrations/0015. */
export const ALLOWED_ATTACHMENT_TYPES = [
  "application/pdf",
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/heic",
] as const;

export type AttachmentType = (typeof ALLOWED_ATTACHMENT_TYPES)[number];

const EXTENSIONS: Record<AttachmentType, string> = {
  "application/pdf": "pdf",
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/heic": "heic",
};

/** ASCII helper: do the bytes at `at` spell `text`? */
function matches(bytes: Uint8Array, at: number, text: string): boolean {
  if (bytes.length < at + text.length) return false;
  for (let i = 0; i < text.length; i++) {
    if (bytes[at + i] !== text.charCodeAt(i)) return false;
  }
  return true;
}

/**
 * The real type of a file, read from its own leading bytes, or null if it is
 * not something we accept.
 *
 * THIS IS A SECURITY CONTROL, NOT A CONVENIENCE. The Worker serves the SPA and
 * the API from a single origin. A file uploaded with a declared content-type of
 * image/png whose bytes are actually markup, and then served back from
 * /api/attachments/:id/content, runs as script on the portal's own origin with
 * the caller's Access session. The client's declared type is an unverified
 * string from the network and must never be stored or echoed as fact.
 *
 * Defence in depth, in order: this sniff, then the CHECK constraint in
 * migration 0015, then `nosniff` plus an explicit content-type on the download.
 */
export function sniffAttachmentType(bytes: Uint8Array): AttachmentType | null {
  // "%PDF-"
  if (matches(bytes, 0, "%PDF-")) return "application/pdf";

  // JPEG: SOI marker FF D8, then the start of any segment marker FF.
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return "image/jpeg";
  }

  // PNG: the 8-byte signature, including the CRLF pair that detects a file
  // mangled by a text-mode transfer.
  const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (bytes.length >= PNG.length && PNG.every((b, i) => bytes[i] === b)) {
    return "image/png";
  }

  // RIFF container: bytes 4..7 are the length, so the format tag is at 8.
  if (matches(bytes, 0, "RIFF") && matches(bytes, 8, "WEBP")) return "image/webp";

  // ISO base media (HEIF). The brand at offset 8 says which flavour; iPhone
  // photos are heic/heix, and mif1/msf1 turn up on some Android scanners.
  if (matches(bytes, 4, "ftyp")) {
    for (const brand of ["heic", "heix", "hevc", "hevx", "heim", "heis", "mif1", "msf1"]) {
      if (matches(bytes, 8, brand)) return "image/heic";
    }
  }

  return null;
}

/**
 * Where an object lives in the bucket.
 *
 * The tenant id leads the path so a mis-scoped listing is obvious rather than
 * subtle, and so a future per-tenant lifecycle rule or export has a prefix to
 * work with. `ownerKind` keeps service receipts from colliding with whatever
 * attaches to renewals or Coinbox transactions later, in one shared bucket.
 *
 * The id is a UUID, so nothing here depends on the uploaded filename -- a name
 * from the client must never reach a path.
 */
export function attachmentKey(parts: {
  tenantId: string;
  ownerKind: string;
  ownerId: string;
  id: string;
  contentType: AttachmentType;
}): string {
  const { tenantId, ownerKind, ownerId, id, contentType } = parts;
  return `${tenantId}/${ownerKind}/${ownerId}/${id}.${EXTENSIONS[contentType]}`;
}

export async function putAttachment(
  bucket: R2Bucket,
  key: string,
  body: ArrayBuffer,
  contentType: AttachmentType,
): Promise<void> {
  await bucket.put(key, body, { httpMetadata: { contentType } });
}

export async function getAttachment(bucket: R2Bucket, key: string): Promise<R2ObjectBody | null> {
  return await bucket.get(key);
}

/**
 * Best-effort cleanup. R2 delete is idempotent, so removing a key that is
 * already gone is not an error -- which matters because the row is deleted
 * first and a retry must not fail on the second pass.
 */
export async function deleteAttachments(bucket: R2Bucket, keys: string[]): Promise<void> {
  if (keys.length === 0) return;
  await bucket.delete(keys);
}
