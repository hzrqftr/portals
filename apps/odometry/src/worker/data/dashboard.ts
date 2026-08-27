import { GarageScopedRepo } from "./base";
import { StatusRepo, type MaintenanceDueRow, type RenewalStatusRow } from "./status";
import { todayIn, daysBetween } from "@portals/core";
import type { Status } from "../types";

/**
 * GET /api/dashboard. Spec 7, 8.1.
 *
 * One pre-shaped payload, one round trip. The spec is explicit that the
 * client must not assemble this from five requests, and the reason is not
 * tidiness: this screen is opened at a petrol pump on a phone with two bars
 * of signal, and five sequential requests on that connection is the
 * difference between a usable app and an abandoned one.
 */

export interface DashboardPayload {
  today: string;
  attention: AttentionItem[];
  vehicles: VehicleCard[];
  staleOdometers: { vehicleId: string; nickname: string; daysSince: number }[];
}

export interface AttentionItem {
  kind: "maintenance" | "renewal";
  vehicleId: string;
  nickname: string;
  label: string;
  status: Status;
  dueDate: string | null;
  daysRemaining: number | null;
  kmRemaining: number | null;
  lowConfidence: boolean;
}

export interface VehicleCard {
  id: string;
  nickname: string;
  vehicleType: "car" | "motorcycle";
  plate: string | null;
  currentOdometerKm: number;
  odometerUpdatedOn: string | null;
  odometerAgeDays: number | null;
  worstStatus: Status;
}

const STATUS_RANK: Record<Status, number> = {
  overdue: 0,
  due_soon: 1,
  ok: 2,
  unknown: 3,
};

export class DashboardRepo extends GarageScopedRepo {
  async load(): Promise<DashboardPayload> {
    const today = todayIn(this.scope.timezone);
    const status = new StatusRepo(this.db, this.raw, this.scope);

    // Three queries, issued together rather than one after another. Each is
    // already aggregated in SQL; nothing here loops over raw rows to compute
    // a total or a status.
    const [maintenance, renewals, vehicles] = await Promise.all([
      status.maintenance(undefined, true),
      status.renewals(undefined, true),
      this.vehicleCards(today),
    ]);

    return {
      today,
      attention: [
        ...maintenance.map(toMaintenanceItem),
        ...renewals.map(toRenewalItem),
      ].sort(byUrgency),
      vehicles,
      // Spec 8.1: warn when readings stop arriving, before projections rot.
      // The threshold is a user setting, since how long a reading stays
      // trustworthy depends entirely on how much the car is driven.
      staleOdometers: vehicles
        .filter(
          (v) =>
            v.odometerAgeDays !== null && v.odometerAgeDays > this.scope.staleOdometerDays,
        )
        .map((v) => ({
          vehicleId: v.id,
          nickname: v.nickname,
          daysSince: v.odometerAgeDays as number,
        })),
    };
  }

