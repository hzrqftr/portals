import { useState } from "react";
import { useParams, Link } from "react-router-dom";
import { useVehicle, useMaintenance, useDashboard } from "../api/hooks";
import { MaintenanceList } from "../components/MaintenanceList";
import { ServiceHistory } from "../components/ServiceHistory";
import { ServiceSheet } from "../components/ServiceSheet";
import { formatKm } from "../lib/format";

/** Spec 8.2: overview, maintenance, and service history. */
export default function VehicleDetail() {
  const { id = "" } = useParams();
  const vehicle = useVehicle(id);
  const maintenance = useMaintenance(id);
  // `today` is the owner's calendar date, computed server-side from their
  // timezone. Never new Date() here: the browser's idea of today and the
  // one every due date was derived from must be the same day (invariant 5).
  const dashboard = useDashboard();
  const [logging, setLogging] = useState(false);

  if (vehicle.isLoading) return <p className="p-4 text-stone-500">Loading&hellip;</p>;
  if (vehicle.isError) return <p className="p-4 text-red-700">Vehicle not found.</p>;

  const today = dashboard.data?.today;

  return (
    <div className="mx-auto max-w-lg p-4 pb-24">
      <Link to="/" className="text-sm text-stone-500">
        &larr; Fleet
      </Link>
      <h1 className="mt-2 text-2xl font-semibold">{vehicle.data?.nickname}</h1>
      <p className="text-stone-600">{formatKm(vehicle.data?.currentOdometerKm ?? null)}</p>

      <button
        onClick={() => setLogging(true)}
        disabled={!today}
        className="mt-4 w-full rounded-xl bg-stone-900 py-3 font-medium text-white disabled:opacity-40"
      >
        Log a service
      </button>

      <section className="mt-6">
        <h2 className="text-sm font-medium uppercase tracking-wide text-stone-500">
          Maintenance
        </h2>
        <MaintenanceList vehicleId={id} rows={maintenance.data ?? []} />
      </section>

      <section className="mt-8">
        <h2 className="text-sm font-medium uppercase tracking-wide text-stone-500">
          Service history
        </h2>
        {today && <ServiceHistory vehicleId={id} today={today} />}
      </section>

      {logging && today && (
        <ServiceSheet
          vehicleId={id}
          nickname={vehicle.data?.nickname ?? ""}
          currentKm={vehicle.data?.currentOdometerKm ?? 0}
          today={today}
          onClose={() => setLogging(false)}
        />
      )}
    </div>
  );
}
