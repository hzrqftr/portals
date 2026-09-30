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
  //
  // `signed_sen` IS DELIBERATELY ABSENT.
  //
  // It exists in the database as a VIRTUAL generated column, and it is not
  // declared here because Drizzle's SQLite insert names EVERY column of the
  // table, filling unprovided ones with DEFAULT -- it does not emit only the
  // keys you pass. So merely declaring it, without ever setting it, made every
  // insert fail with "cannot INSERT into generated column". Found by the
  // isolation suite on the first POST.
  //
  // Reading it goes through raw SQL (see monthlySummary and the v_txn_monthly
  // view), which is where aggregation belongs anyway under invariant 4.
  // Leaving it out makes the mistake unmakeable rather than merely documented.
  //
  sourceTypeRaw: text("source_type_raw"),
  sourceCategoryRaw: text("source_category_raw"),
  //
  // How the row got here: 1 only when the recurring materialiser wrote it.
  //
  // Unlike `signed_sen` this IS a real stored column, so it belongs here --
  // and it needs its default declared, because Drizzle names every column on
  // insert and an undeclared default would arrive as NULL against a NOT NULL.
  //
  // It is PROVENANCE, not state. Absent from `transactionPatch` (which is
  // `.strict()`) exactly as the two `source_*_raw` columns are, so an edit
  // cannot rewrite how a row entered the ledger.
  isRecurring: integer("is_recurring").notNull().default(0),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

/**
 * A declared recurring entry: "Insurance, RM 230, the 15th of every month".
 *
 * DECLARED, not detected -- nothing inspects history to infer a pattern, which
 * is what the spec's non-goal rules out.
 *
 * The schedule is `intervalMonths` + `dayOfMonth`, and the phase comes from
 * `startsOn`. There is deliberately no `frequency` enum beside them and no
 * `nextDueOn` cursor: the first would be a second column encoding a fact the
 * first already carries, and the second would be a cache of something derivable
 * from `recurringPostings`, which is the actual source of truth.
 *
 * `vehicleId` carries no foreign key for the same reason `transactions` does
 * not: it points into Odometry's garage-scoped tables, and a garage deletion
 * must not cascade into a schedule. Validated on write, and RE-validated when
 * the cron posts months later -- see data/recurring-runner.ts.
 */
export const recurringRules = sqliteTable("recurring_rules", {
  id: text("id").primaryKey(),
  ledgerId: text("ledger_id").notNull(),
  item: text("item").notNull(),
  description: text("description"),
  categoryId: text("category_id").notNull(),
  vehicleId: text("vehicle_id"),
  amountSen: integer("amount_sen").notNull(),
  direction: text("direction").notNull().$type<"in" | "out">(),
  intervalMonths: integer("interval_months").notNull(),
  dayOfMonth: integer("day_of_month").notNull(),
  startsOn: text("starts_on").notNull(),
  endsOn: text("ends_on"),
  isActive: integer("is_active").notNull().default(1),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

/**
 * One row per occurrence that has been CLAIMED, and the reason the cron cannot
 * double-post: the primary key `(rule_id, occurred_on)` makes a second attempt
 * fail at the database rather than at a code path someone can reorder.
 *
 * `transactionId` goes NULL when its transaction is deleted while the claim
 * row stays, so a deleted entry is not helpfully re-created on the next run.
 */
export const recurringPostings = sqliteTable("recurring_postings", {
  ruleId: text("rule_id").notNull(),
  occurredOn: text("occurred_on").notNull(),
  transactionId: text("transaction_id"),
  postedAt: text("posted_at").notNull(),
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

// ------------------------------------------------------------ family fund
//
// Migration 0020, docs/coinbox-spec.md §11. A SEPARATE BOOK: nothing here is
// a transaction, and no view reads these tables, so the pot's spending can
// never reach the personal ledger's totals.
//
// Only `funds` carries a ledger id. The child tables reach the tenant through
// fund_id, and FundRepo resolves the fund under the ledger predicate before
// touching any of them -- the way recurring_postings reaches it through rule_id.

export const funds = sqliteTable("funds", {
  id: text("id").primaryKey(),
  ledgerId: text("ledger_id").notNull(),
  name: text("name").notNull().default("Family fund"),
  createdAt: text("created_at").notNull(),
});

/** Names, not users: the siblings never sign in. */
export const fundMembers = sqliteTable("fund_members", {
  id: text("id").primaryKey(),
  fundId: text("fund_id").notNull(),
  name: text("name").notNull(),
  /** Pre-fills the entry sheet. Never used to compute anything owed. */
  defaultSen: integer("default_sen").notNull().default(0),
  recurringRuleId: text("recurring_rule_id"),
  isActive: integer("is_active").notNull().default(1),
  createdAt: text("created_at").notNull(),
});

/**
 * A row with a member is a contribution; without one, anything else. No `kind`
 * column -- it would restate member_id and be free to disagree with it.
 *
 * `signed_sen` is absent for the reason spelled out on `transactions`: Drizzle
 * names every declared column on insert, and a generated one rejects that.
 */
export const fundEntries = sqliteTable("fund_entries", {
  id: text("id").primaryKey(),
  fundId: text("fund_id").notNull(),
  occurredOn: text("occurred_on").notNull(),
  item: text("item").notNull(),
  description: text("description"),
  amountSen: integer("amount_sen").notNull(),
  direction: text("direction").notNull().$type<"in" | "out">(),
  memberId: text("member_id"),
  /** 'YYYY-MM' the contribution pays for -- not always the month it was paid in. */
  forMonth: text("for_month"),
  /** Set when a recurring rule in the personal ledger posted this row. */
  transactionId: text("transaction_id"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

/** Compared with the recorded pot, never applied to it. */
export const fundBalanceChecks = sqliteTable("fund_balance_checks", {
  id: text("id").primaryKey(),
  fundId: text("fund_id").notNull(),
  checkedOn: text("checked_on").notNull(),
  balanceSen: integer("balance_sen").notNull(),
  createdAt: text("created_at").notNull(),
});
