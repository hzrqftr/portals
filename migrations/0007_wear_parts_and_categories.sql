-- Wear-and-tear parts the seed set was missing, and four categories to hold them.
--
-- WHY
--
-- The 0003 seed set covers fluids, filters, brakes and belts, but nothing that
-- wears out underneath the car: absorbers and their mounts, stabiliser links
-- and bushes, lower arm bushes, ball joints, tie rod and rack ends. Nor CV
-- boots, engine mounts, radiator hoses or the water pump. On Malaysian roads
-- those are the parts that actually get replaced.
--
-- They cannot all go in 'other'. Category drives the icon on every tile and
-- now drives the grouping of the maintenance list, so nineteen parts filed
-- under 'other' would defeat the layout they are being added to.
--
-- WHAT SEEDS AND WHAT DOES NOT
--
-- A part with NULL in BOTH default interval columns is skipped by the vehicle
-- seeder (see the predicate in data/vehicles.ts) and reachable only through
-- "Not tracked on this car". That is the existing opt-in mechanism, already
-- used by pt_timing_chain, and it is how parts that depend on the car rather
-- than the fuel are handled here: a clutch on an automatic, a differential on
-- a front-wheel-drive car, drums on a car with rear discs.
--
-- ============================================================================
-- WHY THIS MIGRATION REBUILDS FIVE TABLES TO CHANGE ONE CHECK CONSTRAINT
-- ============================================================================
--
-- SQLite cannot ALTER a CHECK constraint, so part_types has to be rebuilt.
-- Four tables carry REFERENCES part_types(id) -- maintenance_intervals,
-- service_items, service_templates, cost_estimates -- and D1 enforces foreign
-- keys. Three shorter routes were tried against the local D1 and all three
-- fail; they are recorded here so nobody spends the afternoon again:
--
--   1. Copy to a new table, DROP TABLE part_types, rename the new one in.
--      The DROP fails immediately: SQLITE_CONSTRAINT_FOREIGNKEY. Dropping a
--      parent counts as deleting every row children point at.
--
--   2. Same, with PRAGMA defer_foreign_keys = ON. The DROP is allowed and the
--      transaction fails at COMMIT instead. The deferred counter is a counter,
--      not a re-check: the DROP increments it once per orphaned child row and
--      renaming a different table into the same name never decrements it.
--      Putting a table back does not undo the arithmetic.
--
--   3. Rename the old table out of the way instead of dropping it, with
--      PRAGMA legacy_alter_table = ON so children keep naming "part_types".
--      D1 accepts that pragma and ignores it. Verified directly: after the
--      rename the child's SQL read REFERENCES "zz_parent_old". Modern rename
--      semantics rewrite children to follow the table, always.
--
--   (PRAGMA writable_schema, the usual surgical escape, returns SQLITE_AUTH.)
--
-- Since a rename drags the children along, the children must be rebuilt too --
-- each one recreated with its FK clause explicitly naming the new part_types.
-- That is what the bulk of this file is. It is mechanical, but every CHECK,
-- generated column, UNIQUE and partial index below was copied from the live
-- schema rather than retyped from the original migrations, because those have
-- since been altered by 0004 and 0006 and no longer match.

PRAGMA defer_foreign_keys = ON;

-- --- 1. Drop the dependent views ------------------------------------------
-- A table cannot be renamed while a view names it. v_maintenance_due names
-- part_types; v_part_baseline names service_items. Both are recreated
-- unchanged at the end.
DROP VIEW v_maintenance_due;
DROP VIEW v_part_baseline;

-- --- 2. part_types, with the four new categories --------------------------
ALTER TABLE part_types RENAME TO part_types_old;

CREATE TABLE part_types (
  id                      TEXT PRIMARY KEY,
  garage_id               TEXT REFERENCES garages(id) ON DELETE CASCADE,
  code                    TEXT NOT NULL,
  name                    TEXT NOT NULL,
  category                TEXT NOT NULL CHECK (category IN
                            ('fluid','filter','brake','tyre','battery','belt',
                             'electrical','other',
                             'suspension','drivetrain','cooling','engine')),
  default_interval_km     INTEGER,
  default_interval_months INTEGER,
  applies_to_fuel         TEXT
);

INSERT INTO part_types
  (id, garage_id, code, name, category,
   default_interval_km, default_interval_months, applies_to_fuel)
SELECT id, garage_id, code, name, category,
       default_interval_km, default_interval_months, applies_to_fuel
  FROM part_types_old;

-- --- 3. Rebuild the four children onto the new part_types ------------------
-- Each follows the same shape: rename away, create with the FK naming
-- part_types, copy, drop, recreate indexes. Indexes come last in each block
-- because the old ones live until their table is dropped and the names would
-- collide.

-- 3a. maintenance_intervals
ALTER TABLE maintenance_intervals RENAME TO maintenance_intervals_old;

