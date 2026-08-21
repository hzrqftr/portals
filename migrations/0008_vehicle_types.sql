-- Motorbikes.
--
-- WHY
--
-- Everything structural in this app is already vehicle-agnostic: odometer
-- readings, derived due points, service records, labour, renewals. Road tax
-- and insurance apply to a bike exactly as they do to a car.
--
-- The parts catalogue is not. Two problems, and only the first is obvious:
--
--   1. APPLICABILITY. All 48 part types apply to everything, so a bike would
--      be seeded with a cabin filter, aircon service, wipers, ATF, power
--      steering fluid, CV boots and the entire car suspension set -- while
--      having nothing for a chain, forks or valve clearances.
--
--   2. INTERVALS. part_types holds ONE default per part. Engine oil on a bike
--      is about 3,000 km, not 10,000. Seeding a bike at 10,000 is not untidy,
--      it is wrong in the direction that wrecks engines.
--
-- Duplicating part types per vehicle type would solve both and cost more: two
-- rows called "Engine oil" split the brand history and the service record for
-- one real-world thing. So applicability and intervals move to a table keyed
-- by (part type, vehicle type), and part_types goes back to being identity
-- alone -- code, name, category.

-- --- 1. Vehicles get a type -----------------------------------------------
-- Plain ADD COLUMN. SQLite permits a CHECK on an added column, and permits
-- NOT NULL when a non-null default is supplied. Existing vehicles become
-- cars, which is what they are.
ALTER TABLE vehicles ADD COLUMN vehicle_type TEXT NOT NULL DEFAULT 'car'
  CHECK (vehicle_type IN ('car','motorcycle'));

-- --- 2. Rebuild part_types without the three moved columns -----------------
--
-- Dropping columns means rebuilding, and rebuilding part_types means
-- rebuilding its FK children too. The full reasoning -- why plain DROP TABLE,
-- defer_foreign_keys and legacy_alter_table each fail on D1 -- is in the
-- header of 0007. This follows that recipe exactly.
--
-- The order matters here in a way it did not in 0007: part_type_defaults is
-- populated FROM part_types_old, in the window after the new part_types
-- exists and before the old one is dropped. Creating it any earlier would
-- make it a fifth child whose FK the rename would rewrite.

PRAGMA defer_foreign_keys = ON;

DROP VIEW v_maintenance_due;
DROP VIEW v_part_baseline;

ALTER TABLE part_types RENAME TO part_types_old;

-- Identity only now. No intervals, no fuel filter: those are per vehicle type
-- and live in part_type_defaults below.
CREATE TABLE part_types (
  id        TEXT PRIMARY KEY,
  garage_id TEXT REFERENCES garages(id) ON DELETE CASCADE,
  code      TEXT NOT NULL,
  name      TEXT NOT NULL,
  category  TEXT NOT NULL CHECK (category IN
              ('fluid','filter','brake','tyre','battery','belt',
               'electrical','other',
               'suspension','drivetrain','cooling','engine'))
);

INSERT INTO part_types (id, garage_id, code, name, category)
SELECT id, garage_id, code, name, category FROM part_types_old;

-- 2a. maintenance_intervals
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

-- 2b. service_items -- line_total_cost is GENERATED and stays out of the INSERT.
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

-- 2c. service_templates -- the two partial unique indexes are load-bearing.
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

-- 2d. cost_estimates
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

-- --- 3. part_type_defaults -------------------------------------------------
--
-- One row per (part type, vehicle type) the part applies to. Three facts that
-- used to be tangled into two columns are now three columns:
--
--   * applies to this kind of vehicle -- a row exists
--   * at what interval               -- interval_km / interval_months
--   * seeded on a new vehicle        -- seed_by_default
--
-- That last one was previously expressed by leaving BOTH intervals NULL, which
-- meant an opt-in part had no interval to offer when the owner did tick it --
-- hence the hardcoded 10,000 km placeholder in UntrackedParts. Fine for a
-- timing chain, absurd for chain lube. Separating the flag lets every part
-- carry a real number whether or not it is seeded.
CREATE TABLE part_type_defaults (
  part_type_id    TEXT NOT NULL REFERENCES part_types(id) ON DELETE CASCADE,
  vehicle_type    TEXT NOT NULL CHECK (vehicle_type IN ('car','motorcycle')),
  interval_km     INTEGER,
  interval_months INTEGER,
  applies_to_fuel TEXT,
  seed_by_default INTEGER NOT NULL DEFAULT 1 CHECK (seed_by_default IN (0,1)),
  PRIMARY KEY (part_type_id, vehicle_type)
);

