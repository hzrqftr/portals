import { Link } from "react-router-dom";
import { formatSen } from "@portals/core";
import type { CategoryEffect } from "../api/hooks";

/**
 * What moved in the selected month, against each category's own recent normal.
 *
 * SORTED BY DEPARTURE FROM NORMAL, NOT BY SIZE. Sorting by size says Food and
 * Transportation are the big ones, which is true every month and actionable in
 * none of them. What is worth a glance is the category that is unlike itself.
 *
 * The bars read as EFFECT ON THE MONTH'S BALANCE, not as spending: right and
 * green helped, left and red cost. That framing is what lets one chart hold
 * both directions, which matters because categories here are deliberately not
 * bound to a direction -- `Extra Income` arriving is the same kind of fact as
 * `Household` overspending, and both belong in the same list.
 *
 * Colour is never the only signal: the side of the line carries direction and
 * every figure is signed. Green and red are close under the commonest form of
 * colour blindness, so neither is doing the work alone.
 */

/** Widest half-bar, as a share of the plot column. */
const MAX_SHARE = 0.48;

/** So a small-but-real effect is still a mark rather than nothing. */
const MIN_SHARE = 0.008;

export function MonthBreakdown({
  month,
  monthLabel,
  categories,
}: {
  month: string;
  monthLabel: string;
  categories: CategoryEffect[];
}) {
  const largest = categories.reduce((max, c) => Math.max(max, Math.abs(c.effectSen)), 1);
  const total = categories.reduce((sum, c) => sum + c.effectSen, 0);

  return (
    <div className="rounded-xl border border-edge bg-surface p-5">
      <h2 className="font-semibold text-ink">What moved in {monthLabel}</h2>
      <p className="mt-1 text-sm text-ink-muted">
        Each category against its own average for the three months before,
        biggest effect first. Bars are scaled within the month.
      </p>

      {categories.length === 0 ? (
        <p className="mt-6 text-sm text-ink-muted">
          Nothing out of the ordinary — every category landed on its usual figure.
        </p>
      ) : (
        <>
          <div className="mt-5 flex items-center gap-3 pb-2">
            <span className="w-28 shrink-0 text-xs font-medium uppercase tracking-wider text-ink-faint sm:w-40">
              Category
            </span>
            <div className="relative min-w-0 flex-1">
              <span className="absolute left-1/2 -translate-x-1/2 whitespace-nowrap text-xs font-medium uppercase tracking-wider text-ink-faint">
                normal
              </span>
            </div>
            <span className="w-24 shrink-0 text-right text-xs font-medium uppercase tracking-wider text-ink-faint sm:w-32">
              Effect
            </span>
          </div>

          <ul className="flex flex-col">
            {categories.map((c) => {
              const helped = c.effectSen > 0;
              const share = Math.max(Math.abs(c.effectSen) / largest, MIN_SHARE) * MAX_SHARE;
              return (
                <li key={c.categoryId} className="flex items-center gap-3">
                  <Link
                    to={`/ledger?month=${month}&categoryId=${c.categoryId}`}
                    className="w-28 shrink-0 truncate py-2 text-sm text-ink hover:underline sm:w-40"
                    title={`${c.categoryName} — open in the ledger`}
                  >
                    {c.categoryName}
                  </Link>

                  <div className="relative h-9 min-w-0 flex-1">
                    <span aria-hidden className="absolute left-1/2 h-full w-px bg-edge" />
                    <span
                      aria-hidden
                      className={
                        "absolute top-1/2 h-3.5 -translate-y-1/2 " +
                        (helped
                          ? "rounded-r bg-status-ok-fg"
                          : "rounded-l bg-status-overdue-fg")
                      }
                      style={
                        helped
                          ? { left: "50%", width: `${share * 100}%` }
                          : { right: "50%", width: `${share * 100}%` }
                      }
                    />
                  </div>

                  <span className="w-24 shrink-0 text-right text-sm tabular-nums text-ink sm:w-32">
                    {helped ? "+" : "−"}
                    {formatSen(Math.abs(c.effectSen))}
                  </span>
                </li>
              );
            })}
          </ul>

          <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-edge pt-3">
            <Key className="bg-status-ok-fg">Helped the month</Key>
            <Key className="bg-status-overdue-fg">Cost the month</Key>
            <span className="ml-auto text-xs tabular-nums text-ink-faint">
              {/* The sum of what is SHOWN, which is not the month's net -- the
                  list is capped, and unchanged categories are left out. */}
              These {categories.length} together: {total < 0 ? "−" : "+"}
              {formatSen(Math.abs(total))}
            </span>
          </div>
        </>
      )}
    </div>
  );
}

function Key({ className, children }: { className: string; children: string }) {
  return (
    <span className="flex items-center gap-1.5">
      <span aria-hidden className={"h-2.5 w-2.5 rounded-sm " + className} />
      <span className="text-xs text-ink-faint">{children}</span>
    </span>
  );
}
