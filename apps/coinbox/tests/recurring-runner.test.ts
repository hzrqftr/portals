import { describe, it, expect, beforeAll, beforeEach } from "vitest";
import { env } from "cloudflare:test";
import {
  as,
  migrate,
  resetDb,
  giveLedger,
  giveGarage,
  giveVehicle,
  giveRule,
  addToGarageOf,
  removeFromGarageOf,
} from "./helpers";
import { runRecurringPosting } from "@worker/data/recurring-runner";

/**
 * The nightly job that posts due recurring entries.
 *
 * This is the only unscoped writer in the system and the only thing in the
 * repo that manufactures transactions, so it gets the same treatment the
 * backup round trip gets: exercised, not asserted.
 *
 * Every failure here is silent in production. A double-post is a plausible
 * looking duplicate; a timezone bug is an entry dated one day out; a runaway
 * catch-up is a Worker killed mid-run with no log line. None of them throw.
 */

const OWNER = "owner@test.local";
const OTHER = "other@test.local";

/** 2026-09-15 mid-morning UTC, well inside the same calendar day at UTC+8. */
const SEP_15 = new Date("2026-09-15T02:00:00.000Z");

async function txnsOf(email: string) {
  const res = await as(email)("/api/transactions");
  return res.body as { id: string; occurredOn: string; item: string; isRecurring: number }[];
}

async function claimCount(ruleId: string): Promise<number> {
  const row = await env.DB.prepare(
    `SELECT COUNT(*) AS n FROM recurring_postings WHERE rule_id = ?`,
  )
    .bind(ruleId)
    .first<{ n: number }>();
  return row?.n ?? 0;
}

