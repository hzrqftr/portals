import { Sheet } from "@portals/core/client";
import { formatSen, fromQuantityMilli } from "@portals/core";
import { senPerLitre } from "@shared/fuelRules";
import { ConsumptionChart } from "./ConsumptionChart";
import {
  useVehicleFuel,
  type FuelFill,
  type SpendSlice,
  type UsageSummary,
  type VehicleCost,
} from "../api/hooks";

/**
 * The drill-down behind a row of the cost-per-kilometre card.
 *
 * ===========================================================================
 * TWO COST-PER-KM FIGURES APPEAR HERE, AND THEY ARE NOT THE SAME NUMBER
 * ===========================================================================
 *
 * The card's figure is TWELVE MONTHS of every kind of spend on the vehicle --
 * fuel, servicing, tyres -- over the distance covered in that window. The one
 * this sheet computes is FUEL ONLY, over the distance of closed segments,
 * across every fill ever recorded. They answer different questions and will
 * always differ, so each is labelled with its window and its scope rather than
 * left to look like a discrepancy.
 *
 * The card's figure is not recomputed here. It arrives as the very `VehicleCost`
 * row the reader clicked, so the two cannot disagree even in principle.
 *
 * The 12-month spend breakdown DOES reconcile with that row, deliberately, and
 * a test asserts the sum -- see VehicleFuelRepo.spend().
 */
export function VehicleFuelSheet({
  vehicle,
  onClose,
}: {
  vehicle: VehicleCost;
  onClose: () => void;
}) {
  const fuel = useVehicleFuel(vehicle.vehicleId);
  const data = fuel.data;

  return (
    <Sheet title={vehicle.nickname} onClose={onClose} wide>
      {/* pr-9 keeps the heading clear of the sheet's floating close button. */}
      <div className="pr-9">
        <h2 className="text-lg font-semibold text-ink">{vehicle.nickname}</h2>
        <p className="mt-1 text-sm text-ink-muted">
          {data === undefined
            ? "Loading…"
            : data.totals.fillCount === 0
              ? "No fill-ups recorded yet."
              : `${data.totals.fillCount} ${data.totals.fillCount === 1 ? "fill" : "fills"}` +
                (data.fills.at(-1) ? ` since ${data.fills.at(-1)!.filledOn}` : "")}
        </p>
      </div>

      {fuel.isError && (
        <p className="mt-5 rounded-xl border border-edge bg-inset p-4 text-sm text-ink-muted">
          That vehicle&rsquo;s fuel history could not be loaded.
        </p>
      )}

      {data && (
        <div className="mt-5 flex flex-col gap-4">
          <Tiles data={data} vehicle={vehicle} />

          <UsageLine usage={data.usage} />

          <ConsumptionChart fills={data.fills} />

          <SpendPanel
            slices={data.spend.slices}
            totalSen={data.spend.totalSen}
            months={data.spend.months}
          />

          {data.fills.length > 0 && <FillTable fills={data.fills} />}

          <p className="text-xs text-ink-faint">
            Consumption is measured from one full tank to the next, so the first
            fill has no figure and a part fill counts towards the tank that
            follows it.
          </p>
        </div>
      )}
    </Sheet>
  );
}

/**
 * How much driving stands behind the figures above.
 *
 * Distance comes from raw odometer readings, the same source the card divides
 * by, so the two agree. It is NOT `v_odometer_clean`, which is what every
 * Odometry figure uses -- the difference is recorded in docs/status.md rather
 * than half-fixed in one of the two places.
 */
function UsageLine({ usage }: { usage: UsageSummary }) {
  const parts: string[] = [];
  if (usage.readingCount === 0) {
    parts.push("No odometer readings yet");
  } else {
    parts.push(`${usage.distanceKm.toLocaleString("en-MY")} km recorded`);
    // Null until two readings span a fortnight. A rate off less than that is a
    // guess dressed as a measurement, so it says so rather than dividing.
    parts.push(
      usage.kmPerDay === null
        ? "not enough history for a daily rate"
        : `${usage.kmPerDay.toFixed(0)} km/day`,
    );
    if (usage.lastReadingOn) parts.push(`last read ${usage.lastReadingOn}`);
  }
  return (
    <p className="text-xs text-ink-faint">{parts.join(" · ")}</p>
  );
}

