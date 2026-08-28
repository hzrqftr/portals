-- Coinbox: the ledger itself. Spec 4.2-4.5.
--
-- Conventions are the same as 0001 and 0010 (CLAUDE.md invariant 1):
--   money      -> INTEGER, minor units (sen). Never REAL.
--   dates      -> TEXT 'YYYY-MM-DD', no time component.
--   timestamps -> TEXT ISO 8601 UTC.
--   enums      -> TEXT + CHECK.
--
-- This was deliberately not written until docs/coinbox-spec.md 7 was settled
-- with the owner (2026-08-28) and the real Google Sheet export had been read.
-- A document is cheap to argue with; a migration against financial history is
-- not. Several shapes below exist because of what the actual 649 rows said,
-- and those reasons are recorded where they apply.

-- ===========================================================================
-- categories
-- ===========================================================================
--
-- Flat, not hierarchical. Settled decision, spec 7.1: the Sheet's categories
-- are flat, so the import invents nothing. Grouping stays easy to add later
-- and hard to remove once reports depend on it.
--
-- NOT BOUND TO DIRECTION, and this is now measured rather than argued. In the
-- real export four categories appear as BOTH in and out -- Household (2 in /
-- 68 out), Miscellaneous (12/3), Family (1/16), Savings (2/8). A `direction`
-- column here could not represent the owner's own data. Do not add one, and
-- do not filter the category picker by the selected direction.
--
-- ledger_id NULL means a global seed row, following the part_types precedent
-- in 0001.
CREATE TABLE categories (
  id         TEXT PRIMARY KEY,
  ledger_id  TEXT REFERENCES ledgers(id) ON DELETE CASCADE,
  code       TEXT NOT NULL,
  name       TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  is_active  INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
  created_at TEXT NOT NULL
);

-- UNIQUE does not constrain NULLs in SQLite, which is exactly the trap a
-- nullable "applies to everything" column makes common: without COALESCE the
-- global rows would all be NULL in the first position and unlimited duplicate
-- codes would be allowed. Same idiom as uq_parttype_code in 0001.
CREATE UNIQUE INDEX uq_category_code ON categories(COALESCE(ledger_id, ''), code);

-- ===========================================================================
-- transactions
-- ===========================================================================
--
-- MAGNITUDE PLUS DIRECTION, SIGN DERIVED.
--
-- amount_sen is constrained NON-NEGATIVE so a sign error is impossible at
-- write time. That matters because a missed negation on one insert path is
-- silent rather than visible -- it produces a total that is merely wrong, not
-- an error anyone sees.
--
-- WHY >= 0 AND NOT > 0. The first version forbade zero, on the reasoning that
-- a zero-amount transaction is almost always a slip. The owner's real ledger
-- disproved it: eight months carry a RM 0.00 water bill, recorded on purpose
-- because a dashboard averages utility cost month over month and a missing
-- month would shorten the denominator and inflate the average. "Billed
-- nothing" is a fact, and the schema has to be able to hold it.
--
-- The guard that was actually wanted lives at the UI instead, where the slip
-- happens: a BLANK amount cannot be saved, a typed 0 can. Blank is a slip;
-- zero is a statement.
--
-- signed_sen is GENERATED, so aggregation is SUM(signed_sen) with no CASE
-- repeated across queries and no chance of two reports disagreeing. VIRTUAL
-- costs no storage; it is recomputed on read.
--
-- Note for anything that writes here: a generated column cannot be inserted
-- into. SQLite rejects the statement. packages/core/src/worker/backup.ts
-- already excludes generated columns from dumps and lets the expression
-- recompute them on restore -- that behaviour is covered by a test that exists
-- specifically because THIS column was coming.
CREATE TABLE transactions (
  id                  TEXT PRIMARY KEY,
  ledger_id           TEXT NOT NULL REFERENCES ledgers(id) ON DELETE CASCADE,

  occurred_on         TEXT NOT NULL,          -- YYYY-MM-DD, the user's calendar
  item                TEXT NOT NULL,
  description         TEXT,
  category_id         TEXT NOT NULL REFERENCES categories(id),

  -- The Odometry link. Phase one is this column and nothing else (settled,
  -- spec 7.2): enough to attribute fuel and servicing, without coupling the
  -- two portals' write paths. There is deliberately no transaction_id on
  -- Odometry's service records yet.
  --
  -- Nullable, and NULL is the normal case: 468 of the owner's 649 rows have no
  -- vehicle at all. Tolls and parking are deliberately left NULL too -- a toll
  -- is a trip cost, not a vehicle cost, and attributing it would dilute
  -- cost-per-km.
  --
  -- NO FOREIGN KEY TO vehicles, on purpose. vehicles is garage-scoped and this
  -- table is ledger-scoped; a database-level reference would tie the ledger's
  -- integrity to the other portal's ownership axis, and ON DELETE CASCADE from
  -- a garage could silently delete financial history. Validity is enforced on
  -- write by assertUsableVehicle() in data/base.ts, which asks whether the
  -- vehicle is in a garage the CALLER is a member of -- see apps/coinbox
  -- CLAUDE.md, "the one place the two axes meet".
  vehicle_id          TEXT,

  amount_sen          INTEGER NOT NULL CHECK (amount_sen >= 0),
  direction           TEXT NOT NULL CHECK (direction IN ('in', 'out')),
  signed_sen          INTEGER GENERATED ALWAYS AS
                        (CASE direction WHEN 'out' THEN -amount_sen ELSE amount_sen END) VIRTUAL,

  -- Import provenance. Dropped once the totals have been reconciled against
  -- the Sheet and nobody is looking backwards any more.
  --
  -- source_type_raw keeps the original 'Debit'/'Credit'. Those words are
  -- ambiguous enough (see apps/coinbox/CLAUDE.md) that "did we map them the
  -- right way round?" is a question worth being able to answer from the data
  -- rather than from memory.
  --
  -- source_category_raw exists because three rows are CORRECTED during import:
  -- 'Ceiling light & screwdriver', 'Dinner' and 'Lunch' were filed under
  -- Transportation in the Sheet. The owner chose to fix them on the way in,
  -- which means the import no longer reproduces the source exactly -- so the
  -- original is kept here, and the correction stays auditable and reversible
  -- instead of being lost.
  source_type_raw     TEXT,
  source_category_raw TEXT,

  created_at          TEXT NOT NULL,
  updated_at          TEXT NOT NULL
);

