import { z } from "zod";

/**
 * Validation shared by the client forms and the API handlers. Spec 2 table.
 *
 * One definition, both sides. A field the client is allowed to send and a
 * field the server is willing to accept cannot drift apart if they are the
 * same object.
 */

/**
 * The type-level primitives live in @portals/core: a calendar date and a
 * whole number of sen mean the same thing in every portal, and one definition
 * is the only way two portals cannot disagree about them.
 *
 * The domain enums below stay here. They are Odometry's vocabulary, and
 * putting them in core would make it the place two unrelated domains meet.
 */
import { calendarDate, sen, quantityMilli } from "@portals/core";

export { calendarDate, sen, quantityMilli };

export const km = z.number().int().nonnegative().max(9_999_999);

export const fuelType = z.enum(["petrol", "diesel", "hybrid", "ev"]);
export const transmission = z.enum(["manual", "auto"]);
export const renewalType = z.enum(["road_tax", "insurance", "inspection", "warranty"]);

/**
 * What kind of visit this was. A label, and the key the parts template is
 * looked up by -- it never resets a maintenance clock itself (invariant 7).
 */
export const serviceType = z.enum(["minor", "major", "repair", "inspection", "other"]);

export const vehicleType = z.enum(["car", "motorcycle"]);

export const partCategory = z.enum([
  "fluid",
  "filter",
  "brake",
  "tyre",
  "battery",
  "belt",
  "electrical",
  "other",
  // Added with migration 0007. Kept in step with the CHECK constraint on
  // part_types.category and the Drizzle enum -- a value that passes here and
  // fails there is a 500 at insert time.
  "suspension",
  "drivetrain",
  "cooling",
  "engine",
]);

export const vehicleInput = z.object({
  nickname: z.string().min(1, "A nickname is required").max(60),
  // Decides which parts get seeded, so it defaults rather than being optional:
  // a vehicle with no type would be seeded with nothing at all.
  vehicleType: vehicleType.default("car"),
  plate: z.string().max(20).optional(),
  make: z.string().max(40).optional(),
  model: z.string().max(60).optional(),
  year: z.number().int().min(1900).max(2100).optional(),
  engineCc: z.number().int().positive().max(20_000).optional(),
  fuelType: fuelType.optional(),
  transmission: transmission.optional(),
  vin: z.string().max(32).optional(),
  purchaseDate: calendarDate.optional(),
  purchasePrice: sen.nonnegative().optional(),
  currentOdometerKm: km.optional(),
  notes: z.string().max(2000).optional(),
});

/**
 * Editing a vehicle. Every optional field is additionally NULLABLE here,
 * which `vehicleInput` deliberately is not.
 *
 * The difference matters: on a PATCH, an omitted key means "leave this
 * alone", so there would otherwise be no way to express "this vehicle has no
 * plate after all". Clearing a field in the form has to arrive as an explicit
 * null or the save silently does nothing.
 *
 * nickname stays non-nullable -- it is the one field a vehicle cannot be
 * without, and the form enforces the same rule.
 *
 * currentOdometerKm is omitted, not nullable: the odometer moves through
 * readings (spec 8.5), never by editing the vehicle.
 */
export const vehiclePatch = vehicleInput
  .partial()
  .omit({ currentOdometerKm: true })
  .extend({
    plate: z.string().max(20).nullable().optional(),
    make: z.string().max(40).nullable().optional(),
    model: z.string().max(60).nullable().optional(),
    year: z.number().int().min(1900).max(2100).nullable().optional(),
    engineCc: z.number().int().positive().max(20_000).nullable().optional(),
    fuelType: fuelType.nullable().optional(),
    transmission: transmission.nullable().optional(),
    vin: z.string().max(32).nullable().optional(),
    purchaseDate: calendarDate.nullable().optional(),
    purchasePrice: sen.nonnegative().nullable().optional(),
    notes: z.string().max(2000).nullable().optional(),
  });

export const odometerInput = z.object({
  readingKm: km,
  recordedOn: calendarDate,
  source: z.enum(["manual", "service", "renewal"]).optional(),
});

export const serviceItemInput = z.object({
  partTypeId: z.string().min(1),
  brand: z.string().max(60).optional(),
  spec: z.string().max(60).optional(),
  quantityMilli: quantityMilli.default(1000),
  unitCost: sen.nonnegative().optional(),
  warrantyMonths: z.number().int().nonnegative().max(240).optional(),
  /**
   * "Next due N km / N months from THIS service."
   *
   * An INTERVAL, deliberately, not the absolute odometer figure the user
   * types into the form. The client subtracts the service odometer before
   * sending, so the API cannot be handed a due point at all -- which is what
   * keeps invariant 6 true rather than merely intended. Bounds match
   * intervalPatch below, since these values can become an interval.
   */
  intervalKmOverride: z.number().int().positive().max(1_000_000).nullable().optional(),
  intervalMonthsOverride: z.number().int().positive().max(600).nullable().optional(),
});

