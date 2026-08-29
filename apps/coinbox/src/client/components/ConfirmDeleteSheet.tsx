import { Sheet, SheetActions } from "@portals/core/client";
import { formatSen } from "@portals/core";
import { useDeleteTransaction, type Transaction } from "../api/hooks";

/**
 * Confirming a delete.
 *
 * A Sheet rather than `window.confirm`: the native dialog is unstyled, renders
 * white in a dark-only app, and blocks the page in a way nothing else here
 * does.
 *
 * It names the entry -- amount, item and date -- because "Are you sure?" asks
 * a question the person cannot check. This is a hard delete on financial
 * history, recoverable only from a backup, so the confirmation has to be
 * readable enough to catch the wrong row.
 */
export function ConfirmDeleteSheet({
  transaction,
  onClose,
}: {
  transaction: Transaction;
  onClose: () => void;
}) {
  const del = useDeleteTransaction();

  return (
    <Sheet title="Delete entry" onClose={onClose}>
      <h2 className="pr-9 text-lg font-semibold">Delete this entry?</h2>

      <div className="mt-4 rounded-xl border border-edge bg-inset p-4">
        <p className="font-medium text-ink">
          {transaction.direction === "out" ? "−" : "+"}
          {formatSen(transaction.amountSen)} · {transaction.item}
        </p>
        <p className="mt-1 text-sm text-ink-muted">
          {transaction.occurredOn} · {transaction.categoryName}
        </p>
      </div>

      <p className="mt-4 text-sm text-ink-muted">
        This cannot be undone from here. The nightly backup keeps 90 days, so it is
        recoverable, but not with a click.
      </p>

      {transaction.isRecurring === 1 && (
        <p className="mt-2 text-sm text-ink-faint">
          A recurring entry created this. Deleting it will not make it come back, and it
          will not stop the rule — pause the rule on the Recurring page for that.
        </p>
      )}

      {del.isError && (
        <p className="mt-2 text-sm text-status-overdue-fg">{(del.error as Error).message}</p>
      )}

      <SheetActions
        onCancel={onClose}
        onConfirm={() => del.mutate(transaction.id, { onSuccess: onClose })}
        confirmLabel="Delete entry"
        busyLabel="Deleting…"
        tone="danger"
        busy={del.isPending}
      />
    </Sheet>
  );
}
