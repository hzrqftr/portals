import { useState } from "react";
import { Link } from "react-router-dom";
import { formatSen } from "@portals/core";
import type { CategorySpend } from "../api/hooks";

/**
 * Where the selected month's money went, biggest first.
 *
 * SORTED BY SIZE, ON PURPOSE. This replaced a panel that sorted by departure
 * from each category's three-month normal -- a better answer to "was this
 * month odd?", and the wrong answer to the question actually being asked,
 * which is "where did it go?". The owner's Google Sheet pivot was this, and it
 * is what he reads.
 *
 * IN AND OUT ARE A TOGGLE, NOT TWO SIDES OF ONE AXIS. Categories here are
 * deliberately not bound to a direction, so a category can hold both in the
 * same month; drawing them on one axis would net them away. One direction is
 * on screen at a time, which also makes this a single-series chart -- there is
 * nothing for a legend to disambiguate, and the toggle names what is shown.
 *
 * THE SCALE IS LINEAR AND UNFLATTERING. In a typical month one category is
 * more than half of it (August 2026: Loans, RM 3,711 of RM 6,738), so most
 * bars are slivers. That is the shape of the month and the chart should say
 * so. A log scale would make RM 16 look comparable to RM 3,711. Nothing is
 * lost to the floor because every row prints its own figure.
 */

/** So a small-but-real amount is still a mark rather than nothing. */
const MIN_SHARE = 0.008;

type Direction = "out" | "in";

export function MonthSpend({
  month,
  monthLabel,
  categories,
}: {
  month: string;
  monthLabel: string;
  categories: CategorySpend[];
}) {
  const [direction, setDirection] = useState<Direction>("out");

  const amountOf = (c: CategorySpend) => (direction === "out" ? c.outSen : c.inSen);
  const previousOf = (c: CategorySpend) =>
    direction === "out" ? c.prevOutSen : c.prevInSen;

  // The payload carries every category with money in either direction, ordered
  // for `out`. Filtering and re-sorting a list this size is presentation, not
  // aggregation -- it is why the toggle does not refetch.
  const rows = categories
    .filter((c) => amountOf(c) > 0)
    .sort((a, b) => amountOf(b) - amountOf(a) || a.categoryName.localeCompare(b.categoryName));

  const largest = rows.reduce((max, c) => Math.max(max, amountOf(c)), 1);
  const total = rows.reduce((sum, c) => sum + amountOf(c), 0);

  return (
    <div className="rounded-xl border border-edge bg-surface p-5">
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-3">
        <div className="min-w-0">
          <h2 className="font-semibold text-ink">
            {direction === "out" ? "Where the money went" : "Where the money came from"} in{" "}
            {monthLabel}
          </h2>
          <p className="mt-1 text-sm text-ink-muted">
            Every category with money {direction === "out" ? "out" : "in"}, biggest first.
            Bars are scaled within the month.
          </p>
        </div>

        <div className="text-right">
          <span className="block text-xs font-medium uppercase tracking-wider text-ink-faint">
            Total {direction}
          </span>
          <span
            className={
              "mt-0.5 block text-xl font-semibold tabular-nums " +
              (direction === "out" ? "text-status-overdue-fg" : "text-status-ok-fg")
            }
          >
            {/* No sign on nothing: "−RM 0.00" reads as a figure that moved. */}
            {total === 0 ? "" : direction === "out" ? "−" : "+"}
            {formatSen(total)}
          </span>
        </div>
      </div>

      {/*
        The toggle lives in this panel's header rather than in a filter row
        above the page. It picks which series this one chart draws; it does not
        scope anything else. Home.tsx keeps the year chart's month selection as
        the page's only global control, deliberately, and this must not become
        a second one.
      */}
      <div className="mt-4 flex gap-2">
        {(["out", "in"] as const).map((d) => (
          <button
            key={d}
            type="button"
            onClick={() => setDirection(d)}
            aria-pressed={direction === d}
            className={
              "rounded-lg border px-3 py-1.5 text-sm font-medium transition-colors " +
              (direction === d
                ? d === "out"
                  ? "border-status-overdue-fg bg-status-overdue-bg text-status-overdue-fg"
                  : "border-status-ok-fg bg-status-ok-bg text-status-ok-fg"
                : "border-edge bg-inset text-ink-muted hover:text-ink")
            }
          >
            {d === "out" ? "Money out" : "Money in"}
          </button>
        ))}
      </div>

      {rows.length === 0 ? (
        <p className="mt-5 text-sm text-ink-muted">
          No money {direction} during {monthLabel}.
        </p>
      ) : (
        <>
          <div className="mt-5 flex items-center gap-3 pb-2">
            <span className="w-28 shrink-0 text-xs font-medium uppercase tracking-wider text-ink-faint sm:w-40">
              Category
            </span>
            <span className="min-w-0 flex-1" />
            <span className="w-24 shrink-0 text-right text-xs font-medium uppercase tracking-wider text-ink-faint sm:w-32">
              Amount
            </span>
          </div>

          <ul>
            {rows.map((c) => (
              <SpendRow
                key={c.categoryId}
                category={c}
                month={month}
                monthLabel={monthLabel}
                direction={direction}
                amount={amountOf(c)}
                previous={previousOf(c)}
                share={Math.max(amountOf(c) / largest, MIN_SHARE)}
                shareOfMonth={total > 0 ? amountOf(c) / total : 0}
              />
            ))}
          </ul>

          <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-edge pt-3">
            <span className="text-xs text-ink-faint">
              {rows.length} {rows.length === 1 ? "category" : "categories"}
            </span>
            <span className="ml-auto text-xs text-ink-faint">
              Hover a row for the detail, or open one in the ledger.
            </span>
          </div>
        </>
      )}
    </div>
  );
}

