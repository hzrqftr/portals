/**
 * THE ODOMETER WRITE. One definition, every caller, both portals.
 *
 * Appending a reading (odometerWriteStatements), correcting one
 * (odometerUpdateStatement) and rebuilding the vehicle's cached figure
 * (recacheOdometerStatement) all live here, because they are three halves of
 * one rule and a copy of any of them is invisible when it goes wrong.
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
 * indistinguishable from a real reading. The client-side plausibility warning
 * in Coinbox's fuel fields is the only defence against it, which is why it
 * exists even though it blocks nothing.
 *
 * Such a reading used to be PERMANENT, there being no way to change one after
 * the fact. That is no longer true for a reading a SERVICE wrote: migration
 * 0014 linked the two, so correcting the service corrects its reading (see
 * odometerUpdateStatement below). A reading entered through the quick odometer
 * flow, or by a Coinbox fuel fill, still has no edit path.
 */
export async function assertReadingNotBackwards(
  raw: D1Database,
  input: {
    vehicleId: string;
    garageId: string;
    recordedOn: string;
    readingKm: number;
    /**
     * The reading being EDITED, excluded from the comparison.
     *
     * Correcting a service can move its date later, which puts that service's
     * own reading strictly before its new date -- so without this the check
     * compares the reading against itself and rejects every forward re-dating.
     * Omit it when appending a new reading, where there is nothing to exclude.
     */
    excludeReadingId?: string | null;
  },
): Promise<void> {
  const prior = await raw
    .prepare(
      `SELECT MAX(reading_km) AS max_km
         FROM odometer_readings
        WHERE vehicle_id = ? AND garage_id = ? AND recorded_on < ?
          AND (? IS NULL OR id <> ?)`,
    )
    .bind(
      input.vehicleId,
      input.garageId,
      input.recordedOn,
      input.excludeReadingId ?? null,
      input.excludeReadingId ?? null,
    )
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

/**
 * Correct a reading that already exists, for the caller's batch.
 *
 * The counterpart to odometerWriteStatements for the EDIT path: a service
 * whose odometer was keyed in wrong has to move its reading rather than append
 * a second one, or the vehicle's history gains a figure that never happened
 * and nothing can tell the two apart afterwards.
 *
 * Scoped on garage_id as well as id. The id alone is a claim from a caller
 * that has already been scoped, but the predicate costs nothing and this is
 * the one write in the system that can rewrite recorded history.
 */
export function odometerUpdateStatement(
  raw: D1Database,
  input: {
    readingId: string;
    garageId: string;
    readingKm: number;
    recordedOn: string;
  },
): D1PreparedStatement {
  return raw
    .prepare(
      `UPDATE odometer_readings
          SET reading_km = ?, recorded_on = ?
        WHERE id = ? AND garage_id = ?`,
    )
    .bind(input.readingKm, input.recordedOn, input.readingId, input.garageId);
}

/**
 * Rebuild vehicles.current_odometer_km from the readings that actually exist.
 *
 * odometerWriteStatements' cache update only ever moves the odometer FORWARD
 * in time, which is right when appending -- a forgotten reading from March
 * must not overwrite today's figure. It is wrong for a CORRECTION: 12,000
 * keyed as 112,000 and then fixed would leave the dashboard showing 112,000,
 * a number no reading supports and nothing on screen able to contradict.
 *
 * So the edit and delete paths recompute instead of nudging. Run it LAST in
 * the batch, after the reading it should see has been written.
 *
 * Two scalar subqueries rather than one row-value `SET (a, b) = (SELECT ...)`,
 * which is a newer SQLite construct than this needs to depend on.
 *
 * A vehicle whose last reading was just deleted lands back on 0 with a NULL
 * date, which is not a fallback but the exact state a vehicle created without
 * an odometer is already in -- current_odometer_km is NOT NULL DEFAULT 0
 * (migrations/0001) and the date is what actually distinguishes "never
 * recorded" from "recorded as zero". COALESCE on the km is therefore
 * load-bearing: without it the delete path violates the NOT NULL constraint,
 * and the visible symptom is a 500 on deleting the last service rather than
 * anything pointing at the cache.
 */
export function recacheOdometerStatement(
  raw: D1Database,
  input: { garageId: string; vehicleId: string },
): D1PreparedStatement {
  const newest = `SELECT %COL% FROM odometer_readings
                   WHERE vehicle_id = ? AND garage_id = ?
                   ORDER BY recorded_on DESC, rowid DESC LIMIT 1`;

  return raw
    .prepare(
      `UPDATE vehicles
          SET current_odometer_km = COALESCE((${newest.replace("%COL%", "reading_km")}), 0),
              odometer_updated_on = (${newest.replace("%COL%", "recorded_on")}),
              updated_at = ?
        WHERE id = ? AND garage_id = ?`,
    )
    .bind(
      input.vehicleId,
      input.garageId,
      input.vehicleId,
      input.garageId,
      nowIso(),
      input.vehicleId,
      input.garageId,
    );
}
