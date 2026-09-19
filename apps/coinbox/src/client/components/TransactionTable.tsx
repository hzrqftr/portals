import { useState } from "react";
import {
  usePatchTransaction,
  type Category,
  type Transaction,
  type Vehicle,
} from "../api/hooks";
import { ConfirmDeleteSheet } from "./ConfirmDeleteSheet";
import { TransactionRow } from "./TransactionRow";
import { HEAD } from "./transactionCells";
import { buildPatch, type Field } from "./transactionEdits";

/**
 * The ledger as a table, with every cell editable in place.
 *
 * Deliberately the same six columns as the Google Sheet it replaces, in the
 * same order -- Date, Item, Amount, Category, Description, Type -- because
 * that is the shape eight months of muscle memory is in. Vehicle is the one
 * addition, last, since it is the field the Sheet could not express.
 *
 * TYPE READS In / Out, not Debit / Credit. The Sheet's words are genuinely
 * ambiguous: by ledger convention a debit increases an asset, but a bank
 * statement is written from the bank's side and shows money arriving as a
 * credit. The original strings are preserved in `source_type_raw` regardless.
 *
 * ADDING still goes through TransactionSheet. The form carries the direction
 * defaults and the conditional vehicle field, which is exactly what a blank
 * row needs and exactly what a correction does not.
 *
 * This file owns the table: the columns, and which single cell is open. A row
 * is TransactionRow, the editors are transactionCells.tsx, and what a commit
 * actually writes is transactionEdits.ts, where it is tested.
 */

interface Editing {
  id: string;
  field: Field;
}

export function TransactionTable({
  transactions,
  categories,
  vehicles,
  truncated,
}: {
  transactions: Transaction[];
  categories: Category[];
  vehicles: Vehicle[];
  truncated: boolean;
}) {
  const [editing, setEditing] = useState<Editing | null>(null);
  const patch = usePatchTransaction();

  const [deleting, setDeleting] = useState<Transaction | null>(null);
  const categoryById = new Map(categories.map((c) => [c.id, c]));
  const vehicleById = new Map(vehicles.map((v) => [v.id, v]));

  function commit(t: Transaction, field: Field, raw: string) {
    setEditing(null);
    const body = buildPatch(t, field, raw, categoryById);
    if (body === null) return;
    patch.mutate({ id: t.id, patch: body });
  }

  return (
    <>
      {patch.isError && (
        <p className="mb-3 text-sm text-status-overdue-fg">{(patch.error as Error).message}</p>
      )}

      {/* Wide content scrolls inside its own container; the page never scrolls
          sideways. Seven columns do not fit a phone and should not try to. */}
      <div className="overflow-x-auto rounded-xl border border-edge">
        {/*
          TABLE-FIXED, WITH DECLARED WIDTHS.

          Under the default auto layout a column is sized by its contents, and
          an <input> carries an intrinsic width of roughly twenty characters
          regardless of the `w-full` on it. So clicking an Amount cell widened
          the whole column and shoved every other column sideways -- the same
          class of bug as the row-height jump, on the other axis.

          Fixed layout makes width a property of the column rather than of
          whatever happens to be in it, which is also how a spreadsheet
          behaves. Nothing can move by being clicked.
        */}
        <table className="w-full min-w-[64rem] table-fixed border-collapse text-sm">
          {/*
            Date is wider than the text needs: it carries a fixed-width marker
            slot for auto-posted rows (see TransactionRow). The slot is present
            on EVERY row, empty or not, so no width depends on the data.

            The last column is a 3rem actions well. The flexible Description
            col absorbs both, so the six pinned widths above it are unchanged
            and the layout the owner is used to does not shift.
          */}
          <colgroup>
            <col className="w-[8.5rem]" />
            <col className="w-[14rem]" />
            <col className="w-[8rem]" />
            <col className="w-[10rem]" />
            <col />
            <col className="w-[5rem]" />
            <col className="w-[8rem]" />
            <col className="w-[3rem]" />
          </colgroup>
          <thead className="bg-inset">
            <tr>
              <th className={HEAD}>Date</th>
              <th className={HEAD}>Item</th>
              <th className={HEAD + " text-right"}>Amount</th>
              <th className={HEAD}>Category</th>
              <th className={HEAD}>Description</th>
              <th className={HEAD}>Type</th>
              <th className={HEAD}>Vehicle</th>
              <th className={HEAD}>
                <span className="sr-only">Actions</span>
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-edge bg-surface">
            {transactions.map((t) => (
              <TransactionRow
                key={t.id}
                t={t}
                categories={categories}
                vehicles={vehicles}
                categoryById={categoryById}
                vehicleById={vehicleById}
                editingField={editing?.id === t.id ? editing.field : null}
                pending={patch.isPending}
                onEdit={(field) => setEditing({ id: t.id, field })}
                onCommit={(field, raw) => commit(t, field, raw)}
                onCancel={() => setEditing(null)}
                onDelete={() => setDeleting(t)}
              />
            ))}
          </tbody>
        </table>
      </div>

      <p className="mt-3 text-sm text-ink-faint">
        {transactions.length} {transactions.length === 1 ? "entry" : "entries"}
        {truncated && " — more exist; narrow with the filters above"}. Click any cell to edit it;
        Enter saves, Escape cancels.
      </p>

      {deleting && (
        <ConfirmDeleteSheet transaction={deleting} onClose={() => setDeleting(null)} />
      )}
    </>
  );
}