export const serviceInput = z.object({
  servicedOn: calendarDate,
  odometerKm: km,
  serviceType: serviceType.optional(),
  workshopName: z.string().max(120).optional(),
  // What the workshop charged for the work itself, separate from the parts.
  // The grand total is derived from this plus the line items, so there is no
  // total to send -- see migrations/0006.
  labourCost: sen.nonnegative().optional(),
  notes: z.string().max(2000).optional(),
  // An empty list is valid and means "this visit reset no clocks"
  // (invariant 7). It is a record of a visit, not a mistake.
  items: z.array(serviceItemInput).default([]),
});

export const servicePatch = serviceInput
  .partial()
  .omit({ items: true, odometerKm: true, servicedOn: true });

export const renewalInput = z.object({
  type: renewalType,
  provider: z.string().max(120).optional(),
  referenceNo: z.string().max(60).optional(),
  issuedOn: calendarDate.optional(),
  expiresOn: calendarDate,
  cost: sen.nonnegative().optional(),
  notes: z.string().max(2000).optional(),
});

/**
 * Corrections only, and the omissions are the point.
 *
 * `expiresOn`, `issuedOn`, `type` and `cost` are deliberately absent.
 * Renewals are immutable (invariant 8): the history of what each renewal
 * cost and when it lapsed is what the forecast is computed from. Changing
 * an expiry means inserting the new certificate you actually hold, which
 * leaves the old one in place as history. Re-dating a row erases it.
 *
 * .strict() means a client that sends `expiresOn` anyway gets a 422 rather
 * than having the field quietly ignored.
 */
export const renewalPatch = z
  .object({
    provider: z.string().max(120).optional(),
    referenceNo: z.string().max(60).optional(),
    notes: z.string().max(2000).optional(),
    documentKey: z.string().max(200).optional(),
  })
  .strict();

export const intervalPatch = z
  .object({
    intervalKm: z.number().int().positive().max(1_000_000).nullable().optional(),
    intervalMonths: z.number().int().positive().max(600).nullable().optional(),
    isActive: z.union([z.literal(0), z.literal(1)]).optional(),
  })
  .refine((v) => v.intervalKm !== null || v.intervalMonths !== null, {
    message: "An interval needs a distance, a time, or both",
  });

export const settingsPatch = z.object({
  // IANA zone name. Every "today" in the app is computed from this, so a
  // wrong value here shifts every due date the user sees by a day.
  timezone: z.string().min(1).max(64).optional(),
  distanceUnit: z.enum(["km", "mi"]).optional(),
  currency: z.string().length(3).optional(),
  dateFormat: z.string().max(20).optional(),
  dueSoonDays: z.number().int().min(1).max(365).optional(),
  dueSoonKm: z.number().int().min(1).max(100_000).optional(),
  // Only used while a vehicle has too little odometer history to measure a
  // real rate. Must stay positive: it is a divisor in the km projection.
  fallbackKmPerDay: z.number().int().min(1).max(1000).optional(),
  staleOdometerDays: z.number().int().min(1).max(365).optional(),
});

/**
 * The full parts list for one service type, replacing whatever was there.
 * A PUT rather than a PATCH because the natural edit is "these are the parts
 * in a minor service now" -- expressing a removal as a diff would be worse.
 * An empty array is valid and means the template no longer pre-fills.
 */
export const serviceTemplatePut = z.object({
  partTypeIds: z.array(z.string().min(1)).max(40),
});

/** A garage's own part type, for anything the 20 seeded ones do not cover. */
export const partTypeInput = z.object({
  name: z.string().min(1, "A name is required").max(60),
  category: partCategory,
  defaultIntervalKm: z.number().int().positive().max(1_000_000).nullable().optional(),
  defaultIntervalMonths: z.number().int().positive().max(600).nullable().optional(),
});

export type VehicleInput = z.infer<typeof vehicleInput>;
export type VehiclePatch = z.infer<typeof vehiclePatch>;
export type OdometerInput = z.infer<typeof odometerInput>;
export type ServiceInput = z.infer<typeof serviceInput>;
export type ServicePatch = z.infer<typeof servicePatch>;
export type RenewalInput = z.infer<typeof renewalInput>;
export type RenewalPatch = z.infer<typeof renewalPatch>;
export type IntervalPatch = z.infer<typeof intervalPatch>;
export type SettingsPatch = z.infer<typeof settingsPatch>;
export type ServiceType = z.infer<typeof serviceType>;
export type ServiceTemplatePut = z.infer<typeof serviceTemplatePut>;
export type PartTypeInput = z.infer<typeof partTypeInput>;
