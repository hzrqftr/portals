import { Sheet, SheetActions } from "@portals/core/client";
import { formatSen } from "@portals/core";
import { describeSchedule } from "@shared/recurrence";
import { useDeleteRecurring, type RecurringRule } from "../api/hooks";

/**
 * Confirming the deletion of a recurring rule.
 *
 * A sibling of ConfirmDeleteSheet rather than a generalisation of it, because
 * the two say opposite things. Deleting a transaction destroys financial
 * history; deleting a rule destroys only a schedule -- the entries it already
 * posted stay, since `recurring_postings` cascades and `transactions` does
 * not. That distinction is the whole reason this sheet exists, so it is the
 * copy, not a shared shell with a prop.
 *
 * It names the rule the same way the card does, from the same two functions,
 * so the card and the confirmation cannot disagree about which one is about to
 * go.
 */
export function ConfirmDeleteRuleSheet({
  rule,
  onClose,
}: {
  rule: RecurringRule;
  onClose: () => void;
}) {
  const del = useDeleteRecurring();

  return (
    <Sheet title="Delete recurring entry" onClose={onClose}>
      {/* pr-9 keeps clear of Sheet's zero-height sticky close button. */}
      <h2 className="pr-9 text-lg font-semibold">Delete this recurring entry?</h2>

      <div className="mt-4 rounded-xl border border-edge bg-inset p-4">
        {/* Never a negative number: magnitude, colour and a prefix. */}
        <p
          className={
            "font-medium " +
            (rule.direction === "out" ? "text-status-overdue-fg" : "text-status-ok-fg")
          }
        >
          {rule.direction === "out" ? "−" : "+"}
          {formatSen(rule.amountSen)} · <span className="text-ink">{rule.item}</span>
        </p>
        <p className="mt-1 text-sm text-ink-muted">
          {rule.categoryName} · {describeSchedule(rule)}
        </p>
      </div>

      <p className="mt-4 text-sm text-ink-muted">
        {rule.postedCount > 0 ? (
          <>
            The {rule.postedCount === 1 ? "entry" : `${rule.postedCount} entries`} it has
            already posted {rule.postedCount === 1 ? "stays" : "stay"} in the ledger. Only
            the schedule stops — nothing here touches the money.
          </>
        ) : (
          <>
            It has not posted anything yet, so nothing in the ledger changes. Only the
            schedule goes.
          </>
        )}
      </p>

      <p className="mt-2 text-sm text-ink-faint">
        To stop it temporarily instead, use Pause — that can be undone.
      </p>

      {del.isError && (
        <p className="mt-2 text-sm text-status-overdue-fg">{(del.error as Error).message}</p>
      )}

      <SheetActions
        onCancel={onClose}
        onConfirm={() => del.mutate(rule.id, { onSuccess: onClose })}
        confirmLabel="Delete rule"
        busyLabel="Deleting…"
        tone="danger"
        busy={del.isPending}
      />
    </Sheet>
  );
}
