-- Phase 1 core schema. Spec section 4.
--
-- Conventions that are NOT optional (spec 4.1, CLAUDE.md invariant 1):
--   money      -> INTEGER, minor units (sen). Never REAL.
--   dates      -> TEXT 'YYYY-MM-DD', no time component.
--   timestamps -> TEXT ISO 8601 UTC.
--   booleans   -> INTEGER 0/1.
--   enums      -> TEXT + CHECK.

CREATE TABLE users (
  id           TEXT PRIMARY KEY,
  email        TEXT NOT NULL UNIQUE,
  display_name TEXT,
  timezone     TEXT NOT NULL DEFAULT 'Asia/Kuala_Lumpur',
  created_at   TEXT NOT NULL
);

CREATE TABLE garages (
  id         TEXT PRIMARY KEY,
  name       TEXT NOT NULL DEFAULT 'My Garage',
  created_by TEXT NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL
);

CREATE TABLE garage_members (
  garage_id TEXT NOT NULL REFERENCES garages(id) ON DELETE CASCADE,
  user_id   TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role      TEXT NOT NULL CHECK (role IN ('owner','editor','viewer')),
  PRIMARY KEY (garage_id, user_id)
);

-- Scoped by user_id, not garage_id. Deliberate exception to the
-- "every table filters on garage_id" rule: settings are per person.
CREATE TABLE user_settings (
  user_id       TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  distance_unit TEXT NOT NULL DEFAULT 'km' CHECK (distance_unit IN ('km','mi')),
  currency      TEXT NOT NULL DEFAULT 'MYR',
  date_format   TEXT NOT NULL DEFAULT 'DD/MM/YYYY',
  due_soon_days INTEGER NOT NULL DEFAULT 30,
  due_soon_km   INTEGER NOT NULL DEFAULT 1000
);

-- garage_id NULL = global seed row, visible to every garage. The other
-- deliberate exception: reads here are `garage_id IS NULL OR garage_id = ?`.
CREATE TABLE part_types (
  id                      TEXT PRIMARY KEY,
  garage_id               TEXT REFERENCES garages(id) ON DELETE CASCADE,
  code                    TEXT NOT NULL,
  name                    TEXT NOT NULL,
  category                TEXT NOT NULL CHECK (category IN
                            ('fluid','filter','brake','tyre','battery','belt','electrical','other')),
  default_interval_km     INTEGER,
  default_interval_months INTEGER,
  applies_to_fuel         TEXT
);

CREATE TABLE vehicles (
  id                  TEXT PRIMARY KEY,
  garage_id           TEXT NOT NULL REFERENCES garages(id) ON DELETE CASCADE,
  nickname            TEXT NOT NULL,
  plate               TEXT,
  make                TEXT,
  model               TEXT,
  year                INTEGER,
  engine_cc           INTEGER,
  fuel_type           TEXT CHECK (fuel_type IN ('petrol','diesel','hybrid','ev')),
  transmission        TEXT CHECK (transmission IN ('manual','auto')),
  vin                 TEXT,
  purchase_date       TEXT,
  purchase_price      INTEGER,
  current_odometer_km INTEGER NOT NULL DEFAULT 0,
  odometer_updated_on TEXT,
  is_active           INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0,1)),
  notes               TEXT,
  created_at          TEXT NOT NULL,
  updated_at          TEXT NOT NULL
);

-- Append-only. vehicles.current_odometer_km is a cache updated in the same
-- transaction, and only when the new reading is the latest one by date.
CREATE TABLE odometer_readings (
  id          TEXT PRIMARY KEY,
  garage_id   TEXT NOT NULL REFERENCES garages(id) ON DELETE CASCADE,
  vehicle_id  TEXT NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
  reading_km  INTEGER NOT NULL,
  recorded_on TEXT NOT NULL,
  source      TEXT NOT NULL CHECK (source IN ('manual','service','renewal'))
);

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

CREATE TABLE service_records (
  id            TEXT PRIMARY KEY,
  garage_id     TEXT NOT NULL REFERENCES garages(id) ON DELETE CASCADE,
  vehicle_id    TEXT NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
  serviced_on   TEXT NOT NULL,
  odometer_km   INTEGER NOT NULL,
  workshop_name TEXT,
  total_cost    INTEGER,
  invoice_key   TEXT,
  notes         TEXT,
  created_at    TEXT NOT NULL
);