CREATE TABLE maintenance_intervals (
  id              TEXT PRIMARY KEY,
  garage_id       TEXT NOT NULL REFERENCES garages(id) ON DELETE CASCADE,
  vehicle_id      TEXT NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
  part_type_id    TEXT NOT NULL REFERENCES part_types(id),
  interval_km     INTEGER,
  interval_months INTEGER,
  is_active       INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0,1)),
  UNIQUE (vehicle_id, part_type_id),
  CHECK (interval_km IS NOT NULL OR interval_months IS NOT NULL)
);

INSERT INTO maintenance_intervals
  (id, garage_id, vehicle_id, part_type_id, interval_km, interval_months, is_active)
SELECT id, garage_id, vehicle_id, part_type_id, interval_km, interval_months, is_active
  FROM maintenance_intervals_old;

DROP TABLE maintenance_intervals_old;

CREATE INDEX idx_intervals_garage  ON maintenance_intervals(garage_id);
CREATE INDEX idx_intervals_vehicle ON maintenance_intervals(vehicle_id) WHERE is_active = 1;

-- 3b. service_items
-- line_total_cost is GENERATED ALWAYS and must not appear in the INSERT.
ALTER TABLE service_items RENAME TO service_items_old;

CREATE TABLE service_items (
  id                TEXT PRIMARY KEY,
  garage_id         TEXT NOT NULL REFERENCES garages(id) ON DELETE CASCADE,
  service_record_id TEXT NOT NULL REFERENCES service_records(id) ON DELETE CASCADE,
  part_type_id      TEXT NOT NULL REFERENCES part_types(id),
  brand             TEXT,
  spec              TEXT,
  quantity_milli    INTEGER NOT NULL DEFAULT 1000 CHECK (quantity_milli > 0),
  unit_cost         INTEGER,
  warranty_months   INTEGER,
  interval_km_override     INTEGER,
  interval_months_override INTEGER,
  line_total_cost   INTEGER GENERATED ALWAYS AS
                      ((unit_cost * quantity_milli + 500) / 1000) VIRTUAL
);

INSERT INTO service_items
  (id, garage_id, service_record_id, part_type_id, brand, spec,
   quantity_milli, unit_cost, warranty_months,
   interval_km_override, interval_months_override)
SELECT id, garage_id, service_record_id, part_type_id, brand, spec,
       quantity_milli, unit_cost, warranty_months,
       interval_km_override, interval_months_override
  FROM service_items_old;

DROP TABLE service_items_old;

CREATE INDEX idx_items_garage   ON service_items(garage_id);
CREATE INDEX idx_items_record   ON service_items(service_record_id);
CREATE INDEX idx_items_parttype ON service_items(part_type_id);

-- 3c. service_templates
-- The two partial unique indexes are load-bearing: a single UNIQUE spanning
-- the nullable vehicle_id would not constrain the garage-wide rows at all,
-- which are the only rows the app writes. See the header of 0004.
ALTER TABLE service_templates RENAME TO service_templates_old;

CREATE TABLE service_templates (
  id           TEXT PRIMARY KEY,
  garage_id    TEXT NOT NULL REFERENCES garages(id) ON DELETE CASCADE,
  vehicle_id   TEXT REFERENCES vehicles(id) ON DELETE CASCADE,
  service_type TEXT NOT NULL CHECK (service_type IN
                 ('minor','major','repair','inspection','other')),
  part_type_id TEXT NOT NULL REFERENCES part_types(id),
  sort_order   INTEGER NOT NULL DEFAULT 0
);

INSERT INTO service_templates
  (id, garage_id, vehicle_id, service_type, part_type_id, sort_order)
SELECT id, garage_id, vehicle_id, service_type, part_type_id, sort_order
  FROM service_templates_old;

DROP TABLE service_templates_old;

CREATE UNIQUE INDEX uq_tmpl_garage
  ON service_templates (garage_id, service_type, part_type_id)
  WHERE vehicle_id IS NULL;
CREATE UNIQUE INDEX uq_tmpl_vehicle
  ON service_templates (vehicle_id, service_type, part_type_id)
  WHERE vehicle_id IS NOT NULL;
CREATE INDEX idx_service_templates_lookup
  ON service_templates (garage_id, service_type);

-- 3d. cost_estimates
ALTER TABLE cost_estimates RENAME TO cost_estimates_old;

CREATE TABLE cost_estimates (
  id             TEXT PRIMARY KEY,
  garage_id      TEXT NOT NULL REFERENCES garages(id) ON DELETE CASCADE,
  vehicle_id     TEXT REFERENCES vehicles(id) ON DELETE CASCADE,
  part_type_id   TEXT NOT NULL REFERENCES part_types(id),
  estimated_cost INTEGER NOT NULL,
  source         TEXT NOT NULL CHECK (source IN ('manual','derived')),
  updated_at     TEXT NOT NULL
);

