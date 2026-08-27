import type { MaintenanceRow, PartType } from "../api/hooks";
import { INPUT } from "@portals/core/client";
import { categoryLabel, groupByCategory } from "../lib/partCategories";

/**
 * Adds a part to a service. Spec 8.4.
 *
 * THE ORDERING IS THE FEATURE. This is used standing in a workshop, one
 * handed, with someone waiting. Forty-eight part types in alphabetical order
 * means hunting; the four the car is actually due for pinned to the top, and
 * the rest grouped by category, means two taps. A native select is deliberate -- it gets the platform's own
 * scroll wheel on a phone rather than a custom list that fights the keyboard.
 */
export function PartPicker({
  partTypes,
  maintenance,
  exclude,
  onAdd,
}: {
  partTypes: PartType[];
  maintenance: MaintenanceRow[];
  exclude: string[];
  onAdd: (partTypeId: string) => void;
}) {
  const taken = new Set(exclude);

  const attention = maintenance
    .filter((r) => r.status === "overdue" || r.status === "due_soon")
    .filter((r) => !taken.has(r.part_type_id));

  const attentionIds = new Set(attention.map((r) => r.part_type_id));
  const rest = partTypes
    .filter((p) => !taken.has(p.id) && !attentionIds.has(p.id))
    .sort((a, b) => a.name.localeCompare(b.name));

  return (
    <select
      value=""
      onChange={(e) => e.target.value && onAdd(e.target.value)}
      className={INPUT + " mt-3"}
    >
      <option value="">+ Add a part</option>

      {attention.length > 0 && (
        <optgroup label="Due on this vehicle">
          {attention.map((r) => (
            <option key={r.part_type_id} value={r.part_type_id}>
              {r.part_name} {r.status === "overdue" ? "(overdue)" : "(due soon)"}
            </option>
          ))}
        </optgroup>
      )}

      {/*
        One optgroup per category, not one "All parts" list. The seed set went
        from twenty entries to forty-eight in 0007, and a flat dropdown that
        long is a scroll rather than a choice. "Due on this vehicle" stays
        pinned above them, since that is the reason most services get logged.
      */}
      {groupByCategory(rest, (p) => p.category).map(({ category, rows }) => (
        <optgroup key={category} label={categoryLabel(category)}>
          {rows.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </optgroup>
      ))}
    </select>
  );
}
