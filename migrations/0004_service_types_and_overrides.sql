-- Configurable service scheduling. Adds:
--   * a service type label on the record (minor / major / ...)
--   * per-service interval OVERRIDES on the line item
--   * garage-level service templates that pre-fill the parts list
--   * two former hard-coded constants promoted to user settings
--   * a "Timing chain" part type, so a chain is nameable rather than being
--     approximated by editing "Timing belt"
--
-- ON THE OVERRIDES AND INVARIANT 6
--
-- CLAUDE.md invariant 6 forbids storing a due date or a "next service
-- mileage". These columns do not store one. They store an INTERVAL -- "this
-- part is next due N km from THIS service" -- and the due point is still
-- computed as baseline + interval, everywhere, by v_maintenance_due below.
--
-- The practical difference: correcting a service's odometer from 135,000 to
-- 134,500 moves the derived due point with it. A stored due point would not
-- move, and would be silently wrong from then on.
--
-- They live on service_items rather than service_records because the baseline
-- lives on the item (invariant 7). That gives the right lifetime for free: an
-- override applies to exactly the next due point and is superseded the moment
-- that part is serviced again. A "major" service covering engine oil (10,000
-- km) and air filter (20,000 km) also cannot be described by one record-level
-- number, which is the other reason this is not on the record.

-- --- 1. Service type -------------------------------------------------------
-- Nullable: every existing row predates the column and must stay valid.
-- The type is a LABEL and a template trigger. It resets no maintenance clock
-- on its own -- only service_items do (invariant 7).
ALTER TABLE service_records ADD COLUMN service_type TEXT
  CHECK (service_type IS NULL OR
         service_type IN ('minor','major','repair','inspection','other'));

-- --- 2. Interval overrides -------------------------------------------------
ALTER TABLE service_items ADD COLUMN interval_km_override     INTEGER;
ALTER TABLE service_items ADD COLUMN interval_months_override INTEGER;

-- --- 3. Service templates --------------------------------------------------
-- vehicle_id NULL = applies to every vehicle in the garage, mirroring the
-- part_types.garage_id NULL convention already used in this schema. Only the
-- NULL (garage-wide) rows are written by the app today; the column exists so
-- per-vehicle templates need no migration later.
CREATE TABLE service_templates (
  id           TEXT PRIMARY KEY,
  garage_id    TEXT NOT NULL REFERENCES garages(id) ON DELETE CASCADE,
  vehicle_id   TEXT REFERENCES vehicles(id) ON DELETE CASCADE,
  service_type TEXT NOT NULL CHECK (service_type IN
                 ('minor','major','repair','inspection','other')),
  part_type_id TEXT NOT NULL REFERENCES part_types(id),
  sort_order   INTEGER NOT NULL DEFAULT 0
);

-- Two PARTIAL unique indexes, not one table-level UNIQUE.
--
-- SQLite treats NULLs as distinct in a UNIQUE constraint, so
-- `UNIQUE (garage_id, vehicle_id, service_type, part_type_id)` would allow
-- unlimited duplicate rows for exactly the garage-wide case -- the only case
-- the app currently writes. The constraint would look present and enforce
-- nothing.
CREATE UNIQUE INDEX uq_tmpl_garage
  ON service_templates (garage_id, service_type, part_type_id)
  WHERE vehicle_id IS NULL;

CREATE UNIQUE INDEX uq_tmpl_vehicle
  ON service_templates (vehicle_id, service_type, part_type_id)
  WHERE vehicle_id IS NOT NULL;

CREATE INDEX idx_service_templates_lookup
  ON service_templates (garage_id, service_type);

-- Starter templates for garages that ALREADY EXIST.
--
-- bootstrapUser() in auth.ts seeds these, but it only runs on a user's first
-- ever login -- so without this backfill every garage created before today
-- has no templates, picking "Minor service" pre-fills nothing, and the
-- feature looks broken for exactly the people already using the app.
-- One statement per part rather than a UNION ALL chain: D1's SQLite is built
-- with a low SQLITE_MAX_COMPOUND_SELECT, and a seven-term compound SELECT
-- fails outright with "too many terms in compound SELECT". Verbose, but it
-- runs.
INSERT INTO service_templates (id, garage_id, vehicle_id, service_type, part_type_id, sort_order)
  SELECT lower(hex(randomblob(16))), id, NULL, 'minor', 'pt_engine_oil', 0 FROM garages;
INSERT INTO service_templates (id, garage_id, vehicle_id, service_type, part_type_id, sort_order)
  SELECT lower(hex(randomblob(16))), id, NULL, 'minor', 'pt_oil_filter', 1 FROM garages;
INSERT INTO service_templates (id, garage_id, vehicle_id, service_type, part_type_id, sort_order)
  SELECT lower(hex(randomblob(16))), id, NULL, 'major', 'pt_engine_oil', 0 FROM garages;
INSERT INTO service_templates (id, garage_id, vehicle_id, service_type, part_type_id, sort_order)
  SELECT lower(hex(randomblob(16))), id, NULL, 'major', 'pt_oil_filter', 1 FROM garages;
INSERT INTO service_templates (id, garage_id, vehicle_id, service_type, part_type_id, sort_order)
  SELECT lower(hex(randomblob(16))), id, NULL, 'major', 'pt_air_filter', 2 FROM garages;
