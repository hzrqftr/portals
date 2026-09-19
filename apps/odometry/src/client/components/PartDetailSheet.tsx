import type { MaintenanceRow } from "../api/hooks";
import { Sheet } from "@portals/core/client";
import { StatusPill } from "./StatusPill";
import { PartIcon } from "./PartIcon";
import { Interval } from "./MaintenanceTile";
import { relativeDays, formatKm } from "../lib/format";

/**
 * Everything about one part, opened by tapping its tile.
 *
 * A tile is too small to carry the baseline and the due point, so the detail
 * lives here. The interval is shown, not edited: the Schedule tab is the one
 * place it changes (2026-09-20), and this sheet links there.
 */
export function PartDetailSheet({
  row,
  onClose,
  onEditSchedule,
}: {
  row: MaintenanceRow;
  onClose: () => void;
  onEditSchedule: () => void;
}) {
  return (
    <Sheet title={row.part_name} onClose={onClose}>
      {/* pr-9 keeps the status pill clear of the sheet's close button. */}
      <div className="flex items-start justify-between gap-3 pr-9">
        <div className="flex items-center gap-3">
          <span className="rounded-lg bg-inset p-2 text-ink-muted">
            <PartIcon category={row.part_category} className="h-6 w-6" />
          </span>
          <h2 className="text-lg font-semibold">{row.part_name}</h2>
        </div>
        <StatusPill status={row.status} />
      </div>

      <dl className="mt-5 space-y-2 text-sm">
        <Row label="Schedule">
          <Interval row={row} />
        </Row>

        {row.status === "unknown" ? (
          <p className="pt-2 text-ink-muted">
            No service on record yet, so there is nothing to count from. Log a service that
            includes this part and the clock starts.
          </p>
        ) : (
          <>
            <Row label="Next due">
              {relativeDays(row.days_remaining)}
              {row.due_km !== null && <> &middot; at {formatKm(row.due_km)}</>}
            </Row>
            <Row label="Last done">
              {row.baseline_date ?? "—"}
              {row.baseline_km !== null && <> &middot; {formatKm(row.baseline_km)}</>}
            </Row>
            {row.low_confidence === 1 && (
              <p className="pt-1 text-xs text-ink-faint">
                The date is estimated: this vehicle has too little odometer history to measure
                a real usage rate, so the assumed rate from Settings is being used.
              </p>
            )}
          </>
        )}

      </dl>

      <div className="mt-5 border-t border-edge pt-4">
        <button
          onClick={onEditSchedule}
          className="w-full rounded-xl border border-edge py-2.5 text-sm text-ink-muted hover:text-ink"
        >
          Change this schedule
        </button>
      </div>
    </Sheet>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex justify-between gap-4">
      <dt className="text-ink-faint">{label}</dt>
      <dd className="text-right text-ink">{children}</dd>
    </div>
  );
}