-- ===========================================================================
-- import_batches
-- ===========================================================================
--
-- Idempotent re-runs. The import is expected to be run more than once.
CREATE TABLE import_batches (
  id          TEXT PRIMARY KEY,
  ledger_id   TEXT NOT NULL REFERENCES ledgers(id) ON DELETE CASCADE,
  source      TEXT NOT NULL,
  row_count   INTEGER NOT NULL DEFAULT 0,
  started_at  TEXT NOT NULL,
  finished_at TEXT
);

-- One row per source line, so a re-run updates instead of duplicating.
--
-- THE HASH MUST INCLUDE THE SOURCE LINE NUMBER, and this is not a style
-- choice. The owner's export contains two rows identical in every field --
-- 19-May-2026, 'Motorcycle fuel', RM4.99, 'Setel', at lines 375 and 377. A
-- hash over content alone collides them, so one insert is silently skipped as
-- "already imported", the ledger is RM 4.99 light, and nothing raises an
-- error. row_hash is therefore computed over the row's fields PLUS its line
-- number.
CREATE TABLE import_rows (
  batch_id       TEXT NOT NULL REFERENCES import_batches(id) ON DELETE CASCADE,
  row_hash       TEXT NOT NULL,
  source_line    INTEGER NOT NULL,
  transaction_id TEXT REFERENCES transactions(id) ON DELETE SET NULL,
  PRIMARY KEY (batch_id, row_hash)
);

-- ===========================================================================
-- Indexes (spec 4.4)
-- ===========================================================================
CREATE INDEX idx_txn_ledger_date     ON transactions(ledger_id, occurred_on DESC);
CREATE INDEX idx_txn_ledger_category ON transactions(ledger_id, category_id, occurred_on);
CREATE INDEX idx_txn_vehicle         ON transactions(vehicle_id) WHERE vehicle_id IS NOT NULL;

-- ===========================================================================
-- Views (spec 4.5, CLAUDE.md invariant 4)
-- ===========================================================================
--
-- Aggregation happens in SQL, never a JS loop: Workers allow 10ms CPU per
-- request, and a loop over rows works fine with a hundred of them and fails
-- silently as the ledger grows.
--
-- NO VIEW MAY CALL date('now') OR CURRENT_DATE. The Worker runs in UTC and the
-- owner is at UTC+8, so "today" is computed from users.timezone and passed as
-- a bound parameter. Views expose parameter-free facts; the caller supplies
-- the period.
CREATE VIEW v_txn_monthly AS
SELECT
  t.ledger_id,
  substr(t.occurred_on, 1, 7)                            AS month,   -- YYYY-MM
  t.category_id,
  c.code                                                 AS category_code,
  c.name                                                 AS category_name,
  SUM(CASE WHEN t.direction = 'in'  THEN t.amount_sen ELSE 0 END) AS in_sen,
  SUM(CASE WHEN t.direction = 'out' THEN t.amount_sen ELSE 0 END) AS out_sen,
  SUM(t.signed_sen)                                      AS net_sen,
  COUNT(*)                                               AS txn_count