INSERT INTO cost_estimates
  (id, garage_id, vehicle_id, part_type_id, estimated_cost, source, updated_at)
SELECT id, garage_id, vehicle_id, part_type_id, estimated_cost, source, updated_at
  FROM cost_estimates_old;

DROP TABLE cost_estimates_old;

CREATE INDEX idx_estimates_garage ON cost_estimates(garage_id);
CREATE UNIQUE INDEX uq_estimate_vehicle ON cost_estimates(garage_id, vehicle_id, part_type_id)
  WHERE vehicle_id IS NOT NULL;
CREATE UNIQUE INDEX uq_estimate_default ON cost_estimates(garage_id, part_type_id)
  WHERE vehicle_id IS NULL;

-- --- 4. The old part_types can go now -------------------------------------
-- Nothing names it any more: all four children were rebuilt above pointing at
-- the new table.
DROP TABLE part_types_old;

CREATE INDEX idx_parttypes_garage ON part_types(garage_id);
-- An expression index, and the only thing stopping two part types sharing a
-- code within a garage.
CREATE UNIQUE INDEX uq_parttype_code ON part_types(COALESCE(garage_id, ''), code);

-- --- 5. The new part types ------------------------------------------------
-- Multi-row VALUES, not a UNION ALL chain: D1's SQLITE_MAX_COMPOUND_SELECT is
-- low enough that a chain this long fails outright.

INSERT INTO part_types (id, garage_id, code, name, category, default_interval_km, default_interval_months, applies_to_fuel) VALUES
  -- Suspension and steering. Fitted to every car, so all of it seeds; only the
  -- springs wait to be asked for, being replaced on symptom rather than on a
  -- schedule.
  ('pt_absorber_front',    NULL, 'absorber_front',    'Front absorbers',       'suspension',  60000, NULL, NULL),
  ('pt_absorber_rear',     NULL, 'absorber_rear',     'Rear absorbers',        'suspension',  60000, NULL, NULL),
  ('pt_absorber_mount',    NULL, 'absorber_mount',    'Absorber mounts',       'suspension',  60000, NULL, NULL),
  ('pt_stabiliser_link',   NULL, 'stabiliser_link',   'Stabiliser links',      'suspension',  40000, NULL, NULL),
  ('pt_stabiliser_bush',   NULL, 'stabiliser_bush',   'Stabiliser bar bushes', 'suspension',  40000, NULL, NULL),
  ('pt_lower_arm_bush',    NULL, 'lower_arm_bush',    'Lower arm bushes',      'suspension',  60000, NULL, NULL),
  ('pt_ball_joint',        NULL, 'ball_joint',        'Ball joints',           'suspension',  80000, NULL, NULL),
  ('pt_tie_rod_end',       NULL, 'tie_rod_end',       'Tie rod ends',          'suspension',  80000, NULL, NULL),
  ('pt_rack_end',          NULL, 'rack_end',          'Rack ends',             'suspension',  80000, NULL, NULL),
  ('pt_coil_spring',       NULL, 'coil_spring',       'Coil springs',          'suspension',  NULL,  NULL, NULL),
  ('pt_power_steer_fluid', NULL, 'power_steer_fluid', 'Power steering fluid',  'fluid',       40000, 48,   NULL),

  -- Drivetrain. Clutch and differential are transmission- and layout-specific
  -- and the schema has no column for either, so they are opt-in rather than
  -- seeded onto every automatic front-wheel-drive car.
  ('pt_cv_boot',           NULL, 'cv_boot',           'Drive shaft boots',     'drivetrain',  60000, NULL, NULL),
  ('pt_engine_mount',      NULL, 'engine_mount',      'Engine mounts',         'drivetrain',  80000, NULL, NULL),
  ('pt_wheel_bearing',     NULL, 'wheel_bearing',     'Wheel bearings',        'drivetrain', 100000, NULL, NULL),
  ('pt_clutch',            NULL, 'clutch',            'Clutch kit',            'drivetrain',  NULL,  NULL, NULL),
  ('pt_diff_oil',          NULL, 'diff_oil',          'Differential oil',      'drivetrain',  NULL,  NULL, NULL),

  -- Cooling. The water pump matches the timing belt interval because that is
  -- when it actually gets changed -- the labour is already paid for.
  ('pt_radiator_hose',     NULL, 'radiator_hose',     'Radiator hoses',        'cooling',     80000, 60,   NULL),
  ('pt_water_pump',        NULL, 'water_pump',        'Water pump',            'cooling',    100000, NULL, 'petrol,diesel,hybrid'),
  ('pt_thermostat',        NULL, 'thermostat',        'Thermostat',            'cooling',     NULL,  NULL, 'petrol,diesel,hybrid'),
  ('pt_radiator',          NULL, 'radiator',          'Radiator',              'cooling',     NULL,  NULL, NULL),

  -- Engine servicing that is neither a fluid nor a filter.
  ('pt_pcv_valve',         NULL, 'pcv_valve',         'PCV valve',             'engine',      60000, NULL, 'petrol,diesel,hybrid'),
  ('pt_throttle_body',     NULL, 'throttle_body',     'Throttle body clean',   'engine',      40000, NULL, 'petrol,hybrid'),
  ('pt_injector_clean',    NULL, 'injector_clean',    'Fuel injector clean',   'engine',      60000, NULL, 'petrol,diesel,hybrid'),

  ('pt_ignition_coil',     NULL, 'ignition_coil',     'Ignition coils',        'electrical', 100000, NULL, 'petrol,hybrid'),

  -- Rear brakes are either discs or drums, never both. Discs already seed, so
  -- these two are opt-in -- seeding them would assert every car has all four.
  ('pt_brake_shoe_rear',   NULL, 'brake_shoe_rear',   'Rear brake shoes',      'brake',       NULL,  NULL, NULL),
  ('pt_brake_drum_rear',   NULL, 'brake_drum_rear',   'Rear brake drums',      'brake',       NULL,  NULL, NULL),

  -- Wheel work: not parts, but scheduled by distance, and skipping them is
  -- what ruins the tyres that are already tracked here.
  ('pt_wheel_alignment',   NULL, 'wheel_alignment',   'Wheel alignment',       'tyre',        20000, 12,   NULL),
  ('pt_tyre_rotation',     NULL, 'tyre_rotation',     'Tyre rotation',         'tyre',        10000, NULL, NULL);

