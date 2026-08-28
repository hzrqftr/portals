import { z } from "zod";

/**
 * Validation primitives shared by every portal, and by both sides of each.
 *
 * Only the type-level primitives live here. Domain enums (fuel type, renewal
 * type, transaction direction) belong to the app that owns the concept --
 * putting them here would make `packages/core` the place where two unrelated
 * domains quietly accumulate.
 */

/** Calendar date, no time component ever. Invariant 5. */
export const calendarDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Expected a date as YYYY-MM-DD");

/**
 * Money, in sen. Integer only -- a float here is the exact failure invariant
 * 1 exists to prevent, and it would arrive from the client looking harmless.
 */
export const sen = z
  .number()
  .int("Money must be a whole number of sen")
  // Money is stored as a magnitude everywhere in this workspace -- direction
  // is a separate column in Coinbox, and Odometry's costs are magnitudes by
  // nature. A negative arriving here is a bug in the caller, and the database
  // would reject it anyway; catching it at the boundary makes it say so.
  .nonnegative("Money cannot be negative");

/** Quantities are integer thousandths. See money.ts. */
export const quantityMilli = z.number().int().positive();
