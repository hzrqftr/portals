-- Documents for renewals and the vehicle grant (geran), plus the grant's
-- vehicle details. Spec 4.4, 4.6.
--
-- ===========================================================================
-- TWO MORE ATTACHMENT TABLES, NOT ONE POLYMORPHIC ONE
-- ===========================================================================
--
-- 0015's header already made this argument and it still holds: a genuine
-- foreign key per parent is what gives ON DELETE CASCADE, and it is what
-- packages/core/src/worker/backup.ts reads (PRAGMA foreign_key_list) to put
-- parents before children on restore. Both tables are column-for-column
-- service_attachments with a different parent, and the same content_type
-- CHECK -- keep all three in step with ALLOWED_ATTACHMENT_TYPES in
-- packages/core/src/worker/attachments.ts.
--
-- Bytes live in the R2 bucket `portals-docs`, which is NOT covered by the
-- nightly export or by D1 Time Travel. See docs/backups.md.
--
-- ===========================================================================
-- renewals.document_key STAYS, UNREAD
-- ===========================================================================
--
-- 0001 gave renewals one `document_key` column, the same shape as the
-- `invoice_key` that 0015 superseded, for the same reason: one renewal can
-- carry more than one file (a cover note and the policy schedule). It is NULL
-- in every row and is left in place rather than rebuilding the table and the
-- v_active_renewals view that reads it. Nothing reads or writes it; nothing
-- should start.

CREATE TABLE renewal_attachments (
  id            TEXT PRIMARY KEY,
  garage_id     TEXT NOT NULL REFERENCES garages(id) ON DELETE CASCADE,
  renewal_id    TEXT NOT NULL REFERENCES renewals(id) ON DELETE CASCADE,
  r2_key        TEXT NOT NULL,
  filename      TEXT NOT NULL,
  content_type  TEXT NOT NULL CHECK (content_type IN (
                  'application/pdf',
                  'image/jpeg',
                  'image/png',
                  'image/webp',
                  'image/heic'
                )),
  size_bytes    INTEGER NOT NULL CHECK (size_bytes > 0),
  uploaded_at   TEXT NOT NULL,
  uploaded_by   TEXT NOT NULL REFERENCES users(id)
);

CREATE INDEX idx_renewal_attach_parent ON renewal_attachments(renewal_id);
CREATE UNIQUE INDEX uq_renewal_attach_key ON renewal_attachments(r2_key);

-- `kind` is 'grant' only for now. It exists so a PUSPAKOM report or a loan
-- letter later widens a CHECK rather than inventing a fourth table. There is
-- no one-grant-per-vehicle constraint: a grant photographed on a phone is
-- routinely two files.
CREATE TABLE vehicle_documents (
  id            TEXT PRIMARY KEY,
  garage_id     TEXT NOT NULL REFERENCES garages(id) ON DELETE CASCADE,
  vehicle_id    TEXT NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
  kind          TEXT NOT NULL CHECK (kind IN ('grant')),
  r2_key        TEXT NOT NULL,
  filename      TEXT NOT NULL,
  content_type  TEXT NOT NULL CHECK (content_type IN (
                  'application/pdf',
                  'image/jpeg',
                  'image/png',
                  'image/webp',
                  'image/heic'
                )),
  size_bytes    INTEGER NOT NULL CHECK (size_bytes > 0),
  uploaded_at   TEXT NOT NULL,
  uploaded_by   TEXT NOT NULL REFERENCES users(id)
);

CREATE INDEX idx_vehicle_docs_parent ON vehicle_documents(vehicle_id, kind);
CREATE UNIQUE INDEX uq_vehicle_docs_key ON vehicle_documents(r2_key);

-- ===========================================================================
-- THE GRANT'S VEHICLE DETAILS -- AND ONLY THOSE
-- ===========================================================================
--
-- The chassis number is the existing `vin` column; it is not duplicated.
--
-- The grant also names the registered owner: name, IC number, address. Those
-- are DELIBERATELY NOT COLUMNS (owner decision, 2026-09-19). Every column is
-- serialised into the nightly backup JSON and the CSV export, and a garage is
-- shared -- any co-member would read them. They stay inside the PDF, behind
-- the garage-scoped download route and outside the backup file.
--
-- ADD COLUMN, not a rebuild: no view depends on the new columns and none has
-- to be dropped.
ALTER TABLE vehicles ADD COLUMN engine_no     TEXT;
ALTER TABLE vehicles ADD COLUMN registered_on TEXT;  -- YYYY-MM-DD
ALTER TABLE vehicles ADD COLUMN colour        TEXT;
