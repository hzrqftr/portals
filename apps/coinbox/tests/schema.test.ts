import { describe, it, expect, beforeAll, beforeEach } from "vitest";
import { env } from "cloudflare:test";
import { migrate, resetDb, giveLedger } from "./helpers";

/**
 * The ledger schema's guarantees, exercised rather than assumed.
 *
 * Migration 0011 leans on constraints instead of on application code being
 * careful, because the failures these prevent are all silent: a negative
 * amount is a total that is merely wrong, a duplicate category code is a
 * picker with two identical entries, a direction typo is a row that never
 * appears in either half of a report.
 *
 * Every constraint below is asserted by making it FAIL. A CHECK that has never
 * rejected anything is indistinguishable from a comment.
 */

const OWNER = "owner@example.com";

async function insertTxn(
  ledgerId: string,
  over: Partial<Record<string, unknown>> = {},
) {
  const row = {
    id: crypto.randomUUID(),
    ledger_id: ledgerId,
    occurred_on: "2026-08-28",
    item: "Test",
    description: null as string | null,
    category_id: "cat_food_drinks",
    vehicle_id: null as string | null,
    amount_sen: 24_550,
    direction: "out",
    created_at: "2026-08-28T00:00:00.000Z",
    updated_at: "2026-08-28T00:00:00.000Z",
    ...over,
  };

  return env.DB.prepare(
    `INSERT INTO transactions
       (id, ledger_id, occurred_on, item, description, category_id, vehicle_id,
        amount_sen, direction, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      row.id,
      row.ledger_id,
      row.occurred_on,
      row.item,
      row.description,
      row.category_id,
      row.vehicle_id,
      row.amount_sen,
      row.direction,
      row.created_at,
      row.updated_at,
    )
    .run();
}

describe("transactions", () => {
  let ledgerId: string;

  beforeAll(migrate);
  beforeEach(async () => {
    await resetDb();
    ledgerId = await giveLedger(OWNER);
  });

  it("derives signed_sen from direction, and never stores it", async () => {
    await insertTxn(ledgerId, { amount_sen: 24_550, direction: "out" });
    await insertTxn(ledgerId, { amount_sen: 1_000, direction: "in" });

    const rows = await env.DB.prepare(
      "SELECT amount_sen, direction, signed_sen FROM transactions ORDER BY amount_sen",
    ).all<{ amount_sen: number; direction: string; signed_sen: number }>();

    expect(rows.results).toEqual([
      { amount_sen: 1_000, direction: "in", signed_sen: 1_000 },
      { amount_sen: 24_550, direction: "out", signed_sen: -24_550 },
    ]);

    // The whole point of the generated column: one expression, so no two
    // reports can disagree about what a total is.
    const sum = await env.DB.prepare(
      "SELECT SUM(signed_sen) AS net FROM transactions",
    ).first<{ net: number }>();
    expect(sum!.net).toBe(1_000 - 24_550);
  });

  it("rejects a write to the generated column", async () => {
    // SQLite refuses this outright. Stated here because the backup and restore
    // path had to be built around it -- see packages/core/src/worker/backup.ts.
    await expect(
      env.DB.prepare(
        `INSERT INTO transactions
           (id, ledger_id, occurred_on, item, category_id, amount_sen, direction,
            signed_sen, created_at, updated_at)
         VALUES ('x', ?, '2026-08-28', 'T', 'cat_food_drinks', 100, 'out', -100, 'a', 'b')`,
      )
        .bind(ledgerId)
        .run(),
    ).rejects.toThrow(/generated column/i);
  });

  it("rejects a negative amount", async () => {
    // Magnitude plus direction. A sign error must be impossible at write time,
    // because a missed negation on one insert path is silent rather than loud.
    // Asserting the message, not merely that something threw: a bare
    // rejects.toThrow() would also pass on a typo in the test's own SQL.
    await expect(insertTxn(ledgerId, { amount_sen: -500 })).rejects.toThrow(/CHECK constraint/i);
    await expect(insertTxn(ledgerId, { amount_sen: -1 })).rejects.toThrow(/CHECK constraint/i);
  });

  it("ACCEPTS a zero amount, because those are real", async () => {
    // The constraint was `> 0` until the full history arrived and disproved
    // it: eight months carry a RM 0.00 water bill, recorded deliberately so a
    // dashboard averaging utility cost has a value for every month. "Billed
    // nothing" is a fact the schema has to be able to hold.
    await insertTxn(ledgerId, { amount_sen: 0, item: "Water" });

    const row = await env.DB.prepare(
      "SELECT amount_sen, signed_sen FROM transactions WHERE item = 'Water'",
    ).first<{ amount_sen: number; signed_sen: number }>();

    expect(row!.amount_sen).toBe(0);
    // Zero has no sign, so the generated column must not invent one.
    expect(row!.signed_sen).toBe(0);
  });

  it("rejects a direction outside in/out", async () => {
    await expect(insertTxn(ledgerId, { direction: "debit" })).rejects.toThrow(/CHECK constraint/i);
    await expect(insertTxn(ledgerId, { direction: "expense" })).rejects.toThrow(/CHECK constraint/i);
    await expect(insertTxn(ledgerId, { direction: "" })).rejects.toThrow(/CHECK constraint/i);
  });

  it("allows a NULL vehicle, which is the normal case", async () => {
    // 468 of the owner's 649 imported rows have no vehicle. Tolls and parking
    // are deliberately among them.
    await insertTxn(ledgerId, { vehicle_id: null });
    const n = await env.DB.prepare(
      "SELECT COUNT(*) AS n FROM transactions WHERE vehicle_id IS NULL",
    ).first<{ n: number }>();
    expect(n!.n).toBe(1);
  });

  it("does not tie the ledger's integrity to Odometry's tables", async () => {
    // vehicle_id carries NO foreign key on purpose: vehicles is garage-scoped
    // and this table is ledger-scoped, so a database-level reference would let
    // a garage deletion cascade into financial history. Validity is a write-
    // time check in the repository instead.
    const fks = await env.DB.prepare(
      "PRAGMA foreign_key_list(transactions)",
    ).all<{ table: string; from: string }>();

    expect(fks.results.map((f) => f.from)).not.toContain("vehicle_id");
    expect(fks.results.map((f) => f.table)).not.toContain("vehicles");
  });
});

describe("categories", () => {
  let ledgerId: string;

  beforeAll(migrate);
  beforeEach(async () => {
    await resetDb();
    ledgerId = await giveLedger(OWNER);
  });

  it("seeds the owner's 20 categories, labels verbatim", async () => {
    const rows = await env.DB.prepare(
      "SELECT code, name FROM categories WHERE ledger_id IS NULL ORDER BY sort_order",
    ).all<{ code: string; name: string }>();

    expect(rows.results).toHaveLength(20);
    expect(rows.results[0]).toEqual({ code: "transportation", name: "Transportation" });

    // The odd internal space is kept on purpose: it is what the Sheet says,
    // and normalising it silently would make source and import disagree.
    expect(rows.results.map((r) => r.name)).toContain("Food/ Drinks");

    // Four appear only in the 2022-2025 history and were missing from the
    // first seed, which was written from a 2026-only export.
    for (const c of ["accommodation", "dividend", "fundings", "debt"]) {
      expect(`${c}: ${rows.results.some((r) => r.code === c)}`).toBe(`${c}: true`);
    }
  });

  it("is not bound to direction", async () => {
    // Not a style preference -- four of the owner's real categories appear as
    // BOTH directions, so a schema binding them could not hold his own data.
    await insertTxn(ledgerId, { category_id: "cat_household", direction: "out" });
    await insertTxn(ledgerId, { category_id: "cat_household", direction: "in" });

    const rows = await env.DB.prepare(
      "SELECT direction FROM transactions WHERE category_id = 'cat_household' ORDER BY direction",
    ).all<{ direction: string }>();
    expect(rows.results.map((r) => r.direction)).toEqual(["in", "out"]);

    const cols = await env.DB.prepare("PRAGMA table_info(categories)").all<{ name: string }>();
    expect(cols.results.map((c) => c.name)).not.toContain("direction");
  });

  it("stops duplicate codes, global and per-ledger alike", async () => {
    // UNIQUE does not constrain NULLs in SQLite, so a plain unique index would
    // let every global row duplicate freely. uq_category_code uses
    // COALESCE(ledger_id, '') for exactly that reason.
    await expect(
      env.DB.prepare(
        `INSERT INTO categories (id, ledger_id, code, name, created_at)
         VALUES ('dupe_global', NULL, 'transportation', 'Transportation Again', 'x')`,
      ).run(),
    ).rejects.toThrow(/UNIQUE constraint/i);

    // A ledger may define its own 'transportation' -- different scope, allowed.
    await env.DB.prepare(
      `INSERT INTO categories (id, ledger_id, code, name, created_at)
       VALUES ('own_transport', ?, 'transportation', 'My Transportation', 'x')`,
    )
      .bind(ledgerId)
      .run();

    // But only once.
    await expect(
      env.DB.prepare(
        `INSERT INTO categories (id, ledger_id, code, name, created_at)
         VALUES ('own_transport2', ?, 'transportation', 'Again', 'x')`,
      )
        .bind(ledgerId)
        .run(),
    ).rejects.toThrow(/UNIQUE constraint/i);
  });
});

describe("the monthly rollup view", () => {
  let ledgerId: string;

  beforeAll(migrate);
  beforeEach(async () => {
    await resetDb();
    ledgerId = await giveLedger(OWNER);
  });

  it("aggregates in SQL, split by direction and category", async () => {
    // CLAUDE.md invariant 4: rollups are SQL, never a JS loop. Workers allow
    // 10ms CPU, and a loop works fine until it quietly does not.
    await insertTxn(ledgerId, {
      occurred_on: "2026-08-01",
      amount_sen: 10_000,
      direction: "out",
      category_id: "cat_food_drinks",
    });
    await insertTxn(ledgerId, {
      occurred_on: "2026-08-15",
      amount_sen: 2_500,
      direction: "out",
      category_id: "cat_food_drinks",
    });
    await insertTxn(ledgerId, {
      occurred_on: "2026-07-31",
      amount_sen: 500,
      direction: "in",
      category_id: "cat_food_drinks",
    });

    const rows = await env.DB.prepare(
      "SELECT month, category_code, in_sen, out_sen, net_sen, txn_count FROM v_txn_monthly ORDER BY month",
    ).all<Record<string, unknown>>();

    expect(rows.results).toEqual([
      {
        month: "2026-07",
        category_code: "food_drinks",
        in_sen: 500,
        out_sen: 0,
        net_sen: 500,
        txn_count: 1,
      },
      {
        month: "2026-08",
        category_code: "food_drinks",
        in_sen: 0,
        out_sen: 12_500,
        net_sen: -12_500,
        txn_count: 2,
      },
    ]);
  });

  it("contains no date('now') or CURRENT_DATE", async () => {
    // Invariant 5. The Worker runs in UTC and the owner is at UTC+8, so
    // "today" computed inside a view is yesterday for eight hours a day. Views
    // expose parameter-free facts; the caller binds the period.
    const views = await env.DB.prepare(
      "SELECT name, sql FROM sqlite_master WHERE type = 'view'",
    ).all<{ name: string; sql: string }>();

    for (const v of views.results) {
      expect(`${v.name}: ${/date\s*\(\s*'now'|CURRENT_DATE/i.test(v.sql)}`).toBe(
        `${v.name}: false`,
      );
    }
  });
});
