import { sql } from "drizzle-orm";
import { sqliteTable, text, integer, index, uniqueIndex } from "drizzle-orm/sqlite-core";

/**
 * Drizzle mirror of migrations/0001_init.sql.
 *
 * Migrations are hand-written SQL applied by wrangler, not generated from
 * this file. Views, partial indexes, CHECK constraints and generated columns
 * are all load-bearing here and none of them survive a round trip through
 * drizzle-kit cleanly. This file exists for typed queries; the SQL files are
 * the source of truth for the shape of the database.
 */

export const users = sqliteTable("users", {
  id: text("id").primaryKey(),
  email: text("email").notNull().unique(),
  displayName: text("display_name"),
  timezone: text("timezone").notNull().default("Asia/Kuala_Lumpur"),
  createdAt: text("created_at").notNull(),
});

export const garages = sqliteTable("garages", {
  id: text("id").primaryKey(),
  name: text("name").notNull().default("My Garage"),
  createdBy: text("created_by").notNull(),
  createdAt: text("created_at").notNull(),
});

export const garageMembers = sqliteTable("garage_members", {
  garageId: text("garage_id").notNull(),
  userId: text("user_id").notNull(),
  role: text("role", { enum: ["owner", "editor", "viewer"] }).notNull(),
});

export const userSettings = sqliteTable("user_settings", {
  userId: text("user_id").primaryKey(),
  distanceUnit: text("distance_unit", { enum: ["km", "mi"] }).notNull().default("km"),
  currency: text("currency").notNull().default("MYR"),
  dateFormat: text("date_format").notNull().default("DD/MM/YYYY"),
  dueSoonDays: integer("due_soon_days").notNull().default(30),
  dueSoonKm: integer("due_soon_km").notNull().default(1000),
  // Assumed daily distance used only while a vehicle has too little odometer
  // history to measure one. See USAGE_CTE in data/status.ts.
  fallbackKmPerDay: integer("fallback_km_per_day").notNull().default(30),
  staleOdometerDays: integer("stale_odometer_days").notNull().default(45),
});

export const partTypes = sqliteTable("part_types", {
  id: text("id").primaryKey(),
  // NULL = global seed row. Reads are `garage_id IS NULL OR garage_id = ?`.
  garageId: text("garage_id"),
  code: text("code").notNull(),
  name: text("name").notNull(),
  category: text("category", {
    enum: ["fluid", "filter", "brake", "tyre", "battery", "belt", "electrical", "other"],
  }).notNull(),
  defaultIntervalKm: integer("default_interval_km"),
  defaultIntervalMonths: integer("default_interval_months"),
  appliesToFuel: text("applies_to_fuel"),
});

