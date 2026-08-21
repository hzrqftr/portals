import { ScopedRepo } from "./base";
import { ValidationError } from "../errors";
import type { PartTypeInput } from "@shared/zod";

export class PartTypeRepo extends ScopedRepo {
  /**
   * Global seed rows plus this garage's own custom types.
   *
   * This is the one read in the app that is not a plain
   * `WHERE garage_id = ?`, and the deviation is deliberate: garage_id NULL
   * means "shared by everyone". It is still scoped -- another garage's custom
   * part types are excluded by the second half of the predicate.
   */
  async list() {
    const { results } = await this.raw
      .prepare(
        `SELECT id, garage_id, code, name, category,
                default_interval_km, default_interval_months, applies_to_fuel
           FROM part_types
          WHERE garage_id IS NULL OR garage_id = ?
          ORDER BY category, name`,
      )
      .bind(this.garageId)
      .all();
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
      await this.raw
        .prepare(
          `INSERT INTO part_types
             (id, garage_id, code, name, category,
              default_interval_km, default_interval_months, applies_to_fuel)
           VALUES (?,?,?,?,?,?,?,NULL)`,
        )
        .bind(
          id,
          this.garageId,
          slugify(input.name),
          input.name,
          input.category,
          input.defaultIntervalKm ?? null,
          input.defaultIntervalMonths ?? null,
        )
        .run();
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
