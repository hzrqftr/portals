-- Derived logic. Spec section 6.
--
-- IMPORTANT: no view here calls date('now') or CURRENT_DATE.
-- The Worker runs in UTC, the owner is at UTC+8, so a UTC "today" is the
-- wrong calendar day for eight hours of every local day (CLAUDE.md
-- invariant 5). "Today" is computed from users.timezone in JS and passed
-- into the queries in src/worker/data/ as a bound parameter.
--
-- These views therefore expose raw, parameter-free facts (baselines, due
-- points, active rows). The date comparison that turns a due point into
-- ok / due_soon / overdue happens in a parameterised SQL query, still in
-- SQL and never in a JS loop (invariant 4).

-- Odometer readings with data-entry errors removed. A reading is kept only
-- if it is not lower than every earlier reading for the same vehicle.
-- Readings can legitimately arrive out of order (a service logged weeks
-- later), so this filters by DATE, not by insertion order.
CREATE VIEW v_odometer_clean AS
SELECT o.*
FROM odometer_readings o
WHERE o.reading_km >= COALESCE(
  (SELECT MAX(p.reading_km)
     FROM odometer_readings p
    WHERE p.vehicle_id = o.vehicle_id
      AND p.recorded_on < o.recorded_on), 0);

-- NOTE: usage rate (spec 6.1) is deliberately NOT a view. The trailing
-- 180-day window has to be measured from the user's local today, which no
-- view can know, so it lives as a CTE in src/worker/data/status.ts and is
-- still evaluated entirely in SQL.

-- The baseline for a part type is the most recent SERVICE ITEM of that type,
-- never the most recent service record. A visit with no line items resets
-- nothing (CLAUDE.md invariant 7).
CREATE VIEW v_part_baseline AS
SELECT garage_id, vehicle_id, part_type_id, serviced_on, odometer_km
FROM (
  SELECT
    si.garage_id,
    sr.vehicle_id,
    si.part_type_id,
    sr.serviced_on,
    sr.odometer_km,
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
  mi.interval_km,
  mi.interval_months,
  b.serviced_on    AS baseline_date,
  b.odometer_km    AS baseline_km,
  CASE WHEN b.odometer_km IS NOT NULL AND mi.interval_km IS NOT NULL
       THEN b.odometer_km + mi.interval_km END AS due_km,
  CASE WHEN b.serviced_on IS NOT NULL AND mi.interval_months IS NOT NULL
       THEN date(b.serviced_on, '+' || mi.interval_months || ' months') END AS due_date_by_time,
  CASE WHEN b.serviced_on IS NULL AND b.odometer_km IS NULL THEN 1 ELSE 0 END AS is_unknown
FROM maintenance_intervals mi
JOIN part_types pt ON pt.id = mi.part_type_id
LEFT JOIN v_part_baseline b
       ON b.vehicle_id = mi.vehicle_id
      AND b.part_type_id = mi.part_type_id
WHERE mi.is_active = 1;

-- The active renewal per (vehicle, type) is the greatest expires_on.
-- Superseded rows stay in the table as cost history for the forecast.
CREATE VIEW v_active_renewals AS
SELECT id, garage_id, vehicle_id, type, provider, reference_no,
       issued_on, expires_on, cost, document_key, notes
FROM (
  SELECT r.*,
         ROW_NUMBER() OVER (
           PARTITION BY r.vehicle_id, r.type ORDER BY r.expires_on DESC
         ) AS rn
  FROM renewals r
)
WHERE rn = 1;
