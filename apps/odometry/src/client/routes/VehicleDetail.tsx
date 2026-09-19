import { useState } from "react";
import { useParams } from "react-router-dom";
import {
  useVehicle,
  useMaintenance,
  useDashboard,
  useServices,
  useFuel,
  useRenewalStatus,
} from "../api/hooks";
import { Page, AppHeader, STICKY_UNDER_BAR_AND_CRUMB } from "../components/Layout";
import { MaintenanceList } from "../components/MaintenanceList";
import { ScheduleTable } from "../components/ScheduleTable";
import { ServiceHistory } from "../components/ServiceHistory";
import { FuelHistory } from "../components/FuelHistory";
import { ServiceSheet } from "../components/ServiceSheet";
import { VehicleSheet } from "../components/VehicleSheet";
import { VehicleSpec } from "../components/VehicleSpec";
import { GrantCard } from "../components/GrantCard";
import { RenewalsPanel } from "../components/RenewalsPanel";
import { TabBar } from "../components/TabBar";
import { formatKm } from "../lib/format";

type Tab = "maintenance" | "schedule" | "history" | "renewals" | "fuel";

/**
 * The top switcher: the vehicle's own record, one card at a time. Details
 * opens by default; the grant (added 2026-09-19) moved behind its own tab so
 * the top of the page stays one card tall.
 */
type TopTab = "details" | "grant";

const TOP_TABS: { value: TopTab; label: string }[] = [
  { value: "details", label: "Details" },
  { value: "grant", label: "Grant" },
];

/**
 * Spec 8.2. Two independent switchers: Details | Grant for the vehicle's own
 * record, and Maintenance | Schedule | Service history | Renewals | Fuel for everything
 * logged against it. Maintenance stays visible on arrival without a click.
 */
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
  const renewals = useRenewalStatus(id);
  const [tab, setTab] = useState<Tab>("maintenance");
  const [topTab, setTopTab] = useState<TopTab>("details");

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
          {/* Not sticky, unlike the switcher below: only one of the two may
              pin under the header, and the lower one is the long list. */}
          <div className="border-b border-edge">
            <TabBar tabs={TOP_TABS} value={topTab} onChange={setTopTab} />
          </div>
          {/* GrantCard mounts only on its tab, so the grant files are fetched
              only when someone looks at them. */}
          {vehicle.data && topTab === "details" && (
            <VehicleSpec vehicle={vehicle.data} onEdit={() => setEditing(true)} />
          )}
          {vehicle.data && topTab === "grant" && <GrantCard vehicle={vehicle.data} />}
        </section>

        {/*
          A switcher, not two stacked sections.
          
          Once a vehicle tracks forty parts the maintenance grid is roughly
          2,500px tall, and service history sat below all of it -- reachable
          only by scrolling past every tile. Anchor links would fix getting
          there and not getting back. Spec 8.2 already calls for five sections
          on this page (Costs still to come), so the switcher is
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
          <TabBar
            tabs={[
              { value: "maintenance", label: "Maintenance", count: maintenance.data?.length ?? 0 },
              // What the maintenance tab is measured against: every part that
              // fits, and the owner's interval for each (2026-09-20).
              { value: "schedule", label: "Schedule" },
              { value: "history", label: "Service history", count: services.data?.length ?? 0 },
              // Active records only -- one per type, not the history.
              { value: "renewals", label: "Renewals", count: renewals.data?.length ?? 0 },
              { value: "fuel", label: "Fuel", count: fuel.data?.length ?? 0 },
            ]}
            value={tab}
            onChange={setTab}
          />
        </div>

        {tab === "maintenance" && (
          <MaintenanceList
            rows={maintenance.data ?? []}
            onEditSchedule={() => setTab("schedule")}
          />
        )}
        {tab === "schedule" && <ScheduleTable vehicleId={id} />}
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
        {tab === "renewals" && <RenewalsPanel vehicleId={id} />}
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
