import { useEffect, useRef, useState } from "react";
import { formatSen, parseSen } from "@portals/core";
import { showsVehicle } from "@shared/categoryRules";
import {
  usePatchTransaction,
  type Category,
  type Transaction,
  type Vehicle,
} from "../api/hooks";
import { ConfirmDeleteSheet } from "./ConfirmDeleteSheet";

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
 */

type Field =
  | "occurredOn"
  | "item"
  | "amountSen"
  | "categoryId"
  | "description"
  | "direction"
  | "vehicleId";

interface Editing {
  id: string;
  field: Field;
}

/**
 * NOTHING BELOW MAY CHANGE A CELL'S HEIGHT WHEN IT ENTERS EDIT MODE.
 *
 * The first version wrapped the editor in a bordered, padded input inside an
 * already-padded cell, so every click made its row jump taller and the whole
 * table shuffled. Clicking a cell should look like focusing text, not like
 * swapping one control for another.
 *
 * So the display span and the editor share identical metrics -- same font
 * size, same line-height, no padding, no border, transparent background --
 * and the focus affordance is a `ring`, which is a box-shadow and therefore
 * costs no layout at all. `h-9` on the cell content pins the height so even a
 * select, which has its own intrinsic sizing, cannot push the row around.
 */
const CELL = "px-3 py-1.5 align-middle transition-colors";
const CONTENT = "flex h-9 min-w-0 items-center text-sm leading-5";

/** Editor and display must be metrically identical. Change both or neither. */
const EDITOR =
  "h-9 w-full min-w-0 appearance-none border-0 p-0 text-sm leading-5 text-ink " +
  "focus:outline-none focus:ring-0";

const EDITOR_INPUT = EDITOR + " bg-transparent";

/**
 * A SELECT MUST NOT BE bg-transparent.
 *
 * `color-scheme: dark` normally makes Chrome paint the option popup dark, but
 * once `appearance-none` is set the browser stops using the native rendering
 * and paints the popup from the author's background instead. Transparent
 * resolves to white, which is how this ended up as pale grey text on a white
 * list -- unreadable, and nothing about it looked like a CSS bug.
 *
 * So the control and its options get explicit colours from the palette.
 */
const EDITOR_SELECT =
  EDITOR + " bg-inset [&>option]:bg-surface [&>option]:text-ink";

const HEAD =
  "px-3 py-2 text-left text-xs font-medium uppercase tracking-wider text-ink-faint whitespace-nowrap";

/** Ring, not border: box-shadow paints inside the box and moves nothing. */
const RING = "bg-inset ring-1 ring-inset ring-ink-muted";

function CellInput({
  value,
  type = "text",
  align = "left",
  onCommit,
  onCancel,
}: {
  value: string;
  type?: "text" | "date" | "decimal";
  align?: "left" | "right";
  onCommit: (next: string) => void;
  onCancel: () => void;
}) {
  const [draft, setDraft] = useState(value);
  const ref = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.focus();

    if (type === "date") {
      // A date cell's first click should open the calendar, not select the
      // text and wait for a second click on an icon that only appears once
      // focused. Typing still works with the picker open, so keying in a date
      // stays available -- it is just no longer the only thing on offer.
      try {
        el.showPicker?.();
      } catch {
        /* unsupported: the field is focused and typeable, picker on click */
      }
      return;
    }

    // Everything else selects, so typing replaces rather than appends.
    el.select();
  }, [type]);

  return (
    <input
      ref={ref}
      className={EDITOR_INPUT + (align === "right" ? " text-right tabular-nums" : "")}
      type={type === "date" ? "date" : "text"}
      inputMode={type === "decimal" ? "decimal" : undefined}
      value={draft}
      onChange={(e) =>
        setDraft(type === "decimal" ? e.target.value.replace(/[^0-9.]/g, "") : e.target.value)
      }
      onBlur={() => onCommit(draft)}
      onKeyDown={(e) => {
        if (e.key === "Enter") onCommit(draft);
        // Escape must not commit. A cell opened by accident has to be
        // escapable without writing anything -- there is no undo behind this.
        if (e.key === "Escape") onCancel();
      }}
    />
  );
}

