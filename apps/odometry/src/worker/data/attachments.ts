import {
  NotFoundError,
  PayloadTooLargeError,
  ValidationError,
  MAX_ATTACHMENT_BYTES,
  attachmentKey,
  deleteAttachments,
  getAttachment,
  putAttachment,
  sniffAttachmentType,
} from "@portals/core/worker";
import { nowIso } from "@portals/core";
import { GarageScopedRepo } from "./base";
import type { Env, Scope } from "../types";

/**
 * Receipts attached to a service record (migration 0015).
 *
 * This is the only class where the database and the R2 bucket meet. The bytes
 * helpers in @portals/core/worker know nothing about garages; the garage
 * predicate is applied here, on every single statement, because D1 has no
 * row-level security and a missing filter is a cross-tenant data leak.
 */

/**
 * Ten files on one service visit is already an unusual amount of paper. The
 * cap is not about storage -- it stops a runaway client loop turning one
 * record into thousands of objects nobody will ever open.
 */
export const MAX_ATTACHMENTS_PER_RECORD = 10;

export interface AttachmentMeta {
  id: string;
  filename: string;
  contentType: string;
  sizeBytes: number;
  uploadedAt: string;
}

interface AttachmentRow {
  id: string;
  filename: string;
  content_type: string;
  size_bytes: number;
  uploaded_at: string;
}

export class AttachmentRepo extends GarageScopedRepo {
  private readonly bucket: R2Bucket;

  constructor(db: ConstructorParameters<typeof GarageScopedRepo>[0], raw: D1Database, scope: Scope, env: Env) {
    super(db, raw, scope);
    this.bucket = env.DOCS;
  }

  /**
   * Spec 5.3, and the same shape as assertOwnedVehicle in base.ts: prove the
   * parent belongs to the caller's garage before touching anything that hangs
   * off it. NotFoundError rather than ForbiddenError -- a 403 would confirm
   * the record exists in someone else's garage.
   */
  private async assertOwnedRecord(serviceRecordId: string): Promise<void> {
    const row = await this.raw
      .prepare(`SELECT 1 FROM service_records WHERE id = ? AND garage_id = ? LIMIT 1`)
      .bind(serviceRecordId, this.garageId)
      .first();
    if (!row) throw new NotFoundError("Service record not found");
  }

  async listFor(serviceRecordId: string): Promise<AttachmentMeta[]> {
    await this.assertOwnedRecord(serviceRecordId);
    const { results } = await this.raw
      .prepare(
        `SELECT id, filename, content_type, size_bytes, uploaded_at
           FROM service_attachments
          WHERE service_record_id = ? AND garage_id = ?
          ORDER BY uploaded_at, id`,
      )
      .bind(serviceRecordId, this.garageId)
      .all<AttachmentRow>();
    return results.map(shape);
  }

  /**
   * Store one file and record it.
   *
   * The declared content type is not a parameter on purpose. Whatever the
   * browser said is unverified network input; the type that gets stored is the
   * one read out of the file's own leading bytes.
   */
  async create(
    serviceRecordId: string,
    file: { bytes: ArrayBuffer; filename: string },
  ): Promise<AttachmentMeta> {
    await this.assertOwnedRecord(serviceRecordId);

    if (file.bytes.byteLength === 0) throw new ValidationError("File is empty");
    if (file.bytes.byteLength > MAX_ATTACHMENT_BYTES) {
      throw new PayloadTooLargeError(
        `File is larger than ${Math.floor(MAX_ATTACHMENT_BYTES / (1024 * 1024))} MB`,
      );
    }

    const contentType = sniffAttachmentType(new Uint8Array(file.bytes.slice(0, 32)));
    if (!contentType) {
      throw new ValidationError("Only PDF, JPEG, PNG, WebP and HEIC files can be attached");
    }

    const existing = await this.raw
      .prepare(
        `SELECT COUNT(*) AS n FROM service_attachments
          WHERE service_record_id = ? AND garage_id = ?`,
      )
      .bind(serviceRecordId, this.garageId)
      .first<{ n: number }>();
    if ((existing?.n ?? 0) >= MAX_ATTACHMENTS_PER_RECORD) {
      throw new ValidationError(
        `A service record can hold at most ${MAX_ATTACHMENTS_PER_RECORD} attachments`,
      );
    }

    const id = crypto.randomUUID();
    const key = attachmentKey({
      tenantId: this.garageId,
      ownerKind: "service",
      ownerId: serviceRecordId,
      id,
      contentType,
    });
    const uploadedAt = nowIso();

    // R2 FIRST, then the row. Getting this backwards is the worse failure:
    // a row whose object never arrived is a download that 404s forever, while
    // an object whose row never arrived is some wasted bytes nothing links to.
    await putAttachment(this.bucket, key, file.bytes, contentType);

    await this.raw
      .prepare(
        `INSERT INTO service_attachments
           (id, garage_id, service_record_id, r2_key, filename, content_type, size_bytes,
            uploaded_at, uploaded_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        id,
        this.garageId,
        serviceRecordId,
        key,
        file.filename,
        contentType,
        file.bytes.byteLength,
        uploadedAt,
        this.scope.userId,
      )
      .run();

    return {
      id,
      filename: file.filename,
      contentType,
      sizeBytes: file.bytes.byteLength,
      uploadedAt,
    };
  }

  /** The bytes, for the download route. Garage-scoped like every other read. */
  async open(
    attachmentId: string,
  ): Promise<{ body: ReadableStream; contentType: string; filename: string }> {
    const row = await this.raw
      .prepare(
        `SELECT r2_key, content_type, filename
           FROM service_attachments
          WHERE id = ? AND garage_id = ?`,
      )
      .bind(attachmentId, this.garageId)
      .first<{ r2_key: string; content_type: string; filename: string }>();
    if (!row) throw new NotFoundError("Attachment not found");

    const object = await getAttachment(this.bucket, row.r2_key);
    // The row says the object exists and the bucket disagrees. Possible after a
    // database restore to a point before the object was deleted, which is
    // exactly the drift documented in docs/backups.md.
    if (!object) throw new NotFoundError("Attachment file is missing");

    return { body: object.body, contentType: row.content_type, filename: row.filename };
  }

  async remove(attachmentId: string): Promise<void> {
    const row = await this.raw
      .prepare(`SELECT r2_key FROM service_attachments WHERE id = ? AND garage_id = ?`)
      .bind(attachmentId, this.garageId)
      .first<{ r2_key: string }>();
    if (!row) throw new NotFoundError("Attachment not found");

    await this.raw
      .prepare(`DELETE FROM service_attachments WHERE id = ? AND garage_id = ?`)
      .bind(attachmentId, this.garageId)
      .run();
    await deleteAttachments(this.bucket, [row.r2_key]);
  }

}

function shape(row: AttachmentRow): AttachmentMeta {
  return {
    id: row.id,
    filename: row.filename,
    contentType: row.content_type,
    sizeBytes: row.size_bytes,
    uploadedAt: row.uploaded_at,
  };
}