export const vehicles = sqliteTable(
  "vehicles",
  {
    id: text("id").primaryKey(),
    garageId: text("garage_id").notNull(),
    nickname: text("nickname").notNull(),
    plate: text("plate"),
    make: text("make"),
    model: text("model"),
    year: integer("year"),
    engineCc: integer("engine_cc"),
    fuelType: text("fuel_type", { enum: ["petrol", "diesel", "hybrid", "ev"] }),
    transmission: text("transmission", { enum: ["manual", "auto"] }),
    vin: text("vin"),
    purchaseDate: text("purchase_date"),
    purchasePrice: integer("purchase_price"), // sen
    currentOdometerKm: integer("current_odometer_km").notNull().default(0),
    odometerUpdatedOn: text("odometer_updated_on"),
    isActive: integer("is_active").notNull().default(1),
    notes: text("notes"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (t) => ({ garageIdx: index("idx_vehicles_garage").on(t.garageId) }),
);

export const odometerReadings = sqliteTable(
  "odometer_readings",
  {
    id: text("id").primaryKey(),
    garageId: text("garage_id").notNull(),
    vehicleId: text("vehicle_id").notNull(),
    readingKm: integer("reading_km").notNull(),
    recordedOn: text("recorded_on").notNull(),
    source: text("source", { enum: ["manual", "service", "renewal"] }).notNull(),
  },
  (t) => ({ vehicleDateIdx: index("idx_odo_vehicle_date").on(t.vehicleId, t.recordedOn) }),
);

export const maintenanceIntervals = sqliteTable(
  "maintenance_intervals",
  {
    id: text("id").primaryKey(),
    garageId: text("garage_id").notNull(),
    vehicleId: text("vehicle_id").notNull(),
    partTypeId: text("part_type_id").notNull(),
    intervalKm: integer("interval_km"),
    intervalMonths: integer("interval_months"),
    isActive: integer("is_active").notNull().default(1),
  },
  (t) => ({ uq: uniqueIndex("uq_interval_vehicle_part").on(t.vehicleId, t.partTypeId) }),
);

export const serviceRecords = sqliteTable(
  "service_records",
  {
    id: text("id").primaryKey(),
    garageId: text("garage_id").notNull(),
    vehicleId: text("vehicle_id").notNull(),
    servicedOn: text("serviced_on").notNull(),
    odometerKm: integer("odometer_km").notNull(),
    // A label and a template trigger. Resets no clock on its own -- only
    // service_items do (invariant 7).
    serviceType: text("service_type", {
      enum: ["minor", "major", "repair", "inspection", "other"],
    }),
    workshopName: text("workshop_name"),
    totalCost: integer("total_cost"), // sen; may exceed the sum of items
    invoiceKey: text("invoice_key"),
    notes: text("notes"),
    createdAt: text("created_at").notNull(),
  },
  (t) => ({ vehicleDateIdx: index("idx_service_vehicle_date").on(t.vehicleId, t.servicedOn) }),
);

export const serviceItems = sqliteTable(
  "service_items",
  {
    id: text("id").primaryKey(),
    garageId: text("garage_id").notNull(),
    serviceRecordId: text("service_record_id").notNull(),
    partTypeId: text("part_type_id").notNull(),
    brand: text("brand"),
    spec: text("spec"),
    // Integer thousandths, never a float. See src/shared/money.ts.
    quantityMilli: integer("quantity_milli").notNull().default(1000),
    unitCost: integer("unit_cost"), // sen
    warrantyMonths: integer("warranty_months"),
    // "Next due N km / N months from THIS service", not an odometer figure.
    // Overrides the vehicle's configured interval for exactly one cycle; see
    // the header of migrations/0004 for why this is not a stored due point.
    intervalKmOverride: integer("interval_km_override"),
    intervalMonthsOverride: integer("interval_months_override"),
    // GENERATED ALWAYS in SQL. Read-only: never include it in an insert.
    lineTotalCost: integer("line_total_cost").generatedAlwaysAs(
      sql`((unit_cost * quantity_milli + 500) / 1000)`,
      { mode: "virtual" },
    ),
  },
  (t) => ({ recordIdx: index("idx_items_record").on(t.serviceRecordId) }),
);

export const serviceTemplates = sqliteTable(
  "service_templates",
  {
    id: text("id").primaryKey(),
    garageId: text("garage_id").notNull(),
    // NULL = applies to every vehicle in the garage.
    vehicleId: text("vehicle_id"),
    serviceType: text("service_type", {
      enum: ["minor", "major", "repair", "inspection", "other"],
    }).notNull(),
    partTypeId: text("part_type_id").notNull(),
    sortOrder: integer("sort_order").notNull().default(0),
  },
  (t) => ({ lookupIdx: index("idx_service_templates_lookup").on(t.garageId, t.serviceType) }),
);

export const renewals = sqliteTable(
  "renewals",
  {
    id: text("id").primaryKey(),
    garageId: text("garage_id").notNull(),
    vehicleId: text("vehicle_id").notNull(),
    type: text("type", {
      enum: ["road_tax", "insurance", "inspection", "warranty"],
    }).notNull(),
    provider: text("provider"),
    referenceNo: text("reference_no"),
    issuedOn: text("issued_on"),
    expiresOn: text("expires_on").notNull(),
    cost: integer("cost"), // sen
    documentKey: text("document_key"),
    notes: text("notes"),
  },
  (t) => ({ lookupIdx: index("idx_renewals_lookup").on(t.vehicleId, t.type, t.expiresOn) }),
);

export const costEstimates = sqliteTable("cost_estimates", {
  id: text("id").primaryKey(),
  garageId: text("garage_id").notNull(),
  vehicleId: text("vehicle_id"), // NULL = garage default
  partTypeId: text("part_type_id").notNull(),
  estimatedCost: integer("estimated_cost").notNull(), // sen
  source: text("source", { enum: ["manual", "derived"] }).notNull(),
  updatedAt: text("updated_at").notNull(),
});
