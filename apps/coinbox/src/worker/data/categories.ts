import { asc, eq, or, sql } from "drizzle-orm";
import { LedgerScopedRepo } from "./base";
import { categories } from "../schema";

/**
 * The category list behind the entry form's picker.
 *
 * NOT ledger-scoped in the usual way, and this is the deliberate exception
 * rather than an oversight. Global rows (`ledger_id IS NULL`) are the 16
 * seeded categories and must be visible to everyone; a ledger may also define
 * its own. So the predicate is "global OR mine", the same shape Odometry uses
 * for `part_types` and the same shape `uq_category_code` indexes.
 *
 * It does NOT use `this.where()`, because that would AND in
 * `ledger_id = ?` and hide every global row -- the picker would come back
 * empty and nothing would report an error. The predicate is written out here
 * instead, which is why this class does not simply inherit the default.
 */
export class CategoryRepo extends LedgerScopedRepo {
  async list() {
    return this.db
      .select({
        id: categories.id,
        code: categories.code,
        name: categories.name,
        sortOrder: categories.sortOrder,
      })
      .from(categories)
      .where(
        sql`${categories.isActive} = 1 AND (${categories.ledgerId} IS NULL OR ${categories.ledgerId} = ${this.ledgerId})`,
      )
      .orderBy(asc(categories.sortOrder), asc(categories.name));
  }
}

/**
 * Vehicles the caller may attach a transaction to.
 *
 * THE ONE ENDPOINT IN COINBOX THAT DOES NOT FILTER ON ledger_id, because it
 * cannot: vehicles belong to Odometry's garage axis. It asks Odometry's
 * question instead -- which vehicles are in a garage this USER is a member of
 * -- exactly as `assertUsableVehicle()` does on the write path.
 *
 * A garage co-member seeing the owner's vehicles here is CORRECT, not a leak.
 * Sharing a fleet is what a garage is for. The leak would be that same person
 * seeing the owner's transactions, and that is a different axis entirely --
 * which is why `tests/isolation.test.ts` asserts both halves separately.
 *
 * Raw SQL rather than Drizzle: `vehicles` and `garage_members` are
 * deliberately absent from Coinbox's Drizzle schema so this app cannot type a
 * query against the other portal's tables. Reaching for raw SQL here is the
 * code acknowledging it is crossing a boundary on purpose, in the one place
 * that is allowed to.
 */
export interface PickableVehicle {
  id: string;
  nickname: string;
  /**
   * The cached current odometer, so the entry form can show what the last
   * reading was and flag an implausible new one before it is written. Not
   * money, and visible to garage co-members in Odometry already.
   */
  currentOdometerKm: number;
}

export class VehicleRepo extends LedgerScopedRepo {
  async list(): Promise<PickableVehicle[]> {
    const res = await this.raw
      .prepare(
        `SELECT v.id, v.nickname, v.current_odometer_km
           FROM vehicles v
           JOIN garage_members gm ON gm.garage_id = v.garage_id
          WHERE gm.user_id = ? AND v.is_active = 1
          ORDER BY v.nickname`,
      )
      .bind(this.scope.userId)
      .all<{ id: string; nickname: string; current_odometer_km: number }>();

    return res.results.map((v) => ({
      id: v.id,
      nickname: v.nickname,
      currentOdometerKm: v.current_odometer_km,
    }));
  }
}
