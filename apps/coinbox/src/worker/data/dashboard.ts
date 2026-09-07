import { eq } from "drizzle-orm";
import { addDays, addMonths, daysBetween, type CalendarDate } from "@portals/core";
import { firstOccurrenceOnOrAfter, nextAfter, type Schedule } from "@shared/recurrence";
import { LedgerScopedRepo } from "./base";
import { categories, recurringRules } from "../schema";

/**
 * The Home dashboard, as one payload.
 *
 * Everything here is an AGGREGATE (invariant 4). No query in this file returns
 * a transaction row -- the largest result set is one row per category for one
 * month. That matters more here than anywhere else in the portal: this is the
 * landing page, it runs on every visit, and a JS rollup over 4,421 rows would
 * work in testing and fail against a Worker's 10ms CPU ceiling later.
 *
 * NOTHING HERE IS A VIEW, and that is deliberate. Every figure below is
 * relative to a month the caller chose, or to their local today, and a view
 * takes no parameters -- the same reason Odometry's usage rate is a CTE in
 * `status.ts` rather than in `0002_views.sql`. `v_txn_monthly` supplies the
 * parameter-free half; the window comes in as a bound value.
 */

/** Months of history the "normal" is drawn from. */
const NORMAL_MONTHS = 3;

/** How far ahead "already committed" looks. */
const COMMITTED_DAYS = 30;

/** Months of ledger history behind a cost-per-km figure. */
const VEHICLE_MONTHS = 12;

/**
 * Attributed entries below which a cost-per-km figure is shown but flagged.
 *
 * Same stance as Odometry's usage rate, which needs two readings spanning 14
 * days before it will project: state the low confidence rather than hide the
 * number or, worse, present three fuel stops as a cost of ownership.
 */
const CONFIDENT_TXNS = 5;

/*
 * There is deliberately no category row limit. The old vs-normal panel capped
 * at eight because a ranking by *departure from normal* has a long tail nobody
 * reads. A ranking by amount does not: the reader is looking for where the
 * month went, and twenty seeded categories is the hard ceiling anyway.
 */

/** How many upcoming occurrences to name individually. */
const UPCOMING_LIMIT = 6;

export interface MonthPoint {
  month: string;
  inSen: number;
  outSen: number;
  netSen: number;
  txnCount: number;
  /** Running total from the first month with data. The Sheet's "Total Loss". */
  cumulativeSen: number;
}

export interface CategorySpend {
  categoryId: string;
  categoryCode: string;
  categoryName: string;
  /**
   * MAGNITUDES, always >= 0, kept apart rather than netted.
   *
   * The panel this replaced read only `net_sen`, so a category with money
   * moving both ways in one month cancelled itself out. Four categories in the
   * owner's real history do exactly that.
   */
  inSen: number;
  outSen: number;
  txnCount: number;
  /** The same category one month earlier. Zero when it did not appear. */
  prevInSen: number;
  prevOutSen: number;
}

export interface UpcomingPosting {
  ruleId: string;
  item: string;
  categoryName: string;
  occurredOn: CalendarDate;
  amountSen: number;
  direction: "in" | "out";
}

export interface VehicleCost {
  vehicleId: string;
  nickname: string;
  spendSen: number;
  distanceKm: number;
  /** Null when there is no odometer movement to divide by. */
  senPerKm: number | null;
  txnCount: number;
  confident: boolean;
}

export interface DashboardPayload {
  today: CalendarDate;
  month: string;
  months: MonthPoint[];
  ytdNetSen: number;
  focus: {
    month: string;
    inSen: number;
    outSen: number;
    netSen: number;
    txnCount: number;
    previousMonth: string | null;
    /** Focus net minus the previous month's net. Null with nothing to compare. */
    momDeltaSen: number | null;
    /** Mean out per month across the preceding three months. Null if no history. */
    trailingOutAvgSen: number | null;
    /** Every category with money in the focus month, biggest out first. */
    categorySpend: CategorySpend[];
  };
  committed: {
    days: number;
    netSen: number;
    count: number;
    upcoming: UpcomingPosting[];
  };
  lastEntryOn: CalendarDate | null;
  /** The last entry the owner TYPED. Recurring rules keep posting regardless. */
  lastTypedEntryOn: CalendarDate | null;
  daysSinceTypedEntry: number | null;
  vehicles: VehicleCost[];
}

