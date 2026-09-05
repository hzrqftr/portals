-- Link a service record to the odometer reading it wrote, so the visit can be
-- corrected afterwards.
--
-- ===========================================================================
-- THE PROBLEM THIS SOLVES
-- ===========================================================================
--
-- Logging a service writes the odometer in THREE places:
--
--   1. service_records.odometer_km          -- the visit's own copy
--   2. an odometer_readings row, source='service'
--   3. the cached vehicles.current_odometer_km
--
-- Until now nothing connected (1) to (2). A correction could therefore update
-- the service and leave the reading behind asserting the original figure --
-- and since v_maintenance_due derives every due point from the service
-- odometer (invariant 6) while the dashboard reads the cache, the three could
-- disagree with nothing on screen able to say which was right.
--
-- That is why `servicePatch` omitted odometerKm and servicedOn: the field was
-- closed rather than allowed to be wrong. This column is what opens it.
--
-- Shaped after fuel_fills.odometer_reading_id (migration 0013), which points
-- at its reading for the same reason. The difference -- service_records keeps
-- its own odometer_km copy as well -- is pre-existing and deliberate; this
-- column is what lets the two copies be kept in step rather than merely hoped
-- to agree.
--
-- ===========================================================================
-- WHY ADD COLUMN AND NOT A TABLE REBUILD
-- ===========================================================================
--
-- v_maintenance_due and v_part_baseline both read service_records. ALTER TABLE
-- ADD COLUMN does not rebuild the table, so unlike migrations 0007 and 0008
-- there are no dependent views to drop and recreate here.
--
-- Nullable with no default is not a style choice either: SQLite refuses to add
-- a column carrying a REFERENCES clause unless its default is NULL, and
-- foreign keys are on.

ALTER TABLE service_records ADD COLUMN odometer_reading_id TEXT
  REFERENCES odometer_readings(id);

-- Best-effort backfill for services logged before this column existed. It
-- matches on everything the create path wrote, which identifies the reading
-- uniquely except where two services on ONE vehicle share a day AND an
-- odometer -- in which case either row is equally correct.
--
-- A service left NULL here is handled at runtime: the update path writes a
-- fresh reading and adopts it rather than failing.
UPDATE service_records SET odometer_reading_id = (
  SELECT r.id
    FROM odometer_readings r
   WHERE r.vehicle_id  = service_records.vehicle_id
     AND r.garage_id   = service_records.garage_id
     AND r.recorded_on = service_records.serviced_on
     AND r.reading_km  = service_records.odometer_km
     AND r.source      = 'service'
   LIMIT 1
);
