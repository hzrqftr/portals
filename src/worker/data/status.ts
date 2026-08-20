import { ScopedRepo } from "./base";
import { todayIn } from "@shared/dates";
import type { Status } from "../types";

/**
 * Maintenance and renewal status. Spec 6.2, 6.3, 8.1.
 *
 * Every computation below happens inside SQLite. Workers allow 10ms of CPU
 * per request and D1 query time is I/O wait that does not count against it,
 * so the same logic as a JS loop over fetched rows is the one shape that
 * blows the ceiling (spec 11.4). Twelve vehicles times twenty part types is
 * 240 rows to fetch, loop, and serialise; as SQL it is one round trip.
 *
 * `today` is always passed in, never taken from date('now'), because the
 * Worker's clock is UTC and the owner's calendar is UTC+8 (invariant 5).
 */

export interface MaintenanceDueRow {
  interval_id: string;
  vehicle_id: string;
  nickname: string;
  part_type_id: string;
  part_name: string;
  part_category: string;
  interval_km: number | null;
  interval_months: number | null;
  baseline_date: string | null;
  baseline_km: number | null;
  current_odometer_km: number;
  due_km: number | null;
  due_date_by_time: string | null;
  projected_date_by_km: string | null;
  effective_due_date: string | null;
  km_remaining: number | null;
  days_remaining: number | null;
  low_confidence: number;
  status: Status;
}

export interface RenewalStatusRow {
  id: string;
  vehicle_id: string;
  nickname: string;
  type: string;
  provider: string | null;
  expires_on: string;
  cost: number | null;
  days_remaining: number;
  status: Status;
}

/**
 * Trailing-180-day usage rate (spec 6.1).
 *
 * Two things here are load-bearing:
 *
 * 1. `* 1.0` forces float division. SQLite's `/` on two integers truncates,
 *    so a vehicle covering 400 km in 30 days would compute as 13 km/day but
 *    one covering 20 km in 30 days would compute as 0 -- and then divide by
 *    zero in the projection below.
 * 2. The rate is NULL, not zero, when there is too little history. NULL
 *    means "unknown, fall back to 30 km/day and tell the user the
 *    projection is low confidence". Zero means "this car genuinely is not
 *    moving", which is a real answer and must not be overwritten.
 *
 * Bind order: garageId, today.
 */
const USAGE_CTE = `
  clean AS (
    SELECT vehicle_id, reading_km, recorded_on
      FROM v_odometer_clean
     WHERE garage_id = ?
       AND recorded_on >= date(?, '-180 days')
  ),
  usage AS (
    SELECT vehicle_id,
           CASE
             WHEN COUNT(*) >= 2
              AND julianday(MAX(recorded_on)) - julianday(MIN(recorded_on)) >= 14
             THEN (MAX(reading_km) - MIN(reading_km)) * 1.0
                  / (julianday(MAX(recorded_on)) - julianday(MIN(recorded_on)))
           END AS avg_km_per_day
      FROM clean
     GROUP BY vehicle_id
  )`;

/**
 * Bind order: garageId, today, garageId, today, today, today, dueSoonDays, dueSoonKm.
 *
 * The status CASE is ordered deliberately:
 *   unknown first  -- a part with no service history has no baseline, so it
 *                     is not overdue, it is unmeasured. Alerting on it would
 *                     make every newly added vehicle scream red on day one
 *                     and train the owner to ignore the dashboard.
 *   overdue next   -- either clock passing counts.
 *   due_soon next  -- either clock approaching counts.
 */