/**
 * One category.
 *
 * THE WHOLE ROW IS THE HIT TARGET, not the painted bar. Most bars in a typical
 * month are a couple of pixels wide, so aiming at the mark would put the
 * detail out of reach exactly where it is most wanted.
 *
 * The tooltip enhances and never gates: the amount is printed on every row
 * whether or not anyone hovers, and the category name links through to the
 * ledger, which is the route that works on a phone where there is no hover at
 * all.
 */
function SpendRow({
  category,
  month,
  monthLabel,
  direction,
  amount,
  previous,
  share,
  shareOfMonth,
}: {
  category: CategorySpend;
  month: string;
  monthLabel: string;
  direction: Direction;
  amount: number;
  previous: number;
  share: number;
  shareOfMonth: number;
}) {
  const [open, setOpen] = useState(false);
  const out = direction === "out";
  const change = previous > 0 ? (amount - previous) / previous : null;

  return (
    <li
      className="relative"
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
      // Focus anywhere inside the row -- the category link is the focusable
      // thing -- shows the same detail the pointer gets.
      onFocus={() => setOpen(true)}
      onBlur={() => setOpen(false)}
    >
      <div
        className={
          "flex items-center gap-3 rounded-lg transition-colors " +
          (open ? "bg-inset" : "")
        }
      >
        <Link
          to={`/ledger?month=${month}&categoryId=${category.categoryId}`}
          className="w-28 shrink-0 truncate py-2 pl-1 text-sm text-ink hover:underline focus:outline-none focus:ring-2 focus:ring-ink-muted sm:w-40"
        >
          {category.categoryName}
        </Link>

        <div className="relative h-9 min-w-0 flex-1">
          <span
            aria-hidden
            className={
              "absolute top-1/2 h-3.5 -translate-y-1/2 rounded-r " +
              (out ? "bg-status-overdue-fg" : "bg-status-ok-fg")
            }
            style={{ left: 0, width: `${share * 100}%` }}
          />
        </div>

        <span className="w-24 shrink-0 pr-1 text-right text-sm tabular-nums text-ink sm:w-32">
          {out ? "−" : "+"}
          {formatSen(amount)}
        </span>
      </div>

      {open && (
        <div
          role="tooltip"
          className="pointer-events-none absolute left-28 top-full z-20 -mt-1 w-60 rounded-xl border border-edge bg-page p-3 shadow-lg sm:left-40"
        >
          {/* Value first: the reader already knows the category and wants the number. */}
          <p
            className={
              "text-base font-semibold tabular-nums " +
              (out ? "text-status-overdue-fg" : "text-status-ok-fg")
            }
          >
            {out ? "−" : "+"}
            {formatSen(amount)}
          </p>
          <p className="mt-0.5 text-sm text-ink">{category.categoryName}</p>
          <p className="mt-1 text-xs text-ink-muted">
            {category.txnCount} {category.txnCount === 1 ? "entry" : "entries"} ·{" "}
            {(shareOfMonth * 100).toFixed(1)}% of {monthLabel}
          </p>
          <p className="mt-1 text-xs text-ink-faint">
            {previous > 0 ? (
              <>
                Last month {formatSen(previous)}
                {change !== null && (
                  <>
                    {" "}
                    {change >= 0 ? "+" : "−"}
                    {Math.abs(change * 100).toFixed(0)}%
                  </>
                )}
              </>
            ) : (
              "Nothing last month"
            )}
          </p>
        </div>
      )}
    </li>
  );
}
