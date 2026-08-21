import { useState } from "react";
import { useSetInterval, type MaintenanceRow } from "../api/hooks";
import { INPUT, digitsOnly } from "./form";

/**
 * Per-vehicle interval editing, inline on the maintenance list (spec 8.2).
 *
 * This lives beside the status it changes rather than in Settings, because
 * the numbers are per vehicle and the moment you want to change one is the
 * moment you are looking at it being wrong. The motivating case: one car has
 * a timing BELT on a 100,000 km clock, the other has a timing CHAIN that is
 * inspect-on-symptom -- same fleet, incompatible schedules.
 *
 * Switching a part off is a first-class action, not a deletion. An inactive
 * interval keeps its history and can come back; a deleted one loses both.
 */
export function IntervalEditor({
  vehicleId,
  row,
  onDone,
}: {
  vehicleId: string;
  row: MaintenanceRow;
  onDone: () => void;
}) {
  const [km, setKm] = useState(
    row.interval_km === null ? "" : String(row.interval_km),
  );
  const [months, setMonths] = useState(
    row.interval_months === null ? "" : String(row.interval_months),
  );
  const save = useSetInterval(vehicleId);

  const intervalKm = km === "" ? null : Number(km);
  const intervalMonths = months === "" ? null : Number(months);
  const valid = intervalKm !== null || intervalMonths !== null;

  return (
    <div className="mt-3 border-t border-edge pt-3">
      <div className="grid grid-cols-2 gap-2">
        <label className="block">
          <span className="text-xs text-ink-muted">Every (km)</span>
          <input
            type="text"
            inputMode="numeric"
            value={km}
            onChange={(e) => setKm(digitsOnly(e.target.value))}
            placeholder="not tracked"
            className={INPUT + " mt-0 py-2 tabular-nums"}
          />
        </label>
        <label className="block">
          <span className="text-xs text-ink-muted">Every (months)</span>
          <input
            type="text"
            inputMode="numeric"
            value={months}
            onChange={(e) => setMonths(digitsOnly(e.target.value))}
            placeholder="not tracked"
            className={INPUT + " mt-0 py-2 tabular-nums"}
          />
        </label>
      </div>

      {!valid && (
        <p className="mt-1 text-xs text-ink-faint">
          Leave both blank and there is nothing to schedule from &mdash; switch the part off
          instead.
        </p>
      )}
      {save.isError && (
        <p className="mt-1 text-xs text-status-overdue-fg">{(save.error as Error).message}</p>
      )}

      <div className="mt-3 flex flex-wrap gap-2">
        <button
          onClick={() => save.mutate({ partTypeId: row.part_type_id, isActive: 0 }, { onSuccess: onDone })}
          className="rounded-lg border border-edge px-3 py-2 text-sm text-ink-muted hover:text-ink"
        >
          Not on this car
        </button>
        <button onClick={onDone} className="ml-auto rounded-lg px-3 py-2 text-sm text-ink-muted hover:text-ink">
          Cancel
        </button>
        <button
          disabled={!valid || save.isPending}
          onClick={() =>
            save.mutate(
              { partTypeId: row.part_type_id, intervalKm, intervalMonths },
              { onSuccess: onDone },
            )
          }
          className="rounded-lg bg-ink px-4 py-2 text-sm font-medium text-page disabled:opacity-40"
        >
          Save
        </button>
      </div>
    </div>
  );
}
