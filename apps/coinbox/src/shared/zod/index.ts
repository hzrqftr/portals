import { z } from "zod";

/**
 * Validation shared by the client forms and the API handlers. One definition,
 * both sides: a field the client may send and a field the server will accept
 * cannot drift apart if they are the same object.
 */

// The type-level primitives are the same in every portal. Imported as well as
// re-exported: a bare `export ... from` forwards them without binding them in
// this module's scope, and the schemas below use them directly.
import { calendarDate, sen } from "@portals/core";
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
  })
  .strict();

export type TransactionCreate = z.infer<typeof transactionCreate>;

/**
 * Editing a transaction -- the thing the Google Form could not do at all.
 *
 * Every field is optional, but the import-provenance columns
 * (`sourceTypeRaw`, `sourceCategoryRaw`) are absent and `.strict()` rejects
 * them. They record what the Sheet actually said; letting a later edit rewrite
 * that would destroy the only evidence of what was imported versus what was
 * corrected afterwards.
 */
export const transactionPatch = transactionCreate.partial().strict();

export type TransactionPatch = z.infer<typeof transactionPatch>;
