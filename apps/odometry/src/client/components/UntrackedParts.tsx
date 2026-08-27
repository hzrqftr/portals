import { useState } from "react";
import { usePartTypes, useSetInterval, type VehicleType } from "../api/hooks";
import { PartIcon } from "./PartIcon";
import { categoryLabel, groupByCategory } from "../lib/partCategories";

/**
 * Parts this vehicle is not tracking, and the only route back once one has
 * been switched off -- an inactive interval is absent from the maintenance
 * view entirely, so without this "Stop tracking" would be a one-way door.
 *
 * It also covers parts the seeder deliberately skips. A part type with no
 * default interval on either column is never seeded onto a new vehicle, which
 * is how the schedule avoids claiming every car has a timing chain AND a
 * timing belt, or rear discs AND rear drums, or a clutch. Those live here
 * until the owner says the car actually has one.
 *
 * Grouped by category since 0007, for the same reason the maintenance grid is:
 * this list went from one entry to roughly a dozen.
 */
export function UntrackedParts({
  vehicleId,
  vehicleType,
  tracked,
  query,
}: {
  vehicleId: string;
  vehicleType: VehicleType;
  tracked: string[];
  /** Lifted from MaintenanceList, so one search box covers tracked and untracked parts alike. */
  query: string;
}) {
  const [openList, setOpenList] = useState(false);
  const [pending, setPending] = useState<string | null>(null);
  const partTypes = usePartTypes(vehicleType);
  const save = useSetInterval(vehicleId);

  const trackedSet = new Set(tracked);
  const untracked = (partTypes.data ?? [])
    .filter((p) => !trackedSet.has(p.id))
    .sort((a, b) => a.name.localeCompare(b.name));

  if (untracked.length === 0) return null;

  // Searching implies wanting the match visible, not another click to reveal
  // it -- so a query forces this section open regardless of the manual toggle.
  const q = query.trim().toLowerCase();
  const searching = q !== "";
  const filtered = searching ? untracked.filter((p) => p.name.toLowerCase().includes(q)) : untracked;
  const isOpen = searching ? true : openList;

  const groups = groupByCategory(filtered, (p) => p.category);

  return (
    <div className="mt-8">
      {searching ? (
        <p className="text-sm text-ink-muted">
          Not tracked on this vehicle ({filtered.length} match{filtered.length === 1 ? "" : "es"})
        </p>
      ) : (
        <button
          onClick={() => setOpenList(!openList)}
          className="text-sm text-ink-muted underline hover:text-ink"
        >
          {openList ? "Hide" : `Not tracked on this vehicle (${untracked.length})`}
        </button>
      )}

      {isOpen && groups.length === 0 && (
        <p className="mt-3 text-sm text-ink-faint">No untracked parts match "{query.trim()}".</p>
      )}

      {isOpen && groups.length > 0 && (
        <div className="mt-3 space-y-5">
          {groups.map(({ category, rows }) => (
            <section key={category}>
              <h3 className="text-xs font-medium uppercase tracking-wider text-ink-faint">
                {categoryLabel(category)}
              </h3>
              <ul className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
                {rows.map((p) => (
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
                          // Every part carries a real interval since 0008, so
                          // there is nothing left to invent -- the old
                          // `?? 10_000` placeholder existed only because an
                          // opt-in part had both intervals NULL.
                          intervalKm: p.default_interval_km,
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
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
