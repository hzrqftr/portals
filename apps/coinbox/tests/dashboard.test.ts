import { describe, it, expect, beforeAll, beforeEach } from "vitest";
import { env } from "cloudflare:test";
import { addDays } from "@portals/core";
import { as, migrate, resetDb, giveLedger, giveRule } from "./helpers";

/**
 * The dashboard's arithmetic.
 *
 * `tests/isolation.test.ts` proves the payload cannot carry another person's
 * money. This file proves the figures inside it are the right figures, which
 * is a separate risk and the likelier one: an aggregate that is quietly wrong
 * looks exactly like an aggregate that is right.
 *
 * Every expectation below is written out in sen by hand. Recomputing them the
 * way the code does would only assert that the code agrees with itself.
 */

const OWNER = "owner@test.local";

/**
 * A transaction, by raw SQL.
 *
 * `is_recurring` is deliberately unreachable through the API -- it is
 * provenance, absent from `transactionPatch` so an edit cannot forge it -- and
 * one of the properties under test is precisely that an auto-posted row does
 * NOT count as the owner having entered something. So the seam has to be the
 * database.
 */
async function seed(
  ledgerId: string,
  row: {
    on: string;
    sen: number;
    direction?: "in" | "out";
    category?: string;
    item?: string;
    recurring?: boolean;
  },
): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO transactions
       (id, ledger_id, occurred_on, item, category_id, amount_sen, direction,
        is_recurring, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z')`,
  )
    .bind(
      crypto.randomUUID(),
      ledgerId,
      row.on,
      row.item ?? "Entry",
      row.category ?? "cat_food_drinks",
      row.sen,
      row.direction ?? "out",
      row.recurring ? 1 : 0,
    )
    .run();
}

beforeAll(migrate);
beforeEach(resetDb);

describe("the monthly series and its running total", () => {
  it("rolls each month up and carries the total forward", async () => {
    const ledger = await giveLedger(OWNER);

    // May: 1,000 in, 400 out  -> net +600
    await seed(ledger, { on: "2026-05-04", sen: 100_000, direction: "in" });
    await seed(ledger, { on: "2026-05-19", sen: 40_000 });
    // June: 900 out          -> net -900
    await seed(ledger, { on: "2026-06-10", sen: 90_000 });
    // July: 250 out          -> net -250
    await seed(ledger, { on: "2026-07-02", sen: 25_000 });

    const res = await as(OWNER)("/api/dashboard?month=2026-07");
    expect(res.status).toBe(200);

    expect(res.body.months).toEqual([
      {
        month: "2026-05",
        inSen: 100_000,
        outSen: 40_000,
        netSen: 60_000,
        txnCount: 2,
        cumulativeSen: 60_000,
      },
      {
        month: "2026-06",
        inSen: 0,
        outSen: 90_000,
        netSen: -90_000,
        txnCount: 1,
        // 60,000 - 90,000
        cumulativeSen: -30_000,
      },
      {
        month: "2026-07",
        inSen: 0,
        outSen: 25_000,
        netSen: -25_000,
        txnCount: 1,
        // -30,000 - 25,000
        cumulativeSen: -55_000,
      },
    ]);

    // The Sheet's "Total Loss" row: the running total after the last month.
    expect(res.body.ytdNetSen).toBe(-55_000);
  });

  it("reports the month-over-month change against the preceding month", async () => {
    const ledger = await giveLedger(OWNER);
    await seed(ledger, { on: "2026-06-10", sen: 90_000 }); // net -90,000
    await seed(ledger, { on: "2026-07-02", sen: 25_000 }); // net -25,000

    const res = await as(OWNER)("/api/dashboard?month=2026-07");

    expect(res.body.focus.previousMonth).toBe("2026-06");
    // -25,000 - (-90,000): July was 65,000 better than June.
    expect(res.body.focus.momDeltaSen).toBe(65_000);
  });

  it("has nothing to compare the first month with", async () => {
    const ledger = await giveLedger(OWNER);
    await seed(ledger, { on: "2026-06-10", sen: 90_000 });

    const res = await as(OWNER)("/api/dashboard?month=2026-06");

    expect(res.body.focus.previousMonth).toBeNull();
    expect(res.body.focus.momDeltaSen).toBeNull();
  });
});

/**
 * Where the month's money went, category by category.
 *
 * This replaced a breakdown that scored each category against its own
 * three-month normal. That panel answered "was this month odd?"; the owner's
 * question is "where did it go?", so the ranking is by amount now. The old
 * query, its four tests and the reasoning behind them are in git history at
 * `9be2459~1` and summarised in docs/coinbox-spec.md §10.3.
 */
