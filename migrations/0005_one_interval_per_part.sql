-- One interval per part, set by the most recent service.
--
-- WHAT CHANGED AND WHY
--
-- Migration 0004 gave a part TWO schedules: the vehicle's standing interval
-- in maintenance_intervals, and a per-service override on the line item that
-- outranked it for exactly one cycle. The override was built for "come back
-- in 5,000 this time, then back to normal".
--
-- In use it did not read that way. The owner edited the interval to 6,000 km,
-- saw the schedule keep saying 5,000, and reasonably concluded the save had
-- not worked -- the number WAS stored, it was just outvoted by a number set
-- somewhere else, on a screen that did not show it. Two numbers for one part
-- is a question the UI has to keep answering ("which of these is in charge?")
-- and it could not answer it well.
--
-- So: maintenance_intervals is now the single source of the schedule. A
-- service that sets an interval writes it there (see data/services.ts), which
-- makes "the interval keyed in at the last service" and "the vehicle's
-- interval" the same fact rather than two facts that can disagree.
--
-- INVARIANT 6 IS UNCHANGED. The due point is still derived, never stored:
-- baseline odometer + interval, computed here. Correct a service's odometer
-- and the due point still moves with it.
--
-- service_items.interval_km_override / interval_months_override are KEPT and
-- still written, now purely as history -- what the schedule was at that
-- service. Nothing computes from them any more, which is why this view no
-- longer joins them in. They are not dropped: they are the only record of
-- what a past service actually specified.

DROP VIEW v_maintenance_due;

CREATE VIEW v_maintenance_due AS
SELECT
  mi.id            AS interval_id,
  mi.garage_id,
  mi.vehicle_id,
  mi.part_type_id,
  pt.name          AS part_name,
  pt.category      AS part_category,
  -- The schedule, from the one place that holds it.
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
  -- A part with no service on record is unknown, never overdue: there is no
  -- baseline to count from, so there is nothing to be late for.
  CASE WHEN b.serviced_on IS NULL AND b.odometer_km IS NULL THEN 1 ELSE 0 END AS is_unknown
FROM maintenance_intervals mi
JOIN part_types pt ON pt.id = mi.part_type_id
LEFT JOIN v_part_baseline b
       ON b.vehicle_id = mi.vehicle_id
      AND b.part_type_id = mi.part_type_id
WHERE mi.is_active = 1;

-- NO BACKFILL, DELIBERATELY.
--
-- The tempting migration here is "copy each part's last override into
-- maintenance_intervals, so whatever was in effect stays in effect". That
-- would overwrite the vehicle's configured interval -- and the configured
-- interval is the number the owner typed by hand, which is the strongest
-- statement of intent in the table. The override is the number a workshop
-- suggested once.
--
-- The two cannot be told apart after the fact, so this picks the one whose
-- loss is recoverable. A part left on its configured interval is on a sane
-- schedule the owner can see and edit. A hand-typed interval silently
-- replaced during a migration is the original bug, shipped again.
