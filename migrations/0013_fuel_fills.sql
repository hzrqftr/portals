-- Fuel fills: the physical half of a refuelling, so consumption is computable.
--
-- The money for a fill lives in Coinbox (`transactions`); this table holds what
-- the money cannot tell you -- how far the car went and how much fuel it took.
-- Cost per kilometre needs only spend and distance and already exists. LITRES
-- PER 100 KM needs volume, and it needs to know whether the tank was FILLED.
--
-- ===========================================================================
-- WHY `is_full_tank` IS NOT OPTIONAL POLISH
-- ===========================================================================
--
-- Consumption is only computable full-tank to full-tank. The tank level at the
-- start and end of a segment has to be the same, or the litres you put in do
-- not correspond to the distance you drove.
--
-- Divide a partial fill's litres by the distance since the last fill and you
-- get a number in an entirely plausible range -- 5, 8, 12 L/100km -- that is
-- simply wrong, with nothing on screen able to say so. That is the failure this
-- column exists to prevent, and it is why the column is NOT NULL: "we do not
-- know whether this was a full tank" and "this was a full tank" must never be
-- the same stored value.
--
-- A partial fill is not discarded. Its litres are carried into the segment that
-- ends at the next full fill, which is the arithmetically correct thing to do
-- with them. See FuelRepo in apps/odometry/src/worker/data/fuel.ts.
--
-- ===========================================================================
-- THERE IS NO MONEY COLUMN HERE, AND THAT IS THE POINT
-- ===========================================================================
--
-- This table is garage-scoped. A garage is SHARED -- that is the whole reason
-- the indirection exists, so a household can co-own a fleet. A `cost_sen`
-- column here would therefore be readable by every co-member, which is exactly
-- the leak the two-axis design exists to prevent: adding someone to your garage
-- so they can see service schedules must never expose what you spend.
--
-- So the ringgit stays on `transactions`, behind the ledger predicate. Coinbox
-- derives price-per-litre by joining its own money to the fill. Odometry shows
-- litres, distance and consumption, and never a price. If you find yourself
-- adding a cost column here to save a join, that join IS the guard.
--
-- ===========================================================================
-- THE ODOMETER IS STORED ONCE
-- ===========================================================================
--
-- `service_records` carries its own `odometer_km` AND writes a matching
-- source='service' row into `odometer_readings`. This table deliberately does
-- NOT follow that precedent: it points at the reading instead.
--
-- Two copies of one number are two numbers that can disagree, and this one is
-- keyed in on a phone at a pump. Pointing at the reading also means the fill
-- inherits, for free, the validation that already guards readings -- the
-- "lower than an earlier reading" check and the date-guarded cache update in
-- packages/core/src/worker/odometer.ts.
--
-- A consequence worth knowing: fills use source='manual', not a new 'fuel'
-- value. "Which readings came from a fill" is answerable by joining this table,
-- so widening the CHECK constraint would have bought nothing and cost a
-- 12-step table rebuild plus a drop and recreate of v_odometer_clean.

CREATE TABLE fuel_fills (
  id                  TEXT PRIMARY KEY,
  garage_id           TEXT NOT NULL REFERENCES garages(id) ON DELETE CASCADE,
  vehicle_id          TEXT NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
  odometer_reading_id TEXT NOT NULL REFERENCES odometer_readings(id),

  -- Denormalised from the reading's recorded_on so the common "fills in a
  -- month" query does not need the join. Written from the same value.
  filled_on           TEXT NOT NULL,

  -- Integer thousandths, like every quantity here (see packages/core/money.ts).
  -- A REAL would corrupt totals silently, which is invariant 1's whole point.
  litres_milli        INTEGER NOT NULL CHECK (litres_milli > 0),

  is_full_tank        INTEGER NOT NULL DEFAULT 1 CHECK (is_full_tank IN (0,1)),

  -- Nullable so a fill can later be logged in Odometry with no money entry
  -- behind it. CASCADE is what implements "deleting the ledger entry drops the
  -- fill"; the odometer reading is NOT touched and survives, because the car
  -- really was at that mileage on that day. That is a physical observation,
  -- not a money fact, and it is the same choice Odometry already makes when a
  -- service record is deleted.
  transaction_id      TEXT REFERENCES transactions(id) ON DELETE CASCADE,

  created_at          TEXT NOT NULL
);

CREATE INDEX idx_fuel_vehicle_date ON fuel_fills(vehicle_id, filled_on);

-- PARTIAL, because UNIQUE does not constrain NULLs in SQLite: a plain UNIQUE
-- on a nullable column allows unlimited rows whenever it is NULL, which is
-- precisely the case this index exists to leave open.
CREATE UNIQUE INDEX uq_fuel_txn ON fuel_fills(transaction_id)
  WHERE transaction_id IS NOT NULL;
