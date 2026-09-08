import { formatSen } from "@portals/core";
import type { Dashboard, UpcomingPosting, VehicleCost } from "../api/hooks";

/**
 * The two side panels: what the rules will post next, and what the fleet costs
 * per kilometre.
 */

/** RM per km, from integer sen per km. Two decimals, like every other figure. */
function perKm(senPerKm: number): string {
  return formatSen(senPerKm);
}

function entries(n: number): string {
  return `${n} ${n === 1 ? "entry" : "entries"}`;
}

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
 * Cost per kilometre — the one figure neither portal can produce on its own.
 *
 * The spend is this ledger's and the distance is Odometry's. Two honesty
 * requirements come with that, and both are load-bearing rather than polish:
 *
 * - Tolls, parking and road tax are deliberately not attributed to a vehicle,
 *   so this is the cost of FUELLING AND SERVICING a vehicle, not the cost of
 *   getting about. Presenting it as the latter would overstate what dropping
 *   a car would save.
 * - A vehicle with a handful of entries, or with no odometer movement to
 *   divide by, gets its figure shown and flagged rather than hidden. Same
 *   stance as Odometry's low-confidence usage rate.
 */
export function VehicleCosts({
  vehicles,
  onSelect,
}: {
  vehicles: VehicleCost[];
  onSelect: (vehicle: VehicleCost) => void;
}) {
  return (
    <div className="rounded-xl border border-edge bg-surface p-5">
      <h2 className="font-semibold text-ink">Cost per kilometre</h2>
      <p className="mt-1 text-sm text-ink-muted">
        Ledger spend against distance from Odometry, over the last 12 months.
      </p>

      {vehicles.length === 0 ? (
        <p className="mt-5 text-sm text-ink-muted">
          No spending attributed to a vehicle yet. Pick one on an entry and it
          appears here.
        </p>
      ) : (
        <ul className="mt-4 flex flex-col gap-2">
          {vehicles.map((v) => (
            <li
              key={v.vehicleId}
              // `relative` anchors the stretched overlay below. The same
              // pattern as Odometry's vehicle tiles and the recurring cards:
              // the WHOLE row is the hit area, not just the nickname. When
              // only the title was clickable on the recurring page, the
              // amount, the date and the dead space all did nothing, and it
              // read as broken rather than as unclickable.
              className="relative flex items-center justify-between gap-3 rounded-xl bg-inset p-4 transition hover:bg-edge/50 focus-within:ring-2 focus-within:ring-ink-muted"
            >
              {/* min-w-[8rem] is a floor, not a preference: at 375px a bare
                  min-w-0 title collapses to one word instead of wrapping. */}
              <div className="min-w-[8rem] flex-1">
                <button
                  type="button"
                  onClick={() => onSelect(v)}
                  aria-label={`${v.nickname}: fuel and spending detail`}
                  // Transparent and stretched. It carries the click for the
                  // whole row without painting over anything.
                  className="absolute inset-0 rounded-xl focus:outline-none"
                />
                <span
                  className={
                    "block truncate text-sm font-medium " +
                    (v.confident ? "text-ink" : "text-ink-muted")
                  }
                >
                  {v.nickname}
                </span>
                <span className="mt-0.5 block text-xs tabular-nums text-ink-faint">
                  {v.senPerKm === null
                    ? `${entries(v.txnCount)} · no odometer movement`
                    : v.confident
                      ? `${entries(v.txnCount)} · ${v.distanceKm.toLocaleString("en-MY")} km`
                      : `${entries(v.txnCount)} — too few to trust`}
                </span>
              </div>
              <span
                className={
                  "shrink-0 text-xl font-semibold tabular-nums " +
                  (v.confident ? "text-ink" : "text-ink-faint")
                }
              >
                {v.senPerKm === null ? "—" : perKm(v.senPerKm)}
              </span>
            </li>
          ))}
        </ul>
      )}

      <p className="mt-4 text-xs text-ink-faint">
        Fuel and servicing only — tolls and parking are not attributed to a
        vehicle, so this is not the full cost of driving.
        {vehicles.length > 0 && " Pick one for its consumption and spend."}
      </p>
    </div>
  );
}
