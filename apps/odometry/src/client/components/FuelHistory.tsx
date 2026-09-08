import { fromQuantityMilli, weightedLPer100km } from "@portals/core";
import { useFuel } from "../api/hooks";
import { formatKm } from "../lib/format";

/**
 * Fills for one vehicle, newest first, each with the consumption of the segment
 * it closes.
 *
 * NO MONEY APPEARS HERE, and that is not an oversight. `fuel_fills` is
 * garage-scoped and a garage is shared, so anything priced on this page would
 * be readable by every co-member. The ringgit stays in Coinbox behind the
 * ledger predicate; this page is about the car.
 */
export function FuelHistory({ vehicleId }: { vehicleId: string }) {
  const fuel = useFuel(vehicleId);

  if (fuel.isLoading) return <p className="text-ink-muted">Loading&hellip;</p>;

  const rows = fuel.data ?? [];
  if (rows.length === 0) {
    return (
      <div className="rounded-xl border border-edge bg-surface p-6 text-ink-muted">
        <p>No fill-ups recorded yet.</p>
        <p className="mt-2 text-sm text-ink-faint">
          Log one in Coinbox: add the expense, pick this vehicle, and tick
          &ldquo;Refueling&rdquo;. Consumption appears from the second full tank onwards.
        </p>
      </div>
    );
  }

  // Averaged over the segments that HAVE a figure, not over all fills: a
  // partial fill contributes its litres to a segment but is not one itself.
  const measured = rows.filter((r) => r.lPer100km !== null);

  // DISTANCE-WEIGHTED, and shared with Coinbox rather than computed here.
  //
  // This used to be the plain mean of the per-segment rates, which counts a
  // 40 km top-up as heavily as a 600 km run. Coinbox's fuel drill-down shows
  // the same average for the same car, so an unweighted figure here would have
  // put two different plausible numbers on two screens with nothing to say
  // which was right. One function, one answer.
  const average = weightedLPer100km(measured);

  return (
    <div>
      {average !== null && (
        <div className="mb-4 rounded-xl border border-edge bg-surface p-4">
          <p className="text-sm text-ink-muted">
            Average over {measured.length} {measured.length === 1 ? "tank" : "tanks"}
          </p>
          <p className="mt-1 text-2xl tabular-nums text-ink">
            {average.toFixed(1)}{" "}
            <span className="text-base text-ink-muted">L/100km</span>
            <span className="ml-3 text-base text-ink-faint">
              {(100 / average).toFixed(1)} km/L
            </span>
          </p>
        </div>
      )}

      <div className="overflow-x-auto rounded-xl border border-edge bg-surface">
        <table className="w-full text-sm">
          <thead className="text-ink-muted">
            <tr className="border-b border-edge">
              <th className="px-4 py-3 text-left font-medium">Date</th>
              <th className="px-4 py-3 text-right font-medium">Odometer</th>
              <th className="px-4 py-3 text-right font-medium">Litres</th>
              <th className="px-4 py-3 text-right font-medium">Distance</th>
              <th className="px-4 py-3 text-right font-medium">L/100km</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className="border-b border-edge last:border-0">
                <td className="px-4 py-3 text-ink">{r.filledOn}</td>
                <td className="px-4 py-3 text-right tabular-nums text-ink">
                  {formatKm(r.readingKm)}
                </td>
                <td className="px-4 py-3 text-right tabular-nums text-ink">
                  {fromQuantityMilli(r.litresMilli).toFixed(2)}
                  {r.isFullTank === 0 && (
                    <span className="ml-2 rounded bg-inset px-1.5 py-0.5 text-xs text-ink-faint">
                      partial
                    </span>
                  )}
                </td>
                <td className="px-4 py-3 text-right tabular-nums text-ink-muted">
                  {r.distanceKm === null ? "—" : formatKm(r.distanceKm)}
                </td>
                {/*
                  A dash is the honest answer twice over: the first full fill
                  has no previous one to measure from, and a part fill is
                  counted towards the next full tank rather than on its own.
                */}
                <td className="px-4 py-3 text-right tabular-nums text-ink">
                  {r.lPer100km === null ? (
                    <span className="text-ink-faint">—</span>
                  ) : (
                    r.lPer100km.toFixed(1)
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="mt-3 text-xs text-ink-faint">
        Consumption is measured from one full tank to the next, so the first fill has no figure
        and a part fill counts towards the tank that follows it.
      </p>
    </div>
  );
}
