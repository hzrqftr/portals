import { ScopedRepo } from "./base";

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
}
