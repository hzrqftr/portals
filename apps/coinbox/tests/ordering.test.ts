import { describe, it, expect, beforeAll, beforeEach } from "vitest";
import { env } from "cloudflare:test";
import { as, migrate, resetDb, giveLedger } from "./helpers";

/**
 * The ledger's default order, which is the only order there is: the table has
 * no sort controls and does no client-side sorting, so whatever the API
 * returns is what the owner reads top to bottom.
 *
 * Ordering is worth a suite of its own because every way it can break is
 * quiet. A wrong order is not an error, it is a list that looks plausible and
 * puts fuel above lunch; an UNSTABLE order is a list that is correct twice and
 * different the third time, for reasons no screenshot can capture.
 */

const OWNER = "owner@example.com";

/**
 * The import's signature shape: many rows sharing ONE created_at, because
 * scripts/import-sheet.mjs stamps a single batch timestamp across all 4,421
 * of them. Same date and same created_at means the first two sort keys tie
 * completely, which is exactly the case the third key exists for.
 */
const IMPORT_STAMP = "2026-08-28T11:25:26.378Z";

async function insertTxn(
  ledgerId: string,
  fields: { id: string; occurredOn: string; item: string; createdAt: string },
) {
  await env.DB.prepare(
    `INSERT INTO transactions
       (id, ledger_id, occurred_on, item, description, category_id, vehicle_id,
        amount_sen, direction, created_at, updated_at)
     VALUES (?, ?, ?, ?, NULL, 'cat_food_drinks', NULL, 1000, 'out', ?, ?)`,
  )
    .bind(fields.id, ledgerId, fields.occurredOn, fields.item, fields.createdAt, fields.createdAt)
    .run();
}

describe("ledger ordering", () => {
  let ledgerId: string;

  beforeAll(migrate);
  beforeEach(async () => {
    await resetDb();
    ledgerId = await giveLedger(OWNER);
  });

  it("puts recent dates first, and the later submission first within a date", async () => {
    // The owner's stated habit: he spends on lunch, then on fuel, and files
    // them in that order even when both are entered well after the fact.
    await insertTxn(ledgerId, {
      id: crypto.randomUUID(),
      occurredOn: "2026-08-27",
      item: "Lunch",
      createdAt: "2026-08-29T10:00:00.000Z",
    });
    await insertTxn(ledgerId, {
      id: crypto.randomUUID(),
      occurredOn: "2026-08-27",
      item: "Fuel",
      createdAt: "2026-08-29T10:05:00.000Z",
    });
    await insertTxn(ledgerId, {
      id: crypto.randomUUID(),
      occurredOn: "2026-08-26",
      item: "Groceries",
      createdAt: "2026-08-29T09:00:00.000Z",
    });

    const { body } = await as(OWNER)("/api/transactions");

    expect(body.map((t: { item: string }) => t.item)).toEqual([
      "Fuel", // same date as Lunch, submitted after it
      "Lunch",
      "Groceries", // older date, despite being submitted first of all
    ]);
  });

  it("never exposes the timestamp it sorts by", async () => {
    await insertTxn(ledgerId, {
      id: crypto.randomUUID(),
      occurredOn: "2026-08-27",
      item: "Lunch",
      createdAt: IMPORT_STAMP,
    });

    const { body } = await as(OWNER)("/api/transactions");

    // created_at drives the order and is deliberately not part of the payload:
    // there is no column for it, and adding one to the response would invite a
    // client-side sort that this design does not want.
    expect(body[0]).not.toHaveProperty("createdAt");
    expect(body[0]).not.toHaveProperty("created_at");
  });

  /**
   * The regression this file exists for.
   *
   * Imported rows tie on BOTH date and created_at, so the first two keys
   * cannot separate them and the third is the only thing left defining the
   * order. This asserts that third key directly, by id, because the obvious
   * test does not work: comparing a filtered call against an unfiltered one
   * PASSES with the tiebreak deleted (tried it -- both plans happen to walk
   * idx_txn_ledger_date and agree), so it would have stood guard over nothing.
   *
   * Insertion order is independent of UUID order, so across 25 rows a result
   * that comes back id-descending cannot be the scan order by coincidence.
   */
  it("falls back to a total order by id when date and created_at both tie", async () => {
    const ids: string[] = [];
    for (let i = 0; i < 25; i++) {
      const id = crypto.randomUUID();
      ids.push(id);
      await insertTxn(ledgerId, {
        id,
        occurredOn: "2026-05-19",
        item: `Row ${i}`,
        createdAt: IMPORT_STAMP,
      });
    }

    const { body } = await as(OWNER)("/api/transactions");
    const returned = body.map((t: { id: string }) => t.id);

    expect(returned).toHaveLength(25);
    expect(returned).toEqual([...ids].sort().reverse());
  });

  /**
   * The order must also not depend on WHICH query got there, since the month
   * filter opens up an index path a bare list does not have.
   */
  it("returns tied rows in the same order whether or not a month filter is used", async () => {
    for (let i = 0; i < 25; i++) {
      await insertTxn(ledgerId, {
        id: crypto.randomUUID(),
        occurredOn: "2026-05-19",
        item: `Row ${i}`,
        createdAt: IMPORT_STAMP,
      });
    }

    const ids = (r: { body: { id: string }[] }) => r.body.map((t) => t.id);
    const unfiltered = await as(OWNER)("/api/transactions");
    const filtered = await as(OWNER)("/api/transactions?month=2026-05");

    expect(ids(filtered)).toEqual(ids(unfiltered));
  });
});