describe("what the month went on", () => {
  type Row = {
    categoryCode: string;
    inSen: number;
    outSen: number;
    txnCount: number;
    prevInSen: number;
    prevOutSen: number;
  };
  const spendOf = (body: { focus: { categorySpend: Row[] } }) => body.focus.categorySpend;
  const find = (body: { focus: { categorySpend: Row[] } }, code: string) =>
    spendOf(body).find((c) => c.categoryCode === code);

  it("ranks every category with money out, biggest first", async () => {
    const ledger = await giveLedger(OWNER);
    await seed(ledger, { on: "2026-08-03", sen: 25_000, category: "cat_utility" });
    await seed(ledger, { on: "2026-08-04", sen: 90_000, category: "cat_loans" });
    await seed(ledger, { on: "2026-08-05", sen: 1_600, category: "cat_vices" });
    // Two entries in one category roll up into one row with a count of two.
    await seed(ledger, { on: "2026-08-06", sen: 3_000, category: "cat_food_drinks" });
    await seed(ledger, { on: "2026-08-07", sen: 4_000, category: "cat_food_drinks" });

    const res = await as(OWNER)("/api/dashboard?month=2026-08");

    expect(spendOf(res.body).map((c) => c.categoryCode)).toEqual([
      "loans",
      "utility",
      "food_drinks",
      "vices",
    ]);
    expect(find(res.body, "food_drinks")).toMatchObject({
      outSen: 7_000,
      inSen: 0,
      txnCount: 2,
    });
    // Magnitudes, never signed: the direction is the reader's choice here.
    expect(find(res.body, "loans")!.outSen).toBe(90_000);
  });

  /**
   * THE CASE THE OLD PANEL COULD NOT EXPRESS.
   *
   * It read `net_sen` only, so a category taking money both ways in one month
   * cancelled itself out. Categories are deliberately not bound to a
   * direction, and four of the owner's real ones appear as both -- Household
   * is 2 in / 68 out. Netting those to 66 would describe no real month.
   */
  it("keeps in and out apart for a category that had both", async () => {
    const ledger = await giveLedger(OWNER);
    await seed(ledger, { on: "2026-08-10", sen: 68_000, category: "cat_household" });
    await seed(ledger, {
      on: "2026-08-20",
      sen: 250_000,
      category: "cat_household",
      direction: "in",
    });

    const res = await as(OWNER)("/api/dashboard?month=2026-08");
    const household = find(res.body, "household");

    expect(household).toMatchObject({ outSen: 68_000, inSen: 250_000, txnCount: 2 });
  });

  it("carries the previous month, and zero for a category that is new", async () => {
    const ledger = await giveLedger(OWNER);
    await seed(ledger, { on: "2026-07-11", sen: 48_000, category: "cat_food_drinks" });
    await seed(ledger, { on: "2026-08-11", sen: 52_000, category: "cat_food_drinks" });
    await seed(ledger, { on: "2026-08-12", sen: 30_000, category: "cat_electronics" });

    const res = await as(OWNER)("/api/dashboard?month=2026-08");

    expect(find(res.body, "food_drinks")).toMatchObject({
      outSen: 52_000,
      prevOutSen: 48_000,
    });
    // Never appeared before, so there is nothing to compare against -- and the
    // tooltip says "Nothing last month" rather than inventing a percentage.
    expect(find(res.body, "electronics")).toMatchObject({
      outSen: 30_000,
      prevOutSen: 0,
      prevInSen: 0,
    });
  });

  /**
   * The deliberate difference from the panel this replaced, which listed a
   * vanished category as a positive effect. Here the question is where THIS
   * month's money went, and a category with none of it is not an answer.
   */
  it("leaves out a category that had money last month but none this month", async () => {
    const ledger = await giveLedger(OWNER);
    await seed(ledger, { on: "2026-07-15", sen: 24_000, category: "cat_insurance" });
    await seed(ledger, { on: "2026-08-15", sen: 30_000, category: "cat_utility" });

    const res = await as(OWNER)("/api/dashboard?month=2026-08");

    expect(spendOf(res.body).map((c) => c.categoryCode)).toEqual(["utility"]);
  });
});

describe("a category's normal", () => {
  it("averages out only over the three months before the focus", async () => {
    const ledger = await giveLedger(OWNER);
    // January is outside the window and must not drag the average down.
    await seed(ledger, { on: "2026-01-09", sen: 900_000 });
    await seed(ledger, { on: "2026-05-09", sen: 30_000 });
    await seed(ledger, { on: "2026-06-09", sen: 30_000 });
    await seed(ledger, { on: "2026-07-09", sen: 30_000 });
    await seed(ledger, { on: "2026-08-09", sen: 10_000 });

    const res = await as(OWNER)("/api/dashboard?month=2026-08");
    // (30,000 x 3) / 3
    expect(res.body.focus.trailingOutAvgSen).toBe(30_000);
  });
});

