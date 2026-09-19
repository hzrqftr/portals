import { useState } from "react";
import type { MaintenanceRow } from "../api/hooks";
import { MaintenanceGroups } from "./MaintenanceGroups";
import { PartDetailSheet } from "./PartDetailSheet";
import { INPUT } from "@portals/core/client";

/**
 * Spec 8.2: every tracked part with last done, next due and status.
 *
 * Status only, since 2026-09-20. Which parts are tracked, and how often each
 * is due, is the Schedule tab's job -- one table, every part, edited together
 * -- so the untracked list and the per-part editor that lived here moved there.
 */

type Filter = "all" | "attention" | "unset";

const FILTERS: { value: Filter; label: string }[] = [
  { value: "all", label: "All" },
  { value: "attention", label: "Needs attention" },
  { value: "unset", label: "Not set up" },
];

export function MaintenanceList({
  rows,
  onEditSchedule,
}: {
  rows: MaintenanceRow[];
  onEditSchedule: () => void;
}) {
  const [filter, setFilter] = useState<Filter>("all");
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState<MaintenanceRow | null>(null);

  const q = query.trim().toLowerCase();

  // Presentation only, over an array already in memory -- not aggregation, so
  // invariant 4 is untouched. The server has already ordered these
  // overdue -> due_soon -> ok -> unknown, and nothing here re-sorts.
  const shown = rows
    .filter((r) =>
      filter === "attention"
        ? r.status === "overdue" || r.status === "due_soon"
        : filter === "unset"
          ? r.status === "unknown"
          : true,
    )
    .filter((r) => q === "" || r.part_name.toLowerCase().includes(q));

  const count = (f: Filter) =>
    f === "attention"
      ? rows.filter((r) => r.status === "overdue" || r.status === "due_soon").length
      : f === "unset"
        ? rows.filter((r) => r.status === "unknown").length
        : rows.length;

  return (
    <>
      <input
        type="search"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Search parts…"
        className={INPUT + " mt-3"}
      />

      <div className="mt-3 flex flex-wrap gap-2">
        {FILTERS.map((f) => (
          <button
            key={f.value}
            onClick={() => setFilter(f.value)}
            className={
              "rounded-full px-3 py-1.5 text-sm transition " +
              (filter === f.value
                ? "bg-ink text-page"
                : "border border-edge text-ink-muted hover:text-ink")
            }
          >
            {f.label}
            <span className="ml-1.5 text-xs opacity-60">{count(f.value)}</span>
          </button>
        ))}
      </div>

      {shown.length === 0 ? (
        // Empty states guide rather than showing a blank area (spec 9).
        <p className="mt-4 rounded-xl border border-edge bg-surface p-4 text-sm text-ink-muted">
          {q !== ""
            ? `No tracked parts match "${query.trim()}".`
            : filter === "attention"
              ? "Nothing is due or overdue on this vehicle."
              : "Every part on this vehicle has a service on record."}
        </p>
      ) : (
        <MaintenanceGroups rows={shown} onOpen={setOpen} />
      )}

      <p className="mt-4 text-sm text-ink-muted">
        Tracking a part, or changing how often it is due, is done on the schedule.{" "}
        <button onClick={onEditSchedule} className="underline hover:text-ink">
          Edit the schedule
        </button>
      </p>

      {open && (
        <PartDetailSheet
          onEditSchedule={() => {
            setOpen(null);
            onEditSchedule();
          }}
          // Re-read from rows so the sheet reflects a just-saved edit rather
          // than the snapshot captured when the tile was clicked.
          row={rows.find((r) => r.interval_id === open.interval_id) ?? open}
          onClose={() => setOpen(null)}
        />
      )}
    </>
  );
}
