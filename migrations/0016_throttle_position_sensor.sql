-- Migration number: 0016 	 2026-09-10T00:00:00.000Z

-- A throttle position sensor is the first genuinely un-loggable part to turn up
-- on a real receipt: nothing in the 61-row catalogue is a sensor, so RM 145 of a
-- RM 424 bill had nowhere to go but the labour field, where a replaced component
-- leaves no trace in parts history at all.
--
-- Global (garage_id NULL) rather than a garage's own custom row, because every
-- fuel-injected vehicle in either catalogue has one.
--
-- 'electrical' is already a valid value in the part_types.category CHECK, so
-- this is a plain INSERT -- no table rebuild, and therefore none of the
-- drop-and-recreate of v_part_baseline and v_maintenance_due that migrations
-- 0007 and 0008 needed.
INSERT INTO part_types (id, garage_id, code, name, category) VALUES
  ('pt_tps', NULL, 'tps', 'Throttle position sensor', 'electrical');

-- Both rows are mandatory, not thorough: PartTypeRepo.list INNER JOINs
-- part_type_defaults, so a part type with no row for a vehicle type is invisible
-- to it -- which looks exactly like the insert having silently failed.
--
-- NULL intervals with seed_by_default 0: a sensor is replaced when it fails, not
-- on a schedule. The two stay distinct on purpose (invariant 6) -- "not seeded"
-- must not be re-encoded as "no interval", or the part has no figure to offer on
-- the day the owner does start tracking it. Precedent: pt_coil_spring.
INSERT INTO part_type_defaults
  (part_type_id, vehicle_type, interval_km, interval_months, applies_to_fuel, seed_by_default)
VALUES
  ('pt_tps', 'car',        NULL, NULL, 'petrol,diesel,hybrid', 0),
  ('pt_tps', 'motorcycle', NULL, NULL, 'petrol,diesel,hybrid', 0);