/** "2026-08" plus a month delta, without going near a Date in this file. */
function shiftMonth(month: string, delta: number): string {
  return addMonths(`${month}-01` as CalendarDate, delta).slice(0, 7);
}

export class DashboardRepo extends LedgerScopedRepo {
  /**
   * `month` is the focused month, `YYYY-MM`. The caller passes their own
   * today, computed from `users.timezone` -- never `new Date()` in here, and
   * never `date('now')` in the SQL. Invariant 5.
   */
  async payload(today: CalendarDate, month?: string): Promise<DashboardPayload> {
    const focusMonth = month ?? today.slice(0, 7);
    const windowStart = shiftMonth(focusMonth, -NORMAL_MONTHS);

    const [months, categoryRows, trailingOut, entryDates, vehicles, committed] =
      await Promise.all([
        this.monthSeries(),
        this.categorySpend(focusMonth, shiftMonth(focusMonth, -1)),
        this.trailingOutAverage(focusMonth, windowStart),
        this.entryDates(),
        this.vehicleCosts(today),
        this.committed(today),
      ]);

    const index = months.findIndex((m) => m.month === focusMonth);
    const focus = index >= 0 ? months[index] : null;
    const previous = index > 0 ? months[index - 1] : null;

    return {
      today,
      month: focusMonth,
      months,
      // The running total after the last month with data, which is what the
      // Sheet's Total row said. Reading it off the series rather than summing
      // again keeps one definition of the number.
      ytdNetSen: months.at(-1)?.cumulativeSen ?? 0,
      focus: {
        month: focusMonth,
        inSen: focus?.inSen ?? 0,
        outSen: focus?.outSen ?? 0,
        netSen: focus?.netSen ?? 0,
        txnCount: focus?.txnCount ?? 0,
        previousMonth: previous?.month ?? null,
        momDeltaSen: focus && previous ? focus.netSen - previous.netSen : null,
        trailingOutAvgSen: trailingOut,
        categorySpend: categoryRows,
      },
      committed,
      lastEntryOn: entryDates.lastAny,
      lastTypedEntryOn: entryDates.lastTyped,
      daysSinceTypedEntry: entryDates.lastTyped
        ? daysBetween(entryDates.lastTyped, today)
        : null,
      vehicles,
    };
  }

  /**
   * One row per month, with the running total.
   *
   * The cumulative is a window function rather than a JS scan for the usual
   * reason -- it is an aggregate, and aggregates belong in SQL. `v_txn_monthly`
   * is grouped by category, so the inner query re-rolls it to one row a month.
   */
  private async monthSeries(): Promise<MonthPoint[]> {
    const res = await this.raw
      .prepare(
        `SELECT month, in_sen, out_sen, net_sen, txn_count,
                SUM(net_sen) OVER (
                  ORDER BY month ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
                ) AS cum_sen
           FROM (SELECT month,
                        SUM(in_sen)    AS in_sen,
                        SUM(out_sen)   AS out_sen,
                        SUM(net_sen)   AS net_sen,
                        SUM(txn_count) AS txn_count
                   FROM v_txn_monthly
                  WHERE ledger_id = ?
                  GROUP BY month)
          ORDER BY month`,
      )
      .bind(this.ledgerId)
      .all<{
        month: string;
        in_sen: number;
        out_sen: number;
        net_sen: number;
        txn_count: number;
        cum_sen: number;
      }>();

    return res.results.map((r) => ({
      month: r.month,
      inSen: r.in_sen,
      outSen: r.out_sen,
      netSen: r.net_sen,
      txnCount: r.txn_count,
      cumulativeSen: r.cum_sen,
    }));
  }