function Tile({
  label,
  value,
  sub,
  note,
}: {
  label: string;
  value: string;
  sub?: string;
  note: string;
}) {
  return (
    <div className="rounded-xl bg-inset p-4">
      <span className="block text-xs font-medium uppercase tracking-wider text-ink-faint">
        {label}
      </span>
      <span className="mt-1 block text-xl font-semibold tabular-nums text-ink">
        {value}
        {sub && <span className="ml-2 text-sm font-normal text-ink-muted">{sub}</span>}
      </span>
      {/* Every figure states its own window. Two of these are drawn from
          different spans, and an unlabelled pair invites the wrong comparison. */}
      <span className="mt-1 block text-xs text-ink-faint">{note}</span>
    </div>
  );
}

function Tiles({
  data,
  vehicle,
}: {
  data: NonNullable<ReturnType<typeof useVehicleFuel>["data"]>;
  vehicle: VehicleCost;
}) {
  const t = data.totals;
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
      <Tile
        label="Consumption"
        value={t.avgLPer100km === null ? "—" : `${t.avgLPer100km.toFixed(1)}`}
        sub={
          t.avgLPer100km === null
            ? undefined
            : `L/100km · ${(t.avgKmPerLitre ?? 0).toFixed(1)} km/L`
        }
        note={
          t.measuredCount === 0
            ? "No full-tank segment yet"
            : `Across ${t.measuredCount} ${t.measuredCount === 1 ? "tank" : "tanks"}, ${t.segmentDistanceKm.toLocaleString("en-MY")} km`
        }
      />
      <Tile
        label="Price per litre"
        value={t.latestSenPerLitre === null ? "—" : formatSen(t.latestSenPerLitre)}
        note={
          t.avgSenPerLitre === null
            ? "No priced fills yet"
            : `Latest · ${formatSen(t.avgSenPerLitre)} average`
        }
      />
      <Tile
        label="Fuel per km"
        value={t.fuelSenPerKm === null ? "—" : formatSen(t.fuelSenPerKm)}
        note={`Fuel only, ${t.measuredCount === 0 ? "no measured distance" : "all fills"}`}
      />
      <Tile
        label="Cost per km"
        value={vehicle.senPerKm === null ? "—" : formatSen(vehicle.senPerKm)}
        note="Fuel and servicing, last 12 months — as on the card"
      />
    </div>
  );
}

/**
 * Where the vehicle's money went, over the same 12 months as the card.
 *
 * A stacked bar rather than a pie: the reader is comparing parts against a
 * whole they already know the size of, and the total is stated in words
 * alongside. There is a 2px gap between segments so two adjacent slices of
 * similar length do not read as one.
 */
