import { describe, it, expect } from "vitest";
import { buildPatch } from "../src/client/components/transactionEdits";
import type { Category, Transaction } from "../src/client/api/hooks";

/**
 * What an inline cell edit in the ledger table actually writes.
 *
 * This is the client half of a pair of rules that are invisible when broken.
 * The server enforces what a transaction may BE; this enforces when an edit
 * must not be sent at all -- and "must not be sent" has no visible symptom.
 * A blank amount that writes zero looks like the owner mistyped, and a
 * category change that leaves a stale vehicle shows an empty column with
 * nothing on screen to contradict it.
 *
 * tests/schema.test.ts covers the zero-amount rule from the database end
 * (CHECK amount_sen >= 0, migration 0011). This covers the other half: blank
 * and zero must NOT be the same thing in the table either.
 */

const CATEGORIES: Category[] = [
  { id: "c_transport", code: "transportation", name: "Transportation", sortOrder: 1 },
  { id: "c_household", code: "household", name: "Household", sortOrder: 2 },
  { id: "c_salary", code: "salary", name: "Salary", sortOrder: 3 },
];

const byId = new Map(CATEGORIES.map((c) => [c.id, c]));

function txn(over: Partial<Transaction> = {}): Transaction {
  return {
    id: "t1",
    occurredOn: "2026-09-01",
    item: "Petrol",
    description: null,
    categoryId: "c_transport",
    categoryName: "Transportation",
    categoryCode: "transportation",
    vehicleId: "v_waja",
    amountSen: 5000,
    direction: "out",
    isRecurring: 0,
    ...over,
  };
}

describe("amount", () => {
  it("does not write a BLANK cell -- that is a slip, not a value", () => {
    expect(buildPatch(txn(), "amountSen", "", byId)).toBeNull();
    expect(buildPatch(txn(), "amountSen", "   ", byId)).toBeNull();
  });

  it("DOES write a typed zero -- RM 0.00 rows exist on purpose", () => {
    // Eight RM 0.00 water bills are real data, recorded so a monthly-average
    // dashboard has a value for every month. See migration 0011.
    expect(buildPatch(txn(), "amountSen", "0", byId)).toEqual({ amountSen: 0 });
    expect(buildPatch(txn(), "amountSen", "0.00", byId)).toEqual({ amountSen: 0 });
  });

  it("converts to sen rather than ringgit", () => {
    expect(buildPatch(txn(), "amountSen", "245.50", byId)).toEqual({ amountSen: 24550 });
  });

  it("refuses a negative, and skips a value that has not changed", () => {
    expect(buildPatch(txn(), "amountSen", "-10", byId)).toBeNull();
    expect(buildPatch(txn({ amountSen: 24550 }), "amountSen", "245.50", byId)).toBeNull();
  });
});

describe("category", () => {
  it("clears the vehicle when moving to a category that does not carry one", () => {
    // Rule 2. Without this the petrol row becomes a Household row still
    // pointing at the car, and the vehicle column is no longer rendered for
    // it, so nothing on screen contradicts the stale link.
    expect(buildPatch(txn(), "categoryId", "c_household", byId)).toEqual({
      categoryId: "c_household",
      vehicleId: null,
    });
  });

  it("keeps the vehicle when the destination category still carries one", () => {
    const t = txn({ categoryId: "c_household", categoryCode: "household" });
    expect(buildPatch(t, "categoryId", "c_transport", byId)).toEqual({
      categoryId: "c_transport",
    });
  });

  it("does not bother clearing a vehicle that is already null", () => {
    const t = txn({ vehicleId: null });
    expect(buildPatch(t, "categoryId", "c_salary", byId)).toEqual({ categoryId: "c_salary" });
  });

  it("skips an unchanged category", () => {
    expect(buildPatch(txn(), "categoryId", "c_transport", byId)).toBeNull();
  });
});

describe("text fields", () => {
  it("trims the item, and refuses to blank it", () => {
    expect(buildPatch(txn(), "item", "  Diesel  ", byId)).toEqual({ item: "Diesel" });
    expect(buildPatch(txn(), "item", "   ", byId)).toBeNull();
    expect(buildPatch(txn(), "item", "Petrol", byId)).toBeNull();
  });

  it("allows a description to be cleared to null, unlike the item", () => {
    const t = txn({ description: "Shell Setel" });
    expect(buildPatch(t, "description", "", byId)).toEqual({ description: null });
    expect(buildPatch(t, "description", "  ", byId)).toEqual({ description: null });
    expect(buildPatch(txn({ description: null }), "description", "", byId)).toBeNull();
  });
});

describe("date, direction and vehicle", () => {
  it("writes a changed date but never an empty one", () => {
    expect(buildPatch(txn(), "occurredOn", "2026-09-15", byId)).toEqual({
      occurredOn: "2026-09-15",
    });
    expect(buildPatch(txn(), "occurredOn", "", byId)).toBeNull();
    expect(buildPatch(txn(), "occurredOn", "2026-09-01", byId)).toBeNull();
  });

  it("writes a flipped direction and skips an unchanged one", () => {
    expect(buildPatch(txn(), "direction", "in", byId)).toEqual({ direction: "in" });
    expect(buildPatch(txn(), "direction", "out", byId)).toBeNull();
  });

  it("treats an empty vehicle choice as clearing it", () => {
    expect(buildPatch(txn(), "vehicleId", "", byId)).toEqual({ vehicleId: null });
    expect(buildPatch(txn({ vehicleId: null }), "vehicleId", "", byId)).toBeNull();
    expect(buildPatch(txn(), "vehicleId", "v_waja", byId)).toBeNull();
  });
});
