import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";

/**
 * Tables shared by every portal, mirroring migrations/0001_init.sql.
 *
 * ONLY genuinely cross-portal tables belong here. `garages` and
 * `garage_members` stay in Odometry, and `ledgers` stays in Coinbox, because
 * each is one portal's ownership axis and neither portal should be able to
 * type a query against the other's.
 *
 * Migrations are hand-written SQL applied by wrangler, not generated from
 * this file. This exists for typed queries; the SQL files are the source of
 * truth for the shape of the database.
 */

export const users = sqliteTable("users", {
  id: text("id").primaryKey(),
  email: text("email").notNull().unique(),
  displayName: text("display_name"),
  timezone: text("timezone").notNull().default("Asia/Kuala_Lumpur"),
  createdAt: text("created_at").notNull(),
});

/**
 * Scoped by user_id, not by any tenant -- settings belong to a person.
 *
 * KNOWN WART: this table mixes genuinely shared columns (currency,
 * dateFormat, distanceUnit) with Odometry-specific ones (dueSoon*,
 * fallbackKmPerDay, staleOdometerDays). Coinbox reads only the shared ones
 * and must not grow a dependency on the rest. Splitting it is a deliberate
 * non-goal for now: it is recorded here so it is not "discovered" later and
 * refactored by accident.
 */
export const userSettings = sqliteTable("user_settings", {
  userId: text("user_id").primaryKey(),
  distanceUnit: text("distance_unit", { enum: ["km", "mi"] }).notNull().default("km"),
  currency: text("currency").notNull().default("MYR"),
  dateFormat: text("date_format").notNull().default("DD/MM/YYYY"),
  dueSoonDays: integer("due_soon_days").notNull().default(30),
  dueSoonKm: integer("due_soon_km").notNull().default(1000),
  fallbackKmPerDay: integer("fallback_km_per_day").notNull().default(30),
  staleOdometerDays: integer("stale_odometer_days").notNull().default(45),
});