  /**
   * What the focused month actually went on, category by category.
   *
   * IN AND OUT STAY APART. `v_txn_monthly` offers `net_sen` and it is the
   * wrong column here: netting hides a category that took money both ways in
   * one month, and four of the owner's categories genuinely do. The panel lets
   * the reader pick a direction, so the query carries both magnitudes and
   * decides nothing.
   *
   * BOTH MONTHS COME BACK IN ONE ROW, so switching direction -- or reading the
   * previous month in a tooltip -- costs no second request. Two months is the
   * whole window: this answers "where did it go", not "was this month odd",
   * and the three-month comparison this replaced is gone.
   *
   * BIND ORDER IS THE STATEMENT'S ORDER, NOT THE CLAUSE'S. Five placeholders
   * sit AHEAD of `ledger_id = ?` here, which is the worst case for that trap:
   * a `?` added anywhere above shifts the tenant id out of position and the
   * symptom is an empty panel rather than an error. The order is
   * focus, focus, focus, prev, prev, ledger, focus, prev -- kept adjacent to
   * the SQL below so the two cannot drift apart.
   *
   * THE SUBQUERY IS NOT DECORATION. Dropping categories with nothing in the
   * focus month cannot be a `HAVING in_sen > 0`: `in_sen` is also a real
   * column of `v_txn_monthly`, so SQLite resolves the name to the SOURCE
   * column rather than to the aggregate alias, and a category whose only money
   * was last month survives the filter. Measured, not feared -- it shipped
   * that way for one test run. Filtering outside the aggregate makes the name
   * unambiguous, and costs no extra placeholder.
   */
  private async categorySpend(
    focusMonth: string,
    previousMonth: string,
  ): Promise<CategorySpend[]> {
    const res = await this.raw
      .prepare(
        `SELECT * FROM (
           SELECT category_id,
                  MAX(category_code) AS category_code,
                  MAX(category_name) AS category_name,
                  SUM(CASE WHEN month = ? THEN in_sen    ELSE 0 END) AS in_sen,
                  SUM(CASE WHEN month = ? THEN out_sen   ELSE 0 END) AS out_sen,
                  SUM(CASE WHEN month = ? THEN txn_count ELSE 0 END) AS txn_count,
                  SUM(CASE WHEN month = ? THEN in_sen    ELSE 0 END) AS prev_in_sen,
                  SUM(CASE WHEN month = ? THEN out_sen   ELSE 0 END) AS prev_out_sen
             FROM v_txn_monthly
            WHERE ledger_id = ? AND month IN (?, ?)
            GROUP BY category_id
         )
          WHERE in_sen > 0 OR out_sen > 0
          ORDER BY out_sen DESC, in_sen DESC, category_name ASC`,
      )
      .bind(
        focusMonth, focusMonth, focusMonth, previousMonth, previousMonth,
        this.ledgerId, focusMonth, previousMonth,
      )
      .all<{
        category_id: string;
        category_code: string;
        category_name: string;
        in_sen: number;
        out_sen: number;
        txn_count: number;
        prev_in_sen: number;
        prev_out_sen: number;
      }>();

    return res.results.map((r) => ({
      categoryId: r.category_id,
      categoryCode: r.category_code,
      categoryName: r.category_name,
      inSen: r.in_sen,
      outSen: r.out_sen,
      txnCount: r.txn_count,
      prevInSen: r.prev_in_sen,
      prevOutSen: r.prev_out_sen,
    }));
  }

