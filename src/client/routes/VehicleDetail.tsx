import { useState } from "react";
import { useParams } from "react-router-dom";
import { useVehicle, useMaintenance, useDashboard } from "../api/hooks";
import { Page, AppHeader, SectionTitle } from "../components/Layout";
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

  if (vehicle.isLoading) return <p className="p-6 text-ink-muted">Loading&hellip;</p>;
  if (vehicle.isError) return <p className="p-6 text-status-overdue-fg">Vehicle not found.</p>;

  const today = dashboard.data?.today;

  return (
    <>
      <AppHeader crumb={vehicle.data?.nickname} />
      <Page>
        {/* Title and primary action sit on one row once there is width for
            it, and stack on a phone where the button stays a full-width
            thumb target (spec 8.5). */}
        <div className="mt-6 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h1 className="text-3xl font-semibold tracking-tight">{vehicle.data?.nickname}</h1>
            <p className="mt-1 text-ink-muted">
              {formatKm(vehicle.data?.currentOdometerKm ?? null)}
              {vehicle.data?.plate && (
                <span className="text-ink-faint"> &middot; {vehicle.data.plate}</span>
              )}
            </p>
          </div>
          <button
            onClick={() => setLogging(true)}
            disabled={!today}
            className="rounded-xl bg-ink px-6 py-3 font-medium text-page disabled:opacity-40 sm:w-auto"
          >
            Log a service
          </button>
        </div>

        <section className="mt-8">
          <SectionTitle>Maintenance</SectionTitle>
          <MaintenanceList vehicleId={id} rows={maintenance.data ?? []} />
        </section>

        <section className="mt-10">
          <SectionTitle>Service history</SectionTitle>
          {today && <ServiceHistory vehicleId={id} today={today} />}
        </section>
      </Page>

      {logging && today && (
        <ServiceSheet
          vehicleId={id}
          nickname={vehicle.data?.nickname ?? ""}
          currentKm={vehicle.data?.currentOdometerKm ?? 0}
          today={today}
          onClose={() => setLogging(false)}
        />
      )}
    </>
  );
}
