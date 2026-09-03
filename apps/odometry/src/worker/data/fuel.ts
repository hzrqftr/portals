import { GarageScopedRepo } from "./base";

/**
 * A fill, with the consumption of the segment it closes.
 *
 * `lPer100km` and `kmPerLitre` are null on any fill that does not close a
 * segment: the first full fill of a vehicle's life, and every partial one.
 * That is a real answer, not missing data -- the same shape as a vehicle with
 * no service history being `unknown` rather than `overdue`.
 */
export interface FuelFillRow {
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
 * CONSUMPTION IS ONLY COMPUTABLE FULL TANK TO FULL TANK.
 *
 * The tank level has to be the same at both ends of a segment, or the litres
 * you put in do not correspond to the distance you drove. So a segment runs
 * from one full fill to the next, and the litres attributed to it are ALL the
 * litres bought in between -- partial fills included, because that fuel was
 * burned over that distance too. Dropping them would understate consumption;
 * dividing a partial fill by its own distance would produce a number in an
 * entirely plausible range that is simply wrong.
 *
 * Ordered by odometer rather than by date, because that is the axis distance
 * is measured on and backdated entry is expected (@portals/core/worker's
 * odometer.ts explains why readings can arrive out of order).
 *
 * Two traps carried over verbatim from status.ts's usage rate, which is the
 * same class of arithmetic:
 *
 *   1. `* 1.0` FORCES FLOAT DIVISION. SQLite truncates integer division, so a
 *      segment would silently compute as 0 rather than 7.4 and then divide by
 *      zero downstream.
 *   2. `distance_km > 0` IS A GUARD, NOT A TIDY-UP. Two fills recorded at the
 *      same odometer is a real data-entry outcome, not an impossible one.
 */
const FUEL_SQL = `
WITH fills AS (
  SELECT f.id, f.filled_on, f.is_full_tank, f.litres_milli, r.reading_km,
         ROW_NUMBER() OVER (ORDER BY r.reading_km, f.filled_on) AS rn
    FROM fuel_fills f
    JOIN odometer_readings r ON r.id = f.odometer_reading_id
   WHERE f.vehicle_id = ? AND f.garage_id = ?
),
marks AS (
  SELECT *,
         MAX(CASE WHEN is_full_tank = 1 THEN rn END) OVER (
           ORDER BY rn ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING
         ) AS prev_full_rn
    FROM fills
),
seg AS (
  SELECT m.id, m.filled_on, m.reading_km, m.litres_milli, m.is_full_tank,
         CASE WHEN m.is_full_tank = 1 AND p.reading_km IS NOT NULL
              THEN m.reading_km - p.reading_km
         END AS distance_km,
         CASE WHEN m.is_full_tank = 1 AND p.reading_km IS NOT NULL
              THEN (SELECT SUM(s.litres_milli) FROM fills s
                     WHERE s.rn > m.prev_full_rn AND s.rn <= m.rn)
         END AS segment_litres_milli
    FROM marks m
    LEFT JOIN fills p ON p.rn = m.prev_full_rn
)
SELECT id, filled_on, reading_km, litres_milli, is_full_tank,
       distance_km, segment_litres_milli,
       CASE WHEN distance_km > 0
            THEN (segment_litres_milli / 1000.0) * 100.0 / (distance_km * 1.0)
       END AS l_per_100km,
       CASE WHEN segment_litres_milli > 0
            THEN (distance_km * 1.0) / (segment_litres_milli / 1000.0)
       END AS km_per_litre
  FROM seg
 ORDER BY reading_km DESC, filled_on DESC
`;

export class FuelRepo extends GarageScopedRepo {
  async list(vehicleId: string): Promise<FuelFillRow[]> {
    await this.assertOwnedVehicle(vehicleId);

    // Bound by POSITION IN THE STATEMENT TEXT, not by CTE: vehicle then garage,
    // which is the order they appear in the innermost WHERE. Swapping them
    // compares the garage id against a vehicle id and returns nothing at all,
    // with no error.
    const res = await this.raw.prepare(FUEL_SQL).bind(vehicleId, this.garageId).all<{
      id: string;
      filled_on: string;
      reading_km: number;
      litres_milli: number;
      is_full_tank: number;
      distance_km: number | null;
      segment_litres_milli: number | null;
      l_per_100km: number | null;
      km_per_litre: number | null;
    }>();

    return res.results.map((r) => ({
      id: r.id,
      filledOn: r.filled_on,
      readingKm: r.reading_km,
      litresMilli: r.litres_milli,
      isFullTank: r.is_full_tank,
      distanceKm: r.distance_km,
      segmentLitresMilli: r.segment_litres_milli,
      lPer100km: r.l_per_100km,
      kmPerLitre: r.km_per_litre,
    }));
  }
}
