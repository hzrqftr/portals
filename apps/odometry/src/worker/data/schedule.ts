import { NotFoundError, ValidationError } from "@portals/core/worker";
import { GarageScopedRepo } from "./base";
import type { ScheduleRowInput } from "@shared/zod";

/**
 * A vehicle's maintenance schedule as one table (spec 8.2, 2026-09-20).
 *
 * The schedule is maintenance_intervals -- one row per vehicle and part,
 * read by v_maintenance_due. Nothing about that changed. What this adds is a
 * way to see and edit the whole of it at once, beside the manufacturer's
 * figure (maker_intervals, migration 0019), instead of one part at a time.
 *
 * The owner is the only thing that changes the schedule. A logged service
 * changes it only when the owner explicitly adopts a figure there; see
 * ServiceRepo and apps/odometry/CLAUDE.md invariant 6.
 */

export interface ScheduleRow {
  part_type_id: string;
  part_name: string;
  part_category: string;
  /** 1 if this garage created the part type itself. */
  is_custom: number;
  /**
   * 1 if the part fits this vehicle's type and fuel TODAY. 0 means it is
   * still tracked from before the fuel type changed -- shown so the owner can
   * clear it, rather than left on the schedule unseen.
   */
  applies: number;
  /** The owner's schedule. Both null: not tracked. */
  interval_km: number | null;
  interval_months: number | null;
  /** The manual's figure. Reference only. */
  maker_km: number | null;
  maker_months: number | null;
  /** The generic figure a new vehicle starts with, for "reset to default". */
  default_km: number | null;
  default_months: number | null;
}

/**
 * Every part that fits the vehicle now, plus every part still tracked that no
 * longer does. One round trip (invariant 4).
 *
 * NUMBERED parameters, on purpose. The vehicle, garage, type and fuel are each
 * needed in several places, and with bare `?` every one of those is a separate
 * bind whose meaning depends on its position in the text -- the trap in the
 * root CLAUDE.md where one added `?` silently shifts the garage id. With ?N a
 * value is named once and cannot drift.
 *
 *   ?1 vehicle id   ?2 garage id   ?3 vehicle type   ?4 fuel type (or NULL)
 *
 * The fuel test wraps both sides in commas, as the seeder in vehicles.ts
 * does, so 'petrol' cannot match 'petrol_x'. A vehicle with no fuel set is
 * offered every part for its type.
 */
const SCHEDULE_SQL = `
  WITH applicable AS (
    SELECT pt.id AS part_type_id, d.interval_km AS default_km,
           d.interval_months AS default_months
      FROM part_types pt
      JOIN part_type_defaults d
        ON d.part_type_id = pt.id AND d.vehicle_type = ?3
     WHERE (pt.garage_id IS NULL OR pt.garage_id = ?2)
       AND (d.applies_to_fuel IS NULL
            OR ?4 IS NULL
            OR instr(',' || d.applies_to_fuel || ',', ',' || ?4 || ',') > 0)
  ),
  tracked AS (
    SELECT part_type_id, interval_km, interval_months
      FROM maintenance_intervals
     WHERE vehicle_id = ?1 AND garage_id = ?2 AND is_active = 1
  ),
  listed AS (
    SELECT part_type_id, 1 AS applies FROM applicable
    UNION
    SELECT part_type_id, 0 AS applies FROM tracked
     WHERE part_type_id NOT IN (SELECT part_type_id FROM applicable)
  )
  SELECT l.part_type_id,
         pt.name     AS part_name,
         pt.category AS part_category,
         CASE WHEN pt.garage_id IS NULL THEN 0 ELSE 1 END AS is_custom,
         l.applies,
         t.interval_km,
         t.interval_months,
         mk.interval_km     AS maker_km,
         mk.interval_months AS maker_months,
         a.default_km,
         a.default_months
    FROM listed l
    JOIN part_types pt ON pt.id = l.part_type_id
    LEFT JOIN applicable a ON a.part_type_id = l.part_type_id
    LEFT JOIN tracked t    ON t.part_type_id = l.part_type_id
    LEFT JOIN maker_intervals mk
           ON mk.vehicle_id = ?1 AND mk.garage_id = ?2
          AND mk.part_type_id = l.part_type_id
   ORDER BY pt.category, pt.name`;

export class ScheduleRepo extends GarageScopedRepo {
  private async vehicleSpec(vehicleId: string) {
    const v = await this.raw
      .prepare(
        `SELECT vehicle_type, fuel_type FROM vehicles
          WHERE id = ? AND garage_id = ? LIMIT 1`,
      )
      .bind(vehicleId, this.garageId)
      .first<{ vehicle_type: string; fuel_type: string | null }>();
    if (!v) throw new NotFoundError("Vehicle not found");
    return v;
  }

  async list(vehicleId: string): Promise<ScheduleRow[]> {
    const v = await this.vehicleSpec(vehicleId);
    const { results } = await this.raw
      .prepare(SCHEDULE_SQL)
      .bind(vehicleId, this.garageId, v.vehicle_type, v.fuel_type)
      .all<ScheduleRow>();
    return results;
  }