-- Car rows, carried across verbatim so existing behaviour is preserved to the
-- letter: whatever seeded before still seeds, at the same interval.
INSERT INTO part_type_defaults
  (part_type_id, vehicle_type, interval_km, interval_months, applies_to_fuel, seed_by_default)
SELECT id, 'car', default_interval_km, default_interval_months, applies_to_fuel,
       CASE WHEN default_interval_km IS NOT NULL OR default_interval_months IS NOT NULL
            THEN 1 ELSE 0 END
  FROM part_types_old;

-- part_types_old has given up everything it knew. Nothing references it: all
-- four children were rebuilt above against the new table.
DROP TABLE part_types_old;

CREATE INDEX idx_parttypes_garage ON part_types(garage_id);
CREATE UNIQUE INDEX uq_parttype_code ON part_types(COALESCE(garage_id, ''), code);

-- --- 4. Give the opt-in car parts real intervals ---------------------------
-- They were NULL only because NULL used to mean "do not seed". It no longer
-- does, so they can say what they actually are and the Track button can stop
-- inventing 10,000 km.
UPDATE part_type_defaults SET interval_km = 150000 WHERE vehicle_type='car' AND part_type_id='pt_clutch';
UPDATE part_type_defaults SET interval_km = 60000, interval_months = 48 WHERE vehicle_type='car' AND part_type_id='pt_diff_oil';
UPDATE part_type_defaults SET interval_km = 60000  WHERE vehicle_type='car' AND part_type_id='pt_brake_shoe_rear';
UPDATE part_type_defaults SET interval_km = 100000 WHERE vehicle_type='car' AND part_type_id='pt_brake_drum_rear';
UPDATE part_type_defaults SET interval_km = 120000 WHERE vehicle_type='car' AND part_type_id='pt_coil_spring';
UPDATE part_type_defaults SET interval_km = 100000 WHERE vehicle_type='car' AND part_type_id='pt_thermostat';
UPDATE part_type_defaults SET interval_km = 150000 WHERE vehicle_type='car' AND part_type_id='pt_radiator';
UPDATE part_type_defaults SET interval_km = 200000 WHERE vehicle_type='car' AND part_type_id='pt_timing_chain';

-- --- 5. Bike-specific part types -------------------------------------------
-- No new categories, deliberately: chain and CVT parts are drivetrain, forks
-- and shock are suspension, valve clearance is engine. Adding a category would
-- mean rebuilding part_types a second time in one migration.
INSERT INTO part_types (id, garage_id, code, name, category) VALUES
  ('pt_chain_sprocket',   NULL, 'chain_sprocket',   'Chain & sprockets',      'drivetrain'),
  ('pt_chain_lube',       NULL, 'chain_lube',       'Chain lube & adjust',    'drivetrain'),
  ('pt_cvt_belt',         NULL, 'cvt_belt',         'CVT belt',               'drivetrain'),
  ('pt_cvt_roller',       NULL, 'cvt_roller',       'CVT rollers',            'drivetrain'),
  ('pt_final_drive_oil',  NULL, 'final_drive_oil',  'Final drive gear oil',   'fluid'),
  ('pt_clutch_plates',    NULL, 'clutch_plates',    'Clutch plates',          'drivetrain'),
  ('pt_clutch_cable',     NULL, 'clutch_cable',     'Clutch cable',           'drivetrain'),
  ('pt_brake_cable',      NULL, 'brake_cable',      'Brake cable',            'brake'),
  ('pt_fork_oil',         NULL, 'fork_oil',         'Front fork oil',         'suspension'),
  ('pt_fork_seal',        NULL, 'fork_seal',        'Fork seals',             'suspension'),
  ('pt_rear_shock',       NULL, 'rear_shock',       'Rear shock absorber',    'suspension'),
  ('pt_steering_bearing', NULL, 'steering_bearing', 'Steering head bearings', 'suspension'),
  ('pt_valve_clearance',  NULL, 'valve_clearance',  'Valve clearance',        'engine');

