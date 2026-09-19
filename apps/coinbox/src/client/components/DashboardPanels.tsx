import { formatSen } from "@portals/core";
import type { Dashboard, UpcomingPosting, VehicleConsumption } from "../api/hooks";

/**
 * The two side panels: what the rules will post next, and how much fuel each
 * vehicle burns.
 */

export function ComingUp({ committed }: { committed: Dashboard["committed"] }) {
  return (
    <div className="rounded-xl border border-edge bg-surface p-5">
      <h2 className="font-semibold text-ink">Coming up</h2>
      <p className="mt-1 text-sm text-ink-muted">
        What your rules will post themselves over the next {committed.days} days.
      </p>

      {committed.upcoming.length === 0 ? (
        <p className="mt-5 text-sm text-ink-muted">
          Nothing scheduled in that window.
        </p>
      ) : (
        <ul className="mt-4 flex flex-col">
          {committed.upcoming.map((u) => (
            <Row key={`${u.ruleId}-${u.occurredOn}`} posting={u} />
          ))}
          {committed.count > committed.upcoming.length && (
            <li className="pt-3 text-sm text-ink-faint">
              and {committed.count - committed.upcoming.length} more
            </li>
          )}
        </ul>
      )}
    </div>
  );
}

function Row({ posting }: { posting: UpcomingPosting }) {
  const out = posting.direction === "out";
  return (
    <li className="flex items-start gap-3 border-b border-edge py-2.5 last:border-b-0">
      {/* The same marker the ledger puts on auto-posted rows. */}
      <span aria-hidden className="w-4 shrink-0 text-center leading-5 text-ink-faint">
        &#8635;
      </span>
      <div className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium text-ink">{posting.item}</span>
        <span className="mt-0.5 block text-xs text-ink-muted">
          {posting.categoryName} · {posting.occurredOn}
        </span>
      </div>
      <span
        className={
          "shrink-0 text-sm font-semibold tabular-nums " +
          (out ? "text-status-overdue-fg" : "text-status-ok-fg")
        }
      >
        {out ? "−" : "+"}
        {formatSen(posting.amountSen)}
      </span>
    </li>
  );
}

/**
 * Fuel consumption per vehicle, full tank to full tank.
 *
 * Replaced the cost-per-kilometre card on 2026-09-19: consumption is the
 * figure the owner reads. It carries no money, so it is the same number
 * Odometry's Fuel tab shows; the price per litre and what each fill cost stay
 * on the drill-down, behind the ledger predicate.
 *
 * A vehicle with fills but no closed segment yet is listed and says so, rather
 * than being hidden -- one full tank is not a measurement, and an empty card
 * would read as "nothing logged".
 */
export function FuelConsumption({
  vehicles,
  onSelect,
}: {
  vehicles: VehicleConsumption[];
  onSelect: (vehicle: VehicleConsumption) => void;
}) {
  return (
    <div className="rounded-xl border border-edge bg-surface p-5">
      <h2 className="font-semibold text-ink">Fuel consumption</h2>
      <p className="mt-1 text-sm text-ink-muted">
        Measured from one full tank to the next, across every fill-up.
      </p>

      {vehicles.length === 0 ? (
        <p className="mt-5 text-sm text-ink-muted">
          No fill-ups recorded yet. Log a fuel entry against a vehicle and it
          appears here.
        </p>
      ) : (
        <ul className="mt-4 flex flex-col gap-2">
          {vehicles.map((v) => {
            const measured = v.avgLPer100km !== null;
            return (
              <li
                key={v.vehicleId}
                // `relative` anchors the stretched overlay below, so the WHOLE
                // row is the hit area rather than just the nickname.
                className="relative flex items-center justify-between gap-3 rounded-xl bg-inset p-4 transition hover:bg-edge/50 focus-within:ring-2 focus-within:ring-ink-muted"
              >
                {/* min-w-[8rem] is a floor: at 375px a bare min-w-0 title
                    collapses to one word instead of wrapping. */}
                <div className="min-w-[8rem] flex-1">
                  <button
                    type="button"
                    onClick={() => onSelect(v)}
                    aria-label={`${v.nickname}: fuel detail`}
                    className="absolute inset-0 rounded-xl focus:outline-none"
                  />
                  <span className="block truncate text-sm font-medium text-ink">
                    {v.nickname}
                  </span>
                  <span className="mt-0.5 block text-xs tabular-nums text-ink-faint">
                    {measured
                      ? `${tanks(v.measuredCount)} · ${v.segmentDistanceKm.toLocaleString("en-MY")} km`
                      : `${fills(v.fillCount)} · needs a second full tank`}
                  </span>
                </div>
                <span className="shrink-0 text-right tabular-nums">
                  <span
                    className={
                      "block text-xl font-semibold " + (measured ? "text-ink" : "text-ink-faint")
                    }
                  >
                    {measured ? v.avgLPer100km!.toFixed(1) : "—"}
                    {measured && (
                      <span className="ml-1 text-sm font-normal text-ink-muted">L/100km</span>
                    )}
                  </span>
                  {measured && v.avgKmPerLitre !== null && (
                    <span className="block text-xs text-ink-faint">
                      {v.avgKmPerLitre.toFixed(1)} km/L
                    </span>
                  )}
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function tanks(n: number): string {
  return `${n} ${n === 1 ? "tank" : "tanks"}`;
}

function fills(n: number): string {
  return `${n} ${n === 1 ? "fill" : "fills"}`;
}