  /** Mean out per month over the three months before the focus. Null if none. */
  private async trailingOutAverage(
    focusMonth: string,
    windowStart: string,
  ): Promise<number | null> {
    const row = await this.raw
      .prepare(
        `SELECT CAST(ROUND(SUM(out_sen) / 3.0) AS INTEGER) AS avg_out_sen
           FROM v_txn_monthly
          WHERE ledger_id = ? AND month < ? AND month >= ?`,
      )
      .bind(this.ledgerId, focusMonth, windowStart)
      .first<{ avg_out_sen: number | null }>();

    return row?.avg_out_sen ?? null;
  }

  /**
   * When the ledger was last written to, by hand and at all.
   *
   * The two differ once recurring rules are posting, and the difference is the
   * whole point: the cron keeps `lastAny` fresh whether or not the owner has
   * opened the app for a fortnight. Staleness is measured against the TYPED
   * entry, because that is the one that stops.
   */
  private async entryDates(): Promise<{
    lastAny: CalendarDate | null;
    lastTyped: CalendarDate | null;
  }> {
    const row = await this.raw
      .prepare(
        `SELECT MAX(occurred_on)                                    AS last_any,
                MAX(CASE WHEN is_recurring = 0 THEN occurred_on END) AS last_typed
           FROM transactions
          WHERE ledger_id = ?`,
      )
      .bind(this.ledgerId)
      .first<{ last_any: string | null; last_typed: string | null }>();

    return {
      lastAny: row?.last_any ?? null,
      lastTyped: row?.last_typed ?? null,
    };
  }

  /**
   * What the active rules will post in the next thirty days.
   *
   * THIS IS THE ONE PLACE THE DASHBOARD LEAVES SQL, and the exception is
   * already documented: the month-end clamp cannot be written in SQLite --
   * `date('2026-01-31','+1 month')` is 2026-03-03, not 2026-02-28. So the
   * projection uses the same pure functions in `@shared/recurrence` that the
   * nightly runner and the Recurring screen use, and there is one definition
   * of when a rule falls due rather than three.
   *
   * Invariant 4 is about not looping over DATA. This loops over RULES -- a
   * handful, bounded by how many the owner has declared, not by how much has
   * been spent. The inner walk is guarded because a date bug that failed to
   * advance would otherwise spin until the Worker was killed.
   *
   * Occurrences dated today are excluded: the cron posts at 01:00 local, so by
   * the time anyone reads this they have already landed and are in the ledger.
   */
  private async committed(today: CalendarDate): Promise<DashboardPayload["committed"]> {
    const rules = await this.db
      .select({
        id: recurringRules.id,
        item: recurringRules.item,
        categoryName: categories.name,
        amountSen: recurringRules.amountSen,
        direction: recurringRules.direction,
        intervalMonths: recurringRules.intervalMonths,
        dayOfMonth: recurringRules.dayOfMonth,
        startsOn: recurringRules.startsOn,
        endsOn: recurringRules.endsOn,
      })
      .from(recurringRules)
      .innerJoin(categories, eq(categories.id, recurringRules.categoryId))
      .where(this.where(recurringRules, eq(recurringRules.isActive, 1)));

    const from = addDays(today, 1);
    const until = addDays(today, COMMITTED_DAYS);

    const upcoming: UpcomingPosting[] = [];
    let netSen = 0;

    for (const rule of rules) {
      const schedule: Schedule = {
        intervalMonths: rule.intervalMonths,
        dayOfMonth: rule.dayOfMonth,
        startsOn: rule.startsOn,
        endsOn: rule.endsOn,
      };

      let cursor = firstOccurrenceOnOrAfter(schedule, from);
      for (let guard = 0; cursor && cursor <= until && guard < 8; guard++) {
        upcoming.push({
          ruleId: rule.id,
          item: rule.item,
          categoryName: rule.categoryName,
          occurredOn: cursor,
          amountSen: rule.amountSen,
          direction: rule.direction as "in" | "out",
        });
        netSen += rule.direction === "out" ? -rule.amountSen : rule.amountSen;
        cursor = nextAfter(schedule, cursor);
      }
    }

    // Soonest first, then by name so two rules on one date do not swap places
    // between loads -- the same stability tiebreak the ledger and rule list use.
    upcoming.sort((a, b) =>
      a.occurredOn === b.occurredOn
        ? a.item.localeCompare(b.item)
        : a.occurredOn.localeCompare(b.occurredOn),
    );

    return {
      days: COMMITTED_DAYS,
      netSen,
      count: upcoming.length,
      upcoming: upcoming.slice(0, UPCOMING_LIMIT),
    };
  }

