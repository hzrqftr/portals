import { useState } from "react";
import { formatSen } from "@portals/core";
import { describeSchedule, firstOccurrenceOnOrAfter } from "@shared/recurrence";
import { usePatchRecurring, type RecurringRule } from "../api/hooks";
import { ConfirmDeleteRuleSheet } from "./ConfirmDeleteRuleSheet";

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
  const [deleting, setDeleting] = useState<RecurringRule | null>(null);

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
    <>
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
                "relative rounded-xl border border-edge bg-surface p-4 transition-colors " +
                "hover:border-ink-faint focus-within:border-ink-faint " +
                (paused ? "opacity-60" : "")
              }
            >
              <div className="flex flex-wrap items-start gap-x-4 gap-y-2">
                {/*
                  The floor is what makes the row WRAP at 375px instead of
                  crushing this column. With `min-w-0` the title took whatever
                  the amount and the buttons left over -- measured at 76px once
                  delete joined Pause, enough to cut a twenty-character rule
                  name down to one word and wrap its schedule over three lines.
                  Refusing to go below 8rem pushes the buttons onto their own
                  line instead, and the title gets 190px back. Desktop is
                  unaffected: there the row has room to spare.
                */}
                <button
                  type="button"
                  onClick={() => onEdit(rule)}
                  className="min-w-[8rem] flex-1 text-left focus:outline-none"
                >
                  {/*
                    The empty span stretches this button over the whole card,
                    so the amount, the next-due date, the posted-count line and
                    any dead space open the editor too -- clicking the title
                    was the only way in before. Same pattern as Odometry's
                    vehicle tiles. The rule's name stays the button's
                    accessible name, and Pause and delete sit above the overlay
                    on z-10 so they keep their own hit areas.

                    The card, not this button, shows the focus ring:
                    `focus-within:border-ink-faint` on the li, because an
                    outline on a control stretched across the card would draw a
                    box round the whole thing.
                  */}
                  <span className="absolute inset-0 rounded-xl" />
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

                {/*
                  Pause and delete travel together so they wrap as a pair at
                  375px rather than the destructive one dropping onto its own
                  line under the amount.
                */}
                <div className="relative z-10 flex shrink-0 items-center gap-2">
                  <button
                    type="button"
                    onClick={() =>
                      patch.mutate({ id: rule.id, patch: { isActive: paused } })
                    }
                    disabled={patch.isPending}
                    className="rounded-lg border border-edge px-3 py-1.5 text-sm text-ink-muted transition hover:bg-inset hover:text-ink disabled:opacity-50"
                  >
                    {paused ? "Resume" : "Pause"}
                  </button>

                  {/*
                    Delete. Its own button and its own confirmation, never part
                    of the card body that opens the editor -- the same rule the
                    ledger table follows.

                    Unlike the ledger's, it does NOT hide until hover: these are
                    cards, not a `group`ed table row, and there are a handful of
                    rules rather than 4,421 entries, so nothing is gained by
                    making it quiet.
                  */}
                  <button
                    type="button"
                    onClick={() => setDeleting(rule)}
                    aria-label={`Delete ${rule.item}`}
                    className="rounded-lg p-1.5 text-ink-faint transition hover:bg-inset hover:text-status-overdue-fg focus:outline-none focus:ring-2 focus:ring-ink-muted"
                  >
                    <svg
                      viewBox="0 0 20 20"
                      aria-hidden
                      className="h-4 w-4"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="1.75"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      <path d="M4 6h12M8.5 6V4.5h3V6M6 6l.6 9h6.8L14 6" />
                    </svg>
                  </button>
                </div>
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

      {deleting && (
        <ConfirmDeleteRuleSheet rule={deleting} onClose={() => setDeleting(null)} />
      )}
    </>
  );
}
