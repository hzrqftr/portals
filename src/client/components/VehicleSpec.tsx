import type { VehicleDetails } from "../api/hooks";
import { formatKm } from "../lib/format";

/**
 * The vehicle's own spec, on the vehicle's own page.
 *
 * These columns have existed since the first migration and the create form
 * has always asked for them -- but nothing ever showed them back, so make,
 * model, year and fuel were write-once and invisible the moment the vehicle
 * was saved. "What did I say this car runs on?" had no answer in the app.
 *
 * It reads as a spec sheet rather than a form: the common case is looking
 * something up, not changing it, and editing is one button away.
 */

const FUEL: Record<string, string> = {
  petrol: "Petrol",
  diesel: "Diesel",
  hybrid: "Hybrid",
  ev: "Electric",
};

const GEARBOX: Record<string, string> = { manual: "Manual", auto: "Automatic" };

export function VehicleSpec({
  vehicle,
  onEdit,
}: {
  vehicle: VehicleDetails;
  onEdit: () => void;
}) {
  const rows: [string, string | null][] = [
    ["Make", vehicle.make],
    ["Model", vehicle.model],
    ["Year", vehicle.year === null ? null : String(vehicle.year)],
    ["Fuel", vehicle.fuelType === null ? null : (FUEL[vehicle.fuelType] ?? vehicle.fuelType)],
    [
      "Transmission",
      vehicle.transmission === null
        ? null
        : (GEARBOX[vehicle.transmission] ?? vehicle.transmission),
    ],
    ["Plate", vehicle.plate],
    ["Odometer", formatKm(vehicle.currentOdometerKm)],
  ];

  const unset = rows.filter(([, v]) => v === null).length;

  return (
    <div className="mt-3 rounded-xl border border-edge bg-surface p-4">
      <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2 lg:grid-cols-3">
        {rows.map(([label, value]) => (
          <div key={label} className="flex justify-between gap-4 border-b border-edge/50 pb-2">
            <dt className="text-ink-faint">{label}</dt>
            {/* An unset field is shown, not hidden. A spec sheet with the
                blanks removed looks complete when it is not, and the gap is
                exactly what the owner came here to fill in. */}
            <dd className={value === null ? "text-ink-faint" : "text-ink"}>
              {value ?? "Not set"}
            </dd>
          </div>
        ))}
      </dl>

      <div className="mt-4 flex flex-wrap items-center gap-3">
        <button
          onClick={onEdit}
          className="rounded-lg border border-edge px-3 py-2 text-sm text-ink-muted hover:text-ink"
        >
          Edit details
        </button>
        {unset > 0 && (
          <p className="text-xs text-ink-faint">
            {unset} {unset === 1 ? "field is" : "fields are"} not set.
          </p>
        )}
      </div>

      <p className="mt-3 text-xs text-ink-faint">
        Fuel type decides which parts this vehicle tracks by default. Which parts it
        actually tracks &mdash; a timing belt rather than a chain, say &mdash; is set per
        part in the Maintenance tab.
      </p>
    </div>
  );
}
