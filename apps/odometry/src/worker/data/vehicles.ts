import { and, eq, desc } from "drizzle-orm";
import { GarageScopedRepo } from "./base";
import { vehicles, odometerReadings, maintenanceIntervals } from "../schema";
import { NotFoundError, ValidationError } from "@portals/core/worker";
import { nowIso, todayIn } from "@portals/core";
import type { VehicleInput, VehiclePatch, OdometerInput } from "@shared/zod";

export class VehicleRepo extends GarageScopedRepo {
  async list() {
    return this.db
      .select()
      .from(vehicles)
      .where(this.where(vehicles, eq(vehicles.isActive, 1)))
      .orderBy(vehicles.nickname);
  }

  async get(id: string) {
    const [row] = await this.db
      .select()
      .from(vehicles)
      .where(this.where(vehicles, eq(vehicles.id, id)))
      .limit(1);
    if (!row) throw new NotFoundError("Vehicle not found");
    return row;
  }

  /**
   * Creates the vehicle, seeds its maintenance intervals from the part type
   * defaults, and records an opening odometer reading if one was given.
   * Spec 8.3.
   *
   * All of it goes through one batch(), which D1 runs atomically: a vehicle
   * with no intervals, or intervals pointing at a vehicle that failed to
   * insert, cannot exist.
   */
  async create(input: VehicleInput) {
    const id = crypto.randomUUID();
    const ts = nowIso();
    const today = todayIn(this.scope.timezone);

    const statements: D1PreparedStatement[] = [
      this.raw
        .prepare(
          `INSERT INTO vehicles
             (id, garage_id, nickname, vehicle_type, plate, make, model, year, engine_cc,
              fuel_type, transmission, vin, purchase_date, purchase_price,
              current_odometer_km, odometer_updated_on, notes, created_at, updated_at)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        )
        .bind(
          id,
          this.garageId,
          input.nickname,
          input.vehicleType,
          input.plate ?? null,
          input.make ?? null,
          input.model ?? null,
          input.year ?? null,
          input.engineCc ?? null,
          input.fuelType ?? null,
          input.transmission ?? null,
          input.vin ?? null,
          input.purchaseDate ?? null,
          input.purchasePrice ?? null,
          input.currentOdometerKm ?? 0,
          input.currentOdometerKm !== undefined ? today : null,
          input.notes ?? null,
          ts,
          ts,
        ),

      // Seed intervals as one INSERT ... SELECT rather than fetching part
      // types and looping in JS. applies_to_fuel is a CSV, so the membership
      // test wraps both sides in commas: 'petrol' must not match 'petrol_x'.
      // A vehicle with no fuel_type set gets every interval.
      //
      // The join to part_type_defaults is what makes a bike a bike: a part
      // with no row for this vehicle type is not merely skipped, it does not
      // apply at all, and the interval comes from that row rather than from
      // the part type -- so engine oil arrives at 3,000 km on a motorcycle and
      // 10,000 on a car (migration 0008).
      this.raw
        .prepare(
          `INSERT INTO maintenance_intervals
             (id, garage_id, vehicle_id, part_type_id, interval_km, interval_months)
           SELECT lower(hex(randomblob(16))), ?, ?, pt.id,
                  d.interval_km, d.interval_months
             FROM part_types pt
             JOIN part_type_defaults d
               ON d.part_type_id = pt.id
              AND d.vehicle_type = ?
            WHERE (pt.garage_id IS NULL OR pt.garage_id = ?)
              AND d.seed_by_default = 1
              AND (d.applies_to_fuel IS NULL
                   OR ? IS NULL
                   OR instr(',' || d.applies_to_fuel || ',', ',' || ? || ',') > 0)`,
        )
        .bind(
          this.garageId,
          id,
          input.vehicleType,
          this.garageId,
          input.fuelType ?? null,
          input.fuelType ?? null,
        ),
    ];

    if (input.currentOdometerKm !== undefined) {
      statements.push(
        this.raw
          .prepare(
            `INSERT INTO odometer_readings
               (id, garage_id, vehicle_id, reading_km, recorded_on, source)
             VALUES (?,?,?,?,?,'manual')`,
          )
          .bind(crypto.randomUUID(), this.garageId, id, input.currentOdometerKm, today),
      );
    }

    await this.raw.batch(statements);
    return this.get(id);
  }

  async update(id: string, patch: VehiclePatch) {
    await this.get(id); // proves ownership before we touch anything
    const [row] = await this.db
      .update(vehicles)
      .set({ ...patch, updatedAt: nowIso() })
      .where(this.where(vehicles, eq(vehicles.id, id)))
      .returning();
    return row;
  }

  /** Soft archive. History is the point of this app; nothing is truly deleted. */
  async archive(id: string) {
    await this.get(id);
    await this.db
      .update(vehicles)
      .set({ isActive: 0, updatedAt: nowIso() })
      .where(this.where(vehicles, eq(vehicles.id, id)));
  }

  async readings(vehicleId: string) {
    await this.assertOwnedVehicle(vehicleId);
    return this.db
      .select()
      .from(odometerReadings)
      .where(this.where(odometerReadings, eq(odometerReadings.vehicleId, vehicleId)))
      .orderBy(desc(odometerReadings.recordedOn));
  }

  /**
   * Records an odometer reading. Spec 8.5 -- this happens standing at a
   * petrol pump and must be fast, so validation has to be right rather than
   * chatty.
   *
   * Spec 8.4 says validate the reading is >= the current odometer. That is
   * wrong for backdated entries: logging a service from two months ago
   * legitimately has a lower reading than today's. The comparison is against
   * the newest reading STRICTLY BEFORE this one's date, so out-of-order entry
   * works and genuine typos ("112000" for "12000") are still caught.
   */
  async addReading(vehicleId: string, input: OdometerInput) {
    await this.assertOwnedVehicle(vehicleId);

    const prior = await this.raw
      .prepare(
        `SELECT MAX(reading_km) AS max_km
           FROM odometer_readings
          WHERE vehicle_id = ? AND garage_id = ? AND recorded_on < ?`,
      )
      .bind(vehicleId, this.garageId, input.recordedOn)
      .first<{ max_km: number | null }>();

    if (prior?.max_km !== null && prior?.max_km !== undefined && input.readingKm < prior.max_km) {
      throw new ValidationError(
        `Reading ${input.readingKm} km is lower than an earlier reading of ${prior.max_km} km. ` +
          `Odometers do not run backwards, so this is almost certainly a typo.`,
      );
    }

    // The cached vehicles.current_odometer_km must only move forward in TIME,
    // not in value: entering a forgotten reading from March must not overwrite
    // today's number. The WHERE clause on the UPDATE is what enforces that,
    // and it runs in the same atomic batch as the insert.
    await this.raw.batch([
      this.raw
        .prepare(
          `INSERT INTO odometer_readings
             (id, garage_id, vehicle_id, reading_km, recorded_on, source)
           VALUES (?,?,?,?,?,?)`,
        )
        .bind(
          crypto.randomUUID(),
          this.garageId,
          vehicleId,
          input.readingKm,
          input.recordedOn,
          input.source ?? "manual",
        ),
      this.raw
        .prepare(
          `UPDATE vehicles
              SET current_odometer_km = ?, odometer_updated_on = ?, updated_at = ?
            WHERE id = ? AND garage_id = ?
              AND (odometer_updated_on IS NULL OR odometer_updated_on <= ?)`,
        )
        .bind(
          input.readingKm,
          input.recordedOn,
          nowIso(),
          vehicleId,
          this.garageId,
          input.recordedOn,
        ),
    ]);
  }

  async setInterval(
    vehicleId: string,
    partTypeId: string,
    patch: { intervalKm?: number | null; intervalMonths?: number | null; isActive?: number },
  ) {
    await this.assertOwnedVehicle(vehicleId);
    await this.assertUsablePartType(partTypeId);

    if (patch.intervalKm === null && patch.intervalMonths === null) {
      throw new ValidationError("An interval needs a distance, a time, or both");
    }

    const [row] = await this.db
      .update(maintenanceIntervals)
      .set(patch)
      .where(
        this.where(
          maintenanceIntervals,
          and(
            eq(maintenanceIntervals.vehicleId, vehicleId),
            eq(maintenanceIntervals.partTypeId, partTypeId),
          ),
        ),
      )
      .returning();
    if (row) return row;

    /**
     * No row yet, so create one.
     *
     * The seeder only creates intervals for part types that ship with a
     * default, which leaves two parts permanently unreachable from the UI:
     * anything deliberately intervalless (Timing chain is inspect-on-symptom,
     * so both its defaults are NULL) and any part type the owner added
     * themselves. Without this branch, "start tracking this part" is a
     * 404 forever and the belt-versus-chain case has no answer.
     *
     * A patch carrying only isActive still 404s: there is genuinely nothing
     * to switch on or off, and inventing a row with no interval in it would
     * fail the table's CHECK constraint anyway.
     */
    if (patch.intervalKm == null && patch.intervalMonths == null) {
      throw new NotFoundError("Interval not found");
    }

    const [created] = await this.db
      .insert(maintenanceIntervals)
      .values({
        id: crypto.randomUUID(),
        garageId: this.garageId,
        vehicleId,
        partTypeId,
        intervalKm: patch.intervalKm ?? null,
        intervalMonths: patch.intervalMonths ?? null,
        isActive: patch.isActive ?? 1,
      })
      .returning();
    return created;
  }
}
