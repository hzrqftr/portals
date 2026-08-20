import { drizzle, type DrizzleD1Database } from "drizzle-orm/d1";
import { and, eq, type SQL } from "drizzle-orm";
import type { Env, Scope } from "../types";
import { NotFoundError } from "../errors";
import * as schema from "../schema";

/**
 * THE ONLY PLACE env.DB IS TOUCHED. CLAUDE.md invariant 2, spec 5.1.
 *
 * D1 has no row-level security. There is nothing behind this code to catch a
 * missing `WHERE garage_id = ?` -- a forgotten predicate is not a bug that
 * returns too many rows, it is one user reading another user's data. The
 * database will hand it over without complaint.
 *
 * Route handlers receive repositories that are already scoped. They cannot
 * import the binding or the Drizzle client, and the CI lint rule in
 * scripts/check-db-imports.mjs fails the build if they try.
 */

/** Any table carrying a garage_id. */
type ScopedTable = { garageId: unknown; id: unknown };

export abstract class ScopedRepo {
  constructor(
    protected readonly db: DrizzleD1Database<typeof schema>,
    protected readonly raw: D1Database,
    protected readonly scope: Scope,
  ) {}

  protected get garageId(): string {
    return this.scope.garageId;
  }

  /**
   * The garage predicate. Every query in every subclass starts from this.
   * Combine further conditions through `where` below rather than building a
   * bare `where()` clause, so the predicate cannot be left off by accident.
   */
  protected inGarage<T extends ScopedTable>(table: T): SQL {
    return eq(table.garageId as never, this.garageId);
  }

  protected where<T extends ScopedTable>(table: T, ...conditions: (SQL | undefined)[]): SQL {
    return and(this.inGarage(table), ...conditions) as SQL;
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
  db: DrizzleD1Database<typeof schema>;
  raw: D1Database;
} {
  return { db: drizzle(env.DB, { schema }), raw: env.DB };
}