  /**
   * Saves the rows the owner changed, atomically, and returns the new table.
   *
   * Per row:
   *  - an interval of the owner's -> upsert, and (re)activate. Both halves
   *    are REPLACED, not merged: clearing the km cell in the table means "no
   *    km clock", and a COALESCE would silently keep the old one.
   *  - both of the owner's cells blank -> switch the part off. The row and
   *    its numbers stay (is_active = 0), because switching a part off is not
   *    deleting its history, and the table's CHECK needs a number anyway.
   *  - the maker cells -> upsert, or delete when both are blank.
   */
  async save(vehicleId: string, rows: ScheduleRowInput[]): Promise<ScheduleRow[]> {
    const v = await this.vehicleSpec(vehicleId);
    await this.assertPartsFit(v.vehicle_type, rows);

    const statements = rows.flatMap((r) => {
      const out: D1PreparedStatement[] = [];

      if (r.intervalKm !== null || r.intervalMonths !== null) {
        out.push(
          this.raw
            .prepare(
              `INSERT INTO maintenance_intervals
                 (id, garage_id, vehicle_id, part_type_id,
                  interval_km, interval_months, is_active)
               VALUES (lower(hex(randomblob(16))), ?, ?, ?, ?, ?, 1)
               ON CONFLICT(vehicle_id, part_type_id) DO UPDATE SET
                 interval_km     = excluded.interval_km,
                 interval_months = excluded.interval_months,
                 is_active       = 1
               WHERE maintenance_intervals.garage_id = excluded.garage_id`,
            )
            .bind(this.garageId, vehicleId, r.partTypeId, r.intervalKm, r.intervalMonths),
        );
      } else {
        out.push(
          this.raw
            .prepare(
              `UPDATE maintenance_intervals SET is_active = 0
                WHERE vehicle_id = ? AND part_type_id = ? AND garage_id = ?`,
            )
            .bind(vehicleId, r.partTypeId, this.garageId),
        );
      }

      if (r.makerKm !== null || r.makerMonths !== null) {
        out.push(
          this.raw
            .prepare(
              `INSERT INTO maker_intervals
                 (garage_id, vehicle_id, part_type_id, interval_km, interval_months)
               VALUES (?, ?, ?, ?, ?)
               ON CONFLICT(vehicle_id, part_type_id) DO UPDATE SET
                 interval_km     = excluded.interval_km,
                 interval_months = excluded.interval_months
               WHERE maker_intervals.garage_id = excluded.garage_id`,
            )
            .bind(this.garageId, vehicleId, r.partTypeId, r.makerKm, r.makerMonths),
        );
      } else {
        out.push(
          this.raw
            .prepare(
              `DELETE FROM maker_intervals
                WHERE vehicle_id = ? AND part_type_id = ? AND garage_id = ?`,
            )
            .bind(vehicleId, r.partTypeId, this.garageId),
        );
      }
      return out;
    });

    await this.raw.batch(statements);
    return this.list(vehicleId);
  }

  /**
   * Every part named must be usable by this garage (global, or its own) --
   * never trust an ID from the client -- and must fit this vehicle's TYPE, so
   * a motorcycle cannot be given a cabin filter by a hand-made request. Fuel
   * is deliberately not enforced: a vehicle's fuel may be unset or wrong, and
   * the table already lists a mismatched part so it can be cleared.
   *
   * One query for the lot. json_each takes the whole list as one bind, which
   * also keeps a 60-part save clear of D1's cap on bound parameters.
   */
  private async assertPartsFit(vehicleType: string, rows: ScheduleRowInput[]) {
    const ids = rows.map((r) => r.partTypeId);
    const { results } = await this.raw
      .prepare(
        `SELECT j.value AS id,
                (SELECT 1 FROM part_types pt
                  WHERE pt.id = j.value
                    AND (pt.garage_id IS NULL OR pt.garage_id = ?)) AS usable,
                (SELECT 1 FROM part_type_defaults d
                  WHERE d.part_type_id = j.value AND d.vehicle_type = ?) AS fits
           FROM json_each(?) j`,
      )
      .bind(this.garageId, vehicleType, JSON.stringify(ids))
      .all<{ id: string; usable: number | null; fits: number | null }>();

    // 404 rather than 403 for another garage's part: a 403 would confirm the
    // id exists somewhere.
    if (results.some((r) => r.usable === null)) {
      throw new NotFoundError("Part type not found");
    }
    // Only SETTING a figure is refused. Clearing one must always work, or a
    // row left behind by an older rule could never be removed.
    const setsSomething = new Set(
      rows
        .filter(
          (r) =>
            r.intervalKm !== null ||
            r.intervalMonths !== null ||
            r.makerKm !== null ||
            r.makerMonths !== null,
        )
        .map((r) => r.partTypeId),
    );
    const misfit = results.find((r) => r.fits === null && setsSomething.has(r.id));
    if (misfit) {
      throw new ValidationError(`That part does not apply to a ${vehicleType}`);
    }
  }
}