-- quantity is INTEGER thousandths, NOT REAL. `unit_cost * quantity` with a
-- float quantity produces float money and silently corrupts totals
-- (CLAUDE.md invariant 1). line_total_cost is a generated column so the
-- rounding back to whole sen happens in exactly one place in the whole
-- system and cannot drift between callers.
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
  line_total_cost   INTEGER GENERATED ALWAYS AS
                      ((unit_cost * quantity_milli + 500) / 1000) VIRTUAL
);

-- Immutable (CLAUDE.md invariant 8). Renewing INSERTs a new row; the active
-- one per (vehicle, type) is the greatest expires_on. Never UPDATE expires_on.
CREATE TABLE renewals (
  id           TEXT PRIMARY KEY,
  garage_id    TEXT NOT NULL REFERENCES garages(id) ON DELETE CASCADE,
  vehicle_id   TEXT NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
  type         TEXT NOT NULL CHECK (type IN ('road_tax','insurance','inspection','warranty')),
  provider     TEXT,
  reference_no TEXT,
  issued_on    TEXT,
  expires_on   TEXT NOT NULL,
  cost         INTEGER,
  document_key TEXT,
  notes        TEXT
);

CREATE TABLE cost_estimates (
  id             TEXT PRIMARY KEY,
  garage_id      TEXT NOT NULL REFERENCES garages(id) ON DELETE CASCADE,
  vehicle_id     TEXT REFERENCES vehicles(id) ON DELETE CASCADE,
  part_type_id   TEXT NOT NULL REFERENCES part_types(id),
  estimated_cost INTEGER NOT NULL,
  source         TEXT NOT NULL CHECK (source IN ('manual','derived')),
  updated_at     TEXT NOT NULL
);

-- Spec 4.8 says every garage_id column needs an index, then lists only
-- vehicles. Every garage_id below is filtered on every single query.
CREATE INDEX idx_vehicles_garage      ON vehicles(garage_id) WHERE is_active = 1;
CREATE INDEX idx_odo_garage           ON odometer_readings(garage_id);
CREATE INDEX idx_odo_vehicle_date     ON odometer_readings(vehicle_id, recorded_on DESC);
CREATE INDEX idx_service_garage       ON service_records(garage_id);
CREATE INDEX idx_service_vehicle_date ON service_records(vehicle_id, serviced_on DESC);
CREATE INDEX idx_items_garage         ON service_items(garage_id);
CREATE INDEX idx_items_record         ON service_items(service_record_id);
CREATE INDEX idx_items_parttype       ON service_items(part_type_id);
CREATE INDEX idx_renewals_garage      ON renewals(garage_id);
CREATE INDEX idx_renewals_lookup      ON renewals(vehicle_id, type, expires_on DESC);
CREATE INDEX idx_intervals_garage     ON maintenance_intervals(garage_id);
CREATE INDEX idx_intervals_vehicle    ON maintenance_intervals(vehicle_id) WHERE is_active = 1;
CREATE INDEX idx_estimates_garage     ON cost_estimates(garage_id);
CREATE INDEX idx_members_user         ON garage_members(user_id);
CREATE INDEX idx_parttypes_garage     ON part_types(garage_id);

-- PUT /api/estimates upserts. A single UNIQUE(garage_id, vehicle_id,
-- part_type_id) would NOT constrain the garage-default rows, because SQLite
-- treats NULLs as distinct, so duplicate defaults would slip through.
-- Two partial indexes cover both cases properly.
CREATE UNIQUE INDEX uq_estimate_vehicle ON cost_estimates(garage_id, vehicle_id, part_type_id)
  WHERE vehicle_id IS NOT NULL;
CREATE UNIQUE INDEX uq_estimate_default ON cost_estimates(garage_id, part_type_id)
  WHERE vehicle_id IS NULL;

CREATE UNIQUE INDEX uq_parttype_code ON part_types(COALESCE(garage_id, ''), code);