const MAINTENANCE_SQL = `
WITH ${USAGE_CTE},
  base AS (
    SELECT md.interval_id, md.vehicle_id, md.part_type_id, md.part_name,
           md.part_category, md.interval_km, md.interval_months,
           md.baseline_date, md.baseline_km, md.due_km, md.due_date_by_time,
           md.is_unknown,
           v.nickname, v.current_odometer_km,
           COALESCE(u.avg_km_per_day, 30.0) AS eff_rate,
           CASE WHEN u.avg_km_per_day IS NULL THEN 1 ELSE 0 END AS low_confidence
      FROM v_maintenance_due md
      JOIN vehicles v ON v.id = md.vehicle_id
      LEFT JOIN usage u ON u.vehicle_id = md.vehicle_id
     WHERE md.garage_id = ?
       AND v.is_active = 1
  ),
  proj AS (
    SELECT base.*,
           CASE WHEN due_km IS NOT NULL AND eff_rate > 0
                THEN date(?, '+' || CAST(
                       MAX(0, due_km - current_odometer_km) / eff_rate AS INTEGER
                     ) || ' days')
           END AS projected_date_by_km
      FROM base
  ),
  eff AS (
    SELECT proj.*,
           -- Spec 6.2 step 5 reads min(due_date_by_time, projected_date).
           -- Taken literally that returns NULL whenever an interval sets only
           -- months or only km, and the item disappears from the attention
           -- list rather than showing as due. Each side is guarded instead.
           CASE
             WHEN due_date_by_time IS NULL     THEN projected_date_by_km
             WHEN projected_date_by_km IS NULL THEN due_date_by_time
             ELSE MIN(due_date_by_time, projected_date_by_km)
           END AS effective_due_date
      FROM proj
  ),
  classified AS (
    SELECT
      interval_id, vehicle_id, nickname, part_type_id, part_name, part_category,
      interval_km, interval_months, baseline_date, baseline_km,
      current_odometer_km, due_km, due_date_by_time, projected_date_by_km,
      effective_due_date, low_confidence,
      CASE WHEN due_km IS NOT NULL THEN due_km - current_odometer_km END AS km_remaining,
      CASE WHEN effective_due_date IS NOT NULL
           THEN CAST(julianday(effective_due_date) - julianday(?) AS INTEGER) END AS days_remaining,
      CASE
        WHEN is_unknown = 1 THEN 'unknown'
        WHEN (due_km IS NOT NULL AND current_odometer_km >= due_km)
          OR (due_date_by_time IS NOT NULL AND ? >= due_date_by_time) THEN 'overdue'
        WHEN (effective_due_date IS NOT NULL
              AND effective_due_date <= date(?, '+' || ? || ' days'))
          OR (due_km IS NOT NULL AND due_km - current_odometer_km <= ?) THEN 'due_soon'
        ELSE 'ok'
      END AS status
    FROM eff
  )
SELECT * FROM classified
/*FILTER*/
ORDER BY
  CASE status WHEN 'overdue' THEN 0 WHEN 'due_soon' THEN 1 WHEN 'ok' THEN 2 ELSE 3 END,
  effective_due_date IS NULL,
  effective_due_date`;

/**
 * Bind order: garageId, today, today, dueSoonDays.
 *
 * A road tax that expires on the 20th is still valid ON the 20th, so overdue
 * is `today > expires_on`, not `>=`. Maintenance uses `>=` because a service
 * due on a date is due that morning. The asymmetry is intentional.
 */
const RENEWALS_SQL = `
SELECT r.id, r.vehicle_id, v.nickname, r.type, r.provider, r.expires_on, r.cost,
       CAST(julianday(r.expires_on) - julianday(?) AS INTEGER) AS days_remaining,
       CASE
         WHEN ? > r.expires_on THEN 'overdue'
         WHEN r.expires_on <= date(?, '+' || ? || ' days') THEN 'due_soon'
         ELSE 'ok'
       END AS status
  FROM v_active_renewals r
  JOIN vehicles v ON v.id = r.vehicle_id
 WHERE r.garage_id = ?
   AND v.is_active = 1
 /*FILTER*/
 ORDER BY r.expires_on`;

export class StatusRepo extends ScopedRepo {
  private get today(): string {
    return todayIn(this.scope.timezone);
  }

  async maintenance(
    vehicleId?: string,
    attentionOnly = false,
  ): Promise<MaintenanceDueRow[]> {
    const today = this.today;
    const filters: string[] = [];
    if (vehicleId) filters.push("vehicle_id = ?");
    // Narrowing to the attention list happens here, in SQL, rather than as a
    // JS .filter() over every interval the garage owns (invariant 4).
    if (attentionOnly) filters.push("status IN ('overdue','due_soon')");
    const sql = MAINTENANCE_SQL.replace(
      "/*FILTER*/",
      filters.length ? `WHERE ${filters.join(" AND ")}` : "",
    );

    const binds: unknown[] = [
      this.garageId, today, // usage CTE
      this.garageId, // base
      today, // proj
      today, // days_remaining
      today, // overdue
      today, this.scope.dueSoonDays, // due_soon by date
      this.scope.dueSoonKm, // due_soon by km
    ];
    if (vehicleId) binds.push(vehicleId);

    const { results } = await this.raw
      .prepare(sql)
      .bind(...binds)
      .all<MaintenanceDueRow>();
    return results;
  }

  async renewals(vehicleId?: string, attentionOnly = false): Promise<RenewalStatusRow[]> {
    const today = this.today;
    const filters: string[] = [];
    if (vehicleId) filters.push("r.vehicle_id = ?");
    const sql = RENEWALS_SQL.replace(
      "/*FILTER*/",
      filters.length ? `AND ${filters.join(" AND ")}` : "",
    );

    // The renewal status CASE is in the SELECT list, so it cannot be filtered
    // in the same WHERE. This set is one row per (vehicle, type) -- a handful,
    // not a scan -- so narrowing it here is bounded and safe.
    const binds: unknown[] = [today, today, today, this.scope.dueSoonDays, this.garageId];
    if (vehicleId) binds.push(vehicleId);

    const { results } = await this.raw
      .prepare(sql)
      .bind(...binds)
      .all<RenewalStatusRow>();
    return attentionOnly
      ? results.filter((r) => r.status === "overdue" || r.status === "due_soon")
      : results;
  }
}
