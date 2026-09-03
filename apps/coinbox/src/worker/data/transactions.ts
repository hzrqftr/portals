import { and, desc, eq, like, or, sql } from "drizzle-orm";
import {
  NotFoundError,
  assertReadingNotBackwards,
  odometerWriteStatements,
} from "@portals/core/worker";
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
  /** "1" = only entries a recurring rule posted, "0" = only typed ones. */
  recurring?: "0" | "1";
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
    if (filters.recurring) {
      conditions.push(eq(transactions.isRecurring, filters.recurring === "1" ? 1 : 0));
    }
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
        isRecurring: transactions.isRecurring,
      })
      .from(transactions)
      .innerJoin(categories, eq(categories.id, transactions.categoryId))
      .where(this.where(transactions, ...conditions))
      // Date first, then submission order within the day: entries the owner
      // files in the order he spent (lunch, then fuel) come back newest-first
      // inside their date. `created_at` is never shown and never sortable --
      // it exists only to give the day a stable internal sequence.
      //
      // `id` is the final tiebreak and is LOAD-BEARING, not decoration. All
      // 4,421 imported rows share ONE created_at (the import batch's
      // timestamp), so for any past date the first two keys tie completely and
      // SQLite is then free to return those rows in whatever order the chosen
      // plan happens to produce -- which can differ between a filtered and an
      // unfiltered query, since only one of them uses idx_txn_ledger_date. The
      // resulting order is arbitrary either way (UUIDs carry no meaning), but
      // it must at least be the SAME arbitrary order on every refresh.
      .orderBy(
        desc(transactions.occurredOn),
        desc(transactions.createdAt),
        desc(transactions.id),
      )
      // 500 by default: the whole ledger is 648 rows and grows by roughly 80
      // a month, so the table shows everything for a filtered month and very
      // nearly everything unfiltered. Past a few thousand this wants
      // virtualising rather than a bigger number.
      .limit(Math.min(filters.limit ?? 500, 1000));
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

  /**
   * Creating an entry, and -- when it is a fill-up -- the vehicle facts that
   * go with it.
   *
   * THIS IS THE ONLY WRITE IN THIS REPO THAT CROSSES INTO THE OTHER PORTAL.
   * docs/coinbox-spec.md §7 deferred exactly this, on the grounds that
   * coupling the two portals' write paths is the half that can leak. It was
   * reopened deliberately: the alternative is keying the odometer twice, in
   * two apps, and an odometer nobody keeps entering is the top-rated product
   * risk in the fleet spec (§11.7).
   *
   * Three guards make it safe, and each one is broken on purpose in
   * tests/isolation.test.ts:
   *
   *   1. The category is a global seed row or this ledger's.
   *   2. The vehicle is in a garage the CALLER is a member of, and the garage
   *      id written to Odometry's tables is READ OFF THAT ROW -- never off the
   *      scope, which has no garageId and must never grow one.
   *   3. The reading does not run the odometer backwards.
   *
   * All of it goes in one batch(), which D1 runs atomically. That is what makes
   * a rejected fill leave NO transaction, no reading and no fill behind --
   * money without its litres, or an odometer that moved for an entry that does
   * not exist, are both worse than a plain failure.
   *
   * STATEMENT ORDER IS FORCED, because D1 enforces foreign keys statement by
   * statement and ignores PRAGMA foreign_keys = OFF: the reading and the
   * transaction must both exist before fuel_fills can reference them. Same
   * trap the recurring materialiser hit.
   */
  async create(input: TransactionCreate) {
    // Never trust an ID from the client (invariant 2). Both checks run before
    // the insert, and both throw NotFound rather than Forbidden so that a
    // crafted id cannot be used to discover what exists.
    await this.assertUsableCategory(input.categoryId);
    const vehicle = input.vehicleId ? await this.assertUsableVehicle(input.vehicleId) : null;

    const id = crypto.randomUUID();
    const at = nowIso();

    // Raw SQL rather than Drizzle so the transaction insert can share the fill's
    // batch. It also names every column explicitly, which sidesteps the
    // generated-column trap: Drizzle's SQLite insert names EVERY column of the
    // table, and merely declaring signed_sen made every insert fail.
    const statements: D1PreparedStatement[] = [
      this.raw
        .prepare(
          `INSERT INTO transactions
             (id, ledger_id, occurred_on, item, description, category_id,
              vehicle_id, amount_sen, direction, created_at, updated_at)
           VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
        )
        .bind(
          id,
          this.ledgerId,
          input.occurredOn,
          input.item,
          input.description ?? null,
          input.categoryId,
          input.vehicleId ?? null,
          input.amountSen,
          input.direction,
          at,
          at,
        ),
    ];

    if (input.fuel) {
      // Guaranteed by transactionCreateBody's refine, restated here because
      // this repo is also reachable from the recurring materialiser and a
      // non-null assertion would be the thing that survives a later change.
      if (!input.vehicleId || !vehicle) throw new NotFoundError("Vehicle not found");

      await assertReadingNotBackwards(this.raw, {
        vehicleId: input.vehicleId,
        garageId: vehicle.garageId,
        recordedOn: input.occurredOn,
        readingKm: input.fuel.odometerKm,
      });

      const readingId = crypto.randomUUID();
      const [insertReading, updateCache] = odometerWriteStatements(this.raw, {
        readingId,
        garageId: vehicle.garageId,
        vehicleId: input.vehicleId,
        readingKm: input.fuel.odometerKm,
        recordedOn: input.occurredOn,
        // Not a new 'fuel' source value: widening the CHECK constraint on
        // odometer_readings would cost a full table rebuild, and joining
        // fuel_fills answers the same question. See migration 0013.
        source: "manual",
      });

      // Reading first, then the transaction, THEN the fill that references
      // both. The cache update goes last; it is the only statement here whose
      // effect can legitimately be a no-op, when the fill is backdated.
      statements.unshift(insertReading);
      statements.push(
        this.raw
          .prepare(
            `INSERT INTO fuel_fills
               (id, garage_id, vehicle_id, odometer_reading_id, filled_on,
                litres_milli, is_full_tank, transaction_id, created_at)
             VALUES (?,?,?,?,?,?,?,?,?)`,
          )
          .bind(
            crypto.randomUUID(),
            vehicle.garageId,
            input.vehicleId,
            readingId,
            input.occurredOn,
            input.fuel.litresMilli,
            input.fuel.isFullTank ? 1 : 0,
            id,
            at,
          ),
        updateCache,
      );
    }

    await this.raw.batch(statements);

    return this.get(id);
  }

  async update(id: string, patch: TransactionPatch) {
    // Proves ownership before touching anything: get() carries the ledger
    // predicate, so editing someone else's row 404s here rather than later.
    await this.get(id);

    if (patch.categoryId) await this.assertUsableCategory(patch.categoryId);
    // The return value is unused here: an edit never writes into Odometry, so
    // it needs the authorisation but not the garage.
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
   * Deleting an entry. Hard, not a flag -- see the route comment for why.
   *
   * TWO GUARDS, not one, and that is deliberate. get() proves ownership and
   * 404s on someone else's row; the where() below carries the ledger predicate
   * again on the DELETE itself. Every other method here would merely LEAK on a
   * missing predicate. This one would DESTROY another person's data, so it
   * does not rely on a caller above it having done the right thing.
   *
   * `recurring_postings.transaction_id` is ON DELETE SET NULL, so the claim
   * row survives with a null transaction. That is what stops the nightly run
   * from cheerfully re-creating the entry the owner just deleted.
   */
  async remove(id: string): Promise<void> {
    await this.get(id);
    await this.db
      .delete(transactions)
      .where(this.where(transactions, eq(transactions.id, id)));
  }
}
