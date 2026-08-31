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

describe("a category's normal", () => {
  /**
   * THE DIVISOR IS ALWAYS THREE, not the number of months the category
   * appeared in.
   *
   * A category seen once in three months is a category you spend on about a
   * third as often, and its normal per month is a third of that one figure.
   * Averaging over present rows instead would return the whole amount, call a
   * typical month "normal", and only ever flag the months it did NOT happen.
   */
  it("divides by three months whether or not the category appeared in all of them", async () => {
    const ledger = await giveLedger(OWNER);
    // Once in the three months before August: 300 out, in May only.
    await seed(ledger, { on: "2026-05-11", sen: 30_000, category: "cat_vices" });
    // And 250 out in August itself.
    await seed(ledger, { on: "2026-08-11", sen: 25_000, category: "cat_vices" });

    const res = await as(OWNER)("/api/dashboard?month=2026-08");
    const vices = res.body.focus.categories.find(
      (c: { categoryCode: string }) => c.categoryCode === "vices",
    );

    expect(vices.netSen).toBe(-25_000);
    // -30,000 spread over THREE months, not over the one it appeared in.
    // Averaging over present rows instead would give -30,000 here, and an
    // effect of +5,000 -- the opposite sign, reading as a month that went
    // well.
    expect(vices.normalSen).toBe(-10_000);
    expect(vices.effectSen).toBe(-15_000);
  });

  /**
   * A bill that did NOT go out is an effect, and the commonest way to miss it
   * is to build this list from the focus month and left-join the history.
   */
  it("surfaces a category that vanished this month", async () => {
    const ledger = await giveLedger(OWNER);
    // 240 out in each of the three preceding months, nothing in August.
    for (const on of ["2026-05-15", "2026-06-15", "2026-07-15"]) {
      await seed(ledger, { on, sen: 24_000, category: "cat_insurance" });
    }

    const res = await as(OWNER)("/api/dashboard?month=2026-08");
    const insurance = res.body.focus.categories.find(
      (c: { categoryCode: string }) => c.categoryCode === "insurance",
    );

    expect(insurance).toBeDefined();
    expect(insurance.netSen).toBe(0);
    expect(insurance.normalSen).toBe(-24_000);
    // Not spending it HELPED the month by its usual amount.
    expect(insurance.effectSen).toBe(24_000);
  });

  it("leaves out categories that landed exactly on their normal", async () => {
    const ledger = await giveLedger(OWNER);
    for (const on of ["2026-05-15", "2026-06-15", "2026-07-15", "2026-08-15"]) {
      await seed(ledger, { on, sen: 30_000, category: "cat_utility" });
    }

    const res = await as(OWNER)("/api/dashboard?month=2026-08");
    const codes = res.body.focus.categories.map(
      (c: { categoryCode: string }) => c.categoryCode,
    );
    expect(codes).not.toContain("utility");
  });

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
    expect(res.body.focus.categories).toEqual([]);
    expect(res.body.vehicles).toEqual([]);
    expect(res.body.lastEntryOn).toBeNull();
  });

  it("rejects a month that is not YYYY-MM", async () => {
    await giveLedger(OWNER);
    const res = await as(OWNER)("/api/dashboard?month=August");
    expect(res.status).toBe(422);
  });
});