  /**
   * Vehicle cards with the worst status across all of that vehicle's items.
   * The worst-status rollup is a MIN() over a rank in SQL, not a JS reduce
   * over every interval of every vehicle.
   */
  private async vehicleCards(today: string): Promise<VehicleCard[]> {
    const { results } = await this.raw
      .prepare(
        `WITH clean AS (
           SELECT vehicle_id, reading_km, recorded_on
             FROM v_odometer_clean
            WHERE garage_id = ? AND recorded_on >= date(?, '-180 days')
         ),
         usage AS (
           SELECT vehicle_id,
                  CASE WHEN COUNT(*) >= 2
                        AND julianday(MAX(recorded_on)) - julianday(MIN(recorded_on)) >= 14
                       THEN (MAX(reading_km) - MIN(reading_km)) * 1.0
                            / (julianday(MAX(recorded_on)) - julianday(MIN(recorded_on)))
                  END AS avg_km_per_day
             FROM clean GROUP BY vehicle_id
         ),
         item_rank AS (
           SELECT md.vehicle_id,
                  MIN(CASE
                    WHEN md.is_unknown = 1 THEN 3
                    WHEN (md.due_km IS NOT NULL
                          AND v.current_odometer_km >= md.due_km)
                      OR (md.due_date_by_time IS NOT NULL
                          AND ? >= md.due_date_by_time) THEN 0
                    WHEN (md.due_date_by_time IS NOT NULL
                          AND md.due_date_by_time <= date(?, '+' || ? || ' days'))
                      OR (md.due_km IS NOT NULL
                          AND md.due_km - v.current_odometer_km <= ?)
                      OR (md.due_km IS NOT NULL
                          AND COALESCE(u.avg_km_per_day, ? * 1.0) > 0
                          AND MAX(0, md.due_km - v.current_odometer_km)
                              / COALESCE(u.avg_km_per_day, ? * 1.0) <= ?) THEN 1
                    ELSE 2
                  END) AS rank
             FROM v_maintenance_due md
             JOIN vehicles v ON v.id = md.vehicle_id
             LEFT JOIN usage u ON u.vehicle_id = md.vehicle_id
            WHERE md.garage_id = ? AND v.is_active = 1
            GROUP BY md.vehicle_id
         ),
         renewal_rank AS (
           SELECT r.vehicle_id,
                  MIN(CASE
                    WHEN ? > r.expires_on THEN 0
                    WHEN r.expires_on <= date(?, '+' || ? || ' days') THEN 1
                    ELSE 2
                  END) AS rank
             FROM v_active_renewals r
            WHERE r.garage_id = ?
            GROUP BY r.vehicle_id
         )
         SELECT v.id, v.nickname, v.vehicle_type, v.plate, v.current_odometer_km,
                v.odometer_updated_on,
                MIN(COALESCE(ir.rank, 3), COALESCE(rr.rank, 3)) AS worst_rank
           FROM vehicles v
           LEFT JOIN item_rank ir ON ir.vehicle_id = v.id
           LEFT JOIN renewal_rank rr ON rr.vehicle_id = v.id
          WHERE v.garage_id = ? AND v.is_active = 1
          ORDER BY worst_rank, v.nickname`,
      )
      .bind(
        this.garageId,
        today, // clean
        today, // item overdue
        today,
        this.scope.dueSoonDays, // item due_soon by date
        this.scope.dueSoonKm, // item due_soon by km
        this.scope.fallbackKmPerDay, // projection guard: rate > 0
        this.scope.fallbackKmPerDay, // projection divisor
        this.scope.dueSoonDays, // item due_soon by projection
        this.garageId, // item_rank scope
        today, // renewal overdue
        today,
        this.scope.dueSoonDays, // renewal due_soon
        this.garageId, // renewal_rank scope
        this.garageId, // vehicles scope
      )
      .all<{
        id: string;
        nickname: string;
        vehicle_type: "car" | "motorcycle";
        plate: string | null;
        current_odometer_km: number;
        odometer_updated_on: string | null;
        worst_rank: number;
      }>();

    const byRank: Status[] = ["overdue", "due_soon", "ok", "unknown"];
    return results.map((r) => ({
      id: r.id,
      nickname: r.nickname,
      vehicleType: r.vehicle_type,
      plate: r.plate,
      currentOdometerKm: r.current_odometer_km,
      odometerUpdatedOn: r.odometer_updated_on,
      odometerAgeDays: r.odometer_updated_on
        ? daysBetween(r.odometer_updated_on, today)
        : null,
      worstStatus: byRank[r.worst_rank] ?? "unknown",
    }));
  }
}

function toMaintenanceItem(r: MaintenanceDueRow): AttentionItem {
  return {
    kind: "maintenance",
    vehicleId: r.vehicle_id,
    nickname: r.nickname,
    label: r.part_name,
    status: r.status,
    dueDate: r.effective_due_date,
    daysRemaining: r.days_remaining,
    kmRemaining: r.km_remaining,
    lowConfidence: r.low_confidence === 1,
  };
}

const RENEWAL_LABELS: Record<string, string> = {
  road_tax: "Road tax",
  insurance: "Insurance",
  inspection: "Inspection",
  warranty: "Warranty",
};

function toRenewalItem(r: RenewalStatusRow): AttentionItem {
  return {
    kind: "renewal",
    vehicleId: r.vehicle_id,
    nickname: r.nickname,
    label: RENEWAL_LABELS[r.type] ?? r.type,
    status: r.status,
    dueDate: r.expires_on,
    daysRemaining: r.days_remaining,
    kmRemaining: null,
    lowConfidence: false,
  };
}

/** Overdue first, then soonest. Spec 8.1. */
function byUrgency(a: AttentionItem, b: AttentionItem): number {
  const rank = STATUS_RANK[a.status] - STATUS_RANK[b.status];
  if (rank !== 0) return rank;
  if (a.dueDate === b.dueDate) return a.nickname.localeCompare(b.nickname);
  if (a.dueDate === null) return 1;
  if (b.dueDate === null) return -1;
  return a.dueDate < b.dueDate ? -1 : 1;
}
