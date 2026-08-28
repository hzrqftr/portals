import { and, desc, eq, like, or, sql } from "drizzle-orm";
import { NotFoundError } from "@portals/core/worker";
import { nowIso } from "@portals/core";
import { LedgerScopedRepo } from "./base";
import { transactions, categories } from "../schema";
import type { TransactionCreate, TransactionPatch } from "@shared/zod";

export interface TransactionFilters {
  /** `YYYY-MM`. */
  month?: string;
  categoryId?: string;
  direction?: "in" | "out";
  /** Substring of item or description. */
  q?: string;
  limit?: number;
}

/**
 * The ledger.
 *
 * Every read goes through `this.where(transactions, ...)`, which folds in
 * `ledger_id = ?` before any other condition. D1 has no row-level security, so
 * a missing predicate here is a data leak with nothing behind it to catch --
 * and the base class makes omitting it impossible rather than merely
 * discouraged.
 */
export class TransactionRepo extends LedgerScopedRepo {
  async list(filters: TransactionFilters = {}) {
    const conditions = [];

    if (filters.month) {
      // substr rather than a range: occurred_on is TEXT 'YYYY-MM-DD', so a
      // prefix comparison is exact and needs no date arithmetic in the Worker.
      conditions.push(eq(sql`substr(${transactions.occurredOn}, 1, 7)`, filters.month));
    }
    if (filters.categoryId) conditions.push(eq(transactions.categoryId, filters.categoryId));
    if (filters.direction) conditions.push(eq(transactions.direction, filters.direction));
    if (filters.q) {
      const needle = `%${filters.q}%`;
      conditions.push(or(like(transactions.item, needle), like(transactions.description, needle)));
    }

    return this.db
      .select({
        id: transactions.id,
        occurredOn: transactions.occurredOn,
        item: transactions.item,
        description: transactions.description,
        categoryId: transactions.categoryId,
        categoryName: categories.name,
        categoryCode: categories.code,
        vehicleId: transactions.vehicleId,
        amountSen: transactions.amountSen,
        direction: transactions.direction,
      })
      .from(transactions)
      .innerJoin(categories, eq(categories.id, transactions.categoryId))
      .where(this.where(transactions, ...conditions))
      .orderBy(desc(transactions.occurredOn), desc(transactions.createdAt))
      .limit(Math.min(filters.limit ?? 200, 500));
  }

  async get(id: string) {
    const [row] = await this.db
      .select()
      .from(transactions)
      .where(this.where(transactions, eq(transactions.id, id)))
      .limit(1);
    if (!row) throw new NotFoundError("Transaction not found");
    return row;
  }

  /**
   * Monthly totals, aggregated by the `v_txn_monthly` view.
   *
   * Invariant 4: rollups are SQL, never a JS loop. Workers allow 10ms CPU, and
   * summing a few hundred rows in JavaScript works right up until it does not.
   *
   * The view is queried through `this.raw` because it is a view rather than a
   * Drizzle table -- but the ledger predicate is still bound explicitly here,
   * and this is the one place in the repo where that is done by hand rather
   * than by `this.where()`. It is written on one line with the bind adjacent
   * so the two cannot drift apart.
   */
  async monthlySummary(month?: string) {
    const sqlText = month
      ? `SELECT month, category_code, category_name, in_sen, out_sen, net_sen, txn_count
           FROM v_txn_monthly WHERE ledger_id = ? AND month = ? ORDER BY out_sen DESC`
      : `SELECT month,
                SUM(in_sen)    AS in_sen,
                SUM(out_sen)   AS out_sen,
                SUM(net_sen)   AS net_sen,
                SUM(txn_count) AS txn_count
           FROM v_txn_monthly WHERE ledger_id = ? GROUP BY month ORDER BY month DESC`;

    const stmt = month
      ? this.raw.prepare(sqlText).bind(this.ledgerId, month)
      : this.raw.prepare(sqlText).bind(this.ledgerId);

    const res = await stmt.all();
    return res.results;
  }

  async create(input: TransactionCreate) {
    // Never trust an ID from the client (invariant 2). Both checks run before
    // the insert, and both throw NotFound rather than Forbidden so that a
    // crafted id cannot be used to discover what exists.
    await this.assertUsableCategory(input.categoryId);
    if (input.vehicleId) await this.assertUsableVehicle(input.vehicleId);

    const id = crypto.randomUUID();
    const at = nowIso();

    await this.db.insert(transactions).values({
      id,
      ledgerId: this.ledgerId,
      occurredOn: input.occurredOn,
      item: input.item,
      description: input.description ?? null,
      categoryId: input.categoryId,
      vehicleId: input.vehicleId ?? null,
      amountSen: input.amountSen,
      direction: input.direction,
      createdAt: at,
      updatedAt: at,
    });

    return this.get(id);
  }

  async update(id: string, patch: TransactionPatch) {
    // Proves ownership before touching anything: get() carries the ledger
    // predicate, so editing someone else's row 404s here rather than later.
    await this.get(id);

    if (patch.categoryId) await this.assertUsableCategory(patch.categoryId);
    if (patch.vehicleId) await this.assertUsableVehicle(patch.vehicleId);

    // An explicit null clears; an omitted key leaves the column alone. Same
    // convention as Odometry's VehicleSheet edit path.
    const values: Record<string, unknown> = { updatedAt: nowIso() };
    for (const key of ["occurredOn", "item", "categoryId", "amountSen", "direction"] as const) {
      if (patch[key] !== undefined) values[key] = patch[key];
    }
    if (patch.description !== undefined) values.description = patch.description ?? null;
    if (patch.vehicleId !== undefined) values.vehicleId = patch.vehicleId ?? null;

    await this.db
      .update(transactions)
      .set(values)
      .where(this.where(transactions, eq(transactions.id, id)));

    return this.get(id);
  }

  /**
   * A category is usable if it is a global seed row or belongs to this ledger.
   * Mirrors Odometry's assertUsablePartType: the same "global or mine" shape
   * that `uq_category_code` indexes.
   */
  private async assertUsableCategory(categoryId: string): Promise<void> {
    const [row] = await this.db
      .select({ id: categories.id })
      .from(categories)
      .where(
        and(
          eq(categories.id, categoryId),
          or(sql`${categories.ledgerId} IS NULL`, eq(categories.ledgerId, this.ledgerId)),
        ),
      )
      .limit(1);
    if (!row) throw new NotFoundError("Category not found");
  }
}
