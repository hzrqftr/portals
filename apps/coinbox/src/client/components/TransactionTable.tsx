import { useEffect, useRef, useState } from "react";
import { formatSen, parseSen } from "@portals/core";
import { showsVehicle } from "@shared/categoryRules";
import {
  usePatchTransaction,
  type Category,
  type Transaction,
  type Vehicle,
} from "../api/hooks";

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
 * credit. The original strings are preserved in `source_type_raw` regardless,
 * so nothing was lost in translation.
 *
 * ADDING still goes through TransactionSheet. The form carries the direction
 * defaults and the conditional vehicle field, which is exactly what a blank
 * row needs and exactly what a correction does not.
 */

type Field = "occurredOn" | "item" | "amountSen" | "categoryId" | "description" | "direction" | "vehicleId";

interface Editing {
  id: string;
  field: Field;
}

const CELL = "px-3 py-2 align-top";
const HEAD =
  "px-3 py-2 text-left text-xs font-medium uppercase tracking-wider text-ink-faint whitespace-nowrap";

/** The input that replaces a cell while it is being edited. */
function CellInput({
  value,
  type = "text",
  onCommit,
  onCancel,
}: {
  value: string;
  type?: "text" | "date" | "decimal";
  onCommit: (next: string) => void;
  onCancel: () => void;
}) {
  const [draft, setDraft] = useState(value);
  const ref = useRef<HTMLInputElement>(null);

  useEffect(() => {
    ref.current?.focus();
    ref.current?.select();
  }, []);

  return (
    <input
      ref={ref}
      className="w-full rounded-md border border-ink-muted bg-inset px-2 py-1 text-ink focus:outline-none"
      type={type === "date" ? "date" : "text"}
      inputMode={type === "decimal" ? "decimal" : undefined}
      value={draft}
      onChange={(e) =>
        setDraft(type === "decimal" ? e.target.value.replace(/[^0-9.]/g, "") : e.target.value)
      }
      onBlur={() => onCommit(draft)}
      onKeyDown={(e) => {
        if (e.key === "Enter") onCommit(draft);
        // Escape must not commit. A cell you opened by accident has to be
        // escapable without writing anything -- there is no undo behind this.
        if (e.key === "Escape") onCancel();
      }}
    />
  );
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

  const categoryById = new Map(categories.map((c) => [c.id, c]));
  const vehicleById = new Map(vehicles.map((v) => [v.id, v]));

  function commit(t: Transaction, field: Field, raw: string) {
    setEditing(null);

    const body: Record<string, unknown> = {};

    if (field === "amountSen") {
      const sen = parseSen(raw);
      // A blank or unparseable amount is a slip, not an instruction to zero
      // the row -- and the CHECK constraint would reject it anyway.
      if (sen === null || sen <= 0) return;
      if (sen === t.amountSen) return;
      body.amountSen = sen;
    } else if (field === "description") {
      const next = raw.trim() || null;
      if (next === t.description) return;
      body.description = next;
    } else if (field === "item") {
      const next = raw.trim();
      if (next === "" || next === t.item) return;
      body.item = next;
    } else if (field === "occurredOn") {
      if (raw === "" || raw === t.occurredOn) return;
      body.occurredOn = raw;
    } else if (field === "direction") {
      if (raw === t.direction) return;
      body.direction = raw;
    } else if (field === "vehicleId") {
      const next = raw || null;
      if (next === t.vehicleId) return;
      body.vehicleId = next;
    } else if (field === "categoryId") {
      if (raw === t.categoryId) return;
      body.categoryId = raw;

      // The table's version of rule 2. Moving a row into a category that does
      // not carry a vehicle must clear the vehicle in the same write --
      // otherwise a grocery row keeps pointing at the car, and the column it
      // would show in is now blank, so nothing on screen contradicts it.
      const code = categoryById.get(raw)?.code ?? null;
      if (!showsVehicle(code) && t.vehicleId) body.vehicleId = null;
    }

    if (Object.keys(body).length === 0) return;
    patch.mutate({ id: t.id, patch: body });
  }

  const editable = (t: Transaction, field: Field) =>
    editing?.id === t.id && editing.field === field;

  /** Click anywhere in a cell to edit it. */
  const cellProps = (t: Transaction, field: Field) => ({
    className: CELL + " cursor-text hover:bg-inset",
    onClick: () => setEditing({ id: t.id, field }),
  });

  return (
    <>
      {patch.isError && (
        <p className="mb-3 text-sm text-status-overdue-fg">{(patch.error as Error).message}</p>
      )}

      {/* Wide content scrolls inside its own container; the page never scrolls
          sideways. Seven columns do not fit a phone and should not try to. */}
      <div className="overflow-x-auto rounded-xl border border-edge">
        <table className="w-full min-w-[52rem] border-collapse text-sm">
          <thead className="bg-inset">
            <tr>
              <th className={HEAD}>Date</th>
              <th className={HEAD}>Item</th>
              <th className={HEAD + " text-right"}>Amount</th>
              <th className={HEAD}>Category</th>
              <th className={HEAD}>Description</th>
              <th className={HEAD}>Type</th>
              <th className={HEAD}>Vehicle</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-edge bg-surface">
            {transactions.map((t) => {
              const code = categoryById.get(t.categoryId)?.code ?? null;
              const vehicleCell = showsVehicle(code);

              return (
                <tr key={t.id} className={patch.isPending ? "opacity-60" : undefined}>
                  {/* Date */}
                  <td {...cellProps(t, "occurredOn")}>
                    {editable(t, "occurredOn") ? (
                      <CellInput
                        value={t.occurredOn}
                        type="date"
                        onCommit={(v) => commit(t, "occurredOn", v)}
                        onCancel={() => setEditing(null)}
                      />
                    ) : (
                      <span className="whitespace-nowrap tabular-nums text-ink-muted">
                        {t.occurredOn}
                      </span>
                    )}
                  </td>

                  {/* Item */}
                  <td {...cellProps(t, "item")}>
                    {editable(t, "item") ? (
                      <CellInput
                        value={t.item}
                        onCommit={(v) => commit(t, "item", v)}
                        onCancel={() => setEditing(null)}
                      />
                    ) : (
                      <span className="text-ink">{t.item}</span>
                    )}
                  </td>

                  {/* Amount -- magnitude only, never a minus sign. Direction
                      is its own column, which is the Sheet's shape too. */}
                  <td {...cellProps(t, "amountSen")} className={CELL + " cursor-text hover:bg-inset text-right"}>
                    {editable(t, "amountSen") ? (
                      <CellInput
                        value={(t.amountSen / 100).toFixed(2)}
                        type="decimal"
                        onCommit={(v) => commit(t, "amountSen", v)}
                        onCancel={() => setEditing(null)}
                      />
                    ) : (
                      <span
                        className={
                          "whitespace-nowrap tabular-nums " +
                          (t.direction === "in" ? "text-status-ok-fg" : "text-ink")
                        }
                      >
                        {formatSen(t.amountSen)}
                      </span>
                    )}
                  </td>

                  {/* Category */}
                  <td {...cellProps(t, "categoryId")}>
                    {editable(t, "categoryId") ? (
                      <select
                        autoFocus
                        className="w-full rounded-md border border-ink-muted bg-inset px-2 py-1 text-ink focus:outline-none"
                        value={t.categoryId}
                        onChange={(e) => commit(t, "categoryId", e.target.value)}
                        onBlur={() => setEditing(null)}
                      >
                        {categories.map((c) => (
                          <option key={c.id} value={c.id}>
                            {c.name}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <span className="whitespace-nowrap text-ink-muted">{t.categoryName}</span>
                    )}
                  </td>

                  {/* Description */}
                  <td {...cellProps(t, "description")}>
                    {editable(t, "description") ? (
                      <CellInput
                        value={t.description ?? ""}
                        onCommit={(v) => commit(t, "description", v)}
                        onCancel={() => setEditing(null)}
                      />
                    ) : (
                      <span className="text-ink-faint">{t.description || "—"}</span>
                    )}
                  </td>

                  {/* Type */}
                  <td {...cellProps(t, "direction")}>
                    {editable(t, "direction") ? (
                      <select
                        autoFocus
                        className="w-full rounded-md border border-ink-muted bg-inset px-2 py-1 text-ink focus:outline-none"
                        value={t.direction}
                        onChange={(e) => commit(t, "direction", e.target.value)}
                        onBlur={() => setEditing(null)}
                      >
                        <option value="out">Out</option>
                        <option value="in">In</option>
                      </select>
                    ) : (
                      <span
                        className={
                          "rounded px-1.5 py-0.5 text-xs font-medium " +
                          (t.direction === "in"
                            ? "bg-status-ok-bg text-status-ok-fg"
                            : "bg-inset text-ink-muted")
                        }
                      >
                        {t.direction === "in" ? "In" : "Out"}
                      </span>
                    )}
                  </td>

                  {/* Vehicle -- only meaningful where the category carries one.
                      Elsewhere it is inert rather than an empty dropdown that
                      implies it could be set. */}
                  <td className={CELL + (vehicleCell ? " cursor-text hover:bg-inset" : "")}>
                    {!vehicleCell ? (
                      <span className="text-ink-faint">—</span>
                    ) : editable(t, "vehicleId") ? (
                      <select
                        autoFocus
                        className="w-full rounded-md border border-ink-muted bg-inset px-2 py-1 text-ink focus:outline-none"
                        value={t.vehicleId ?? ""}
                        onChange={(e) => commit(t, "vehicleId", e.target.value)}
                        onBlur={() => setEditing(null)}
                      >
                        <option value="">—</option>
                        {vehicles.map((v) => (
                          <option key={v.id} value={v.id}>
                            {v.nickname}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <span
                        className="whitespace-nowrap text-ink-muted"
                        onClick={() => setEditing({ id: t.id, field: "vehicleId" })}
                      >
                        {t.vehicleId ? (vehicleById.get(t.vehicleId)?.nickname ?? "—") : "—"}
                      </span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <p className="mt-3 text-sm text-ink-faint">
        {transactions.length} {transactions.length === 1 ? "entry" : "entries"}
        {truncated && " — more exist; narrow with the filters above"}. Click any cell to edit it.
      </p>
    </>
  );
}
