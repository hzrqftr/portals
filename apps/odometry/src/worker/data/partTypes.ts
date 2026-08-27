import { GarageScopedRepo } from "./base";
import { ValidationError } from "@portals/core/worker";
import type { PartTypeInput } from "@shared/zod";

export class PartTypeRepo extends GarageScopedRepo {
  /**
   * Global seed rows plus this garage's own custom types.
   *
   * This is the one read in the app that is not a plain
   * `WHERE garage_id = ?`, and the deviation is deliberate: garage_id NULL
   * means "shared by everyone". It is still scoped -- another garage's custom
   * part types are excluded by the second half of the predicate.
   */
  async list(vehicleType?: "car" | "motorcycle") {
    // With a vehicle type: an INNER join, so a part with no row for that type
    // is absent entirely -- a bike is never offered a cabin filter. Intervals
    // come from that row too, which is what makes the same pt_engine_oil read
    // 3,000 km on a bike and 10,000 on a car.
    //
    // Without one: every part type, with the car figures where they exist.
    // That is the garage-wide template editor, which is not about any one
    // vehicle and must be able to see the whole catalogue.
    const scoped = `(pt.garage_id IS NULL OR pt.garage_id = ?)`;
    const sql = vehicleType
      ? `SELECT pt.id, pt.garage_id, pt.code, pt.name, pt.category,
                d.interval_km   AS default_interval_km,
                d.interval_months AS default_interval_months
           FROM part_types pt
           JOIN part_type_defaults d
             ON d.part_type_id = pt.id AND d.vehicle_type = ?
          WHERE ${scoped}
          ORDER BY pt.category, pt.name`
      : `SELECT pt.id, pt.garage_id, pt.code, pt.name, pt.category,
                d.interval_km   AS default_interval_km,
                d.interval_months AS default_interval_months
           FROM part_types pt
           LEFT JOIN part_type_defaults d
             ON d.part_type_id = pt.id AND d.vehicle_type = 'car'
          WHERE ${scoped}
          ORDER BY pt.category, pt.name`;

    const stmt = this.raw.prepare(sql);
    const { results } = await (vehicleType
      ? stmt.bind(vehicleType, this.garageId)
      : stmt.bind(this.garageId)
    ).all();
    return results;
  }

  /**
   * A part type owned by this garage, for anything the seeded set does not
   * cover -- differential oil, a power steering flush, a specific bush.
   *
   * The read half already existed: list() above and assertUsablePartType in
   * base.ts both carry `garage_id IS NULL OR garage_id = ?`, so a custom row
   * is usable and another garage's is not. This only adds the write.
   *
   * applies_to_fuel is left NULL. Fuel filtering exists to stop an EV being
   * seeded with engine oil; a part the owner typed by hand needs no such
   * protection from itself.
   */
  async create(input: PartTypeInput) {
    const id = crypto.randomUUID();
    try {
      // Two statements, batched so a part type cannot exist without the
      // defaults row that decides which vehicles it applies to -- a part type
      // with no defaults row is invisible to every vehicle, which would look
      // exactly like the insert having silently failed.
      //
      // A row for BOTH vehicle types: a part the owner typed by hand needs no
      // protecting from itself, and guessing that "Chain lube" is bike-only
      // would be guessing.
      await this.raw.batch([
        this.raw
          .prepare(
            `INSERT INTO part_types (id, garage_id, code, name, category)
             VALUES (?,?,?,?,?)`,
          )
          .bind(id, this.garageId, slugify(input.name), input.name, input.category),
        this.raw
          .prepare(
            `INSERT INTO part_type_defaults
               (part_type_id, vehicle_type, interval_km, interval_months, seed_by_default)
             VALUES (?,'car',?,?,1), (?,'motorcycle',?,?,1)`,
          )
          .bind(
            id,
            input.defaultIntervalKm ?? null,
            input.defaultIntervalMonths ?? null,
            id,
            input.defaultIntervalKm ?? null,
            input.defaultIntervalMonths ?? null,
          ),
      ]);
    } catch (e) {
      // uq_parttype_code is UNIQUE(COALESCE(garage_id,''), code) -- codes are
      // unique per garage, so this fires only on a duplicate name within the
      // caller's own garage. Adding the same part twice is an ordinary slip
      // and deserves a message, not a 500.
      if (e instanceof Error && /UNIQUE constraint failed/i.test(e.message)) {
        throw new ValidationError(`You already have a part type called "${input.name}"`);
      }
      throw e;
    }
    return { id };
  }
}

/** `code` is a human-readable handle, not a key -- nothing joins on it. */
function slugify(name: string): string {
  return (
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "")
      .slice(0, 40) || "custom"
  );
}
