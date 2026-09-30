import { describe, it, expect, beforeAll, beforeEach } from "vitest";
import { env } from "cloudflare:test";
import { as, migrate, resetDb } from "./helpers";

/**
 * The Family fund's arithmetic and its write rules. docs/coinbox-spec.md §11.
 *
 * The pot replaces a workbook whose "who has paid" grid was typed by hand and
 * had already drifted from the log beside it. Here the grid is derived, so the
 * figures below are the whole of what the owner reads -- and every one of them
 * would look plausible if it were wrong.
 */

const OWNER = "owner@test.local";
const OTHER = "other@test.local";

const owner = () => as(OWNER);

async function addMember(email: string, name: string, defaultSen = 20_000) {
  const res = await as(email)("/api/fund/members", {
    method: "POST",
    json: { name, defaultSen },
  });
  expect(res.status).toBe(201);
  return res.body.id as string;
}

async function contribute(memberId: string, forMonth: string, amountSen: number, occurredOn?: string) {
  const res = await owner()("/api/fund/entries", {
    method: "POST",
    json: {
      memberId,
      forMonth,
      amountSen,
      direction: "in",
      occurredOn: occurredOn ?? `${forMonth}-01`,
    },
  });
  expect(res.status, res.text).toBe(201);
  return res.body.id as string;
}

async function spend(item: string, amountSen: number, occurredOn = "2026-07-01", dir = "out") {
  const res = await owner()("/api/fund/entries", {
    method: "POST",
    json: { item, amountSen, direction: dir, occurredOn },
  });
  expect(res.status, res.text).toBe(201);
  return res.body.id as string;
}

beforeAll(migrate);
beforeEach(resetDb);

describe("the pot", () => {
  it("starts empty, creating the fund on first use", async () => {
    const res = await owner()("/api/fund");
    expect(res.status).toBe(200);
    expect(res.body.balanceSen).toBe(0);
    expect(res.body.members).toEqual([]);
    expect(res.body.latestCheck).toBeNull();

    // Idempotent: a second visit finds the same fund rather than a second one.
    await owner()("/api/fund");
    const n = await env.DB.prepare(`SELECT COUNT(*) AS n FROM funds`).first<{ n: number }>();
    expect(n?.n).toBe(1);
  });

  it("is contributions in, spending out -- and refunds count as in", async () => {
    const kdik = await addMember(OWNER, "Kdik");
    await contribute(kdik, "2026-07", 20_000);
    await contribute(kdik, "2026-08", 20_000);
    await spend("Dinner - Cili Kampung", 54_330);
    await spend("Homestay Deposit (Return)", 35_000, "2026-07-02", "in");

    const res = await owner()("/api/fund");
    // 200 + 200 - 543.30 + 350 = 206.70
    expect(res.body.balanceSen).toBe(20_670);
    expect(res.body.members[0].totalSen).toBe(40_000);
  });

  it("never lets pot money reach the personal ledger's totals", async () => {
    const kdik = await addMember(OWNER, "Kdik");
    await contribute(kdik, "2026-07", 20_000);
    await spend("Dinner", 54_330);

    // The whole point of a separate book: family money is not personal spending.
    const summary = await owner()("/api/summary");
    expect(summary.body).toEqual([]);
    const txns = await owner()("/api/transactions");
    expect(txns.body).toEqual([]);
  });

  it("lists spending without the contributions", async () => {
    const kdik = await addMember(OWNER, "Kdik");
    await contribute(kdik, "2026-07", 20_000);
    await spend("Dinner", 54_330, "2026-07-10");
    await spend("Tent", 28_000, "2026-05-01");

    const res = await owner()("/api/fund/entries");
    expect(res.body.map((e: { item: string }) => e.item)).toEqual(["Dinner", "Tent"]);
  });
});

