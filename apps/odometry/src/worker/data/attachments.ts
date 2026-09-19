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
 * Files attached to a garage-owned row: receipts on a service record
 * (migration 0015), certificates on a renewal and the vehicle grant (0018).
 *
 * This is the only class where the database and the R2 bucket meet. The bytes
 * helpers in @portals/core/worker know nothing about garages; the garage
 * predicate is applied here, on every single statement, because D1 has no
 * row-level security and a missing filter is a cross-tenant data leak.
 *
 * One class configured per owner rather than three copies. The rules that are
 * invisible when broken -- prove the parent is in the caller's garage, sniff
 * the type, R2 before the row -- are exactly the ones a copy would drift on.
 */

/**
 * Where one kind of attachment lives. Every string here is a constant from
 * the frozen owners below, interpolated into SQL -- never a value from the
 * request.
 */
export interface AttachmentOwner {
  table: "service_attachments" | "renewal_attachments" | "vehicle_documents";
  parentTable: "service_records" | "renewals" | "vehicles";
  parentColumn: "service_record_id" | "renewal_id" | "vehicle_id";
  /** The path segment in the R2 key -- see attachmentKey(). */
  ownerKind: string;
  /** vehicle_documents only: the fixed `kind` every row of this owner carries. */
  kind?: "grant";
  /** Used in errors: "Service record not found". */
  parentLabel: string;
  max: number;
}

/**
 * Ten files on one service visit is already an unusual amount of paper. The
 * cap is not about storage -- it stops a runaway client loop turning one
 * record into thousands of objects nobody will ever open.
 */
export const MAX_ATTACHMENTS_PER_RECORD = 10;

export const SERVICE_RECEIPTS: AttachmentOwner = Object.freeze({
  table: "service_attachments",
  parentTable: "service_records",
  parentColumn: "service_record_id",
  ownerKind: "service",
  parentLabel: "Service record",
  max: MAX_ATTACHMENTS_PER_RECORD,
});

/** A cover note plus a policy schedule is the usual case; ten is headroom. */
export const RENEWAL_DOCUMENTS: AttachmentOwner = Object.freeze({
  table: "renewal_attachments",
  parentTable: "renewals",
  parentColumn: "renewal_id",
  ownerKind: "renewal",
  parentLabel: "Renewal",
  max: 10,
});

/** A grant is one PDF, or a couple of phone photos of it. */
export const VEHICLE_GRANT: AttachmentOwner = Object.freeze({
  table: "vehicle_documents",
  parentTable: "vehicles",
  parentColumn: "vehicle_id",
  ownerKind: "grant",
  kind: "grant",
  parentLabel: "Vehicle",
  max: 5,
});

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
  private readonly owner: AttachmentOwner;
  /**
   * `AND kind = ?` for an owner with a fixed kind. It always comes LAST in the
   * statement text, so its bind is always appended last -- parameters bind by
   * position, and a clause placed anywhere else would shift the garage id.
   */
  private readonly kindClause: string;
  private readonly kindBinds: string[];

  constructor(
    db: ConstructorParameters<typeof GarageScopedRepo>[0],
    raw: D1Database,
    scope: Scope,
    env: Env,
    owner: AttachmentOwner,
  ) {
    super(db, raw, scope);
    this.bucket = env.DOCS;
    this.owner = owner;
    this.kindClause = owner.kind ? " AND kind = ?" : "";
    this.kindBinds = owner.kind ? [owner.kind] : [];
  }

  /**
   * Spec 5.3, and the same shape as assertOwnedVehicle in base.ts: prove the
   * parent belongs to the caller's garage before touching anything that hangs
   * off it. NotFoundError rather than ForbiddenError -- a 403 would confirm
   * the parent exists in someone else's garage.
   */
  private async assertOwnedParent(parentId: string): Promise<void> {
    const row = await this.raw
      .prepare(`SELECT 1 FROM ${this.owner.parentTable} WHERE id = ? AND garage_id = ? LIMIT 1`)
      .bind(parentId, this.garageId)
      .first();
    if (!row) throw new NotFoundError(`${this.owner.parentLabel} not found`);
  }

  async listFor(parentId: string): Promise<AttachmentMeta[]> {
    await this.assertOwnedParent(parentId);
    const { table, parentColumn } = this.owner;
    const { results } = await this.raw
      .prepare(
        `SELECT id, filename, content_type, size_bytes, uploaded_at
           FROM ${table}
          WHERE ${parentColumn} = ? AND garage_id = ?${this.kindClause}
          ORDER BY uploaded_at, id`,
      )
      .bind(parentId, this.garageId, ...this.kindBinds)
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
    parentId: string,
    file: { bytes: ArrayBuffer; filename: string },
  ): Promise<AttachmentMeta> {
    await this.assertOwnedParent(parentId);
    const { table, parentColumn, ownerKind, parentLabel, max } = this.owner;

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
        `SELECT COUNT(*) AS n FROM ${table}
          WHERE ${parentColumn} = ? AND garage_id = ?${this.kindClause}`,
      )
      .bind(parentId, this.garageId, ...this.kindBinds)
      .first<{ n: number }>();
    if ((existing?.n ?? 0) >= max) {
      throw new ValidationError(`${parentLabel} can hold at most ${max} attachments`);
    }

    const id = crypto.randomUUID();
    const key = attachmentKey({
      tenantId: this.garageId,
      ownerKind,
      ownerId: parentId,
      id,
      contentType,
    });
    const uploadedAt = nowIso();

    // R2 FIRST, then the row. Getting this backwards is the worse failure:
    // a row whose object never arrived is a download that 404s forever, while
    // an object whose row never arrived is some wasted bytes nothing links to.
    await putAttachment(this.bucket, key, file.bytes, contentType);

    // `kind`, when present, is the LAST column, so its bind is appended last.
    const kindColumn = this.owner.kind ? ", kind" : "";
    const kindValue = this.owner.kind ? ", ?" : "";
    await this.raw
      .prepare(
        `INSERT INTO ${table}
           (id, garage_id, ${parentColumn}, r2_key, filename, content_type, size_bytes,
            uploaded_at, uploaded_by${kindColumn})
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?${kindValue})`,
      )
      .bind(
        id,
        this.garageId,
        parentId,
        key,
        file.filename,
        contentType,
        file.bytes.byteLength,
        uploadedAt,
        this.scope.userId,
        ...this.kindBinds,
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
           FROM ${this.owner.table}
          WHERE id = ? AND garage_id = ?${this.kindClause}`,
      )
      .bind(attachmentId, this.garageId, ...this.kindBinds)
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
      .prepare(
        `SELECT r2_key FROM ${this.owner.table}
          WHERE id = ? AND garage_id = ?${this.kindClause}`,
      )
      .bind(attachmentId, this.garageId, ...this.kindBinds)
      .first<{ r2_key: string }>();
    if (!row) throw new NotFoundError("Attachment not found");

    await this.raw
      .prepare(
        `DELETE FROM ${this.owner.table}
          WHERE id = ? AND garage_id = ?${this.kindClause}`,
      )
      .bind(attachmentId, this.garageId, ...this.kindBinds)
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