-- --- 6. What a motorcycle actually has -------------------------------------
--
-- Drive-specific parts are NOT seeded. A bike is either chain-driven or a CVT
-- scooter and never both, and the schema has no column that says which -- the
-- same situation as rear discs versus drums, handled the same way: both are
-- offered, neither is assumed.
--
-- Liquid cooling is the other assumption avoided. Plenty of bikes here are
-- air-cooled, so the radiator group is opt-in rather than seeded.
INSERT INTO part_type_defaults
  (part_type_id, vehicle_type, interval_km, interval_months, applies_to_fuel, seed_by_default) VALUES
  -- Bike-specific, seeded: every bike has forks, a rear shock and valves.
  ('pt_fork_oil',         'motorcycle', 20000, 24,   NULL, 1),
  ('pt_rear_shock',       'motorcycle', 30000, NULL, NULL, 1),
  ('pt_valve_clearance',  'motorcycle', 15000, NULL, 'petrol,hybrid', 1),

  -- Bike-specific, opt-in: depends on chain versus CVT, cable versus hydraulic.
  ('pt_chain_sprocket',   'motorcycle', 20000, NULL, NULL, 0),
  ('pt_chain_lube',       'motorcycle', 1000,  NULL, NULL, 0),
  ('pt_cvt_belt',         'motorcycle', 20000, NULL, NULL, 0),
  ('pt_cvt_roller',       'motorcycle', 20000, NULL, NULL, 0),
  ('pt_final_drive_oil',  'motorcycle', 10000, 12,   NULL, 0),
  ('pt_clutch_plates',    'motorcycle', 30000, NULL, NULL, 0),
  ('pt_clutch_cable',     'motorcycle', 20000, NULL, NULL, 0),
  ('pt_brake_cable',      'motorcycle', 20000, NULL, NULL, 0),
  ('pt_fork_seal',        'motorcycle', 40000, NULL, NULL, 0),
  ('pt_steering_bearing', 'motorcycle', 40000, NULL, NULL, 0),

  -- Shared with cars, different numbers. This is the whole reason intervals
  -- moved out of part_types: same part type, same brand history, same service
  -- records -- a third of the car's oil interval.
  ('pt_engine_oil',       'motorcycle', 3000,  6,    'petrol,hybrid', 1),
  ('pt_oil_filter',       'motorcycle', 6000,  12,   'petrol,hybrid', 1),
  ('pt_air_filter',       'motorcycle', 8000,  12,   'petrol,hybrid', 1),
  ('pt_spark_plugs',      'motorcycle', 10000, 12,   'petrol,hybrid', 1),
  ('pt_tyres',            'motorcycle', 20000, 36,   NULL, 1),
  ('pt_brake_pad_front',  'motorcycle', 20000, NULL, NULL, 1),
  ('pt_brake_pad_rear',   'motorcycle', 25000, NULL, NULL, 1),
  ('pt_brake_disc_front', 'motorcycle', 60000, NULL, NULL, 1),
  ('pt_brake_disc_rear',  'motorcycle', 60000, NULL, NULL, 1),
  ('pt_brake_fluid',      'motorcycle', 24000, 24,   NULL, 1),
  ('pt_battery',          'motorcycle', NULL,  24,   NULL, 1),
  ('pt_wheel_bearing',    'motorcycle', 40000, NULL, NULL, 1),

  -- Shared, opt-in: drum brakes, liquid cooling, and fuel-system work that
  -- only some bikes get.
  ('pt_brake_shoe_rear',  'motorcycle', 25000, NULL, NULL, 0),
  ('pt_brake_drum_rear',  'motorcycle', 60000, NULL, NULL, 0),
  ('pt_coolant',          'motorcycle', 24000, 24,   NULL, 0),
  ('pt_radiator',         'motorcycle', 100000, NULL, NULL, 0),
  ('pt_radiator_hose',    'motorcycle', 60000, 60,   NULL, 0),
  ('pt_thermostat',       'motorcycle', 60000, NULL, NULL, 0),
  ('pt_water_pump',       'motorcycle', 60000, NULL, 'petrol,hybrid', 0),
  ('pt_fuel_filter',      'motorcycle', 20000, 24,   'petrol,hybrid', 0),
  ('pt_injector_clean',   'motorcycle', 20000, NULL, 'petrol,hybrid', 0),
  ('pt_throttle_body',    'motorcycle', 20000, NULL, 'petrol,hybrid', 0);

-- Everything else -- cabin filter, aircon, wipers, ATF, power steering fluid,
-- serpentine and timing belts, timing chain, CV boots, engine mounts,
-- differential oil, PCV valve, ignition coils, the car clutch kit, wheel
-- alignment, tyre rotation and all nine car suspension parts -- gets no
-- motorcycle row and so does not exist for a bike at all.

-- --- 7. Restore the views --------------------------------------------------
-- Both unchanged: v_part_baseline as of 0004, v_maintenance_due as of 0005.
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