INSERT INTO service_templates (id, garage_id, vehicle_id, service_type, part_type_id, sort_order)
  SELECT lower(hex(randomblob(16))), id, NULL, 'major', 'pt_cabin_filter', 3 FROM garages;
INSERT INTO service_templates (id, garage_id, vehicle_id, service_type, part_type_id, sort_order)
  SELECT lower(hex(randomblob(16))), id, NULL, 'major', 'pt_brake_fluid', 4 FROM garages;

-- --- 4. Constants that should have been settings ---------------------------
-- fallback_km_per_day replaces the literal 30.0 in src/worker/data/status.ts
-- and dashboard.ts; stale_odometer_days replaces STALE_ODOMETER_DAYS.
ALTER TABLE user_settings ADD COLUMN fallback_km_per_day INTEGER NOT NULL DEFAULT 30;
ALTER TABLE user_settings ADD COLUMN stale_odometer_days INTEGER NOT NULL DEFAULT 45;

-- --- 5. Timing chain -------------------------------------------------------
-- Both intervals NULL: a chain is inspect-on-symptom, not scheduled. That
-- also means the interval seeder in vehicles.ts skips it (it requires at
-- least one non-null default), so it does not clutter new vehicles. Activate
-- it per vehicle from the maintenance list.
INSERT INTO part_types (id, garage_id, code, name, category,
                        default_interval_km, default_interval_months, applies_to_fuel)
VALUES ('pt_timing_chain', NULL, 'timing_chain', 'Timing chain', 'belt',
        NULL, NULL, 'petrol,diesel,hybrid');

-- --- 6. Rebuild the affected views -----------------------------------------
-- SQLite has no CREATE OR REPLACE VIEW. v_maintenance_due depends on
-- v_part_baseline, so it drops first.
DROP VIEW v_maintenance_due;
DROP VIEW v_part_baseline;

-- Unchanged except that the winning row now also carries its overrides.
CREATE VIEW v_part_baseline AS
SELECT garage_id, vehicle_id, part_type_id, serviced_on, odometer_km,
       interval_km_override, interval_months_override
FROM (
  SELECT
    si.garage_id,
    sr.vehicle_id,
    si.part_type_id,
    sr.serviced_on,
    sr.odometer_km,
    si.interval_km_override,
    si.interval_months_override,
    ROW_NUMBER() OVER (
      PARTITION BY sr.vehicle_id, si.part_type_id
      ORDER BY sr.serviced_on DESC, sr.odometer_km DESC
    ) AS rn
  FROM service_items si
  JOIN service_records sr ON sr.id = si.service_record_id
)
WHERE rn = 1;

-- Due points per (vehicle, part type). Derived, never stored (invariant 6).
--
-- The effective interval is the most recent service's override if it set one,
-- otherwise the vehicle's configured interval. Because the override rides on
-- the baseline row, it expires by construction: service the part again
-- without an override and the configured interval takes back over.
--
-- Each CASE guards its own NULL independently. An interval may set km only,
-- months only, or both, and a part may have no baseline at all. Computing
-- min(due_date_by_time, projected_date) directly, as spec 6.2 step 5 reads,
-- returns NULL whenever either side is missing -- and a km-only item would
-- silently vanish from the attention list instead of showing as due.
-- The caller COALESCEs these two columns; here they stay separate.
CREATE VIEW v_maintenance_due AS
SELECT
  mi.id            AS interval_id,
  mi.garage_id,
  mi.vehicle_id,
  mi.part_type_id,
  pt.name          AS part_name,
  pt.category      AS part_category,
  COALESCE(b.interval_km_override,     mi.interval_km)     AS interval_km,
  COALESCE(b.interval_months_override, mi.interval_months) AS interval_months,
  -- Whether the numbers above came from the last service or from the
  -- vehicle's own configuration. The UI says which, so an interval that
  -- looks wrong can be traced to where it was set.
  CASE WHEN b.interval_km_override IS NOT NULL
         OR b.interval_months_override IS NOT NULL
       THEN 1 ELSE 0 END AS interval_is_override,
  mi.interval_km      AS configured_interval_km,
  mi.interval_months  AS configured_interval_months,
  b.serviced_on    AS baseline_date,
  b.odometer_km    AS baseline_km,
  CASE WHEN b.odometer_km IS NOT NULL
        AND COALESCE(b.interval_km_override, mi.interval_km) IS NOT NULL
       THEN b.odometer_km + COALESCE(b.interval_km_override, mi.interval_km)
  END AS due_km,
  CASE WHEN b.serviced_on IS NOT NULL
        AND COALESCE(b.interval_months_override, mi.interval_months) IS NOT NULL
       THEN date(b.serviced_on, '+' ||
                 COALESCE(b.interval_months_override, mi.interval_months) || ' months')
  END AS due_date_by_time,
  CASE WHEN b.serviced_on IS NULL AND b.odometer_km IS NULL THEN 1 ELSE 0 END AS is_unknown
FROM maintenance_intervals mi
JOIN part_types pt ON pt.id = mi.part_type_id
LEFT JOIN v_part_baseline b
       ON b.vehicle_id = mi.vehicle_id
      AND b.part_type_id = mi.part_type_id
WHERE mi.is_active = 1;
