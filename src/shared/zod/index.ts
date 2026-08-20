import { z } from "zod";

/**
 * Validation shared by the client forms and the API handlers. Spec 2 table.
 *
 * One definition, both sides. A field the client is allowed to send and a
 * field the server is willing to accept cannot drift apart if they are the
 * same object.
 */

/** Calendar date, no time component ever. Invariant 5. */
export const calendarDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Expected a date as YYYY-MM-DD");

/**
 * Money, in sen. Integer only -- a float here is the exact failure invariant
 * 1 exists to prevent, and it would arrive from the client looking harmless.
 */
export const sen = z.number().int("Money must be a whole number of sen");

/** Quantities are integer thousandths. See src/shared/money.ts. */
export const quantityMilli = z.number().int().positive();

export const km = z.number().int().nonnegative().max(9_999_999);

export const fuelType = z.enum(["petrol", "diesel", "hybrid", "ev"]);
export const transmission = z.enum(["manual", "auto"]);
export const renewalType = z.enum(["road_tax", "insurance", "inspection", "warranty"]);

export const vehicleInput = z.object({
  nickname: z.string().min(1, "A nickname is required").max(60),
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

export const vehiclePatch = vehicleInput.partial().omit({ currentOdometerKm: true });

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
});

export const serviceInput = z.object({
  servicedOn: calendarDate,
  odometerKm: km,
  workshopName: z.string().max(120).optional(),
  // Entered separately from the line items: labour and sundries are real
  // costs but not parts, so total_cost may legitimately exceed their sum.
  totalCost: sen.nonnegative().optional(),
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
