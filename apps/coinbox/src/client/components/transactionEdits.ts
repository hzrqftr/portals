import { parseSen } from "@portals/core";
import { showsVehicle } from "@shared/categoryRules";
import type { Category, Transaction } from "../api/hooks";

/**
 * What an inline cell edit actually writes.
 *
 * Split out of TransactionTable because this is the half that can be silently
 * WRONG rather than merely ugly. Every branch below is a rule about when NOT
 * to write, and a rule that stops firing leaves no trace on screen: a blank
 * amount that overwrites a real one looks like a typo the owner made, and a
 * grocery row still pointing at the car shows an empty column that nothing
 * contradicts.
 *
 * transactionEdits.test.ts is the point of it being a separate file.
 */

export type Field =
  | "occurredOn"
  | "item"
  | "amountSen"
  | "categoryId"
  | "description"
  | "direction"
  | "vehicleId";

/**
 * Returns the PATCH body for one committed cell, or null when the edit is a
 * no-op and must not be sent.
 *
 * Returning null rather than an empty object is deliberate: "nothing changed"
 * and "change nothing" are the same outcome here, and a caller that forgets to
 * check `Object.keys().length` would otherwise issue an empty write.
 */
export function buildPatch(
  t: Transaction,
  field: Field,
  raw: string,
  categoryById: Map<string, Category>,
): Record<string, unknown> | null {
  const body: Record<string, unknown> = {};

  if (field === "amountSen") {
    // A BLANK cell is a slip and must not write; a typed 0 is a real value.
    // Eight RM 0.00 water bills exist on purpose -- see migration 0011.
    if (raw.trim() === "") return null;
    const sen = parseSen(raw);
    if (sen === null || sen < 0 || sen === t.amountSen) return null;
    body.amountSen = sen;
  } else if (field === "description") {
    const next = raw.trim() || null;
    if (next === t.description) return null;
    body.description = next;
  } else if (field === "item") {
    const next = raw.trim();
    if (next === "" || next === t.item) return null;
    body.item = next;
  } else if (field === "occurredOn") {
    if (raw === "" || raw === t.occurredOn) return null;
    body.occurredOn = raw;
  } else if (field === "direction") {
    if (raw === t.direction) return null;
    body.direction = raw;
  } else if (field === "vehicleId") {
    const next = raw || null;
    if (next === t.vehicleId) return null;
    body.vehicleId = next;
  } else if (field === "categoryId") {
    if (raw === t.categoryId) return null;
    body.categoryId = raw;

    // The table's version of rule 2. Moving a row into a category that does
    // not carry a vehicle must clear the vehicle in the same write --
    // otherwise a grocery row keeps pointing at the car, and the column it
    // would show in is now blank, so nothing on screen contradicts it.
    const code = categoryById.get(raw)?.code ?? null;
    if (!showsVehicle(code) && t.vehicleId) body.vehicleId = null;
  }

  return Object.keys(body).length === 0 ? null : body;
}
