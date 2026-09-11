-- Migration number: 0017 	 2026-09-10T00:00:00.000Z

-- A free-text note on ONE line item.
--
-- A line item's only free text was brand and spec, both 60 chars and both
-- already meaning something specific, and service_records.notes belongs to the
-- whole visit so it cannot say which part a remark is about. The case that
-- forced this: a fuel filter billed at RM 76 where RM 28 of it was the O-ring.
-- Folded into one unit cost the total stays correct and the reason it is high
-- disappears.
--
-- Nullable, no default, no REFERENCES clause, so this is a plain ADD COLUMN.
-- service_items.line_total_cost is a VIRTUAL generated column, which ADD COLUMN
-- leaves alone -- only a rebuild would have to keep it out of the INSERT column
-- list. No view reads service_items.note either, so v_part_baseline and
-- v_maintenance_due are untouched.
ALTER TABLE service_items ADD COLUMN note TEXT;
