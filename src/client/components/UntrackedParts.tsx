import { useState } from "react";
import { usePartTypes, useSetInterval } from "../api/hooks";
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
  tracked,
}: {
  vehicleId: string;
  tracked: string[];
}) {
  const [openList, setOpenList] = useState(false);
  const [pending, setPending] = useState<string | null>(null);
  const partTypes = usePartTypes();
  const save = useSetInterval(vehicleId);

  const trackedSet = new Set(tracked);
  const untracked = (partTypes.data ?? [])
    .filter((p) => !trackedSet.has(p.id))
    .sort((a, b) => a.name.localeCompare(b.name));

  if (untracked.length === 0) return null;

  const groups = groupByCategory(untracked, (p) => p.category);

  return (
    <div className="mt-8">
      <button
        onClick={() => setOpenList(!openList)}
        className="text-sm text-ink-muted underline hover:text-ink"
      >
        {openList ? "Hide" : `Not tracked on this car (${untracked.length})`}
      </button>

      {openList && (
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
                          // A part with no default has nothing to schedule
                          // from, so it starts at a placeholder the owner then
                          // corrects -- better than refusing to add it at all.
                          intervalKm:
                            p.default_interval_km ??
                            (p.default_interval_months ? null : 10_000),
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
