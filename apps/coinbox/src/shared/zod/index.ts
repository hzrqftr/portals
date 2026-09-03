import { z } from "zod";

/**
 * Validation shared by the client forms and the API handlers. One definition,
 * both sides: a field the client may send and a field the server will accept
 * cannot drift apart if they are the same object.
 */

// The type-level primitives are the same in every portal. Imported as well as
// re-exported: a bare `export ... from` forwards them without binding them in
// this module's scope, and the schemas below use them directly.
import { calendarDate, quantityMilli, sen } from "@portals/core";
export { calendarDate, sen, quantityMilli } from "@portals/core";

/**
 * Money direction. NOT debit/credit, and NOT income/expense.
 *
 * Debit and credit are genuinely ambiguous here: by ledger convention a debit
 * increases an asset, but a bank statement is written from the bank's side and
 * shows money arriving as a credit. Same word, opposite meanings, both
 * correct. They only earn their keep in double-entry, where every transaction
 * has two sides that must balance -- this is a single pooled account and a
 * flat log, so there is no second side and nothing to balance.
 *
 * Not income/expense either: categories are deliberately NOT bound to a
 * direction, so naming the direction after a category-like concept would
 * quietly re-couple them.
 */
export const direction = z.enum(["in", "out"]);
export type Direction = z.infer<typeof direction>;

/**
 * The physical half of a fill-up. Optional on a transaction, and absent from
 * the overwhelming majority of them.
 *
 * ODOMETER AND LITRES ARE NOT LEDGER DATA and are not stored on
 * `transactions`. They travel through this schema on their way to Odometry,
 * which owns `odometer_readings` and `fuel_fills`. The ledger keeps the
 * ringgit and the vehicle attribution it already had.
 *
 * `isFullTank` has no default here on purpose. Consumption is only computable
 * full-tank to full-tank, so "we do not know" and "it was full" must not
 * collapse into one value on the way in; the form supplies the default, and a
 * client that omits it is a 422 rather than a silent assumption.
 */
export const fuelFill = z
  .object({
    odometerKm: z.number().int().positive(),
    litresMilli: quantityMilli,
    isFullTank: z.boolean(),
  })
  .strict();

export type FuelFill = z.infer<typeof fuelFill>;

/**
 * Creating a transaction.
 *
 * `amountSen` is a positive magnitude and the sign is derived in SQL, so there
 * is nothing here that could carry one. A client sending -2455 is a 422, not a
 * refund.
 *
 * `signedSen` is deliberately absent and `.strict()` makes sending it an
 * error rather than a silent no-op: it is a generated column, and a client
 * that believes it can set the sign is a client with a bug worth surfacing.
 */
export const transactionCreate = z
  .object({
    occurredOn: calendarDate,
    item: z.string().trim().min(1).max(120),
    description: z.string().trim().max(500).nullish(),
    categoryId: z.string().min(1),
    /** Nullable and normally null: most rows have no vehicle. */
    vehicleId: z.string().min(1).nullish(),
    amountSen: sen,
    direction,

    /**
     * Present only when this entry is a fill-up. See `fuelFill` above for why
     * none of it lands on the transactions table.
     */
    fuel: fuelFill.nullish(),
  })
  .strict();

export type TransactionCreate = z.infer<typeof transactionCreate>;

/**
 * What the POST handler actually parses.
 *
 * The cross-field rule lives on a separate schema because `.refine()` returns
 * a ZodEffects, which has no `.omit()` or `.partial()` -- putting it on
 * `transactionCreate` would break `transactionPatch` below. Keeping the
 * object plain and refining once at the boundary is the cheaper half of that
 * trade.
 *
 * A fill with no vehicle has nowhere to go: the odometer belongs to a vehicle,
 * and without one there is no garage to authorise the write against.
 */
export const transactionCreateBody = transactionCreate.refine(
  (v) => !v.fuel || !!v.vehicleId,
  { message: "A fill-up must say which vehicle was filled", path: ["vehicleId"] },
);

/**
 * Editing a transaction -- the thing the Google Form could not do at all.
 *
 * Every field is optional, but the import-provenance columns
 * (`sourceTypeRaw`, `sourceCategoryRaw`) are absent and `.strict()` rejects
 * them. They record what the Sheet actually said; letting a later edit rewrite
 * that would destroy the only evidence of what was imported versus what was
 * corrected afterwards.
 *
 * `fuel` is absent too, and `.strict()` makes sending it a 422. A fill writes
 * an odometer reading into Odometry, and `odometer_readings` has no correction
 * path there either -- so editing one here would need a rule for what happens
 * to a reading that other figures have already been derived from. To fix a
 * mistyped fill, delete the entry and re-enter it: the CASCADE takes the fill
 * with it and leaves the reading, which is the documented behaviour.
 */
export const transactionPatch = transactionCreate.omit({ fuel: true }).partial().strict();

export type TransactionPatch = z.infer<typeof transactionPatch>;

/**
 * Declaring a recurring entry.
 *
 * The transaction template is the same shape as `transactionCreate` minus
 * `occurredOn` -- the schedule supplies the date -- plus the schedule itself.
 *
 * `isRecurring` appears in NEITHER transaction schema above, and `.strict()`
 * makes sending it a 422. It records that the materialiser wrote a row, so a
 * client able to set it could forge that provenance; the same protection the
 * `source_*_raw` columns already have.
 */
export const recurringCreate = z
  .object({
    item: z.string().trim().min(1).max(120),
    description: z.string().trim().max(500).nullish(),
    categoryId: z.string().min(1),
    vehicleId: z.string().min(1).nullish(),
    amountSen: sen,
    direction,

    /** 1 = monthly, 3 = quarterly, 12 = yearly. No frequency enum beside it. */
    intervalMonths: z.number().int().min(1).max(60),

    /**
     * The intended day, which is not always a day that exists. 31 means "the
     * last day" in February -- the clamp is applied when each occurrence is
     * computed, never carried forward from the previous one.
     */
    dayOfMonth: z.number().int().min(1).max(31),

    /**
     * Earliest permitted date, and the phase of the series.
     *
     * FORWARD ONLY. The repository rejects a date before today in the owner's
     * timezone, so backfilling history is not a behaviour that was suppressed
     * -- it is unreachable. The 4,421 imported rows already cover the past,
     * and a rule that regenerated them would duplicate them in silence.
     */
    startsOn: calendarDate,
    endsOn: calendarDate.nullish(),

    /** Pausing is "not right now"; an end date is "never again". */
    isActive: z.boolean().optional(),
  })
  .strict();

export type RecurringCreate = z.infer<typeof recurringCreate>;

export const recurringPatch = recurringCreate.partial().strict();

export type RecurringPatch = z.infer<typeof recurringPatch>;