function CellSelect({
  value,
  children,
  onCommit,
  onCancel,
}: {
  value: string;
  children: React.ReactNode;
  onCommit: (next: string) => void;
  onCancel: () => void;
}) {
  const ref = useRef<HTMLSelectElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.focus();
    // One click should open the list, not merely focus a control that then
    // needs a second click. There is no other way to open a native select
    // programmatically; showPicker is the supported one, and it throws where
    // it is unavailable rather than no-opping, so it is guarded.
    try {
      el.showPicker?.();
    } catch {
      /* older browsers: the select is focused, a second click opens it */
    }
  }, []);

  return (
    <select
      ref={ref}
      className={EDITOR_SELECT}
      value={value}
      onChange={(e) => onCommit(e.target.value)}
      onBlur={onCancel}
      onKeyDown={(e) => e.key === "Escape" && onCancel()}
    >
      {children}
    </select>
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

  const [deleting, setDeleting] = useState<Transaction | null>(null);
  const categoryById = new Map(categories.map((c) => [c.id, c]));
  const vehicleById = new Map(vehicles.map((v) => [v.id, v]));

  function commit(t: Transaction, field: Field, raw: string) {
    setEditing(null);

    const body: Record<string, unknown> = {};

    if (field === "amountSen") {
      // A BLANK cell is a slip and must not write; a typed 0 is a real value.
      // Eight RM 0.00 water bills exist on purpose -- see migration 0011.
      if (raw.trim() === "") return;
      const sen = parseSen(raw);
      if (sen === null || sen < 0 || sen === t.amountSen) return;
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

  const isEditing = (t: Transaction, field: Field) =>
    editing?.id === t.id && editing.field === field;

  /** Click anywhere in a cell to focus it. */
  // Cells whose first click opens something rather than placing a caret.
  // occurredOn is here even though it is still typeable -- the picker leads.
  const PICKERS: Field[] = ["occurredOn", "categoryId", "direction", "vehicleId"];

  function cellProps(t: Transaction, field: Field, extra = "") {
    const active = isEditing(t, field);
    // A text cursor over a dropdown promises typing that is not on offer.
    const cursor = PICKERS.includes(field) ? "cursor-pointer" : "cursor-text";
    return {
      className: `${CELL} ${cursor} hover:bg-inset ${active ? RING : ""} ${extra}`,
      onClick: () => setEditing({ id: t.id, field }),
    };
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
            slot for auto-posted rows (below). The slot is present on EVERY
            row, empty or not, so no width depends on the data.

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
            {transactions.map((t) => {
              const code = categoryById.get(t.categoryId)?.code ?? null;
              const hasVehicleCell = showsVehicle(code);

              return (
                <tr key={t.id} className={"group " + (patch.isPending ? "opacity-60" : "")}>
                  {/* Date */}
                  <td {...cellProps(t, "occurredOn")}>
                    <div className={CONTENT}>
                      {/*
                        THE RECURRING MARKER, and the reason it is shaped this
                        way. CONTENT is already a flex row fixed at h-9, and
                        CONTENT/EDITOR are deliberately metrically identical so
                        clicking a cell cannot move anything. A marker rendered
                        only on recurring rows would shift the date on those
                        rows and shift it again when the editor opens. So the
                        slot is always here, always the same width, and only
                        its contents change.
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
                      {isEditing(t, "occurredOn") ? (
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
                    </div>
                  </td>

                  {/* Item */}
                  <td {...cellProps(t, "item")}>
                    <div className={CONTENT}>
                      {isEditing(t, "item") ? (
                        <CellInput
                          value={t.item}
                          onCommit={(v) => commit(t, "item", v)}
                          onCancel={() => setEditing(null)}
                        />
                      ) : (
                        <span className="truncate text-ink" title={t.item}>
                          {t.item}
                        </span>
                      )}
                    </div>
                  </td>

                  {/* Amount -- magnitude only, never a minus sign. Direction is
                      its own column, which is the Sheet's shape too. */}
                  <td {...cellProps(t, "amountSen", "text-right")}>
                    <div className={CONTENT + " justify-end"}>
                      {isEditing(t, "amountSen") ? (
                        <CellInput
                          value={(t.amountSen / 100).toFixed(2)}
                          type="decimal"
                          align="right"
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
                    </div>
                  </td>

                  {/* Category */}
                  <td {...cellProps(t, "categoryId")}>
                    <div className={CONTENT}>
                      {isEditing(t, "categoryId") ? (
                        <CellSelect
                          value={t.categoryId}
                          onCommit={(v) => commit(t, "categoryId", v)}
                          onCancel={() => setEditing(null)}
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
                  <td {...cellProps(t, "description")}>
                    <div className={CONTENT}>
                      {isEditing(t, "description") ? (
                        <CellInput
                          value={t.description ?? ""}
                          onCommit={(v) => commit(t, "description", v)}
                          onCancel={() => setEditing(null)}
                        />
                      ) : (
                        <span className="truncate text-ink-faint" title={t.description ?? ""}>
                          {t.description || "—"}
                        </span>
                      )}
                    </div>
                  </td>

                  {/* Type */}
                  <td {...cellProps(t, "direction")}>
                    <div className={CONTENT}>
                      {isEditing(t, "direction") ? (
                        <CellSelect
                          value={t.direction}
                          onCommit={(v) => commit(t, "direction", v)}
                          onCancel={() => setEditing(null)}
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

                  {/* Vehicle -- only meaningful where the category carries one.
                      Elsewhere it is inert rather than an empty dropdown that
                      implies it could be set, so it gets no hover either. */}
                  {hasVehicleCell ? (
                    <td {...cellProps(t, "vehicleId")}>
                      <div className={CONTENT}>
                        {isEditing(t, "vehicleId") ? (
                          <CellSelect
                            value={t.vehicleId ?? ""}
                            onCommit={(v) => commit(t, "vehicleId", v)}
                            onCancel={() => setEditing(null)}
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
                    Delete. Quiet on desktop, always visible on touch -- a
                    hover-only control is unreachable on the phone where entry
                    actually happens.

                    NOT a cell you can click into: every other td here opens an
                    inline editor, and a destructive action sharing that
                    gesture is how a mis-tap deletes a row. It gets its own
                    button and its own confirmation.
                  */}
                  <td className={CELL}>
                    <div className={CONTENT + " justify-center"}>
                      <button
                        type="button"
                        onClick={() => setDeleting(t)}
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
            })}
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
