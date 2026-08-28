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
const CELL_HOVER = "cursor-text hover:bg-inset";
const CONTENT = "flex h-9 items-center text-sm leading-5";

/** Editor and display must be metrically identical. Change both or neither. */
const EDITOR =
  "h-9 w-full appearance-none border-0 bg-transparent p-0 text-sm leading-5 text-ink " +
  "focus:outline-none focus:ring-0";

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
    ref.current?.focus();
    ref.current?.select();
  }, []);

  return (
    <input
      ref={ref}
      className={EDITOR + (align === "right" ? " text-right tabular-nums" : "")}
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
  useEffect(() => ref.current?.focus(), []);

  return (
    <select
      ref={ref}
      className={EDITOR}
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

  const categoryById = new Map(categories.map((c) => [c.id, c]));
  const vehicleById = new Map(vehicles.map((v) => [v.id, v]));

  function commit(t: Transaction, field: Field, raw: string) {
    setEditing(null);

    const body: Record<string, unknown> = {};

    if (field === "amountSen") {
      const sen = parseSen(raw);
      // A blank or unparseable amount is a slip, not an instruction to zero
      // the row -- and the CHECK constraint would reject it anyway.
      if (sen === null || sen <= 0 || sen === t.amountSen) return;
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
  function cellProps(t: Transaction, field: Field, extra = "") {
    const active = isEditing(t, field);
    return {
      className: `${CELL} ${CELL_HOVER} ${active ? RING : ""} ${extra}`,
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
              const hasVehicleCell = showsVehicle(code);

              return (
                <tr key={t.id} className={patch.isPending ? "opacity-60" : undefined}>
                  {/* Date */}
                  <td {...cellProps(t, "occurredOn")}>
                    <div className={CONTENT}>
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
                        <span className="text-ink">{t.item}</span>
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
                        <span className="whitespace-nowrap text-ink-muted">{t.categoryName}</span>
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
                        <span className="text-ink-faint">{t.description || "—"}</span>
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
    </>
  );
}