describe("staleness", () => {
  /**
   * THE ONE THAT MATTERS.
   *
   * Once recurring rules are posting, the ledger keeps growing whether or not
   * anyone opens the app. Measuring "when did you last enter something" from
   * the newest row of any kind means the dashboard reports itself as current
   * while a fortnight of real spending is missing -- confidently, and with no
   * symptom.
   */
  it("measures the last TYPED entry, not the last auto-posted one", async () => {
    const ledger = await giveLedger(OWNER);
    const probe = await as(OWNER)("/api/dashboard");
    const today: string = probe.body.today;

    await seed(ledger, { on: addDays(today, -9), sen: 5_000, item: "Typed by hand" });
    await seed(ledger, {
      on: addDays(today, -1),
      sen: 23_000,
      item: "Posted by a rule",
      recurring: true,
    });

    const res = await as(OWNER)("/api/dashboard");

    expect(res.body.lastEntryOn).toBe(addDays(today, -1));
    expect(res.body.lastTypedEntryOn).toBe(addDays(today, -9));
    expect(res.body.daysSinceTypedEntry).toBe(9);
  });

  it("reports no typed entry at all when only rules have posted", async () => {
    const ledger = await giveLedger(OWNER);
    const probe = await as(OWNER)("/api/dashboard");
    await seed(ledger, {
      on: addDays(probe.body.today, -2),
      sen: 23_000,
      recurring: true,
    });

    const res = await as(OWNER)("/api/dashboard");
    expect(res.body.lastTypedEntryOn).toBeNull();
    expect(res.body.daysSinceTypedEntry).toBeNull();
  });
});

describe("what the rules have already committed", () => {
  it("counts occurrences inside the window and skips today's", async () => {
    const ledger = await giveLedger(OWNER);
    const probe = await as(OWNER)("/api/dashboard");
    const today: string = probe.body.today;

    // Due today. The cron posts at 01:00 local, so by now it is in the ledger
    // already and counting it here would double it.
    await giveRule(ledger, {
      item: "Due today",
      amount_sen: 11_100,
      starts_on: today,
      day_of_month: Number(today.slice(8, 10)),
      interval_months: 12,
    });

    // Due in three days, inside the 30-day window.
    const soon = addDays(today, 3);
    await giveRule(ledger, {
      item: "Due soon",
      amount_sen: 22_200,
      starts_on: soon,
      day_of_month: Number(soon.slice(8, 10)),
      interval_months: 12,
    });

    // Due in 90 days, outside it.
    const later = addDays(today, 90);
    await giveRule(ledger, {
      item: "Due much later",
      amount_sen: 33_300,
      starts_on: later,
      day_of_month: Number(later.slice(8, 10)),
      interval_months: 12,
    });

    const res = await as(OWNER)("/api/dashboard");

    expect(res.body.committed.days).toBe(30);
    expect(res.body.committed.count).toBe(1);
    expect(res.body.committed.upcoming[0].item).toBe("Due soon");
    // Out, so it reduces the balance. Signed, rendered as a magnitude.
    expect(res.body.committed.netSen).toBe(-22_200);
  });

  it("ignores a paused rule", async () => {
    const ledger = await giveLedger(OWNER);
    const probe = await as(OWNER)("/api/dashboard");
    const soon = addDays(probe.body.today, 3);

    await giveRule(ledger, {
      item: "Paused",
      amount_sen: 22_200,
      starts_on: soon,
      day_of_month: Number(soon.slice(8, 10)),
      interval_months: 12,
      is_active: 0,
    });

    const res = await as(OWNER)("/api/dashboard");
    expect(res.body.committed.count).toBe(0);
    expect(res.body.committed.netSen).toBe(0);
  });
});

describe("an empty ledger", () => {
  it("answers with zeros rather than failing", async () => {
    await giveLedger(OWNER);

    const res = await as(OWNER)("/api/dashboard");
    expect(res.status).toBe(200);
    expect(res.body.months).toEqual([]);
    expect(res.body.ytdNetSen).toBe(0);
    expect(res.body.focus.netSen).toBe(0);
    expect(res.body.focus.momDeltaSen).toBeNull();
    expect(res.body.focus.trailingOutAvgSen).toBeNull();
    expect(res.body.focus.categorySpend).toEqual([]);
    expect(res.body.vehicles).toEqual([]);
    expect(res.body.lastEntryOn).toBeNull();
  });

  it("rejects a month that is not YYYY-MM", async () => {
    await giveLedger(OWNER);
    const res = await as(OWNER)("/api/dashboard?month=August");
    expect(res.status).toBe(422);
  });
});
