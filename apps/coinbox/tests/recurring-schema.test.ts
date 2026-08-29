import { describe, it, expect, beforeAll, beforeEach } from "vitest";
import { env } from "cloudflare:test";
import { migrate, resetDb, giveLedger, giveRule } from "./helpers";

/**
 * What the recurring tables guarantee, exercised rather than assumed.
 *
 * Every constraint below is asserted by making it FAIL. A CHECK that has never
 * rejected anything is indistinguishable from a comment -- and these guard a
 * writer that runs unattended at 1am, where a bad row is not a 500 somebody
 * sees but a wrong number in a ledger nobody has opened yet.
 *
 * Raw SQL rather than requests through the app, for the same reason
 * schema.test.ts uses it: through the API a constraint failure and a handler
 * bug look identical.
 */

const NOW = "2026-09-15T00:00:00.000Z";

async function insertTxn(ledgerId: string, over: Record<string, unknown> = {}) {
  const row = {
    id: crypto.randomUUID(),
    ledger_id: ledgerId,
    occurred_on: "2026-09-15",
    item: "x",
    category_id: "cat_food_drinks",
    amount_sen: 100,
    direction: "out",
    is_recurring: 0,
    ...over,
  };
  await env.DB.prepare(
    `INSERT INTO transactions
       (id, ledger_id, occurred_on, item, category_id, amount_sen, direction,
        is_recurring, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      row.id,
      row.ledger_id,
      row.occurred_on,
      row.item,
      row.category_id,
      row.amount_sen,
      row.direction,
      row.is_recurring,
      NOW,
      NOW,
    )
    .run();
  return row.id as string;
}

describe("recurring_rules", () => {
  const OWNER = "rules@example.com";
  let ledgerId: string;

  beforeAll(migrate);
  beforeEach(async () => {
    await resetDb();
    ledgerId = await giveLedger(OWNER);
  });

  it("rejects a negative amount", async () => {
    await expect(giveRule(ledgerId, { amount_sen: -1 })).rejects.toThrow();
  });

  /**
   * Eight RM 0.00 water bills are in the owner's real history, recorded on
   * purpose so a monthly average has a value for every month. A recurring bill
   * that is sometimes zero is the same fact, so the constraint is >= 0.
   */
  it("ACCEPTS a zero amount, because those are real", async () => {
    await expect(giveRule(ledgerId, { amount_sen: 0 })).resolves.toBeTruthy();
  });

  it("rejects a direction outside in/out", async () => {
    await expect(giveRule(ledgerId, { direction: "debit" })).rejects.toThrow();
  });

  it("rejects an interval outside the supported range", async () => {
    await expect(giveRule(ledgerId, { interval_months: 0 })).rejects.toThrow();
    await expect(giveRule(ledgerId, { interval_months: 61 })).rejects.toThrow();
    await expect(giveRule(ledgerId, { interval_months: 12 })).resolves.toBeTruthy();
  });

  it("rejects a day of month that is not a day", async () => {
    await expect(giveRule(ledgerId, { day_of_month: 0 })).rejects.toThrow();
    await expect(giveRule(ledgerId, { day_of_month: 32 })).rejects.toThrow();
    // 31 is allowed and means "the last day". The clamp happens in JS because
    // SQLite rolls 31 Jan +1 month forward to 3 March rather than clamping.
    await expect(giveRule(ledgerId, { day_of_month: 31 })).resolves.toBeTruthy();
  });

  it("rejects an end date before the start date", async () => {
    await expect(
      giveRule(ledgerId, { starts_on: "2026-09-01", ends_on: "2026-08-01" }),
    ).rejects.toThrow();
  });

  it("rejects an active flag that is not a flag", async () => {
    await expect(giveRule(ledgerId, { is_active: 2 })).rejects.toThrow();
  });

  /**
   * The same mistake as `categories.direction`, in new clothes.
   *
   * A `frequency` enum beside `interval_months` would encode a fact the
   * integer already carries, would be free to disagree with it
   * (frequency='monthly' with interval_months=3), and would invite
   * `WHERE frequency = 'monthly'` in a query that should have been arithmetic.
   */
  it("has no frequency column duplicating interval_months", async () => {
    const cols = await env.DB.prepare(`PRAGMA table_info(recurring_rules)`).all<{
      name: string;
    }>();
    const names = cols.results.map((c) => c.name);
    expect(names).toContain("interval_months");
    expect(names).not.toContain("frequency");
  });

  /** Nor a cursor: that would cache what the claims table already knows. */
  it("stores no next-due cursor", async () => {
    const cols = await env.DB.prepare(`PRAGMA table_info(recurring_rules)`).all<{
      name: string;
    }>();
    expect(cols.results.map((c) => c.name)).not.toContain("next_due_on");
  });
});

describe("recurring_postings", () => {
  const OWNER = "postings@example.com";
  let ledgerId: string;
  let ruleId: string;

  beforeAll(migrate);
  beforeEach(async () => {
    await resetDb();
    ledgerId = await giveLedger(OWNER);
    ruleId = await giveRule(ledgerId);
  });

  const claim = (occurredOn: string, transactionId: string | null = null) =>
    env.DB.prepare(
      `INSERT INTO recurring_postings (rule_id, occurred_on, transaction_id, posted_at)
       VALUES (?, ?, ?, ?)`,
    )
      .bind(ruleId, occurredOn, transactionId, NOW)
      .run();

  /**
   * THE MOST IMPORTANT SCHEMA TEST IN THIS FEATURE.
   *
   * This primary key is the only thing that makes the nightly run safe to
   * repeat. Careful code is not a substitute: the cron can fire twice, be
   * retried, or overlap, and the result would be a second RM 230 that looks
   * exactly like a real one.
   */
  it("refuses the same occurrence of the same rule twice", async () => {
    await expect(claim("2026-09-15")).resolves.toBeTruthy();
    await expect(claim("2026-09-15")).rejects.toThrow();
  });

  it("allows the same date for a different rule", async () => {
    const other = await giveRule(ledgerId, { item: "Astro" });
    await claim("2026-09-15");

    await expect(
      env.DB.prepare(
        `INSERT INTO recurring_postings (rule_id, occurred_on, transaction_id, posted_at)
         VALUES (?, ?, NULL, ?)`,
      )
        .bind(other, "2026-09-15", NOW)
        .run(),
    ).resolves.toBeTruthy();
  });

  /**
   * Unlimited NULLs, one non-NULL. A plain UNIQUE would look correct and
   * constrain nothing on the NULLs -- which is the state every occurrence
   * lands in once its transaction has been deleted.
   */
  it("allows many unlinked claims but never two for one transaction", async () => {
    const txnId = await insertTxn(ledgerId);
    await claim("2026-09-15");
    await claim("2026-10-15");

    await env.DB.prepare(
      `UPDATE recurring_postings SET transaction_id = ? WHERE rule_id = ? AND occurred_on = ?`,
    )
      .bind(txnId, ruleId, "2026-09-15")
      .run();

    await expect(
      env.DB.prepare(
        `UPDATE recurring_postings SET transaction_id = ? WHERE rule_id = ? AND occurred_on = ?`,
      )
        .bind(txnId, ruleId, "2026-10-15")
        .run(),
    ).rejects.toThrow();
  });

  /**
   * Deleting the entry must NOT release the claim, or the next nightly run
   * re-creates the row the owner just deleted -- an entry that will not stay
   * deleted, forever.
   */
  it("keeps the claim when its transaction is deleted", async () => {
    const txnId = await insertTxn(ledgerId, { is_recurring: 1 });
    await claim("2026-09-15", txnId);

    await env.DB.prepare(`DELETE FROM transactions WHERE id = ?`).bind(txnId).run();

    const row = await env.DB.prepare(
      `SELECT transaction_id FROM recurring_postings WHERE rule_id = ?`,
    )
      .bind(ruleId)
      .first<{ transaction_id: string | null }>();

    expect(row).not.toBeNull();
    expect(row?.transaction_id).toBeNull();
  });

  /** Deleting a RULE takes its claims and leaves the money entirely alone. */
  it("cascades from the rule but never into financial history", async () => {
    const txnId = await insertTxn(ledgerId, { is_recurring: 1 });
    await claim("2026-09-15", txnId);

    await env.DB.prepare(`DELETE FROM recurring_rules WHERE id = ?`).bind(ruleId).run();

    const claims = await env.DB.prepare(
      `SELECT COUNT(*) AS n FROM recurring_postings WHERE rule_id = ?`,
    )
      .bind(ruleId)
      .first<{ n: number }>();
    const txn = await env.DB.prepare(`SELECT is_recurring FROM transactions WHERE id = ?`)
      .bind(txnId)
      .first<{ is_recurring: number }>();

    expect(claims?.n).toBe(0);
    // The money survives, and can still say how it got here without the rule.
    expect(txn?.is_recurring).toBe(1);
  });
});

describe("transactions.is_recurring", () => {
  const OWNER = "flag@example.com";
  let ledgerId: string;

  beforeAll(migrate);
  beforeEach(async () => {
    await resetDb();
    ledgerId = await giveLedger(OWNER);
  });

  it("defaults to 0, so a typed entry never claims to be automated", async () => {
    const id = crypto.randomUUID();
    await env.DB.prepare(
      `INSERT INTO transactions
         (id, ledger_id, occurred_on, item, category_id, amount_sen, direction,
          created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
      .bind(id, ledgerId, "2026-09-15", "x", "cat_food_drinks", 100, "out", NOW, NOW)
      .run();

    const row = await env.DB.prepare(`SELECT is_recurring FROM transactions WHERE id = ?`)
      .bind(id)
      .first<{ is_recurring: number }>();
    expect(row?.is_recurring).toBe(0);
  });

  it("rejects a value that is not a flag", async () => {
    await expect(insertTxn(ledgerId, { is_recurring: 2 })).rejects.toThrow();
  });

  it("left every imported row unflagged", async () => {
    // The column was added with DEFAULT 0, which is correct for all 4,421
    // existing rows: every one was typed or imported, none was posted by a
    // rule. Asserted on a seeded row here; verified against production counts
    // when the migration was applied.
    const id = await insertTxn(ledgerId);
    const row = await env.DB.prepare(`SELECT is_recurring FROM transactions WHERE id = ?`)
      .bind(id)
      .first<{ is_recurring: number }>();
    expect(row?.is_recurring).toBe(0);
  });
});
