import { formatSen } from "@portals/core";
import { describeSchedule, firstOccurrenceOnOrAfter } from "@shared/recurrence";
import { usePatchRecurring, type RecurringRule } from "../api/hooks";

/**
 * The declared recurring entries.
 *
 * Cards rather than a table: a rule carries a schedule, a next date and a
 * state, which is more than a row of cells reads well as at 375px — and unlike
 * the ledger there are a handful of these, not 4,421.
 */
export function RecurringList({
  rules,
  today,
  onEdit,
}: {
  rules: RecurringRule[];
  today: string;
  onEdit: (rule: RecurringRule) => void;
}) {
  const patch = usePatchRecurring();

  if (rules.length === 0) {
    return (
      <div className="mt-4 rounded-xl border border-edge bg-surface p-8 text-center">
        <p className="text-ink">No recurring entries yet.</p>
        <p className="mx-auto mt-2 max-w-md text-sm text-ink-muted">
          Add the bills you pay on a schedule — insurance, Astro, subscriptions — and they
          will post themselves into the ledger on each due date.
        </p>
      </div>
    );
  }

  return (
    <ul className="mt-4 flex flex-col gap-2">
      {rules.map((rule) => {
        const paused = rule.isActive === 0;
        // Computed on the client from the same pure functions the server uses,
        // so there is one definition of when a rule is next due.
        const next = firstOccurrenceOnOrAfter(
          {
            intervalMonths: rule.intervalMonths,
            dayOfMonth: rule.dayOfMonth,
            startsOn: rule.startsOn,
            endsOn: rule.endsOn,
          },
          today > rule.startsOn ? today : rule.startsOn,
        );

        return (
          <li
            key={rule.id}
            className={
              "rounded-xl border border-edge bg-surface p-4 transition " +
              (paused ? "opacity-60" : "")
            }
          >
            <div className="flex flex-wrap items-start gap-x-4 gap-y-2">
              <button
                type="button"
                onClick={() => onEdit(rule)}
                className="min-w-0 flex-1 text-left"
              >
                <span className="flex items-center gap-2">
                  <span className="truncate font-medium text-ink">{rule.item}</span>
                  {paused && (
                    <span className="shrink-0 rounded-full bg-inset px-2 py-0.5 text-xs text-ink-faint">
                      Paused
                    </span>
                  )}
                </span>
                <span className="mt-0.5 block text-sm text-ink-muted">
                  {rule.categoryName} · {describeSchedule(rule)}
                </span>
              </button>

              <div className="text-right">
                {/* Never a negative number: magnitude, colour and a prefix. */}
                <span
                  className={
                    "block tabular-nums font-semibold " +
                    (rule.direction === "out"
                      ? "text-status-overdue-fg"
                      : "text-status-ok-fg")
                  }
                >
                  {rule.direction === "out" ? "−" : "+"}
                  {formatSen(rule.amountSen)}
                </span>
                <span className="mt-0.5 block text-xs text-ink-faint">
                  {paused
                    ? "Not posting"
                    : next
                      ? `Next ${next}`
                      : "Finished"}
                </span>
              </div>

              <button
                type="button"
                onClick={() =>
                  patch.mutate({ id: rule.id, patch: { isActive: paused } })
                }
                disabled={patch.isPending}
                className="shrink-0 rounded-lg border border-edge px-3 py-1.5 text-sm text-ink-muted transition hover:bg-inset hover:text-ink disabled:opacity-50"
              >
                {paused ? "Resume" : "Pause"}
              </button>
            </div>

            {rule.postedCount > 0 && (
              <p className="mt-2 text-xs text-ink-faint">
                {rule.postedCount} posted so far, last on {rule.lastPostedOn}
              </p>
            )}
          </li>
        );
      })}
    </ul>
  );
}
