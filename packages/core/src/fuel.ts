/**
 * Fuel arithmetic that both a Worker and a browser bundle need.
 *
 * The SQL that computes segments lives in `@portals/core/worker`; this file
 * holds only what a client component also has to be able to say, so that
 * Odometry's fuel table and Coinbox's chart cannot print different averages
 * for the same car.
 */

/**
 * A fill, with the consumption of the segment it closes.
 *
 * `lPer100km` and `kmPerLitre` are null on any fill that does not close a
 * segment: the first full fill of a vehicle's life, and every partial one.
 * That is a real answer, not missing data -- the same shape as a vehicle with
 * no service history being `unknown` rather than `overdue`.
 */
export interface FuelSegmentRow {
  id: string;
  filledOn: string;
  readingKm: number;
  litresMilli: number;
  isFullTank: number;
  /** Distance covered by the segment this fill closes. */
  distanceKm: number | null;
  /** Litres burned over that distance, INCLUDING any partial fills within it. */
  segmentLitresMilli: number | null;
  lPer100km: number | null;
  kmPerLitre: number | null;
}

/**
 * Lifetime consumption, DISTANCE-WEIGHTED: all the litres burned over all the
 * distance measured.
 *
 * NOT the mean of the per-segment rates. That over-weights short segments -- a
 * 40 km top-up-to-full counts as much as a 600 km highway run -- and the error
 * is largest exactly when fills are irregular, which is when someone looks.
 * Both figures sit in a plausible range, so nothing on screen can flag the
 * wrong one; this is the arithmetic the number claims to be.
 *
 * Returns null when no segment has been closed yet, which is the honest answer
 * for a vehicle with one fill on it.
 */
export function weightedLPer100km(
  rows: Pick<FuelSegmentRow, "distanceKm" | "segmentLitresMilli">[],
): number | null {
  let km = 0;
  let milli = 0;
  for (const r of rows) {
    if (r.distanceKm === null || r.segmentLitresMilli === null) continue;
    if (r.distanceKm <= 0) continue; // same guard as the SQL: two fills, one odometer
    km += r.distanceKm;
    milli += r.segmentLitresMilli;
  }
  return km > 0 ? (milli / 1000) * 100 / km : null;
}