describe("the contribution grid", () => {
  it("sums by the month paid FOR, not the month paid in", async () => {
    const ayiq = await addMember(OWNER, "Ayiq");
    // January and February 2024 paid together on 18 February -- a real row
    // pair in the workbook.
    await contribute(ayiq, "2024-01", 20_000, "2024-02-18");
    await contribute(ayiq, "2024-02", 20_000, "2024-02-18");

    const res = await owner()("/api/fund/grid?year=2024");
    const byMonth = Object.fromEntries(
      res.body.cells.map((c: { forMonth: string; paidSen: number }) => [c.forMonth, c.paidSen]),
    );
    expect(byMonth).toEqual({ "2024-01": 20_000, "2024-02": 20_000 });
  });

  it("adds two payments in one month, and a RM 0.00 skip stays accounted for", async () => {
    const kdik = await addMember(OWNER, "Kdik");
    const kyon = await addMember(OWNER, "Kyon");
    await contribute(kyon, "2026-10", 15_000);
    await contribute(kyon, "2026-10", 5_000); // a top-up
    await contribute(kdik, "2026-10", 0); // agreed skip

    const res = await owner()("/api/fund/grid?year=2026");
    const cell = (m: string) =>
      res.body.cells.find((c: { memberId: string }) => c.memberId === m);
    expect(cell(kyon)).toMatchObject({ paidSen: 20_000, entries: 2 });
    // Present with zero: "skipped", which the grid must tell apart from a
    // month with no row at all ("not yet").
    expect(cell(kdik)).toMatchObject({ paidSen: 0, entries: 1 });

    const pot = await owner()("/api/fund");
    expect(pot.body.balanceSen).toBe(20_000);
  });

  it("keeps a year's grid to that year", async () => {
    const kdik = await addMember(OWNER, "Kdik");
    await contribute(kdik, "2025-12", 20_000);
    await contribute(kdik, "2026-01", 20_000);

    const res = await owner()("/api/fund/grid?year=2026");
    expect(res.body.cells.map((c: { forMonth: string }) => c.forMonth)).toEqual(["2026-01"]);
    expect(res.body.contributions).toHaveLength(1);
  });

  it("does not rewrite past months when a member's agreed amount changes", async () => {
    const kyon = await addMember(OWNER, "Kyon", 20_000);
    await contribute(kyon, "2026-08", 20_000);

    const patched = await owner()(`/api/fund/members/${kyon}`, {
      method: "PATCH",
      json: { defaultSen: 15_000 },
    });
    expect(patched.status).toBe(200);

    const res = await owner()("/api/fund/grid?year=2026");
    expect(res.body.cells[0].paidSen).toBe(20_000);
  });
});

describe("what a write may contain", () => {
  it("rejects a contribution with no month, or one going out", async () => {
    const kdik = await addMember(OWNER, "Kdik");
    const noMonth = await owner()("/api/fund/entries", {
      method: "POST",
      json: { memberId: kdik, amountSen: 20_000, direction: "in", occurredOn: "2026-09-01" },
    });
    expect(noMonth.status).toBe(422);

    const goingOut = await owner()("/api/fund/entries", {
      method: "POST",
      json: {
        memberId: kdik,
        forMonth: "2026-09",
        amountSen: 20_000,
        direction: "out",
        occurredOn: "2026-09-01",
      },
    });
    expect(goingOut.status).toBe(422);
  });

  it("refuses a client-supplied link to the personal ledger", async () => {
    const res = await owner()("/api/fund/entries", {
      method: "POST",
      json: {
        item: "x",
        amountSen: 1,
        direction: "in",
        occurredOn: "2026-09-01",
        transactionId: "anything",
      },
    });
    expect(res.status).toBe(422);
  });

  it("names a contribution after its member", async () => {
    const kdik = await addMember(OWNER, "Kdik");
    await contribute(kdik, "2026-09", 20_000);
    const grid = await owner()("/api/fund/grid?year=2026");
    expect(grid.body.contributions[0].item).toBe("From Kdik");
  });

  it("refuses a duplicate member name with a readable error", async () => {
    await addMember(OWNER, "Kdik");
    const res = await owner()("/api/fund/members", {
      method: "POST",
      json: { name: "Kdik", defaultSen: 0 },
    });
    expect(res.status).toBe(422);
  });

  /**
   * The database's own guard, below Zod. A contribution without a month, or
   * a spend that names a member, must be unrepresentable -- not merely
   * rejected by the one code path that happens to validate.
   */
  it("enforces the contribution shape in the schema itself", async () => {
    await owner()("/api/fund");
    const kdik = await addMember(OWNER, "Kdik");
    const fund = await env.DB.prepare(`SELECT id FROM funds`).first<{ id: string }>();
    const insert = (memberId: string | null, forMonth: string | null, dir: string) =>
      env.DB.prepare(
        `INSERT INTO fund_entries (id, fund_id, occurred_on, item, amount_sen, direction,
                                   member_id, for_month, created_at, updated_at)
         VALUES (?, ?, '2026-09-01', 'x', 100, ?, ?, ?, 't', 't')`,
      )
        .bind(crypto.randomUUID(), fund!.id, dir, memberId, forMonth)
        .run();

    await expect(insert(kdik, null, "in")).rejects.toThrow(/CHECK/);
    await expect(insert(null, "2026-09", "in")).rejects.toThrow(/CHECK/);
    await expect(insert(kdik, "2026-09", "out")).rejects.toThrow(/CHECK/);
    await expect(insert(kdik, "2026-09", "in")).resolves.toBeTruthy();
  });

  it("has no `kind` column to disagree with member_id", async () => {
    const { results } = await env.DB.prepare(`PRAGMA table_info(fund_entries)`).all<{
      name: string;
    }>();
    expect(results.map((c) => c.name)).not.toContain("kind");
  });
});

