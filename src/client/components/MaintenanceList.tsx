import { useState } from "react";
import { usePartTypes, useSetInterval, type MaintenanceRow } from "../api/hooks";
import { StatusPill } from "./StatusPill";
import { IntervalEditor } from "./IntervalEditor";
import { relativeDays, formatKm } from "../lib/format";

/** Spec 8.2: intervals with last done, next due, status, and inline editing. */
export function MaintenanceList({
  vehicleId,
  rows,
}: {
  vehicleId: string;
  rows: MaintenanceRow[];
}) {
  const [editing, setEditing] = useState<string | null>(null);

  return (
    <>
      <ul className="mt-3 space-y-2">
        {rows.map((row) => (
          <li key={row.interval_id} className="rounded-xl bg-white p-3 ring-1 ring-stone-200">
            <div className="flex items-start justify-between gap-2">
              <p className="min-w-0 truncate font-medium">{row.part_name}</p>
              <StatusPill status={row.status} />
            </div>

            {row.status === "unknown" ? (
              // A part with no history is unmeasured, not overdue. The row
              // asks for a baseline instead of raising a false alarm.
              <p className="mt-1 text-sm text-stone-600">
                No service on record yet &mdash; log one to start this clock.
              </p>
            ) : (
              <p className="mt-1 text-sm text-stone-700">
                {relativeDays(row.days_remaining)}
                {row.due_km !== null && (
                  <span className="text-stone-500"> &middot; at {formatKm(row.due_km)}</span>
                )}
                {row.low_confidence === 1 && (
                  <span className="text-stone-500"> &middot; estimated</span>
                )}
              </p>
            )}

            <div className="mt-1 flex items-baseline justify-between gap-2">
              <p className="text-xs text-stone-500">
                <Interval row={row} />
              </p>
              <button
                onClick={() => setEditing(editing === row.interval_id ? null : row.interval_id)}
                className="shrink-0 text-xs text-stone-500 underline"
              >
                {editing === row.interval_id ? "Close" : "Change"}
              </button>
            </div>

            {editing === row.interval_id && (
              <IntervalEditor vehicleId={vehicleId} row={row} onDone={() => setEditing(null)} />
            )}
          </li>
        ))}
      </ul>

      <UntrackedParts vehicleId={vehicleId} tracked={rows.map((r) => r.part_type_id)} />
    </>
  );
}

/**
 * "Every 5,000 km (one-off) or 12 months".
 *
 * The marker goes on the half that was actually overridden, not on the whole
 * line. A service can set a one-off distance while leaving the time interval
 * alone, and labelling both as one-off would send the owner looking for a
 * change to the months value that never happened.
 */
function Interval({ row }: { row: MaintenanceRow }) {
  if (row.interval_km === null && row.interval_months === null) return <>No interval set</>;

  const oneOff = (effective: number | null, configured: number | null) =>
    effective !== configured ? " (one-off)" : "";

  const parts = [
    row.interval_km === null
      ? null
      : `${row.interval_km.toLocaleString("en-MY")} km` +
        oneOff(row.interval_km, row.configured_interval_km),
    row.interval_months === null
      ? null
      : `${row.interval_months} months` +
        oneOff(row.interval_months, row.configured_interval_months),
  ].filter(Boolean);

  return <>Every {parts.join(" or ")}</>;
}

/**
 * Parts this vehicle is not tracking, and the only route back once one has
 * been switched off -- an inactive interval is absent from the maintenance
 * view entirely, so without this section "Not on this car" would be a
 * one-way door. It also covers parts the seeder never created, which is how
 * a chain-driven car gets a Timing chain row at all.
 */
function UntrackedParts({ vehicleId, tracked }: { vehicleId: string; tracked: string[] }) {
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState<string | null>(null);
  const partTypes = usePartTypes();
  const save = useSetInterval(vehicleId);

  const trackedSet = new Set(tracked);
  const untracked = (partTypes.data ?? [])
    .filter((p) => !trackedSet.has(p.id))
    .sort((a, b) => a.name.localeCompare(b.name));

  if (untracked.length === 0) return null;

  return (
    <div className="mt-3">
      <button onClick={() => setOpen(!open)} className="text-sm text-stone-500 underline">
        {open ? "Hide" : `Not tracked on this car (${untracked.length})`}
      </button>

      {open && (
        <ul className="mt-2 space-y-2">
          {untracked.map((p) => (
            <li
              key={p.id}
              className="flex items-center justify-between gap-2 rounded-xl bg-stone-50 p-3 text-sm ring-1 ring-stone-200"
            >
              <span className="min-w-0 truncate">{p.name}</span>
              <button
                disabled={save.isPending}
                onClick={() => {
                  setPending(p.id);
                  save.mutate({
                    partTypeId: p.id,
                    // A part with no default has nothing to schedule from, so
                    // it starts at a placeholder the owner then corrects --
                    // better than refusing to add it at all.
                    intervalKm: p.default_interval_km ?? (p.default_interval_months ? null : 10_000),
                    intervalMonths: p.default_interval_months,
                    isActive: 1,
                  });
                }}
                className="shrink-0 rounded-lg border border-stone-300 px-3 py-1.5"
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