function SpendPanel({
  slices,
  totalSen,
  months,
}: {
  slices: SpendSlice[];
  totalSen: number;
  months: number;
}) {
  return (
    <div className="rounded-xl border border-edge bg-surface p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="font-semibold text-ink">Spend</h3>
        <span className="text-sm tabular-nums text-ink-muted">
          {formatSen(totalSen)} over {months} months
        </span>
      </div>

      {slices.length === 0 ? (
        <p className="mt-4 text-sm text-ink-muted">
          Nothing attributed to this vehicle in the last {months} months.
        </p>
      ) : (
        <>
          <div className="mt-4 flex h-3 w-full gap-0.5 overflow-hidden rounded-full">
            {slices.map((s) => (
              <span
                key={s.label}
                aria-hidden
                className={s.isFuel ? "bg-ink" : "bg-ink-faint"}
                style={{ width: `${(s.amountSen / totalSen) * 100}%` }}
              />
            ))}
          </div>

          <ul className="mt-4 flex flex-col gap-2">
            {slices.map((s) => (
              <li key={s.label} className="flex items-center justify-between gap-3 text-sm">
                <span className="flex min-w-0 items-center gap-2">
                  <span
                    aria-hidden
                    className={
                      "h-2.5 w-2.5 shrink-0 rounded-sm " +
                      (s.isFuel ? "bg-ink" : "bg-ink-faint")
                    }
                  />
                  <span className="truncate text-ink">{s.label}</span>
                  <span className="shrink-0 text-xs text-ink-faint">
                    {s.txnCount} {s.txnCount === 1 ? "entry" : "entries"}
                  </span>
                </span>
                <span className="shrink-0 tabular-nums text-ink">
                  {formatSen(s.amountSen)}
                </span>
              </li>
            ))}
          </ul>
        </>
      )}

      <p className="mt-4 text-xs text-ink-faint">
        The fuel slice comes from entries marked as a fill-up, not from a
        category &mdash; there is no fuel category, and every fuel entry here is
        Transportation.
      </p>
    </div>
  );
}

/**
 * Every fill, newest first. This is the table view that makes a suspicious
 * point on the chart explainable, and the accessible reading of the same data.
 */
function FillTable({ fills }: { fills: FuelFill[] }) {
  return (
    <div className="overflow-x-auto rounded-xl border border-edge bg-surface">
      <table className="w-full text-sm">
        <thead className="text-ink-muted">
          <tr className="border-b border-edge">
            <th className="px-3 py-3 text-left font-medium">Date</th>
            <th className="px-3 py-3 text-right font-medium">Odometer</th>
            <th className="px-3 py-3 text-right font-medium">Litres</th>
            <th className="px-3 py-3 text-right font-medium">Cost</th>
            <th className="px-3 py-3 text-right font-medium">RM/L</th>
            <th className="px-3 py-3 text-right font-medium">L/100km</th>
          </tr>
        </thead>
        <tbody>
          {fills.map((f) => {
            const perLitre = senPerLitre(f.amountSen, f.litresMilli);
            return (
              <tr key={f.id} className="border-b border-edge last:border-0">
                <td className="px-3 py-3 text-ink">{f.filledOn}</td>
                <td className="px-3 py-3 text-right tabular-nums text-ink">
                  {f.readingKm.toLocaleString("en-MY")}
                </td>
                <td className="px-3 py-3 text-right tabular-nums text-ink">
                  {fromQuantityMilli(f.litresMilli).toFixed(2)}
                  {f.isFullTank === 0 && (
                    <span className="ml-2 rounded bg-inset px-1.5 py-0.5 text-xs text-ink-faint">
                      part
                    </span>
                  )}
                </td>
                {/*
                  A dash here means the money is not this ledger's -- a fill a
                  garage co-member paid for, or one logged with no entry behind
                  it. Deliberately indistinguishable: saying which would leak
                  that someone else has an entry.
                */}
                <td className="px-3 py-3 text-right tabular-nums text-ink-muted">
                  {f.amountSen === null ? (
                    <span className="text-ink-faint">&mdash;</span>
                  ) : (
                    formatSen(f.amountSen)
                  )}
                </td>
                <td className="px-3 py-3 text-right tabular-nums text-ink-muted">
                  {perLitre === null ? (
                    <span className="text-ink-faint">&mdash;</span>
                  ) : (
                    formatSen(perLitre)
                  )}
                </td>
                {/*
                  A dash is the honest answer twice over: the first full fill
                  has no previous one to measure from, and a part fill is
                  counted towards the next full tank rather than on its own.
                */}
                <td className="px-3 py-3 text-right tabular-nums text-ink">
                  {f.lPer100km === null ? (
                    <span className="text-ink-faint">&mdash;</span>
                  ) : (
                    f.lPer100km.toFixed(1)
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
