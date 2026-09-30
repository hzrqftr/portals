import { and, asc, desc, eq, gte, isNotNull, isNull, lte } from "drizzle-orm";
import { NotFoundError, ValidationError } from "@portals/core/worker";
import { nowIso, type CalendarDate } from "@portals/core";
import { LedgerScopedRepo } from "./base";
import { funds, fundMembers, fundEntries, fundBalanceChecks, recurringRules } from "../schema";
import type {
  FundEntryCreate,
  FundEntryPatch,
  FundMemberCreate,
  FundMemberPatch,
  FundCheckCreate,
} from "@shared/zod";

/**
 * The Family fund: a pooled sibling fund kept as a SEPARATE BOOK from the
 * ledger. docs/coinbox-spec.md §11, migration 0020.
 *
 * ===========================================================================
 * HOW THIS STAYS INSIDE THE TENANT
 * ===========================================================================
 *
 * Only `funds` carries a ledger id. Every method starts from `fundId()`, which
 * resolves the caller's fund through `this.where(funds)` -- the ordinary
 * ledger predicate -- and every child-table query then filters on THAT id.
 * The child tables have no ledger column to forget, and no path reaches them
 * without first proving the fund is the caller's. This is the shape
 * RecurringRepo.postDue already uses for recurring_postings.
 *
 * Ids from the client (a member, an entry, a recurring rule) are never trusted:
 * each is looked up under the fund or ledger predicate and 404s if it is not
 * the caller's -- never 403, which would confirm it exists.
 *
 * Every figure is SQL (invariant 4). The pot is small today, but a JS pass over
 * its rows is the pattern that works on 150 rows and is never revisited.
 */

/** What a contribution posted by a recurring rule is called in the pot. */
function contributionItem(memberName: string): string {
  return `From ${memberName}`;
}

/** "2026-09-30" -> "2026-09". A posting pays for its own month. */
function monthOf(date: CalendarDate): string {
  return date.slice(0, 7);
}

const LINKED_READ_ONLY =
  "This contribution was posted by a recurring entry in your ledger. " +
  "Edit or delete it there, and the pot follows.";

export class FundRepo extends LedgerScopedRepo {
  private cachedFundId: string | null = null;

  /**
   * The caller's fund, created on first use.
   *
   * INSERT ... ON CONFLICT DO NOTHING, then re-read -- bootstrapLedger's
   * pattern, race-safe because uq_fund_ledger makes a second fund impossible.
   * Writing on a GET is deliberate for the same reason bootstrap does it: the
   * page has nothing to show until the fund exists, and "not created yet" is
   * not a state worth a screen of its own.
   */
  private async fundId(): Promise<string> {
    if (this.cachedFundId) return this.cachedFundId;
    await this.raw
      .prepare(
        `INSERT INTO funds (id, ledger_id, name, created_at) VALUES (?, ?, 'Family fund', ?)
         ON CONFLICT(ledger_id) DO NOTHING`,
      )
      .bind(crypto.randomUUID(), this.ledgerId, nowIso())
      .run();
    const [row] = await this.db
      .select({ id: funds.id })
      .from(funds)
      .where(this.where(funds))
      .limit(1);
    if (!row) throw new NotFoundError("Fund not found");
    this.cachedFundId = row.id;
    return row.id;
  }

