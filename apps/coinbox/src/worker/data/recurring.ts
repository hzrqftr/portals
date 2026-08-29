import { asc, desc, eq, lte, sql } from "drizzle-orm";
import { NotFoundError, ValidationError } from "@portals/core/worker";
import { nowIso, todayIn, type CalendarDate } from "@portals/core";
import { LedgerScopedRepo } from "./base";
import { recurringRules, recurringPostings, categories } from "../schema";
import { dueOccurrences, type Schedule } from "@shared/recurrence";
import type { RecurringCreate, RecurringPatch } from "@shared/zod";

/**
 * Declared recurring entries, and the machinery that posts them.
 *
 * Every read and write goes through `this.where(recurringRules, ...)`. That
 * matters more here than anywhere else in the portal, because this repository
 * is also driven by the cron -- a caller with no HTTP request behind it. The
 * scope is real either way (see data/recurring-runner.ts), so there is no
 * second, laxer code path for the scheduled writer to take.
 */

/**
 * How many occurrences one rule may post in a single run.
 *
 * Twelve absorbs any realistic outage -- a year of a monthly rule -- in one
 * pass. It is also a hard stop: a date bug that fails to advance would
 * otherwise loop until the Worker is killed, which in a cron nobody watches is
 * invisible rather than loud.
 */
const MAX_PER_RULE = 12;

export interface PostingResult {
  considered: number;
  posted: number;
  skipped: number;
}

function scheduleOf(rule: {
  intervalMonths: number;
  dayOfMonth: number;
  startsOn: string;
  endsOn: string | null;
}): Schedule {
  return {
    intervalMonths: rule.intervalMonths,
    dayOfMonth: rule.dayOfMonth,
    startsOn: rule.startsOn,
    endsOn: rule.endsOn,
  };
}

export class RecurringRepo extends LedgerScopedRepo {
  /**
   * The rules, with how far each has got.
   *
   * `lastPostedOn` and `postedCount` are correlated subqueries rather than a
   * JS pass over the postings -- invariant 4, and the reason a rule list stays
   * one round trip however many occurrences it has behind it.
   */
  async list() {
    return this.db
      .select({
        id: recurringRules.id,
        item: recurringRules.item,
        description: recurringRules.description,
        categoryId: recurringRules.categoryId,
        categoryName: categories.name,
        categoryCode: categories.code,
        vehicleId: recurringRules.vehicleId,
        amountSen: recurringRules.amountSen,
        direction: recurringRules.direction,
        intervalMonths: recurringRules.intervalMonths,
        dayOfMonth: recurringRules.dayOfMonth,
        startsOn: recurringRules.startsOn,
        endsOn: recurringRules.endsOn,
        isActive: recurringRules.isActive,
        lastPostedOn: sql<string | null>`(SELECT MAX(p.occurred_on) FROM recurring_postings p WHERE p.rule_id = ${recurringRules.id})`,
        postedCount: sql<number>`(SELECT COUNT(*) FROM recurring_postings p WHERE p.rule_id = ${recurringRules.id})`,
      })
      .from(recurringRules)
      .innerJoin(categories, eq(categories.id, recurringRules.categoryId))
      .where(this.where(recurringRules))
      // Active first, then alphabetical, then id. The id is the same stability
      // tiebreak the ledger carries: without it two rules sharing a name can
      // swap places between loads.
      .orderBy(desc(recurringRules.isActive), asc(recurringRules.item), asc(recurringRules.id));
  }

  async get(id: string) {
    const [row] = await this.db
      .select()
      .from(recurringRules)
      .where(this.where(recurringRules, eq(recurringRules.id, id)))
      .limit(1);
    if (!row) throw new NotFoundError("Recurring entry not found");
    return row;
  }

  async create(input: RecurringCreate) {
    await this.assertUsableCategory(input.categoryId);
    if (input.vehicleId) await this.assertUsableVehicle(input.vehicleId);
    this.assertForwardOnly(input.startsOn);

    const id = crypto.randomUUID();
    const at = nowIso();

    await this.db.insert(recurringRules).values({
      id,
      ledgerId: this.ledgerId,
      item: input.item,
      description: input.description ?? null,
      categoryId: input.categoryId,
      vehicleId: input.vehicleId ?? null,
      amountSen: input.amountSen,
      direction: input.direction,
      intervalMonths: input.intervalMonths,
      dayOfMonth: input.dayOfMonth,
      startsOn: input.startsOn,
      endsOn: input.endsOn ?? null,
      isActive: input.isActive === false ? 0 : 1,
      createdAt: at,
      updatedAt: at,
    });

    return this.get(id);
  }

