import { eq, type SQL } from "drizzle-orm";
import { BaseScopedRepo, makeDb as makeCoreDb, NotFoundError } from "@portals/core/worker";
import type { Env, Scope } from "../types";
import * as schema from "../schema";

/**
 * Odometry's tenant axis: garage_id. Invariant 2, spec 5.1.
 *
 * The generic machinery -- the Drizzle client, the constructor, and a
 * `where()` that cannot be called without folding in the tenant predicate --
 * lives in @portals/core/worker. What is Odometry's own is the answer to
 * "which column carries ownership", and that is the one thing this class
 * supplies.
 *
 * Coinbox answers it differently (ledger_id), which is exactly why the base
 * class takes it as a parameter instead of hardcoding a column. A garage is
 * shared so a household can co-own a fleet; a ledger is not.
 */

/** Any table carrying a garage_id. */
type ScopedTable = { garageId: unknown; id: unknown };

export abstract class GarageScopedRepo extends BaseScopedRepo<
  typeof schema,
  Scope,
  ScopedTable
> {
  protected get garageId(): string {
    return this.scope.garageId;
  }

  protected override tenantPredicate(table: ScopedTable): SQL {
    return eq(table.garageId as never, this.garageId);
  }

  /** Reads better at the call sites than `tenantPredicate` does. */
  protected inGarage<T extends ScopedTable>(table: T): SQL {
    return this.tenantPredicate(table);
  }

  /**
   * Spec 5.3: never trust an ID from the client. Before inserting a row that
   * references a vehicle, prove that vehicle is in the caller's garage --
   * otherwise a client can attach its own service records to someone else's
   * car, and the read path will happily hide the evidence.
   *
   * Throws NotFoundError, not ForbiddenError: a 403 would confirm the ID
   * exists somewhere, which leaks the thing we are protecting.
   */
  protected async assertOwnedVehicle(vehicleId: string): Promise<void> {
    const row = await this.raw
      .prepare(`SELECT 1 FROM vehicles WHERE id = ? AND garage_id = ? LIMIT 1`)
      .bind(vehicleId, this.garageId)
      .first();
    if (!row) throw new NotFoundError("Vehicle not found");
  }

  /** Part types are global (garage_id IS NULL) or owned by this garage. */
  protected async assertUsablePartType(partTypeId: string): Promise<void> {
    const row = await this.raw
      .prepare(
        `SELECT 1 FROM part_types
          WHERE id = ? AND (garage_id IS NULL OR garage_id = ?) LIMIT 1`,
      )
      .bind(partTypeId, this.garageId)
      .first();
    if (!row) throw new NotFoundError("Part type not found");
  }
}

export function makeDb(env: Env): {
  db: ReturnType<typeof makeCoreDb<typeof schema>>["db"];
  raw: D1Database;
} {
  return makeCoreDb(env.DB, schema);
}