  /**
   * Cost per kilometre: the one figure neither portal can produce alone.
   *
   * The spend is Coinbox's and the distance is Odometry's, so this is the only
   * READ in this portal that crosses the two ownership axes. It carries two
   * independent guards, for the same reason `TransactionRepo.remove` does --
   * so that removing either one alone is visible in the isolation suite:
   *
   * 1. The money is filtered by `ledger_id`, so only the caller's own spending
   *    is ever summed. A vehicle the caller has never spent on is absent
   *    entirely, whoever else drives it.
   * 2. Both the vehicle and its odometer readings are joined through
   *    `garage_members` for the CALLER. Without this, a stale `vehicle_id` --
   *    left behind after someone was removed from a garage, since the column
   *    deliberately carries no foreign key -- would still hand back that
   *    vehicle's nickname and mileage.
   *
   * Only `direction = 'out'` counts: a refund or an insurance payout arriving
   * against a vehicle is real money, but it is not a cost of running it, and
   * netting it off would understate the figure it is used to compare.
   */
  private async vehicleCosts(today: CalendarDate): Promise<VehicleCost[]> {
    const since = addMonths(today, -VEHICLE_MONTHS);

    const res = await this.raw
      .prepare(
        `WITH spend AS (
           SELECT t.vehicle_id,
                  SUM(t.amount_sen) AS spend_sen,
                  COUNT(*)          AS txn_count
             FROM transactions t
            WHERE t.ledger_id = ?
              AND t.vehicle_id IS NOT NULL
              AND t.direction = 'out'
              AND t.occurred_on >= ?
            GROUP BY t.vehicle_id
         ),
         dist AS (
           SELECT o.vehicle_id,
                  MAX(o.reading_km) - MIN(o.reading_km) AS km
             FROM odometer_readings o
             JOIN vehicles v       ON v.id = o.vehicle_id
             JOIN garage_members m ON m.garage_id = v.garage_id AND m.user_id = ?
            WHERE o.recorded_on >= ?
            GROUP BY o.vehicle_id
         )
         SELECT v.id        AS vehicle_id,
                v.nickname  AS nickname,
                s.spend_sen AS spend_sen,
                s.txn_count AS txn_count,
                COALESCE(d.km, 0) AS km
           FROM spend s
           JOIN vehicles v       ON v.id = s.vehicle_id
           JOIN garage_members m ON m.garage_id = v.garage_id AND m.user_id = ?
           LEFT JOIN dist d      ON d.vehicle_id = s.vehicle_id
          ORDER BY s.spend_sen DESC`,
      )
      // Statement order: ledger, spend window, membership (dist), distance
      // window, membership (outer). Five binds, and the two user ids are the
      // same value in two different joins -- not a duplicate to be tidied away.
      .bind(this.ledgerId, since, this.scope.userId, since, this.scope.userId)
      .all<{
        vehicle_id: string;
        nickname: string;
        spend_sen: number;
        txn_count: number;
        km: number;
      }>();

    return res.results.map((r) => ({
      vehicleId: r.vehicle_id,
      nickname: r.nickname,
      spendSen: r.spend_sen,
      distanceKm: r.km,
      // Integer sen per km, so the money path stays free of floats end to end.
      senPerKm: r.km > 0 ? Math.round(r.spend_sen / r.km) : null,
      txnCount: r.txn_count,
      confident: r.km > 0 && r.txn_count >= CONFIDENT_TXNS,
    }));
  }
}
