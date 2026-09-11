import { useState } from "react";
import { useCreatePartType } from "../api/hooks";
import { Field, INPUT, Select, digitsOnly } from "@portals/core/client";
import { CATEGORY_ORDER, categoryLabel } from "../lib/partCategories";

/**
 * Adds a part type the catalogue does not have, from inside the service form.
 *
 * The write half has existed since the part-type repo was written -- POST
 * /api/part-types, `partTypeInput`, and `PartTypeRepo.create`, which batches
 * the row with its part_type_defaults so a part type cannot exist invisible to
 * every vehicle. Nothing rendered it, so the catalogue was effectively closed:
 * a receipt line with no matching part had to be folded into labour, and a
 * replaced component left no trace in parts history.
 *
 * AN INLINE PANEL, NOT A NESTED SHEET. This opens from the part picker, which
 * already lives inside ServiceSheet's own Sheet. A second overlay over the
 * first would put the half-filled service behind two scrims, and closing the
 * wrong one loses the visit.
 *
 * The interval is optional and asks for the GAP, not an odometer figure --
 * unlike the "Next due at" box on a line item, which asks for the absolute
 * number on the workshop sticker. This one is the part's default for every
 * vehicle, so it has no service odometer to be relative to.
 */
export function CustomPartDialog({
  onCreated,
  onCancel,
}: {
  /**
   * Receives the new part type's id AND name, so it can drop into the current
   * visit immediately. The name is passed because the part-types query is
   * still refetching at this point, so the caller cannot look it up yet.
   */
  onCreated: (partTypeId: string, name: string) => void;
  onCancel: () => void;
}) {
  const create = useCreatePartType();

  const [name, setName] = useState("");
  const [category, setCategory] = useState("other");
  const [intervalKm, setIntervalKm] = useState("");
  const [intervalMonths, setIntervalMonths] = useState("");

  const trimmed = name.trim();
  const canSave = trimmed.length > 0 && !create.isPending;

  function save() {
    if (!canSave) return;
    create.mutate(
      {
        name: trimmed,
        category,
        // Null rather than omitted: the part genuinely has no schedule, which
        // is a legitimate answer for anything replaced on failure.
        defaultIntervalKm: intervalKm === "" ? null : Number(intervalKm),
        defaultIntervalMonths: intervalMonths === "" ? null : Number(intervalMonths),
      },
      { onSuccess: ({ id }) => onCreated(id, trimmed) },
    );
  }

  return (
    <div className="mt-3 rounded-xl border border-edge bg-inset p-3">
      <p className="text-sm font-medium">Add a part the list does not have</p>

      <Field label="Name">
        <input
          value={name}
          onChange={(e) => setName(e.target.value.slice(0, 60))}
          placeholder="Throttle position sensor"
          className={INPUT}
          autoFocus
        />
      </Field>

      <Field label="Category">
        <Select className="mt-1" value={category} onChange={(e) => setCategory(e.target.value)}>
          {CATEGORY_ORDER.map((c) => (
            <option key={c} value={c}>
              {categoryLabel(c)}
            </option>
          ))}
        </Select>
      </Field>

      <div className="mt-3 grid grid-cols-2 gap-2">
        <label className="block">
          <span className="text-xs text-ink-muted">Every … km</span>
          <input
            type="text"
            inputMode="numeric"
            value={intervalKm}
            onChange={(e) => setIntervalKm(digitsOnly(e.target.value))}
            placeholder="optional"
            className={INPUT + " mt-0 py-2 tabular-nums"}
          />
        </label>
        <label className="block">
          <span className="text-xs text-ink-muted">Every … months</span>
          <input
            type="text"
            inputMode="numeric"
            value={intervalMonths}
            onChange={(e) => setIntervalMonths(digitsOnly(e.target.value))}
            placeholder="optional"
            className={INPUT + " mt-0 py-2 tabular-nums"}
          />
        </label>
      </div>
      <p className="mt-1 text-xs text-ink-faint">
        Leave both blank for something replaced when it fails rather than on a schedule.
      </p>

      {create.isError && (
        <p className="mt-2 text-sm text-status-overdue-fg">{(create.error as Error).message}</p>
      )}

      <div className="mt-3 flex gap-2">
        <button
          onClick={onCancel}
          className="flex-1 rounded-lg border border-edge py-2 text-sm text-ink-muted hover:text-ink"
        >
          Cancel
        </button>
        <button
          onClick={save}
          disabled={!canSave}
          className="flex-1 rounded-lg bg-ink py-2 text-sm font-medium text-page disabled:opacity-40"
        >
          {create.isPending ? "Adding…" : "Add part"}
        </button>
      </div>
    </div>
  );
}