FROM transactions t
JOIN categories c ON c.id = t.category_id
GROUP BY t.ledger_id, substr(t.occurred_on, 1, 7), t.category_id;

-- Per-vehicle spend, for the Odometry link. Only rows that name a vehicle.
CREATE VIEW v_txn_by_vehicle AS
SELECT
  t.ledger_id,
  t.vehicle_id,
  substr(t.occurred_on, 1, 7) AS month,
  SUM(t.signed_sen)           AS net_sen,
  COUNT(*)                    AS txn_count
FROM transactions t
WHERE t.vehicle_id IS NOT NULL
GROUP BY t.ledger_id, t.vehicle_id, substr(t.occurred_on, 1, 7);

-- ===========================================================================
-- Seed: the owner's 16 categories, verbatim from the Sheet
-- ===========================================================================
--
-- Global rows (ledger_id NULL), so a second ledger starts from the same set.
--
-- 'Food/ Drinks' keeps its odd internal space ON PURPOSE. It is what the
-- Sheet says, and normalising it silently would make the source and the
-- import disagree on a label for no gain. Fix it in the app if it grates.
--
-- sort_order follows real usage frequency in the export, so the picker offers
-- Transportation and Food/ Drinks first -- together they are more than half
-- of all 649 rows.
INSERT INTO categories (id, ledger_id, code, name, sort_order, is_active, created_at) VALUES
  ('cat_transportation', NULL, 'transportation', 'Transportation',  10, 1, '2026-08-28T00:00:00.000Z'),
  ('cat_food_drinks',    NULL, 'food_drinks',    'Food/ Drinks',    20, 1, '2026-08-28T00:00:00.000Z'),
  ('cat_household',      NULL, 'household',      'Household',       30, 1, '2026-08-28T00:00:00.000Z'),
  ('cat_personal',       NULL, 'personal',       'Personal',        40, 1, '2026-08-28T00:00:00.000Z'),
  ('cat_utility',        NULL, 'utility',        'Utility',         50, 1, '2026-08-28T00:00:00.000Z'),
  ('cat_loans',          NULL, 'loans',          'Loans',           60, 1, '2026-08-28T00:00:00.000Z'),
  ('cat_vices',          NULL, 'vices',          'Vices',           70, 1, '2026-08-28T00:00:00.000Z'),
  ('cat_family',         NULL, 'family',         'Family',          80, 1, '2026-08-28T00:00:00.000Z'),
  ('cat_extra_income',   NULL, 'extra_income',   'Extra Income',    90, 1, '2026-08-28T00:00:00.000Z'),
  ('cat_insurance',      NULL, 'insurance',      'Insurance',      100, 1, '2026-08-28T00:00:00.000Z'),
  ('cat_miscellaneous',  NULL, 'miscellaneous',  'Miscellaneous',  110, 1, '2026-08-28T00:00:00.000Z'),
  ('cat_electronics',    NULL, 'electronics',    'Electronics',    120, 1, '2026-08-28T00:00:00.000Z'),
  ('cat_savings',        NULL, 'savings',        'Savings',        130, 1, '2026-08-28T00:00:00.000Z'),
  ('cat_entertainment',  NULL, 'entertainment',  'Entertainment',  140, 1, '2026-08-28T00:00:00.000Z'),
  ('cat_salary',         NULL, 'salary',         'Salary',         150, 1, '2026-08-28T00:00:00.000Z'),
  ('cat_medications',    NULL, 'medications',    'Medications',    160, 1, '2026-08-28T00:00:00.000Z'),
  -- Present only in the full 2022-2026 history, so they were missing from the
  -- first seed. Rare but real distinctions the owner drew, and merging them
  -- into their nearest neighbour would destroy information he chose to record.
  ('cat_accommodation',  NULL, 'accommodation',  'Accommodation',  170, 1, '2026-08-28T00:00:00.000Z'),
  ('cat_dividend',       NULL, 'dividend',       'Dividend',       180, 1, '2026-08-28T00:00:00.000Z'),
  ('cat_fundings',       NULL, 'fundings',       'Fundings',       190, 1, '2026-08-28T00:00:00.000Z'),
  ('cat_debt',           NULL, 'debt',           'Debt',           200, 1, '2026-08-28T00:00:00.000Z');