  /**
   * The page header: the pot, the members, and the latest bank check.
   *
   * `balanceSen` is RECORDED money -- contributions and spending only. The
   * real account also earns a dividend the owner does not track, so the bank
   * is usually slightly ahead. `latestCheck.recordedSen` is the pot AS AT the
   * check's date, not today, so a contribution entered after the check cannot
   * manufacture a shortfall.
   */
  async summary(today: CalendarDate) {
    const fundId = await this.fundId();

    const balance = await this.raw
      .prepare(`SELECT COALESCE(SUM(signed_sen), 0) AS sen FROM fund_entries WHERE fund_id = ?`)
      .bind(fundId)
      .first<{ sen: number }>();

    // The rule join carries the LEDGER predicate: a rule id on a member row was
    // validated when it was set, but the join re-asserts it rather than trusting
    // that nothing has changed since.
    const { results: members } = await this.raw
      .prepare(
        `SELECT m.id, m.name, m.default_sen, m.recurring_rule_id, m.is_active,
                r.day_of_month AS rule_day, r.is_active AS rule_active, r.item AS rule_item,
                (SELECT COALESCE(SUM(e.amount_sen), 0) FROM fund_entries e
                  WHERE e.member_id = m.id) AS total_sen
           FROM fund_members m
           LEFT JOIN recurring_rules r ON r.id = m.recurring_rule_id AND r.ledger_id = ?
          WHERE m.fund_id = ?
          ORDER BY m.is_active DESC, m.created_at, m.name`,
      )
      .bind(this.ledgerId, fundId)
      .all<{
        id: string;
        name: string;
        default_sen: number;
        recurring_rule_id: string | null;
        is_active: number;
        rule_day: number | null;
        rule_active: number | null;
        rule_item: string | null;
        total_sen: number;
      }>();

    const check = await this.raw
      .prepare(
        `SELECT c.checked_on, c.balance_sen,
                (SELECT COALESCE(SUM(e.signed_sen), 0) FROM fund_entries e
                  WHERE e.fund_id = c.fund_id AND e.occurred_on <= c.checked_on) AS recorded_sen
           FROM fund_balance_checks c
          WHERE c.fund_id = ?
          ORDER BY c.checked_on DESC, c.created_at DESC
          LIMIT 1`,
      )
      .bind(fundId)
      .first<{ checked_on: string; balance_sen: number; recorded_sen: number }>();

    const span = await this.raw
      .prepare(
        `SELECT MIN(for_month) AS first_month FROM fund_entries
          WHERE fund_id = ? AND for_month IS NOT NULL`,
      )
      .bind(fundId)
      .first<{ first_month: string | null }>();

    return {
      today,
      month: monthOf(today),
      firstMonth: span?.first_month ?? null,
      balanceSen: balance?.sen ?? 0,
      members: members.map((m) => ({
        id: m.id,
        name: m.name,
        defaultSen: m.default_sen,
        isActive: m.is_active === 1,
        totalSen: m.total_sen,
        // Present only when the rule still exists in THIS ledger.
        rule:
          m.recurring_rule_id && m.rule_day !== null
            ? {
                id: m.recurring_rule_id,
                item: m.rule_item,
                dayOfMonth: m.rule_day,
                isActive: m.rule_active === 1,
              }
            : null,
      })),
      latestCheck: check
        ? {
            checkedOn: check.checked_on,
            balanceSen: check.balance_sen,
            recordedSen: check.recorded_sen,
            // Positive: the bank holds MORE than recorded (dividends). Negative:
            // it holds less -- the case the owner wants to see.
            gapSen: check.balance_sen - check.recorded_sen,
          }
        : null,
    };
  }

  /**
   * One calendar year of contributions: per-cell sums for the grid, and the
   * rows behind them so a cell can be opened and edited.
   *
   * Keyed on `for_month`, never on the date paid -- a January catch-up for
   * February belongs in February's cell.
   */
  async grid(year: number) {
    const fundId = await this.fundId();
    const from = `${year}-01`;
    const to = `${year}-12`;

    const { results: cells } = await this.raw
      .prepare(
        `SELECT member_id, for_month, SUM(amount_sen) AS paid_sen, COUNT(*) AS entries
           FROM fund_entries
          WHERE fund_id = ? AND member_id IS NOT NULL AND for_month BETWEEN ? AND ?
          GROUP BY member_id, for_month`,
      )
      .bind(fundId, from, to)
      .all<{ member_id: string; for_month: string; paid_sen: number; entries: number }>();

    const contributions = await this.db
      .select({
        id: fundEntries.id,
        memberId: fundEntries.memberId,
        forMonth: fundEntries.forMonth,
        occurredOn: fundEntries.occurredOn,
        item: fundEntries.item,
        description: fundEntries.description,
        amountSen: fundEntries.amountSen,
        transactionId: fundEntries.transactionId,
      })
      .from(fundEntries)
      .where(
        and(
          eq(fundEntries.fundId, fundId),
          isNotNull(fundEntries.memberId),
          // Text comparison, which is exactly right for zero-padded 'YYYY-MM'.
          gte(fundEntries.forMonth, from),
          lte(fundEntries.forMonth, to),
        ),
      )
      .orderBy(asc(fundEntries.forMonth), asc(fundEntries.occurredOn), asc(fundEntries.id));

    return {
      year,
      cells: cells.map((c) => ({
        memberId: c.member_id,
        forMonth: c.for_month,
        paidSen: c.paid_sen,
        entries: c.entries,
      })),
      contributions,
    };
  }

  /** Everything that is not a contribution, newest first. */
  async entries() {
    const fundId = await this.fundId();
    return this.db
      .select({
        id: fundEntries.id,
        occurredOn: fundEntries.occurredOn,
        item: fundEntries.item,
        description: fundEntries.description,
        amountSen: fundEntries.amountSen,
        direction: fundEntries.direction,
      })
      .from(fundEntries)
      .where(and(eq(fundEntries.fundId, fundId), isNull(fundEntries.memberId)))
      .orderBy(desc(fundEntries.occurredOn), desc(fundEntries.createdAt), asc(fundEntries.id));
  }

  async getEntry(id: string) {
    const fundId = await this.fundId();
    const [row] = await this.db
      .select()
      .from(fundEntries)
      .where(and(eq(fundEntries.fundId, fundId), eq(fundEntries.id, id)))
      .limit(1);
    if (!row) throw new NotFoundError("Entry not found");
    return row;
  }

