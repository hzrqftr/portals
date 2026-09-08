/**
 * Full-tank-to-full-tank consumption, shared by both portals.
 *
 * This lived in apps/odometry/src/worker/data/fuel.ts until Coinbox needed the
 * same arithmetic to draw a consumption chart. It moved here rather than being
 * copied because the segment attribution below is invisible when it drifts:
 * two copies would keep returning plausible numbers while disagreeing, and
 * nothing on either screen could say which was right.
 *
 * WHAT DOES NOT LIVE HERE IS THE TENANT PREDICATE. The statement binds a
 * vehicle and a garage, and each portal proves its own right to that pair
 * before calling -- Odometry through GarageScopedRepo, Coinbox through
 * assertUsableVehicle()'s garage_members join. That is the same division
 * BaseScopedRepo draws, for the same reason.
 */

import type { FuelSegmentRow } from "../fuel";
export type { FuelSegmentRow };

/** The raw column shape the statement returns, before camel-casing. */
export interface FuelSegmentRaw {
  id: string;
  filled_on: string;
  reading_km: number;
  litres_milli: number;
  is_full_tank: number;
  distance_km: number | null;
  segment_litres_milli: number | null;
  l_per_100km: number | null;
  km_per_litre: number | null;
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
 * is measured on and backdated entry is expected (odometer.ts explains why
 * readings can arrive out of order).
 *
 * Two traps carried over verbatim from Odometry's usage rate, which is the
 * same class of arithmetic:
 *
 *   1. `* 1.0` FORCES FLOAT DIVISION. SQLite truncates integer division, so a
 *      segment would silently compute as 0 rather than 7.4 and then divide by
 *      zero downstream.
 *   2. `distance_km > 0` IS A GUARD, NOT A TIDY-UP. Two fills recorded at the
 *      same odometer is a real data-entry outcome, not an impossible one.
 *
 * ---------------------------------------------------------------------------
 * BINDS ARE POSITIONAL IN THE STATEMENT TEXT, NOT BY CLAUSE.
 * ---------------------------------------------------------------------------
 *
 * The `fills` CTE is the first thing in the statement, so its two binds are
 * always 1 = vehicleId and 2 = garageId, in that order. Swapping them compares
 * a garage id against a vehicle id and returns nothing at all, with no error.
 *
 * Anything `extraJoin` introduces binds AFTER those two, because it appears
 * later in the text. Do not add a `?` anywhere above the final SELECT without
 * re-counting every call site -- the root CLAUDE.md records what that costs:
 * a silently empty response rather than an exception.
 *
 * @param extraSelect Extra output columns, e.g. `, t.amount_sen AS amount_sen`.
 *                    Must begin with a comma. Joined against `seg`.
 * @param extraJoin   Extra joins, e.g. a LEFT JOIN onto the caller's own money.
 *                    `seg` carries `transaction_id` so a money join needs no
 *                    second trip through `fuel_fills`.
 */
export function fuelSegmentSql(
  opts: { extraSelect?: string; extraJoin?: string } = {},
): string {
  const { extraSelect = "", extraJoin = "" } = opts;
  return `
WITH fills AS (
  SELECT f.id, f.filled_on, f.is_full_tank, f.litres_milli, f.transaction_id,
         r.reading_km,
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
         m.transaction_id,
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
SELECT seg.id, seg.filled_on, seg.reading_km, seg.litres_milli, seg.is_full_tank,
       seg.distance_km, seg.segment_litres_milli,
       CASE WHEN seg.distance_km > 0
            THEN (seg.segment_litres_milli / 1000.0) * 100.0 / (seg.distance_km * 1.0)
       END AS l_per_100km,
       CASE WHEN seg.segment_litres_milli > 0
            THEN (seg.distance_km * 1.0) / (seg.segment_litres_milli / 1000.0)
       END AS km_per_litre${extraSelect}
  FROM seg
  ${extraJoin}
 ORDER BY seg.reading_km DESC, seg.filled_on DESC
`;
}

export function mapFuelSegment(r: FuelSegmentRaw): FuelSegmentRow {
  return {
    id: r.id,
    filledOn: r.filled_on,
    readingKm: r.reading_km,
    litresMilli: r.litres_milli,
    isFullTank: r.is_full_tank,
    distanceKm: r.distance_km,
    segmentLitresMilli: r.segment_litres_milli,
    lPer100km: r.l_per_100km,
    kmPerLitre: r.km_per_litre,
  };
}
