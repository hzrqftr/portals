import { Sheet } from "@portals/core/client";
import { formatSen, fromQuantityMilli } from "@portals/core";
import { senPerLitre } from "@shared/fuelRules";
import { ConsumptionChart } from "./ConsumptionChart";
import {
  useVehicleFuel,
  type FuelFill,
  type VehicleConsumption,
} from "../api/hooks";

/**
 * The drill-down behind a row of the fuel consumption card.
 *
 * Consumption, the price paid at the pump, the trend, and every fill. The
 * cost-per-km tiles, the 12-month spend breakdown and the distance line were
 * removed on 2026-09-19 with the card they reconciled against: the owner reads
 * consumption, and those were the figures that leaned on the raw odometer
 * range rather than on full-tank segments.
 *
 * The prices here are this ledger's own, joined behind `t.ledger_id = ?` on
 * the server -- a garage co-member opening the same vehicle sees the litres
 * and no ringgit.
 */
export function VehicleFuelSheet({
  vehicle,
  onClose,
}: {
  vehicle: VehicleConsumption;
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
          <Tiles data={data} />

          <ConsumptionChart fills={data.fills} />

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

function Tiles({ data }: { data: NonNullable<ReturnType<typeof useVehicleFuel>["data"]> }) {
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