  async createEntry(input: FundEntryCreate) {
    const fundId = await this.fundId();
    const member = input.memberId ? await this.getMember(input.memberId) : null;
    const item = input.item ?? (member ? contributionItem(member.name) : null);
    if (!item) throw new ValidationError("Say what the money was for");

    const id = crypto.randomUUID();
    const at = nowIso();
    const insert = this.db.insert(fundEntries).values({
      id,
      fundId,
      occurredOn: input.occurredOn,
      item,
      description: input.description ?? null,
      amountSen: input.amountSen,
      direction: member ? "in" : input.direction,
      memberId: member?.id ?? null,
      forMonth: member ? (input.forMonth ?? null) : null,
      transactionId: null,
      createdAt: at,
      updatedAt: at,
    });

    if (!(input.replaceMonth && member && input.forMonth)) {
      await insert;
      return this.getEntry(id);
    }

    // REPLACING A MONTH: "skipped" over a payment, or a payment over a skip.
    // A month shows one state, and two rows saying opposite things is the
    // disagreement the hand-ticked workbook grid had.
    //
    // A contribution posted from the ledger is never replaced here -- it is
    // the same payment as a ledger row, and removing only the pot's copy would
    // leave the two books disagreeing. Refused, not skipped over silently.
    const inMonth = and(
      eq(fundEntries.fundId, fundId),
      eq(fundEntries.memberId, member.id),
      eq(fundEntries.forMonth, input.forMonth),
    );
    const [linked] = await this.db
      .select({ id: fundEntries.id })
      .from(fundEntries)
      .where(and(inMonth, isNotNull(fundEntries.transactionId)))
      .limit(1);
    if (linked) throw new ValidationError(LINKED_READ_ONLY);

    // One batch: the old rows go and the new one lands together, or neither.
    await this.db.batch([
      this.db.delete(fundEntries).where(and(inMonth, isNull(fundEntries.transactionId))),
      insert,
    ]);
    return this.getEntry(id);
  }

  async updateEntry(id: string, patch: FundEntryPatch) {
    const before = await this.getEntry(id);
    if (before.transactionId) throw new ValidationError(LINKED_READ_ONLY);
    if (before.memberId === null && patch.forMonth !== undefined) {
      throw new ValidationError("Only a contribution pays for a month");
    }
    if (before.memberId !== null && patch.direction === "out") {
      throw new ValidationError("A contribution is money into the pot");
    }

    const values: Record<string, unknown> = { updatedAt: nowIso() };
    for (const key of ["occurredOn", "item", "amountSen", "direction", "forMonth"] as const) {
      if (patch[key] !== undefined) values[key] = patch[key];
    }
    if (patch.description !== undefined) values.description = patch.description ?? null;

    await this.db
      .update(fundEntries)
      .set(values)
      .where(and(eq(fundEntries.fundId, before.fundId), eq(fundEntries.id, id)));
    return this.getEntry(id);
  }

  async removeEntry(id: string): Promise<void> {
    const before = await this.getEntry(id);
    if (before.transactionId) throw new ValidationError(LINKED_READ_ONLY);
    await this.db
      .delete(fundEntries)
      .where(and(eq(fundEntries.fundId, before.fundId), eq(fundEntries.id, id)));
  }

  // ------------------------------------------------------------ members

  private async getMember(id: string) {
    const fundId = await this.fundId();
    const [row] = await this.db
      .select()
      .from(fundMembers)
      .where(and(eq(fundMembers.fundId, fundId), eq(fundMembers.id, id)))
      .limit(1);
    if (!row) throw new NotFoundError("Member not found");
    return row;
  }

  /** A rule id from the client must be a rule in THIS ledger. */
  private async assertOwnRule(ruleId: string): Promise<void> {
    const [row] = await this.db
      .select({ id: recurringRules.id })
      .from(recurringRules)
      .where(this.where(recurringRules, eq(recurringRules.id, ruleId)))
      .limit(1);
    if (!row) throw new NotFoundError("Recurring entry not found");
  }

  /** Names are unique per fund; say so rather than surfacing a constraint error. */
  private async assertNameFree(fundId: string, name: string, exceptId?: string) {
    const [row] = await this.db
      .select({ id: fundMembers.id })
      .from(fundMembers)
      .where(and(eq(fundMembers.fundId, fundId), eq(fundMembers.name, name)))
      .limit(1);
    if (row && row.id !== exceptId) throw new ValidationError(`${name} is already a member`);
  }