describe("the scheduled recurring run", () => {
  let ledgerId: string;

  beforeAll(migrate);
  beforeEach(async () => {
    await resetDb();
    ledgerId = await giveLedger(OWNER);
  });

  it("posts an occurrence that has come due", async () => {
    await giveRule(ledgerId, { starts_on: "2026-09-01", day_of_month: 15 });

    const result = await runRecurringPosting(env, { now: SEP_15 });

    expect(result.posted).toBe(1);
    const txns = await txnsOf(OWNER);
    expect(txns).toHaveLength(1);
    expect(txns[0]?.occurredOn).toBe("2026-09-15");
    expect(txns[0]?.item).toBe("Insurance");
  });

  it("posts nothing before the due date arrives", async () => {
    await giveRule(ledgerId, { starts_on: "2026-09-01", day_of_month: 15 });

    const result = await runRecurringPosting(env, { now: new Date("2026-09-14T02:00:00Z") });

    expect(result.posted).toBe(0);
    expect(await txnsOf(OWNER)).toHaveLength(0);
  });

  /**
   * THE HEADLINE TEST. Everything else in this feature is arranged around it.
   *
   * The cron may fire twice, be retried, or overlap with a manual run. If the
   * only thing standing between that and a duplicate entry were careful code,
   * this would eventually produce a second RM 230 that looks exactly like a
   * real one. The primary key on recurring_postings is what actually stops it.
   */
  it("does not post twice, however many times it runs", async () => {
    const ruleId = await giveRule(ledgerId, { starts_on: "2026-09-01", day_of_month: 15 });

    const first = await runRecurringPosting(env, { now: SEP_15 });
    const second = await runRecurringPosting(env, { now: SEP_15 });
    // A third at a different hour of the same day, which is what a retry looks like.
    const third = await runRecurringPosting(env, { now: new Date("2026-09-15T21:00:00Z") });

    expect(first.posted).toBe(1);
    expect(second.posted).toBe(0);
    expect(second.skipped + third.skipped).toBe(0); // nothing even offered twice
    expect(await txnsOf(OWNER)).toHaveLength(1);
    expect(await claimCount(ruleId)).toBe(1);
  });

  /**
   * Two runs racing. Miniflare serialises D1, so this exercises the constraint
   * path rather than proving production concurrency safety -- the atomic
   * batch() plus the primary key is the argument; this only shows the path is
   * wired. Said plainly rather than over-claimed.
   */
  it("survives two runs started together", async () => {
    await giveRule(ledgerId, { starts_on: "2026-09-01", day_of_month: 15 });

    await Promise.all([
      runRecurringPosting(env, { now: SEP_15 }),
      runRecurringPosting(env, { now: SEP_15 }),
    ]);

    expect(await txnsOf(OWNER)).toHaveLength(1);
  });

  it("catches up every missed occurrence in one run", async () => {
    await giveRule(ledgerId, { starts_on: "2026-06-01", day_of_month: 1 });

    const result = await runRecurringPosting(env, { now: new Date("2026-09-05T02:00:00Z") });

    expect(result.posted).toBe(4);
    const dates = (await txnsOf(OWNER)).map((t) => t.occurredOn).sort();
    expect(dates).toEqual(["2026-06-01", "2026-07-01", "2026-08-01", "2026-09-01"]);
  });

  /**
   * THE ONLY TEST THAT CAN FAIL ON A SINGLE GLOBAL `today`.
   *
   * With one timezone in the fixture, a runner using `new Date()` or one
   * shared today passes everything else in this file. Two owners on opposite
   * sides of the date line make the bug unavoidable: at this instant it is
   * already the 15th at UTC+14 and still the 14th at UTC-11, so exactly one of
   * them is due. An entry posted a day early is the quiet wrongness the fleet
   * spec warns destroys trust in the tool.
   */
  it("uses each owner's own calendar day, not one global today", async () => {
    const otherLedger = await giveLedger(OTHER);
    await env.DB.batch([
      env.DB.prepare(`UPDATE users SET timezone = 'Pacific/Kiritimati' WHERE email = ?`).bind(OWNER),
      env.DB.prepare(`UPDATE users SET timezone = 'Pacific/Niue' WHERE email = ?`).bind(OTHER),
    ]);
    await giveRule(ledgerId, { starts_on: "2026-09-01", day_of_month: 15, item: "EastRule" });
    await giveRule(otherLedger, { starts_on: "2026-09-01", day_of_month: 15, item: "WestRule" });

    // 2026-09-15T00:30Z: already the 15th at UTC+14, still the 14th at UTC-11.
    await runRecurringPosting(env, { now: new Date("2026-09-15T00:30:00.000Z") });

    expect((await txnsOf(OWNER)).map((t) => t.item)).toEqual(["EastRule"]);
    expect(await txnsOf(OTHER)).toHaveLength(0);
  });

  it("posts nothing for a paused rule, and resumes without arrears", async () => {
    const ruleId = await giveRule(ledgerId, {
      starts_on: "2026-06-01",
      day_of_month: 1,
      is_active: 0,
    });

    await runRecurringPosting(env, { now: new Date("2026-09-05T02:00:00Z") });
    expect(await txnsOf(OWNER)).toHaveLength(0);

    // Unpausing does not back-pay the paused months: the run only ever posts
    // occurrences at or before today, and the claims table decides where the
    // series resumes -- but nothing was claimed, so it starts at startsOn.
    await env.DB.prepare(`UPDATE recurring_rules SET is_active = 1 WHERE id = ?`)
      .bind(ruleId)
      .run();
    const after = await runRecurringPosting(env, { now: new Date("2026-09-05T02:00:00Z") });
    expect(after.posted).toBeGreaterThan(0);
  });

  it("stops at the end date", async () => {
    await giveRule(ledgerId, {
      starts_on: "2026-06-01",
      day_of_month: 1,
      ends_on: "2026-07-01",
    });

    await runRecurringPosting(env, { now: new Date("2026-09-05T02:00:00Z") });

    const dates = (await txnsOf(OWNER)).map((t) => t.occurredOn).sort();
    expect(dates).toEqual(["2026-06-01", "2026-07-01"]);
  });

  it("never posts before the start date, so history cannot be regenerated", async () => {
    await giveRule(ledgerId, { starts_on: "2026-09-01", day_of_month: 15 });

    await runRecurringPosting(env, { now: SEP_15 });

    const dates = (await txnsOf(OWNER)).map((t) => t.occurredOn);
    expect(dates.every((d) => d >= "2026-09-01")).toBe(true);
  });

  it("bounds one run rather than looping without limit", async () => {
    await giveRule(ledgerId, { starts_on: "2020-01-01", day_of_month: 1 });

    const result = await runRecurringPosting(env, { now: SEP_15 });

    // MAX_PER_RULE. The point is that it terminates, not the exact number.
    expect(result.posted).toBe(12);
  });

  describe("what it produces", () => {
    it("marks its entries as recurring, and leaves typed ones unmarked", async () => {
      await giveRule(ledgerId, { starts_on: "2026-09-01", day_of_month: 15 });
      await runRecurringPosting(env, { now: SEP_15 });

      await as(OWNER)("/api/transactions", {
        method: "POST",
        json: {
          occurredOn: "2026-09-15",
          item: "Typed by hand",
          categoryId: "cat_food_drinks",
          amountSen: 1200,
          direction: "out",
        },
      });

      const txns = await txnsOf(OWNER);
      const auto = txns.find((t) => t.item === "Insurance");
      const typed = txns.find((t) => t.item === "Typed by hand");
      expect(auto?.isRecurring).toBe(1);
      expect(typed?.isRecurring).toBe(0);
    });

    it("produces an ordinary transaction that counts in the summary", async () => {
      await giveRule(ledgerId, { starts_on: "2026-09-01", day_of_month: 15 });
      await runRecurringPosting(env, { now: SEP_15 });

      const summary = await as(OWNER)("/api/summary");
      expect(summary.body).toHaveLength(1);
      expect(summary.body[0].out_sen).toBe(23_000);
    });

    /**
     * The single best argument for the link table.
     *
     * Deleting the entry nulls recurring_postings.transaction_id but leaves
     * the (rule_id, occurred_on) claim, so the occurrence stays spoken for.
     * With provenance on the transaction instead, deleting the row would
     * delete the evidence and the next run would helpfully re-create it --
     * an entry that will not stay deleted, forever.
     */
    it("does not resurrect an entry the owner deleted", async () => {
      const ruleId = await giveRule(ledgerId, { starts_on: "2026-09-01", day_of_month: 15 });
      await runRecurringPosting(env, { now: SEP_15 });

      const [posted] = await txnsOf(OWNER);
      if (!posted) throw new Error("expected the run to have posted one entry");
      const del = await as(OWNER)(`/api/transactions/${posted.id}`, { method: "DELETE" });
      expect(del.status).toBe(204);
      expect(await txnsOf(OWNER)).toHaveLength(0);

      await runRecurringPosting(env, { now: SEP_15 });
      await runRecurringPosting(env, { now: new Date("2026-09-20T02:00:00Z") });

      expect(await txnsOf(OWNER)).toHaveLength(0);
      expect(await claimCount(ruleId)).toBe(1);
    });

    it("keeps posted entries when the rule itself is deleted", async () => {
      const ruleId = await giveRule(ledgerId, { starts_on: "2026-09-01", day_of_month: 15 });
      await runRecurringPosting(env, { now: SEP_15 });

      const del = await as(OWNER)(`/api/recurring/${ruleId}`, { method: "DELETE" });
      expect(del.status).toBe(204);

      // The money survives; only the schedule and its claims go.
      const txns = await txnsOf(OWNER);
      expect(txns).toHaveLength(1);
      expect(txns[0]?.isRecurring).toBe(1); // still answerable without the rule
      expect(await claimCount(ruleId)).toBe(0);
    });
  });

  describe("the vehicle it was authorised for", () => {
    /**
     * A rule's vehicle is checked when the rule is created and RE-checked every
     * time the cron posts, because those are months apart and garage
     * membership can change in between. Without the second check, revoking
     * someone's garage access would revoke nothing: the scheduled writer would
     * keep stamping the owner's vehicle_id into their ledger indefinitely.
     */
    it("posts unattributed once the vehicle is no longer reachable", async () => {
      const co = "comember@test.local";
      await as(OWNER)("/api/me");
      await giveGarage(OWNER);
      const vehicleId = await giveVehicle(OWNER, "Waja");
      const coLedger = await giveLedger(co);
      await addToGarageOf(OWNER, co);

      await giveRule(coLedger, {
        starts_on: "2026-09-01",
        day_of_month: 15,
        vehicle_id: vehicleId,
        item: "Car insurance",
      });

      await removeFromGarageOf(OWNER, co);
      await runRecurringPosting(env, { now: SEP_15 });

      const rows = await env.DB.prepare(
        `SELECT vehicle_id, amount_sen FROM transactions WHERE ledger_id = ?`,
      )
        .bind(coLedger)
        .all<{ vehicle_id: string | null; amount_sen: number }>();

      expect(rows.results).toHaveLength(1);
      // The payment is real and is recorded; only the attribution is dropped.
      expect(rows.results[0]?.vehicle_id).toBeNull();
      expect(rows.results[0]?.amount_sen).toBe(23_000);
    });

    it("keeps the vehicle while membership still holds", async () => {
      await as(OWNER)("/api/me");
      await giveGarage(OWNER);
      const vehicleId = await giveVehicle(OWNER, "Waja");

      await giveRule(ledgerId, {
        starts_on: "2026-09-01",
        day_of_month: 15,
        vehicle_id: vehicleId,
      });
      await runRecurringPosting(env, { now: SEP_15 });

      const row = await env.DB.prepare(
        `SELECT vehicle_id FROM transactions WHERE ledger_id = ?`,
      )
        .bind(ledgerId)
        .first<{ vehicle_id: string | null }>();
      expect(row?.vehicle_id).toBe(vehicleId);
    });
  });
});
