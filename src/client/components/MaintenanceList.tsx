import { useState } from "react";
import { usePartTypes, useSetInterval, type MaintenanceRow } from "../api/hooks";
import { MaintenanceTile } from "./MaintenanceTile";
import { PartDetailSheet } from "./PartDetailSheet";
import { PartIcon } from "./PartIcon";

/** Spec 8.2: intervals with last done, next due, status, and inline editing. */

type Filter = "all" | "attention" | "unset";

const FILTERS: { value: Filter; label: string }[] = [
  { value: "all", label: "All" },
  { value: "attention", label: "Needs attention" },
  { value: "unset", label: "Not set up" },
];

export function MaintenanceList({
  vehicleId,
  rows,
}: {
  vehicleId: string;
  rows: MaintenanceRow[];
}) {
  const [filter, setFilter] = useState<Filter>("all");
  const [open, setOpen] = useState<MaintenanceRow | null>(null);

  // Presentation only, over an array already in memory -- not aggregation, so
  // invariant 4 is untouched. The server has already ordered these
  // overdue -> due_soon -> ok -> unknown, so attention lands top-left and
  // nothing is re-sorted here.
  const shown = rows.filter((r) =>
    filter === "attention"
      ? r.status === "overdue" || r.status === "due_soon"
      : filter === "unset"
        ? r.status === "unknown"
        : true,
  );

  const count = (f: Filter) =>
    f === "attention"
      ? rows.filter((r) => r.status === "overdue" || r.status === "due_soon").length
      : f === "unset"
        ? rows.filter((r) => r.status === "unknown").length
        : rows.length;

  return (
    <>
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
          {filter === "attention"
            ? "Nothing is due or overdue on this vehicle."
            : "Every part on this vehicle has a service on record."}
        </p>
      ) : (
        // auto-rows-fr equalises the row tracks. Without it a row holding a
        // tile with a due-mileage line is taller than a row of unknowns, and
        // the tiles read as different sizes rather than one grid.
        <ul className="mt-3 grid auto-rows-fr grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
          {shown.map((row) => (
            <li key={row.interval_id} className="h-full">
              <MaintenanceTile row={row} onOpen={() => setOpen(row)} />
            </li>
          ))}
        </ul>
      )}

      <UntrackedParts vehicleId={vehicleId} tracked={rows.map((r) => r.part_type_id)} />

      {open && (
        <PartDetailSheet
          vehicleId={vehicleId}
          // Re-read from rows so the sheet reflects a just-saved edit rather
          // than the snapshot captured when the tile was clicked.
          row={rows.find((r) => r.interval_id === open.interval_id) ?? open}
          onClose={() => setOpen(null)}
        />
      )}
    </>
  );
}

/**
 * Parts this vehicle is not tracking, and the only route back once one has
 * been switched off -- an inactive interval is absent from the maintenance
 * view entirely, so without this section "Not on this car" would be a
 * one-way door. It also covers parts the seeder never created, which is how
 * a chain-driven car gets a Timing chain row at all.
 */
function UntrackedParts({ vehicleId, tracked }: { vehicleId: string; tracked: string[] }) {
  const [openList, setOpenList] = useState(false);
  const [pending, setPending] = useState<string | null>(null);
  const partTypes = usePartTypes();
  const save = useSetInterval(vehicleId);

  const trackedSet = new Set(tracked);
  const untracked = (partTypes.data ?? [])
    .filter((p) => !trackedSet.has(p.id))
    .sort((a, b) => a.name.localeCompare(b.name));

  if (untracked.length === 0) return null;

  return (
    <div className="mt-6">
      <button
        onClick={() => setOpenList(!openList)}
        className="text-sm text-ink-muted underline hover:text-ink"
      >
        {openList ? "Hide" : `Not tracked on this car (${untracked.length})`}
      </button>

      {openList && (
        <ul className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {untracked.map((p) => (
            <li
              key={p.id}
              className="flex items-center gap-3 rounded-xl border border-edge bg-surface p-3 text-sm"
            >
              <span className="rounded-lg bg-inset p-1.5 text-ink-faint">
                <PartIcon category={p.category} />
              </span>
              <span className="min-w-0 flex-1 truncate">{p.name}</span>
              <button
                disabled={save.isPending}
                onClick={() => {
                  setPending(p.id);
                  save.mutate({
                    partTypeId: p.id,
                    // A part with no default has nothing to schedule from, so
                    // it starts at a placeholder the owner then corrects --
                    // better than refusing to add it at all.
                    intervalKm:
                      p.default_interval_km ?? (p.default_interval_months ? null : 10_000),
                    intervalMonths: p.default_interval_months,
                    isActive: 1,
                  });
                }}
                className="shrink-0 rounded-lg border border-edge px-3 py-1.5 text-ink-muted hover:text-ink"
              >
                {save.isPending && pending === p.id ? "Adding…" : "Track"}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
