-- Migration 0019: what the manufacturer recommends, beside the owner's schedule.
--
-- The schedule itself is unchanged: maintenance_intervals, one row per vehicle
-- and part, read by v_maintenance_due. This table is a REFERENCE. No view reads
-- it and nothing computes a due point from it; it exists so the schedule page
-- can show "maker says 40,000 km" next to the owner's 50,000 and flag the gap.
--
-- A separate table rather than two columns on maintenance_intervals, because
-- that table's CHECK requires an interval of the owner's. A part the owner does
-- not track can still have a known maker figure, and relaxing the CHECK would
-- mean a 12-step rebuild of a table two views depend on.
--
-- Starts empty and is never seeded from part_type_defaults. The defaults are
-- generic figures, not any manufacturer's, and a delta against an invented
-- maker number is worse than no delta at all.
CREATE TABLE maker_intervals (
  garage_id       TEXT NOT NULL REFERENCES garages(id) ON DELETE CASCADE,
  vehicle_id      TEXT NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
  part_type_id    TEXT NOT NULL REFERENCES part_types(id),
  interval_km     INTEGER CHECK (interval_km > 0),
  interval_months INTEGER CHECK (interval_months > 0),
  PRIMARY KEY (vehicle_id, part_type_id),
  CHECK (interval_km IS NOT NULL OR interval_months IS NOT NULL)
);

CREATE INDEX idx_maker_intervals_garage ON maker_intervals(garage_id);