-- --- 6. Backfill vehicles that already exist ------------------------------
--
-- Intervals are seeded when a vehicle is created, so without this the new
-- parts would exist but be tracked on nothing the owner actually drives.
--
-- The predicate mirrors the seeder in data/vehicles.ts exactly: same "must
-- have at least one default interval" guard, same CSV membership test on
-- applies_to_fuel with both sides wrapped in commas so 'petrol' cannot match
-- 'petrol_x', same "a vehicle with no fuel type gets everything" behaviour.
--
-- NOT EXISTS makes it idempotent, which matters because the UNIQUE on
-- (vehicle_id, part_type_id) would turn a second run into a hard failure
-- rather than a no-op.
INSERT INTO maintenance_intervals
  (id, garage_id, vehicle_id, part_type_id, interval_km, interval_months)
SELECT lower(hex(randomblob(16))), v.garage_id, v.id, pt.id,
       pt.default_interval_km, pt.default_interval_months
  FROM vehicles v
  JOIN part_types pt
    ON (pt.garage_id IS NULL OR pt.garage_id = v.garage_id)
   AND (pt.default_interval_km IS NOT NULL
        OR pt.default_interval_months IS NOT NULL)
   AND (pt.applies_to_fuel IS NULL
        OR v.fuel_type IS NULL
        OR instr(',' || pt.applies_to_fuel || ',', ',' || v.fuel_type || ',') > 0)
 WHERE v.is_active = 1
   AND NOT EXISTS (
         SELECT 1 FROM maintenance_intervals mi
          WHERE mi.vehicle_id = v.id
            AND mi.part_type_id = pt.id
       );

-- --- 7. Restore the views -------------------------------------------------
-- Both unchanged: v_part_baseline as of 0004, v_maintenance_due as of 0005.
-- Reproduced verbatim because SQLite has no CREATE OR REPLACE VIEW and the
-- rebuild required dropping them. If either definition ever changes, it
-- changes in a later migration, not here.

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

CREATE VIEW v_maintenance_due AS
SELECT
  mi.id            AS interval_id,
  mi.garage_id,
  mi.vehicle_id,
  mi.part_type_id,
  pt.name          AS part_name,
  pt.category      AS part_category,
  mi.interval_km,
  mi.interval_months,
  b.serviced_on    AS baseline_date,
  b.odometer_km    AS baseline_km,
  CASE WHEN b.odometer_km IS NOT NULL AND mi.interval_km IS NOT NULL
       THEN b.odometer_km + mi.interval_km
  END AS due_km,
  CASE WHEN b.serviced_on IS NOT NULL AND mi.interval_months IS NOT NULL
       THEN date(b.serviced_on, '+' || mi.interval_months || ' months')
  END AS due_date_by_time,
  CASE WHEN b.serviced_on IS NULL AND b.odometer_km IS NULL THEN 1 ELSE 0 END AS is_unknown
FROM maintenance_intervals mi
JOIN part_types pt ON pt.id = mi.part_type_id
LEFT JOIN v_part_baseline b
       ON b.vehicle_id = mi.vehicle_id
      AND b.part_type_id = mi.part_type_id
WHERE mi.is_active = 1;
