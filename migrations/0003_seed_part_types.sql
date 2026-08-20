-- Global part type seed set (spec 4.3). garage_id NULL = visible to everyone.
-- IDs are stable literals, not UUIDs, so migrations and tests can reference
-- them and re-running is safe.
--
-- applies_to_fuel is a CSV of fuel types; NULL means all. This is what stops
-- an EV being seeded with an engine oil interval on creation.

INSERT INTO part_types (id, garage_id, code, name, category, default_interval_km, default_interval_months, applies_to_fuel) VALUES
  ('pt_engine_oil',      NULL, 'engine_oil',      'Engine oil',          'fluid',      10000, 12,  'petrol,diesel,hybrid'),
  ('pt_oil_filter',      NULL, 'oil_filter',      'Oil filter',          'filter',     10000, 12,  'petrol,diesel,hybrid'),
  ('pt_air_filter',      NULL, 'air_filter',      'Air filter',          'filter',     20000, 24,  'petrol,diesel,hybrid'),
  ('pt_cabin_filter',    NULL, 'cabin_filter',    'Cabin filter',        'filter',     20000, 12,  NULL),
  ('pt_fuel_filter',     NULL, 'fuel_filter',     'Fuel filter',         'filter',     40000, 48,  'petrol,diesel,hybrid'),
  ('pt_gearbox_oil',     NULL, 'gearbox_oil',     'Gearbox / ATF oil',   'fluid',      40000, 48,  NULL),
  ('pt_coolant',         NULL, 'coolant',         'Coolant',             'fluid',      60000, 48,  NULL),
  ('pt_brake_fluid',     NULL, 'brake_fluid',     'Brake fluid',         'fluid',      40000, 24,  NULL),
  ('pt_brake_pad_front', NULL, 'brake_pad_front', 'Front brake pads',    'brake',      40000, NULL, NULL),
  ('pt_brake_pad_rear',  NULL, 'brake_pad_rear',  'Rear brake pads',     'brake',      60000, NULL, NULL),
  ('pt_brake_disc_front',NULL, 'brake_disc_front','Front brake discs',   'brake',      80000, NULL, NULL),
  ('pt_brake_disc_rear', NULL, 'brake_disc_rear', 'Rear brake discs',    'brake',     100000, NULL, NULL),
  ('pt_tyres',           NULL, 'tyres',           'Tyres',               'tyre',       60000, 60,  NULL),
  ('pt_battery',         NULL, 'battery',         'Battery',             'battery',    NULL,  36,  NULL),
  ('pt_timing_belt',     NULL, 'timing_belt',     'Timing belt',         'belt',      100000, 84,  'petrol,diesel,hybrid'),
  ('pt_serpentine_belt', NULL, 'serpentine_belt', 'Serpentine belt',     'belt',       60000, 48,  'petrol,diesel,hybrid'),
  ('pt_spark_plugs',     NULL, 'spark_plugs',     'Spark plugs',         'electrical', 40000, 48,  'petrol,hybrid'),
  ('pt_wiper_blades',    NULL, 'wiper_blades',    'Wiper blades',        'other',      NULL,  12,  NULL),
  ('pt_aircon_service',  NULL, 'aircon_service',  'Aircon service',      'other',      NULL,  24,  NULL);