  async update(id: string, patch: RecurringPatch) {
    // Proves ownership before touching anything: get() carries the ledger
    // predicate, so editing someone else's rule 404s here rather than later.
    await this.get(id);

    if (patch.categoryId) await this.assertUsableCategory(patch.categoryId);
    if (patch.vehicleId) await this.assertUsableVehicle(patch.vehicleId);
    if (patch.startsOn) this.assertForwardOnly(patch.startsOn);

    const values: Record<string, unknown> = { updatedAt: nowIso() };
    for (const key of [
      "item",
      "categoryId",
      "amountSen",
      "direction",
      "intervalMonths",
      "dayOfMonth",
      "startsOn",
    ] as const) {
      if (patch[key] !== undefined) values[key] = patch[key];
    }
    // An explicit null clears; an omitted key leaves the column alone. Same
    // convention as TransactionRepo.update.
    if (patch.description !== undefined) values.description = patch.description ?? null;
    if (patch.vehicleId !== undefined) values.vehicleId = patch.vehicleId ?? null;
    if (patch.endsOn !== undefined) values.endsOn = patch.endsOn ?? null;
    if (patch.isActive !== undefined) values.isActive = patch.isActive ? 1 : 0;

    await this.db
      .update(recurringRules)
      .set(values)
      .where(this.where(recurringRules, eq(recurringRules.id, id)));

    return this.get(id);
  }

  /**
   * Deleting a rule stops the series. It does NOT touch the entries the rule
   * already posted: `recurring_postings` cascades, `transactions` does not,
   * because the money was real whatever happens to the schedule that caused
   * it. `transactions.is_recurring` is why those entries can still say how
   * they got there once the rule and its claims are gone.
   */
  async remove(id: string): Promise<void> {
    await this.get(id);
    await this.db
      .delete(recurringRules)
      .where(this.where(recurringRules, eq(recurringRules.id, id)));
  }

  /**
   * FORWARD ONLY.
   *
   * Rejected here rather than in Zod because it needs the owner's timezone,
   * which only the scope knows. The 4,421 imported rows already cover the
   * past; a rule allowed to start in 2022 would regenerate them as duplicates
   * and nothing would report it.
   */
  private assertForwardOnly(startsOn: CalendarDate): void {
    const today = todayIn(this.scope.timezone);
    if (startsOn < today) {
      throw new ValidationError("A recurring entry cannot start in the past");
    }
  }

  /**
   * Post every occurrence that has come due and has not been claimed.
   *
   * `today` is the owner's calendar day, computed by the caller from
   * `users.timezone`. Never `new Date()`: the Worker runs in UTC and the owner
   * is at UTC+8, so a bare date is the previous local day for eight hours out
   * of every twenty-four -- and an entry posted a day early is exactly the
   * quiet wrongness that destroys trust in an automated ledger.
   */
  async postDue(today: CalendarDate): Promise<PostingResult> {
    const rules = await this.db
      .select()
      .from(recurringRules)
      .where(
        this.where(
          recurringRules,
          eq(recurringRules.isActive, 1),
          lte(recurringRules.startsOn, today),
        ),
      );

    const result: PostingResult = { considered: rules.length, posted: 0, skipped: 0 };

    for (const rule of rules) {
      // Where this rule has got to, read from the claims table rather than
      // from a stored cursor. A cursor would be a cache of a derivable fact,
      // and a cache that is wrong posts money on the wrong day.
      //
      // Not `this.where()`: recurring_postings carries no ledger_id (it
      // reaches the ledger through rule_id, as import_rows does through
      // import_batches). `rule.id` came from the ledger-scoped query above,
      // so the tenant is already established.
      const [last] = await this.db
        .select({ lastPostedOn: sql<string | null>`MAX(${recurringPostings.occurredOn})` })
        .from(recurringPostings)
        .where(eq(recurringPostings.ruleId, rule.id));

      const occurrences = dueOccurrences(
        scheduleOf(rule),
        last?.lastPostedOn ?? null,
        today,
        MAX_PER_RULE,
      );

      for (const occurredOn of occurrences) {
        if (await this.postOne(rule, occurredOn)) result.posted += 1;
        else result.skipped += 1;
      }
    }

    return result;
  }

