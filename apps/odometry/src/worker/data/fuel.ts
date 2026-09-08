import {
  fuelSegmentSql,
  mapFuelSegment,
  type FuelSegmentRaw,
  type FuelSegmentRow,
} from "@portals/core/worker";
import { GarageScopedRepo } from "./base";

/**
 * The row shape this portal has always returned. Re-exported under its old
 * name so callers and tests do not have to move with the SQL.
 */
export type FuelFillRow = FuelSegmentRow;

/**
 * Fills for one vehicle, newest first.
 *
 * THE ARITHMETIC MOVED TO @portals/core/worker's fuel.ts, unchanged, when
 * Coinbox needed the same segments to draw a consumption chart. What stayed
 * here is the only part that is Odometry's: the garage predicate. Read the
 * comment on `fuelSegmentSql` before touching either half -- the reasons the
 * segment runs full tank to full tank, and is ordered by odometer rather than
 * by date, are recorded there.
 */
export class FuelRepo extends GarageScopedRepo {
  async list(vehicleId: string): Promise<FuelFillRow[]> {
    await this.assertOwnedVehicle(vehicleId);

    // Bound by POSITION IN THE STATEMENT TEXT, not by CTE: vehicle then garage,
    // which is the order they appear in the innermost WHERE. Swapping them
    // compares the garage id against a vehicle id and returns nothing at all,
    // with no error.
    const res = await this.raw
      .prepare(fuelSegmentSql())
      .bind(vehicleId, this.garageId)
      .all<FuelSegmentRaw>();

    return res.results.map(mapFuelSegment);
  }
}
