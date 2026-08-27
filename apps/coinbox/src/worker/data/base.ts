import { eq, type SQL } from "drizzle-orm";
import { BaseScopedRepo, makeDb as makeCoreDb, NotFoundError } from "@portals/core/worker";
import type { Env, Scope } from "../types";
import * as schema from "../schema";

/**
 * Coinbox's tenant axis: ledger_id.
 *
 * The generic machinery lives in @portals/core/worker. What is Coinbox's own
 * is the answer to "which column carries ownership" -- and it is a different
 * answer from Odometry's, which is the entire reason the base class takes it
 * as a parameter instead of hardcoding one.
 */

/** Any table carrying a ledger_id. */
type ScopedTable = { ledgerId: unknown; id: unknown };

export abstract class LedgerScopedRepo extends BaseScopedRepo<
  typeof schema,
  Scope,
  ScopedTable
> {
  protected get ledgerId(): string {
    return this.scope.ledgerId;
  }

  protected override tenantPredicate(table: ScopedTable): SQL {
    return eq(table.ledgerId as never, this.ledgerId);
  }

  protected inLedger<T extends ScopedTable>(table: T): SQL {
    return this.tenantPredicate(table);
  }

  /**
   * THE ONE PLACE THE TWO OWNERSHIP AXES MEET.
   *
   * A transaction may reference a vehicle (fuel, servicing, road tax). The
   * transaction is ledger-scoped; the vehicle is garage-scoped. So this check
   * cannot use the ledger predicate -- it has to ask Odometry's question:
   * is this vehicle in a garage the CALLER is a member of?
   *
   * Getting it wrong in the lax direction lets someone attach their spending
   * to a stranger's car, and worse, lets a crafted vehicle_id confirm which
   * vehicle ids exist. Getting it wrong in the strict direction is merely
   * annoying. It throws NotFoundError, not Forbidden, for the usual reason: a
   * 403 would confirm the id exists somewhere.
   *
   * Nothing calls this yet -- there are no transactions. It is written now
   * because it is the subtlest rule in this portal and the isolation suite
   * asserts it from the start.
   */
  protected async assertUsableVehicle(vehicleId: string): Promise<void> {
    const row = await this.raw
      .prepare(
        `SELECT 1
           FROM vehicles v
           JOIN garage_members gm ON gm.garage_id = v.garage_id
          WHERE v.id = ? AND gm.user_id = ?
          LIMIT 1`,
      )
      .bind(vehicleId, this.scope.userId)
      .first();
    if (!row) throw new NotFoundError("Vehicle not found");
  }
}

export function makeDb(env: Env): {
  db: ReturnType<typeof makeCoreDb<typeof schema>>["db"];
  raw: D1Database;
} {
  return makeCoreDb(env.DB, schema);
}