  /** True when it posted, false when the occurrence was already claimed. */
  private async postOne(
    rule: typeof recurringRules.$inferSelect,
    occurredOn: CalendarDate,
  ): Promise<boolean> {
    const vehicleId = await this.resolveVehicleForPost(rule.vehicleId);
    const txnId = crypto.randomUUID();
    const at = nowIso();

    try {
      // The money, then the claim, in ONE atomic batch.
      //
      // THE ORDER IS FORCED AND IS NOT A PREFERENCE. recurring_postings
      // .transaction_id references transactions(id), and D1 enforces foreign
      // keys statement by statement -- it ignores `PRAGMA foreign_keys = OFF`
      // (root CLAUDE.md, "Known traps"). Claiming first therefore fails with
      // SQLITE_CONSTRAINT_FOREIGNKEY on a row that does not exist yet. Found
      // by this repository's own test suite on the first run.
      //
      // Ordering costs nothing, because the guarantee never came from the
      // order: D1 has no interactive transactions and batch() is the atomic
      // unit -- the same tool bootstrapLedger uses -- so a primary-key
      // violation on the claim rolls back the transaction insert beside it
      // whichever way round they are written. There is no window in which a
      // posted entry exists without its claim.
      //
      // DO NOT write `INSERT OR IGNORE` on the claim. That WOULD break it: the
      // claim would be skipped while the transaction insert succeeded, giving
      // exactly the double-post this table exists to prevent, on the next run
      // and every run after. It is a two-word edit that reads as defensive.
      await this.raw.batch([
        this.raw
          .prepare(
            `INSERT INTO transactions
               (id, ledger_id, occurred_on, item, description, category_id,
                vehicle_id, amount_sen, direction, is_recurring, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`,
          )
          .bind(
            txnId,
            // The scheduled writer still carries the tenant predicate's value.
            this.ledgerId,
            occurredOn,
            rule.item,
            rule.description,
            rule.categoryId,
            vehicleId,
            rule.amountSen,
            rule.direction,
            at,
            at,
          ),
        this.raw
          .prepare(
            `INSERT INTO recurring_postings (rule_id, occurred_on, transaction_id, posted_at)
             VALUES (?, ?, ?, ?)`,
          )
          .bind(rule.id, occurredOn, txnId, at),
      ]);
      return true;
    } catch (err) {
      // Decide by re-reading, NOT by matching the error text. "D1_ERROR:
      // UNIQUE constraint failed" is not a stable API, and a version bump
      // that reworded it would silently turn every real failure -- a bad
      // category reference, say -- into "already posted, nothing to do".
      const claimed = await this.raw
        .prepare(`SELECT 1 FROM recurring_postings WHERE rule_id = ? AND occurred_on = ?`)
        .bind(rule.id, occurredOn)
        .first();
      if (!claimed) throw err;
      return false;
    }
  }

  /**
   * A rule's vehicle was authorised when the rule was created. The cron posts
   * months later, when garage membership may have lapsed -- so it is checked
   * again, against the ledger owner, every single time.
   *
   * On failure the entry posts WITHOUT the vehicle rather than being skipped.
   * The payment is real and the ledger must record it; the vehicle link is
   * attribution, and dropping it fails in the safe direction. Skipping instead
   * would lose money from the ledger because a *garage membership* changed,
   * which is wrong about the one thing this system exists to be right about.
   *
   * The rule's own `vehicle_id` is left alone: clearing it would destroy the
   * record of what was intended and make the cause unrecoverable.
   */
  private async resolveVehicleForPost(vehicleId: string | null): Promise<string | null> {
    if (!vehicleId) return null;
    try {
      await this.assertUsableVehicle(vehicleId);
      return vehicleId;
    } catch {
      console.log(
        `recurring: vehicle ${vehicleId} no longer usable by this ledger's owner, posting unattributed`,
      );
      return null;
    }
  }
}
