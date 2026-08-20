import { useParams, Link } from "react-router-dom";
import { useVehicle, useMaintenance } from "../api/hooks";
import { StatusPill } from "../components/StatusPill";
import { relativeDays, formatKm } from "../lib/format";

/** Spec 8.2, Phase 1 slice: overview plus the maintenance table. */
export default function VehicleDetail() {
  const { id = "" } = useParams();
  const vehicle = useVehicle(id);
  const maintenance = useMaintenance(id);

  if (vehicle.isLoading) return <p className="p-4 text-stone-500">Loading&hellip;</p>;
  if (vehicle.isError) return <p className="p-4 text-red-700">Vehicle not found.</p>;

  return (
    <div className="mx-auto max-w-lg p-4 pb-24">
      <Link to="/" className="text-sm text-stone-500">
        &larr; Fleet
      </Link>
      <h1 className="mt-2 text-2xl font-semibold">{vehicle.data?.nickname}</h1>
      <p className="text-stone-600">{formatKm(vehicle.data?.currentOdometerKm ?? null)}</p>

      <section className="mt-6">
        <h2 className="text-sm font-medium uppercase tracking-wide text-stone-500">
          Maintenance
        </h2>
        <ul className="mt-3 space-y-2">
          {maintenance.data?.map((row) => (
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
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
