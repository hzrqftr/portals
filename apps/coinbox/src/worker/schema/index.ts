import { sqliteTable, text } from "drizzle-orm/sqlite-core";

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