  /** One rule pays one member's share -- or a single payment is credited twice. */
  private async assertRuleFree(fundId: string, ruleId: string, exceptId?: string) {
    const [row] = await this.db
      .select({ id: fundMembers.id, name: fundMembers.name })
      .from(fundMembers)
      .where(and(eq(fundMembers.fundId, fundId), eq(fundMembers.recurringRuleId, ruleId)))
      .limit(1);
    if (row && row.id !== exceptId) {
      throw new ValidationError(`That recurring entry already pays ${row.name}'s share`);
    }
  }

  async createMember(input: FundMemberCreate) {
    const fundId = await this.fundId();
    await this.assertNameFree(fundId, input.name);
    if (input.recurringRuleId) {
      await this.assertOwnRule(input.recurringRuleId);
      await this.assertRuleFree(fundId, input.recurringRuleId);
    }
    const id = crypto.randomUUID();
    await this.db.insert(fundMembers).values({
      id,
      fundId,
      name: input.name,
      defaultSen: input.defaultSen,
      recurringRuleId: input.recurringRuleId ?? null,
      isActive: 1,
      createdAt: nowIso(),
    });
    return this.getMember(id);
  }

  /**
   * Linking a rule changes FUTURE postings only. Earlier postings of that rule
   * are not back-filled into the pot here: whether they were already recorded
   * (as the imported workbook rows were) is a question only the owner can
   * answer, and scripts/import-fund.mjs answers it once, explicitly.
   */
  async updateMember(id: string, patch: FundMemberPatch) {
    const before = await this.getMember(id);
    if (patch.name !== undefined) await this.assertNameFree(before.fundId, patch.name, id);
    if (patch.recurringRuleId) {
      await this.assertOwnRule(patch.recurringRuleId);
      await this.assertRuleFree(before.fundId, patch.recurringRuleId, id);
    }

    const values: Record<string, unknown> = {};
    if (patch.name !== undefined) values.name = patch.name;
    if (patch.defaultSen !== undefined) values.defaultSen = patch.defaultSen;
    if (patch.recurringRuleId !== undefined) values.recurringRuleId = patch.recurringRuleId ?? null;
    if (patch.isActive !== undefined) values.isActive = patch.isActive ? 1 : 0;

    if (Object.keys(values).length) {
      await this.db
        .update(fundMembers)
        .set(values)
        .where(and(eq(fundMembers.fundId, before.fundId), eq(fundMembers.id, id)));
    }
    return this.getMember(id);
  }

  // ------------------------------------------------------------ bank checks

  async createCheck(input: FundCheckCreate) {
    const fundId = await this.fundId();
    const id = crypto.randomUUID();
    await this.db.insert(fundBalanceChecks).values({
      id,
      fundId,
      checkedOn: input.checkedOn,
      balanceSen: input.balanceSen,
      createdAt: nowIso(),
    });
    const [row] = await this.db
      .select()
      .from(fundBalanceChecks)
      .where(and(eq(fundBalanceChecks.fundId, fundId), eq(fundBalanceChecks.id, id)))
      .limit(1);
    return row;
  }
}

/**
 * The fund's half of a recurring posting, or null when the rule pays nobody's
 * share.
 *
 * Called by RecurringRepo.postOne, whose batch() it joins: the transaction, its
 * claim and this contribution land together or not at all, so a claim that
 * collides on a re-run rolls the contribution back with the transaction.
 * Must be placed AFTER the transaction insert in that batch -- D1 enforces
 * foreign keys statement by statement, and this row references it.
 *
 * The member lookup carries the ledger predicate through `funds`. The rule id
 * came from a ledger-scoped query and the member's rule was validated when it
 * was set; the join re-asserts both rather than trusting that.
 */
export async function linkedContribution(
  raw: D1Database,
  ledgerId: string,
  rule: { id: string; amountSen: number },
  occurredOn: CalendarDate,
  transactionId: string,
  at: string,
): Promise<D1PreparedStatement | null> {
  const member = await raw
    .prepare(
      `SELECT m.id, m.name, m.fund_id
         FROM fund_members m
         JOIN funds f ON f.id = m.fund_id
        WHERE m.recurring_rule_id = ? AND f.ledger_id = ?
        LIMIT 1`,
    )
    .bind(rule.id, ledgerId)
    .first<{ id: string; name: string; fund_id: string }>();
  if (!member) return null;

  return raw
    .prepare(
      `INSERT INTO fund_entries
         (id, fund_id, occurred_on, item, description, amount_sen, direction,
          member_id, for_month, transaction_id, created_at, updated_at)
       VALUES (?, ?, ?, ?, NULL, ?, 'in', ?, ?, ?, ?, ?)`,
    )
    .bind(
      crypto.randomUUID(),
      member.fund_id,
      occurredOn,
      contributionItem(member.name),
      // The rule's money leaves the ledger as `out`; the same ringgit arrives in
      // the pot as `in`. Magnitude is shared, direction is each book's own.
      rule.amountSen,
      member.id,
      monthOf(occurredOn),
      transactionId,
      at,
      at,
    );
}
