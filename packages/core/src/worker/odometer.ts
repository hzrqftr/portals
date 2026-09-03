/**
 * THE ODOMETER WRITE. One definition, three callers, both portals.
 *
 * Recording a reading is two statements that have to agree with each other and
 * a validation rule that is wrong in an interesting way if you simplify it.
 * Until this file existed the pair was copy-pasted in Odometry's vehicles.ts
 * and services.ts, and Coinbox's fuel entry would have made a third copy --
 * of a rule whose correctness is completely invisible when broken.
 *
 * The statements are RETURNED rather than executed, so each caller folds them
 * into its own batch(). That is not a style choice: Coinbox has to insert a
 * transaction, a reading and a fuel fill atomically, and a helper that ran its
 * own batch() would make that impossible.
 */

import { ValidationError } from "./errors";
import { nowIso } from "../dates";

export type OdometerSource = "manual" | "service" | "renewal";

export interface OdometerWrite {
  readingId: string;
  garageId: string;
  vehicleId: string;
  readingKm: number;
  /** The date the reading APPLIES to, which is not necessarily today. */
  recordedOn: string;
  source: OdometerSource;
}

/**
 * Rejects a reading that would run the odometer backwards.
 *
 * Spec 8.4 says compare against the vehicle's current odometer. THAT IS WRONG
 * FOR BACKDATED ENTRIES: logging a service, or a fuel fill, from two months ago
 * legitimately has a lower reading than today's, and comparing against the
 * current figure would refuse every one of them.
 *
 * So the comparison is against the newest reading STRICTLY BEFORE this one's
 * date. Out-of-order entry works, and a genuine typo ("112000" for "12000")
 * is still caught.
 *
 * What this CANNOT catch is a typo in the other direction -- 112000 entered as
 * the latest reading is higher than everything before it and is therefore
 * indistinguishable from a real reading. There is no delete path for readings,
 * so that mistake is permanent. The client-side plausibility warning in
 * Coinbox's fuel fields is the only defence against it, which is why it exists
 * even though it blocks nothing.
 */
export async function assertReadingNotBackwards(
  raw: D1Database,
  input: { vehicleId: string; garageId: string; recordedOn: string; readingKm: number },
): Promise<void> {
  const prior = await raw
    .prepare(
      `SELECT MAX(reading_km) AS max_km
         FROM odometer_readings
        WHERE vehicle_id = ? AND garage_id = ? AND recorded_on < ?`,
    )
    .bind(input.vehicleId, input.garageId, input.recordedOn)
    .first<{ max_km: number | null }>();

  if (prior?.max_km !== null && prior?.max_km !== undefined && input.readingKm < prior.max_km) {
    throw new ValidationError(
      `Reading ${input.readingKm} km is lower than an earlier reading of ${prior.max_km} km. ` +
        `Odometers do not run backwards, so this is almost certainly a typo.`,
    );
  }
}

/**
 * The append plus the cache refresh, as statements for the caller's batch.
 *
 * The cached vehicles.current_odometer_km must only move forward in TIME, not
 * in value: entering a forgotten reading from March must not overwrite today's
 * number. The WHERE clause on the UPDATE is what enforces that, and it has to
 * run in the SAME atomic batch as the insert -- a reading that landed while the
 * cache did not, or the reverse, is a vehicle whose dashboard figure disagrees
 * with its own history.
 */
export function odometerWriteStatements(
  raw: D1Database,
  input: OdometerWrite,
): [insertReading: D1PreparedStatement, updateCache: D1PreparedStatement] {
  return [
    raw
      .prepare(
        `INSERT INTO odometer_readings
           (id, garage_id, vehicle_id, reading_km, recorded_on, source)
         VALUES (?,?,?,?,?,?)`,
      )
      .bind(
        input.readingId,
        input.garageId,
        input.vehicleId,
        input.readingKm,
        input.recordedOn,
        input.source,
      ),
    raw
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
        input.vehicleId,
        input.garageId,
        input.recordedOn,
      ),
  ];
}