describe("the bank check", () => {
  /**
   * The owner's worry is the bank holding LESS than recorded. A check is
   * compared with the pot AS AT its own date: a contribution entered later
   * must not make an old check look short or long.
   */
  it("compares with the pot as at the check's date, not today", async () => {
    const kdik = await addMember(OWNER, "Kdik");
    await contribute(kdik, "2026-08", 20_000, "2026-08-01");

    const check = await owner()("/api/fund/checks", {
      method: "POST",
      json: { checkedOn: "2026-08-15", balanceSen: 18_000 },
    });
    expect(check.status).toBe(201);

    await contribute(kdik, "2026-09", 20_000, "2026-09-01");

    const res = await owner()("/api/fund");
    expect(res.body.balanceSen).toBe(40_000);
    expect(res.body.latestCheck).toEqual({
      checkedOn: "2026-08-15",
      balanceSen: 18_000,
      recordedSen: 20_000,
      gapSen: -2_000,
    });
  });

  it("never changes the pot", async () => {
    await owner()("/api/fund/checks", {
      method: "POST",
      json: { checkedOn: "2026-09-30", balanceSen: 319_206 },
    });
    const res = await owner()("/api/fund");
    expect(res.body.balanceSen).toBe(0);
  });
});

describe("ids from the client are never trusted", () => {
  it("404s a member from someone else's fund", async () => {
    const theirs = await addMember(OTHER, "Theirs");
    const res = await owner()("/api/fund/entries", {
      method: "POST",
      json: {
        memberId: theirs,
        forMonth: "2026-09",
        amountSen: 20_000,
        direction: "in",
        occurredOn: "2026-09-01",
      },
    });
    expect(res.status).toBe(404);
  });

  it("404s a recurring rule from someone else's ledger", async () => {
    const other = await as(OTHER)("/api/recurring", {
      method: "POST",
      json: {
        item: "Theirs",
        categoryId: "cat_family",
        amountSen: 20_000,
        direction: "out",
        intervalMonths: 1,
        dayOfMonth: 31,
        startsOn: "2099-01-01",
      },
    });
    expect(other.status).toBe(201);

    const res = await owner()("/api/fund/members", {
      method: "POST",
      json: { name: "Ayiq", defaultSen: 20_000, recurringRuleId: other.body.id },
    });
    expect(res.status).toBe(404);
  });

  it("404s editing or deleting another person's entry", async () => {
    await as(OTHER)("/api/fund");
    const res = await as(OTHER)("/api/fund/entries", {
      method: "POST",
      json: { item: "Theirs", amountSen: 100, direction: "out", occurredOn: "2026-09-01" },
    });
    const id = res.body.id as string;

    expect((await owner()(`/api/fund/entries/${id}`)).status).toBe(404);
    const patch = await owner()(`/api/fund/entries/${id}`, {
      method: "PATCH",
      json: { amountSen: 1 },
    });
    expect(patch.status).toBe(404);
    expect((await owner()(`/api/fund/entries/${id}`, { method: "DELETE" })).status).toBe(404);
    // And it is still there for its owner.
    expect((await as(OTHER)(`/api/fund/entries/${id}`)).status).toBe(200);
  });
});

describe("deleting a person", () => {
  /**
   * Both portals' test suites reset by deleting `users`, which cascades down
   * through ledgers to the fund. A RESTRICT anywhere in 0020 would fail
   * Odometry's suite with an error about a table it has never heard of.
   */
  it("cascades cleanly through the whole fund", async () => {
    const kdik = await addMember(OWNER, "Kdik");
    await contribute(kdik, "2026-09", 20_000);
    await spend("Dinner", 100);
    await owner()("/api/fund/checks", {
      method: "POST",
      json: { checkedOn: "2026-09-30", balanceSen: 100 },
    });

    await env.DB.prepare(`DELETE FROM users WHERE email = ?`).bind(OWNER).run();

    for (const t of ["funds", "fund_members", "fund_entries", "fund_balance_checks"]) {
      const n = await env.DB.prepare(`SELECT COUNT(*) AS n FROM ${t}`).first<{ n: number }>();
      expect(n?.n, t).toBe(0);
    }
  });
});

