import { describe, it, expect, beforeAll, beforeEach, afterEach } from "vitest";
import { env } from "cloudflare:test";
import { as, migrate, resetDb, giveLedger, giveRule } from "./helpers";
import { runRecurringPosting } from "@worker/data/recurring-runner";

/**
 * The owner's own share, paid by a recurring entry in the PERSONAL ledger,
 * lands in the pot in the same batch as the ledger row. docs/coinbox-spec.md
 * §11, and RecurringRepo.postOne.
 *
 * What goes wrong silently if this breaks: the ledger says RM 200 went to the
 * fund and the pot never hears of it (the grid shows the owner behind), or the
 * pot credits RM 200 whose ledger row was rolled back (the pot is fiction).
 */

const OWNER = "owner@test.local";

/** 30 Sep 2026, 01:00 in Kuala Lumpur -- when the real cron fires. */
const SEP_30 = new Date("2026-09-29T17:00:00.000Z");

let ledgerId: string;

async function memberFor(ruleId: string | null, name = "Ayiq") {
  const res = await as(OWNER)("/api/fund/members", {
    method: "POST",
    json: { name, defaultSen: 20_000, recurringRuleId: ruleId },
  });
  expect(res.status, res.text).toBe(201);
  return res.body.id as string;
}

async function count(sql: string): Promise<number> {
  const row = await env.DB.prepare(sql).first<{ n: number }>();
  return row?.n ?? 0;
}

const familyRule = () =>
  giveRule(ledgerId, {
    item: "Family fund",
    category_id: "cat_family",
    amount_sen: 20_000,
    day_of_month: 31,
    starts_on: "2026-09-01",
  });

beforeAll(migrate);
beforeEach(async () => {
  await resetDb();
  ledgerId = await giveLedger(OWNER);
});

describe("a rule that pays a member's share", () => {
  it("posts the ledger entry and the contribution together", async () => {
    const ruleId = await familyRule();
    const ayiq = await memberFor(ruleId);

    const result = await runRecurringPosting(env, { now: SEP_30 });
    expect(result.posted).toBe(1);

    const txn = await env.DB.prepare(
      `SELECT id, direction, amount_sen FROM transactions WHERE item = 'Family fund'`,
    ).first<{ id: string; direction: string; amount_sen: number }>();
    expect(txn).toMatchObject({ direction: "out", amount_sen: 20_000 });

    const grid = await as(OWNER)("/api/fund/grid?year=2026");
    expect(grid.body.contributions).toEqual([
      expect.objectContaining({
        memberId: ayiq,
        // 30 September pays for September: a posting pays for its own month.
        forMonth: "2026-09",
        occurredOn: "2026-09-30",
        amountSen: 20_000,
        item: "From Ayiq",
        transactionId: txn!.id,
      }),
    ]);
  });

  it("writes nothing to the pot for a rule that pays nobody's share", async () => {
    await giveRule(ledgerId, { starts_on: "2026-09-01", day_of_month: 15 });
    await memberFor(null, "Kdik");

    await runRecurringPosting(env, { now: SEP_30 });

    expect(await count(`SELECT COUNT(*) AS n FROM transactions`)).toBe(1);
    expect(await count(`SELECT COUNT(*) AS n FROM fund_entries`)).toBe(0);
  });

  it("does not credit the pot twice when the run repeats", async () => {
    const ruleId = await familyRule();
    await memberFor(ruleId);

    await runRecurringPosting(env, { now: SEP_30 });
    await runRecurringPosting(env, { now: SEP_30 });

    expect(await count(`SELECT COUNT(*) AS n FROM fund_entries`)).toBe(1);
  });

  it("removes the contribution when the ledger entry is deleted", async () => {
    const ruleId = await familyRule();
    await memberFor(ruleId);
    await runRecurringPosting(env, { now: SEP_30 });

    const txn = await env.DB.prepare(`SELECT id FROM transactions`).first<{ id: string }>();
    const del = await as(OWNER)(`/api/transactions/${txn!.id}`, { method: "DELETE" });
    expect(del.status).toBe(204);

    // One payment, deleted in one place.
    expect(await count(`SELECT COUNT(*) AS n FROM fund_entries`)).toBe(0);
    const pot = await as(OWNER)("/api/fund");
    expect(pot.body.balanceSen).toBe(0);
  });

  it("refuses to edit or delete the linked contribution from the fund side", async () => {
    const ruleId = await familyRule();
    await memberFor(ruleId);
    await runRecurringPosting(env, { now: SEP_30 });
    const entry = await env.DB.prepare(`SELECT id FROM fund_entries`).first<{ id: string }>();

    const patch = await as(OWNER)(`/api/fund/entries/${entry!.id}`, {
      method: "PATCH",
      json: { amountSen: 1 },
    });
    expect(patch.status).toBe(422);
    const del = await as(OWNER)(`/api/fund/entries/${entry!.id}`, { method: "DELETE" });
    expect(del.status).toBe(422);
    expect(await count(`SELECT COUNT(*) AS n FROM fund_entries WHERE amount_sen = 20000`)).toBe(1);
  });

  it("stops linking once the rule is deleted, keeping what it already paid", async () => {
    const ruleId = await familyRule();
    const ayiq = await memberFor(ruleId);
    await runRecurringPosting(env, { now: SEP_30 });

    const del = await as(OWNER)(`/api/recurring/${ruleId}`, { method: "DELETE" });
    expect(del.status).toBe(204);

    const member = await env.DB.prepare(`SELECT recurring_rule_id FROM fund_members WHERE id = ?`)
      .bind(ayiq)
      .first<{ recurring_rule_id: string | null }>();
    expect(member?.recurring_rule_id).toBeNull();
    expect(await count(`SELECT COUNT(*) AS n FROM fund_entries`)).toBe(1);
  });
});

/**
 * ALL OR NOTHING, proved in both directions.
 *
 * Every validation happens before the batch runs, so the ordinary tests above
 * would still pass if the contribution were written in a second, separate
 * statement. These make one statement of the batch fail at the database -- a
 * temporary trigger, dropped afterwards -- and assert nothing else survived.
 */
describe("one batch", () => {
  afterEach(async () => {
    await env.DB.prepare(`DROP TRIGGER IF EXISTS fail_fund_insert`).run();
    await env.DB.prepare(`DROP TRIGGER IF EXISTS fail_claim_insert`).run();
  });

  it("rolls back the ledger entry and its claim if the contribution fails", async () => {
    const ruleId = await familyRule();
    await memberFor(ruleId);
    await env.DB.prepare(
      `CREATE TRIGGER fail_fund_insert BEFORE INSERT ON fund_entries
       BEGIN SELECT RAISE(ABORT, 'forced'); END`,
    ).run();

    await expect(runRecurringPosting(env, { now: SEP_30 })).rejects.toThrow();

    expect(await count(`SELECT COUNT(*) AS n FROM transactions`)).toBe(0);
    expect(await count(`SELECT COUNT(*) AS n FROM recurring_postings`)).toBe(0);
  });

  it("rolls back the contribution if the claim fails", async () => {
    const ruleId = await familyRule();
    await memberFor(ruleId);
    await env.DB.prepare(
      `CREATE TRIGGER fail_claim_insert BEFORE INSERT ON recurring_postings
       BEGIN SELECT RAISE(ABORT, 'forced'); END`,
    ).run();

    await expect(runRecurringPosting(env, { now: SEP_30 })).rejects.toThrow();

    expect(await count(`SELECT COUNT(*) AS n FROM fund_entries`)).toBe(0);
    expect(await count(`SELECT COUNT(*) AS n FROM transactions`)).toBe(0);
  });
});
