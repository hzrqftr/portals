import { z } from "zod";

/**
 * Validation shared by the client forms and the API handlers. One definition,
 * both sides: a field the client may send and a field the server will accept
 * cannot drift apart if they are the same object.
 */

// The type-level primitives are the same in every portal.
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
