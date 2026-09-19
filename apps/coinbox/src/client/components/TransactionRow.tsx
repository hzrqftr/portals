import { formatSen } from "@portals/core";
import { showsVehicle } from "@shared/categoryRules";
import type { Category, Transaction, Vehicle } from "../api/hooks";
import { CELL, CONTENT, CellInput, CellSelect, RING } from "./transactionCells";
import type { Field } from "./transactionEdits";

/**
 * One ledger row, with every cell editable in place.
 *
 * Split out of TransactionTable: the table owns which cell is open and what a
 * commit writes, and this owns what a row looks like in either state. It holds
 * no state of its own, because "which cell is being edited" is a property of
 * the table -- only one cell across all rows may be open at a time.
 */
export function TransactionRow({
  t,
  categories,
  vehicles,
  categoryById,
  vehicleById,
  editingField,
  pending,
  onEdit,
  onCommit,
  onCancel,
  onDelete,
}: {
  t: Transaction;
  categories: Category[];
  vehicles: Vehicle[];
  categoryById: Map<string, Category>;
  vehicleById: Map<string, Vehicle>;
  /** The field open for editing on THIS row, or null if none is. */
  editingField: Field | null;
  pending: boolean;
  onEdit: (field: Field) => void;
  onCommit: (field: Field, raw: string) => void;
  onCancel: () => void;
  onDelete: () => void;
}) {
  const code = categoryById.get(t.categoryId)?.code ?? null;
  const hasVehicleCell = showsVehicle(code);

  // Cells whose first click opens something rather than placing a caret.
  // occurredOn is here even though it is still typeable -- the picker leads.
  const PICKERS: Field[] = ["occurredOn", "categoryId", "direction", "vehicleId"];

  /** Click anywhere in a cell to focus it. */
  function cellProps(field: Field, extra = "") {
    const active = editingField === field;
    // A text cursor over a dropdown promises typing that is not on offer.
    const cursor = PICKERS.includes(field) ? "cursor-pointer" : "cursor-text";
    return {
      className: `${CELL} ${cursor} hover:bg-inset ${active ? RING : ""} ${extra}`,
      onClick: () => onEdit(field),
    };
  }

  return (
    <tr className={"group " + (pending ? "opacity-60" : "")}>
      {/* Date */}
      <td {...cellProps("occurredOn")}>
        <div className={CONTENT}>
          {/*
            THE RECURRING MARKER, and the reason it is shaped this way.
            CONTENT is already a flex row fixed at h-9, and CONTENT/EDITOR are
            deliberately metrically identical so clicking a cell cannot move
            anything. A marker rendered only on recurring rows would shift the
            date on those rows and shift it again when the editor opens. So the
            slot is always here, always the same width, and only its contents
            change.
          */}
          <span
            className="w-4 shrink-0 text-center text-ink-faint"
            title={t.isRecurring === 1 ? "Posted by a recurring entry" : undefined}
          >
            {t.isRecurring === 1 && (
              <>
                <span aria-hidden>&#8635;</span>
                <span className="sr-only">Posted by a recurring entry</span>
              </>
            )}
          </span>
          {editingField === "occurredOn" ? (
            <CellInput
              value={t.occurredOn}
              type="date"
              onCommit={(v) => onCommit("occurredOn", v)}
              onCancel={onCancel}
            />
          ) : (
            <span className="whitespace-nowrap tabular-nums text-ink-muted">{t.occurredOn}</span>
          )}
        </div>
      </td>

      {/* Item */}
      <td {...cellProps("item")}>
        <div className={CONTENT}>
          {editingField === "item" ? (
            <CellInput
              value={t.item}
              onCommit={(v) => onCommit("item", v)}
              onCancel={onCancel}
            />
          ) : (
            <span className="truncate text-ink" title={t.item}>
              {t.item}
            </span>
          )}
        </div>
      </td>

      {/* Amount -- magnitude only, never a minus sign. Direction is its own
          column, which is the Sheet's shape too. */}
      <td {...cellProps("amountSen", "text-right")}>
        <div className={CONTENT + " justify-end"}>
          {editingField === "amountSen" ? (
            <CellInput
              value={(t.amountSen / 100).toFixed(2)}
              type="decimal"
              align="right"
              onCommit={(v) => onCommit("amountSen", v)}
              onCancel={onCancel}
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
        </div>
      </td>

      {/* Category */}
      <td {...cellProps("categoryId")}>
        <div className={CONTENT}>
          {editingField === "categoryId" ? (
            <CellSelect
              value={t.categoryId}
              onCommit={(v) => onCommit("categoryId", v)}
              onCancel={onCancel}
            >
              {categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </CellSelect>
          ) : (
            <span className="truncate text-ink-muted" title={t.categoryName}>
              {t.categoryName}
            </span>
          )}
        </div>
      </td>

      {/* Description */}
      <td {...cellProps("description")}>
        <div className={CONTENT}>
          {editingField === "description" ? (
            <CellInput
              value={t.description ?? ""}
              onCommit={(v) => onCommit("description", v)}
              onCancel={onCancel}
            />
          ) : (
            <span className="truncate text-ink-faint" title={t.description ?? ""}>
              {t.description || "—"}
            </span>
          )}
        </div>
      </td>

      {/* Type */}
      <td {...cellProps("direction")}>
        <div className={CONTENT}>
          {editingField === "direction" ? (
            <CellSelect
              value={t.direction}
              onCommit={(v) => onCommit("direction", v)}
              onCancel={onCancel}
            >
              <option value="out">Out</option>
              <option value="in">In</option>
            </CellSelect>
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
        </div>
      </td>

      {/* Vehicle -- only meaningful where the category carries one. Elsewhere
          it is inert rather than an empty dropdown that implies it could be
          set, so it gets no hover either. */}
      {hasVehicleCell ? (
        <td {...cellProps("vehicleId")}>
          <div className={CONTENT}>
            {editingField === "vehicleId" ? (
              <CellSelect
                value={t.vehicleId ?? ""}
                onCommit={(v) => onCommit("vehicleId", v)}
                onCancel={onCancel}
              >
                <option value="">—</option>
                {vehicles.map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.nickname}
                  </option>
                ))}
              </CellSelect>
            ) : (
              <span className="whitespace-nowrap text-ink-muted">
                {t.vehicleId ? (vehicleById.get(t.vehicleId)?.nickname ?? "—") : "—"}
              </span>
            )}
          </div>
        </td>
      ) : (
        <td className={CELL}>
          <div className={CONTENT}>
            <span className="text-ink-faint">—</span>
          </div>
        </td>
      )}

      {/*
        Delete. Quiet on desktop, always visible on touch -- a hover-only
        control is unreachable on the phone where entry actually happens.

        NOT a cell you can click into: every other td here opens an inline
        editor, and a destructive action sharing that gesture is how a mis-tap
        deletes a row. It gets its own button and its own confirmation.
      */}
      <td className={CELL}>
        <div className={CONTENT + " justify-center"}>
          <button
            type="button"
            onClick={onDelete}
            aria-label={`Delete ${t.item}`}
            className="rounded-lg p-1.5 text-ink-faint opacity-100 transition hover:bg-inset hover:text-status-overdue-fg focus:outline-none focus:ring-2 focus:ring-ink-muted sm:opacity-0 sm:group-hover:opacity-100 sm:focus:opacity-100"
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
      </td>
    </tr>
  );
}
