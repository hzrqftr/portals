import { and, eq, or, sql, type SQL } from "drizzle-orm";
import { BaseScopedRepo, makeDb as makeCoreDb, NotFoundError } from "@portals/core/worker";
import type { Scope } from "../types";
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
   * A category is usable if it is a global seed row or belongs to this ledger.
   * Mirrors Odometry's assertUsablePartType: the same "global or mine" shape
   * that `uq_category_code` indexes.
   *
   * Deliberately NOT `this.where()`: the ledger predicate alone would reject
   * the 20 global seed rows, which have a NULL ledger_id and belong to
   * everyone.
   *
   * Lives here rather than on one repository because both transactions and
   * recurring rules reference a category, and two copies of a validation rule
   * are two chances for one of them to be relaxed alone.
   */
  protected async assertUsableCategory(categoryId: string): Promise<void> {
    const [row] = await this.db
      .select({ id: schema.categories.id })
      .from(schema.categories)
      .where(
        and(
          eq(schema.categories.id, categoryId),
          or(
            sql`${schema.categories.ledgerId} IS NULL`,
            eq(schema.categories.ledgerId, this.ledgerId),
          ),
        ),
      )
      .limit(1);
    if (!row) throw new NotFoundError("Category not found");
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
   * IT RETURNS THE GARAGE ID, and that return value is load-bearing. A fill-up
   * writes into Odometry's garage-scoped tables, and the garage those rows are
   * stamped with MUST be the one this query proved the caller into -- read off
   * the vehicle row, in the same statement as the membership join.
   *
   * The alternative, putting a garageId on the Scope object, is the exact leak
   * both CLAUDE.md files warn about: it starts life "just for the vehicle
   * picker" and ends up in a WHERE clause. tests/isolation.test.ts asserts
   * /api/me never mentions one.
   */
  protected async assertUsableVehicle(vehicleId: string): Promise<{ garageId: string }> {
    const row = await this.raw
      .prepare(
        `SELECT v.garage_id AS garage_id
           FROM vehicles v
           JOIN garage_members gm ON gm.garage_id = v.garage_id
          WHERE v.id = ? AND gm.user_id = ?
          LIMIT 1`,
      )
      .bind(vehicleId, this.scope.userId)
      .first<{ garage_id: string }>();
    if (!row) throw new NotFoundError("Vehicle not found");
    return { garageId: row.garage_id };
  }
}

/**
 * Widened from `Env` to just the binding it uses, so the scheduled runner --
 * which is handed a minimal env -- can share this one construction rather than
 * growing a second, subtly different one.
 */
export function makeDb(env: { DB: D1Database }): {
  db: ReturnType<typeof makeCoreDb<typeof schema>>["db"];
  raw: D1Database;
} {
  return makeCoreDb(env.DB, schema);
}
