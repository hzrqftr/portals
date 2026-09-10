-- Receipts and invoices attached to a service record. Spec 4.5, Phase 4.
--
-- ===========================================================================
-- WHY A TABLE AND NOT service_records.invoice_key
-- ===========================================================================
--
-- 0001_init.sql shipped `service_records.invoice_key TEXT`, described in the
-- spec as "R2 object key, Phase 4". It holds one key. One workshop visit
-- routinely produces more than one piece of paper -- an invoice from the
-- workshop and a separate receipt for parts bought elsewhere -- and a phone
-- scanning a two-page invoice hands you two files, not one.
--
-- `invoice_key` is therefore superseded, and is DELIBERATELY LEFT IN PLACE.
-- Removing a column in SQLite means rebuilding the table, and a rebuild here
-- means dropping and recreating v_maintenance_due and v_part_baseline (the
-- pattern migrations 0007 and 0008 follow). That is a real risk to the
-- maintenance clock in exchange for deleting one column that is NULL in every
-- row. Nothing reads or writes it; nothing should start.
--
-- ===========================================================================
-- WHY A GENUINE FOREIGN KEY AND NOT A POLYMORPHIC owner_type/owner_id
-- ===========================================================================
--
-- A polymorphic attachments table serving service records, renewals and
-- whatever comes next is one table instead of two. It is also a column SQLite
-- cannot put a foreign key on, and this schema leans on foreign keys hard:
--
--   * ON DELETE CASCADE is what stops a deleted service record leaving rows
--     behind. Without it, every delete path has to remember to clean up by
--     hand, and the failure is invisible -- orphan rows nothing displays.
--   * packages/core/src/worker/backup.ts derives its parents-first insert
--     order from PRAGMA foreign_key_list. A table with no declared parent
--     sorts arbitrarily and the nightly restore breaks on a constraint error
--     that reads like bad data.
--
-- Renewals already have their own unused `document_key` column. When document
-- storage is wanted there, it gets its own table with its own foreign key
-- rather than widening this one.
--
-- ===========================================================================
-- WHAT IS NOT STORED HERE
-- ===========================================================================
--
-- The file itself. Bytes live in R2 (bucket `portals-docs`), and this row
-- holds the key that finds them. Two reasons, both load-bearing:
--
--   * D1 rows have a size limit and the nightly backup serialises the entire
--     database to one JSON object in R2. Receipt bytes in D1 would be dumped
--     and re-uploaded every night for the 90-day retention window.
--   * The backup encodes column values with JSON.stringify. A BLOB comes back
--     from D1 as an ArrayBuffer, which stringifies to `{}` -- so a blob column
--     would corrupt the dump silently and fail the restore. Keys are TEXT and
--     round-trip exactly.
--
-- The consequence is worth writing down: R2 OBJECTS ARE NOT COVERED BY THE
-- NIGHTLY EXPORT OR BY D1 TIME TRAVEL. Restoring the database to an older
-- state can leave rows pointing at deleted objects, and objects nothing
-- references. Nothing reconciles the two. See docs/backups.md.
--
-- ===========================================================================
-- content_type IS CONSTRAINED, AND IS NOT WHAT THE BROWSER SAID
-- ===========================================================================
--
-- The value stored here is the type derived from the file's own leading bytes
-- at upload, not the type the client declared. The Worker serves the SPA and
-- the API from one origin, so a file uploaded as image/png that actually holds
-- markup, then served back, executes on the portal's own origin. The CHECK is
-- the last line of that defence, not the first -- see
-- packages/core/src/worker/attachments.ts.

CREATE TABLE service_attachments (
  id                TEXT PRIMARY KEY,
  garage_id         TEXT NOT NULL REFERENCES garages(id) ON DELETE CASCADE,
  service_record_id TEXT NOT NULL REFERENCES service_records(id) ON DELETE CASCADE,
  r2_key            TEXT NOT NULL,
  filename          TEXT NOT NULL,
  content_type      TEXT NOT NULL CHECK (content_type IN (
                      'application/pdf',
                      'image/jpeg',
                      'image/png',
                      'image/webp',
                      'image/heic'
                    )),
  size_bytes        INTEGER NOT NULL CHECK (size_bytes > 0),
  uploaded_at       TEXT NOT NULL,
  uploaded_by       TEXT NOT NULL REFERENCES users(id)
);

-- The only access path: every attachment of one service record.
CREATE INDEX idx_attach_record ON service_attachments(service_record_id);

-- An object key must identify exactly one row, or deleting one attachment
-- would remove the bytes out from under another. Not partial: r2_key is
-- NOT NULL, so a plain UNIQUE constrains every row here.
CREATE UNIQUE INDEX uq_attach_key ON service_attachments(r2_key);
