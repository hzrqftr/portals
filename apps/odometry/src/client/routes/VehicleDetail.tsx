import { useState } from "react";
import { useParams } from "react-router-dom";
import { useVehicle, useMaintenance, useDashboard, useServices, useFuel } from "../api/hooks";
import { Page, AppHeader, SectionTitle, STICKY_UNDER_BAR_AND_CRUMB } from "../components/Layout";
import { MaintenanceList } from "../components/MaintenanceList";
import { ServiceHistory } from "../components/ServiceHistory";
import { FuelHistory } from "../components/FuelHistory";
import { ServiceSheet } from "../components/ServiceSheet";
import { VehicleSheet } from "../components/VehicleSheet";
import { VehicleSpec } from "../components/VehicleSpec";
import { formatKm } from "../lib/format";

type Tab = "maintenance" | "history" | "fuel";

const TABS: { value: Tab; label: string }[] = [
  { value: "maintenance", label: "Maintenance" },
  { value: "history", label: "Service history" },
  { value: "fuel", label: "Fuel" },
];

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
  const [editing, setEditing] = useState(false);
  const services = useServices(id);
  const fuel = useFuel(id);
  const [tab, setTab] = useState<Tab>("maintenance");

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
          <SectionTitle>Details</SectionTitle>
          {vehicle.data && (
            <VehicleSpec vehicle={vehicle.data} onEdit={() => setEditing(true)} />
          )}
        </section>

        {/*
          A switcher, not two stacked sections.
          
          Once a vehicle tracks forty parts the maintenance grid is roughly
          2,500px tall, and service history sat below all of it -- reachable
          only by scrolling past every tile. Anchor links would fix getting
          there and not getting back. Spec 8.2 already calls for five sections
          on this page (Renewals and Costs still to come), so the switcher is
          the shape this page was heading for anyway.
        */}
        {/*
          Pinned under the header, which on this page is TWO rows: the bar plus
          the breadcrumb. The offset is imported rather than written as a
          number, because the two have to move together and only one of them is
          visible from here.
        */}
        <div
          className={
            `sticky ${STICKY_UNDER_BAR_AND_CRUMB} z-20 -mx-4 mt-10 border-b border-edge ` +
            "bg-page/90 px-4 backdrop-blur sm:-mx-6 sm:px-6 lg:-mx-8 lg:px-8"
          }
        >
          <div className="flex gap-1">
            {TABS.map((t) => (
              <button
                key={t.value}
                onClick={() => setTab(t.value)}
                aria-current={tab === t.value ? "page" : undefined}
                className={
                  "-mb-px border-b-2 px-3 py-3 text-sm transition " +
                  (tab === t.value
                    ? "border-ink font-medium text-ink"
                    : "border-transparent text-ink-muted hover:text-ink")
                }
              >
                {t.label}
                <span className="ml-1.5 text-xs text-ink-faint">
                  {t.value === "maintenance"
                    ? (maintenance.data?.length ?? 0)
                    : t.value === "history"
                      ? (services.data?.length ?? 0)
                      : (fuel.data?.length ?? 0)}
                </span>
              </button>
            ))}
          </div>
        </div>

        {tab === "maintenance" && (
          <MaintenanceList
            vehicleId={id}
            vehicleType={vehicle.data?.vehicleType ?? "car"}
            rows={maintenance.data ?? []}
          />
        )}
        {tab === "history" && (
          <section className="mt-4">
            {today && (
              <ServiceHistory
                vehicleId={id}
                vehicleType={vehicle.data?.vehicleType ?? "car"}
                nickname={vehicle.data?.nickname ?? ""}
                today={today}
              />
            )}
          </section>
        )}
        {tab === "fuel" && (
          <section className="mt-4">
            <FuelHistory vehicleId={id} />
          </section>
        )}
      </Page>

      {editing && vehicle.data && (
        <VehicleSheet vehicle={vehicle.data} onClose={() => setEditing(false)} />
      )}

      {logging && today && (
        <ServiceSheet
          vehicleId={id}
          vehicleType={vehicle.data?.vehicleType ?? "car"}
          nickname={vehicle.data?.nickname ?? ""}
          currentKm={vehicle.data?.currentOdometerKm ?? 0}
          today={today}
          onClose={() => setLogging(false)}
        />
      )}
    </>
  );
}