/**
 * A month holds ONE state. Found by the owner in the browser on 2026-09-30:
 * "Skipped" stacked on top of a RM 200 payment, and a second tap stacked a
 * second skip. `replaceMonth` swaps the month's hand-entered rows in one batch.
 */
describe("replacing a month", () => {
  const replace = (memberId: string, amountSen: number) =>
    owner()("/api/fund/entries", {
      method: "POST",
      json: {
        memberId,
        forMonth: "2026-09",
        amountSen,
        direction: "in",
        occurredOn: "2026-09-30",
        replaceMonth: true,
      },
    });

  const rowsFor = async (memberId: string) => {
    const grid = await owner()("/api/fund/grid?year=2026");
    return grid.body.contributions
      .filter((c: { memberId: string; forMonth: string }) => c.memberId === memberId && c.forMonth === "2026-09")
      .map((c: { amountSen: number }) => c.amountSen);
  };

  it("turns a paid month into a skip, rather than holding both", async () => {
    const kdik = await addMember(OWNER, "Kdik");
    await contribute(kdik, "2026-09", 20_000);

    expect((await replace(kdik, 0)).status).toBe(201);
    expect(await rowsFor(kdik)).toEqual([0]);
    expect((await owner()("/api/fund")).body.balanceSen).toBe(0);
  });

  it("does not stack a second skip", async () => {
    const kdik = await addMember(OWNER, "Kdik");
    await replace(kdik, 0);
    await replace(kdik, 0);
    expect(await rowsFor(kdik)).toEqual([0]);
  });

  it("lets a payment replace a skip", async () => {
    const kdik = await addMember(OWNER, "Kdik");
    await replace(kdik, 0);
    await replace(kdik, 20_000);
    expect(await rowsFor(kdik)).toEqual([20_000]);
  });

  it("still adds a top-up when not replacing", async () => {
    const kdik = await addMember(OWNER, "Kdik");
    await contribute(kdik, "2026-09", 15_000);
    await contribute(kdik, "2026-09", 5_000);
    // Same date, so their order is the id tiebreak -- compare as a set.
    expect((await rowsFor(kdik)).sort()).toEqual([15_000, 5_000].sort());
  });

  it("touches only that member's month", async () => {
    const kdik = await addMember(OWNER, "Kdik");
    const kyon = await addMember(OWNER, "Kyon");
    await contribute(kdik, "2026-08", 20_000);
    await contribute(kyon, "2026-09", 20_000);
    await contribute(kdik, "2026-09", 20_000);

    await replace(kdik, 0);
    expect(await rowsFor(kyon)).toEqual([20_000]);
    const aug = await owner()("/api/fund/grid?year=2026");
    expect(aug.body.cells.find((c: { forMonth: string; memberId: string }) => c.memberId === kdik && c.forMonth === "2026-08").paidSen).toBe(20_000);
  });

  it("refuses to replace over a ledger-posted contribution, removing nothing", async () => {
    const ayiq = await addMember(OWNER, "Ayiq");
    await contribute(ayiq, "2026-09", 5_000); // a hand top-up beside it
    // Stand in for the recurring run's linked row: a real ledger transaction
    // and a contribution pointing at it.
    const txn = await owner()("/api/transactions", {
      method: "POST",
      json: { occurredOn: "2026-09-30", item: "Family fund", categoryId: "cat_family", amountSen: 20_000, direction: "out" },
    });
    const fund = await env.DB.prepare(`SELECT id FROM funds`).first<{ id: string }>();
    await env.DB.prepare(
      `INSERT INTO fund_entries (id, fund_id, occurred_on, item, amount_sen, direction, member_id,
                                 for_month, transaction_id, created_at, updated_at)
       VALUES (?, ?, '2026-09-30', 'From Ayiq', 20000, 'in', ?, '2026-09', ?, 't', 't')`,
    ).bind(crypto.randomUUID(), fund!.id, ayiq, txn.body.id).run();

    expect((await replace(ayiq, 0)).status).toBe(422);
    expect((await rowsFor(ayiq)).sort()).toEqual([20_000, 5_000].sort());
  });

  it("refuses replaceMonth on anything but a contribution", async () => {
    const res = await owner()("/api/fund/entries", {
      method: "POST",
      json: { item: "Dinner", amountSen: 100, direction: "out", occurredOn: "2026-09-30", replaceMonth: true },
    });
    expect(res.status).toBe(422);
  });
});
