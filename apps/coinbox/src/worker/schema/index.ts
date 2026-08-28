import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";

/**
 * Drizzle mirror of Coinbox's tables. Migrations are hand-written SQL and are
 * the source of truth; this exists for typed queries.
 *
 * `users` and `user_settings` are shared and come from @portals/core/schema.
 * Odometry's `garages` and `garage_members` are deliberately ABSENT: they are
 * the other portal's ownership axis, and nothing here should be able to type
 * a query against them. The isolation suite reaches garage_members by raw SQL
 * precisely because it is testing a boundary this app cannot cross.
 */
export { users, userSettings } from "@portals/core/schema";

export const ledgers = sqliteTable("ledgers", {
  id: text("id").primaryKey(),
  ownerUserId: text("owner_user_id").notNull(),
  name: text("name").notNull().default("My Ledger"),
  createdAt: text("created_at").notNull(),
});

/**
 * Flat, and NOT bound to direction. Any category may appear as either `in` or
 * `out` -- four of the owner's real categories do. There is no `direction`
 * column and adding one would make the schema unable to hold his own data.
 *
 * `ledgerId` NULL is a global seed row, following the `part_types` precedent.
 */
export const categories = sqliteTable("categories", {
  id: text("id").primaryKey(),
  ledgerId: text("ledger_id"),
  code: text("code").notNull(),
  name: text("name").notNull(),
  sortOrder: integer("sort_order").notNull().default(0),
  isActive: integer("is_active").notNull().default(1),
  createdAt: text("created_at").notNull(),
});

/**
 * The ledger.
 *
 * `signedSen` is a GENERATED column and is therefore READ-ONLY. Drizzle has no
 * way to know that, so it is listed here for selects and must never appear in
 * an insert or update -- SQLite rejects the statement outright. Aggregate with
 * `sum(transactions.signedSen)` rather than repeating a CASE at each call site.
 *
 * `vehicleId` carries no foreign key by design: it points into Odometry's
 * garage-scoped tables, and a database-level reference would let a garage
 * deletion cascade into financial history. It is validated on write instead,
 * by assertUsableVehicle() in data/base.ts.
 */
export const transactions = sqliteTable("transactions", {
  id: text("id").primaryKey(),
  ledgerId: text("ledger_id").notNull(),
  occurredOn: text("occurred_on").notNull(),
  item: text("item").notNull(),
  description: text("description"),
  categoryId: text("category_id").notNull(),
  vehicleId: text("vehicle_id"),
  amountSen: integer("amount_sen").notNull(),
  direction: text("direction").notNull().$type<"in" | "out">(),
  /** READ-ONLY. Generated in SQL; never insert or update this. */
  signedSen: integer("signed_sen"),
  sourceTypeRaw: text("source_type_raw"),
  sourceCategoryRaw: text("source_category_raw"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export const importBatches = sqliteTable("import_batches", {
  id: text("id").primaryKey(),
  ledgerId: text("ledger_id").notNull(),
  source: text("source").notNull(),
  rowCount: integer("row_count").notNull().default(0),
  startedAt: text("started_at").notNull(),
  finishedAt: text("finished_at"),
});

/** `rowHash` covers the source row's fields PLUS its line number -- see 0011. */
export const importRows = sqliteTable("import_rows", {
  batchId: text("batch_id").notNull(),
  rowHash: text("row_hash").notNull(),
  sourceLine: integer("source_line").notNull(),
  transactionId: text("transaction_id"),
});
