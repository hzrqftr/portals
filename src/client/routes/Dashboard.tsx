import { useState } from "react";
import { Link } from "react-router-dom";
import { useDashboard, type VehicleCard } from "../api/hooks";
import { Page, AppHeader, SectionTitle } from "../components/Layout";
import { VehicleTypeIcon } from "../lib/vehicleType";
import { StatusPill } from "../components/StatusPill";
import { OdometerSheet } from "../components/OdometerSheet";
import { VehicleSheet } from "../components/VehicleSheet";
import { relativeDays, formatKm } from "../lib/format";

/**
 * Spec 1.1: answer "what needs attention?" within five seconds of opening
 * the app. Everything on this screen serves that; nothing else belongs here.
 */
export default function Dashboard() {
  const { data, isLoading, isError } = useDashboard();
  const [logging, setLogging] = useState<VehicleCard | null>(null);
  const [adding, setAdding] = useState(false);

  if (isLoading) return <p className="p-6 text-ink-muted">Loading&hellip;</p>;
  if (isError || !data)
    return <p className="p-6 text-status-overdue-fg">Could not load your fleet.</p>;

  return (
    <>
      <AppHeader />
      <Page>
        <h1 className="mt-6 text-3xl font-semibold tracking-tight">Your Vehicles</h1>

        {data.staleOdometers.length > 0 && (
          // Spec 8.1 / 11.7: every projection decays silently without fresh
          // readings, so staleness is surfaced before the numbers go wrong
          // rather than after the user notices they cannot be trusted.
          <div className="mt-4 rounded-xl border border-status-soon-fg/25 bg-status-soon-bg p-3 text-sm text-status-soon-fg">
            {data.staleOdometers.map((s) => (
              <p key={s.vehicleId}>
                {s.nickname}&rsquo;s odometer is {s.daysSince} days old. Projections are
                drifting.
              </p>
            ))}
          </div>
        )}

        <section className="mt-8">
          <SectionTitle>Needs attention</SectionTitle>

          {data.attention.length === 0 ? (
            // Empty states guide rather than showing a blank table (spec 9).
            <p className="mt-3 rounded-xl border border-edge bg-surface p-4 text-ink-muted">
              Nothing is due. Add a service record when you next have work done, and this
              list will start filling itself in.
            </p>
          ) : (
            <ul className="mt-3 grid grid-cols-1 gap-3 lg:grid-cols-2">
              {data.attention.map((item, i) => (
                <li
                  key={item.kind + item.vehicleId + item.label + i}
                  className="rounded-xl border border-edge bg-surface p-3"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="truncate font-medium">{item.label}</p>
                      <p className="text-sm text-ink-muted">{item.nickname}</p>
                    </div>
                    <StatusPill status={item.status} />
                  </div>
                  <p className="mt-2 text-sm text-ink-muted">
                    {relativeDays(item.daysRemaining)}
                    {item.dueDate && <span className="text-ink-faint"> &middot; {item.dueDate}</span>}
                    {item.lowConfidence && <span className="text-ink-faint"> &middot; estimated</span>}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="mt-10">
          <div className="flex items-baseline justify-between">
            <SectionTitle>Vehicles</SectionTitle>
            {data.vehicles.length > 0 && (
              <button
                onClick={() => setAdding(true)}
                className="text-sm font-medium text-ink-muted underline hover:text-ink"
              >
                Add
              </button>
            )}
          </div>

          {data.vehicles.length === 0 ? (
            // Without this the heading sits above an empty list, which reads as
            // a broken screen rather than an empty one (spec 9).
            <div className="mt-3 max-w-md rounded-xl border border-edge bg-surface p-4">
              <p className="text-ink-muted">
                No vehicles yet. Add your first one and its maintenance schedule is built
                from the seeded defaults.
              </p>
              <button
                onClick={() => setAdding(true)}
                className="mt-4 w-full rounded-xl bg-ink py-3 font-medium text-page"
              >
                Add a vehicle
              </button>
            </div>
          ) : (
            <ul className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {data.vehicles.map((v) => (
                <li key={v.id} className="rounded-xl border border-edge bg-surface p-4">
                  <div className="flex items-start justify-between gap-2">
                    <Link to={"/vehicles/" + v.id} className="min-w-0 hover:text-ink">
                      <p className="flex items-center gap-2 truncate text-lg font-medium">
                        <span className="shrink-0 text-ink-faint">
                          <VehicleTypeIcon type={v.vehicleType} className="h-4 w-4" />
                        </span>
                        <span className="truncate">{v.nickname}</span>
                      </p>
                      <p className="text-sm text-ink-muted">
                        {formatKm(v.currentOdometerKm)}
                        {v.odometerAgeDays !== null && (
                          <span className="text-ink-faint">
                            {" "}
                            &middot; {odometerAge(v.odometerAgeDays)}
                          </span>
                        )}
                      </p>
                    </Link>
                    <StatusPill status={v.worstStatus} />
                  </div>
                  {/* Full-width on purpose at every size: this is the
                      petrol-pump target (spec 8.5). */}
                  <button
                    onClick={() => setLogging(v)}
                    className="mt-4 w-full rounded-lg border border-edge bg-inset py-2.5 text-sm font-medium text-ink-muted hover:text-ink"
                  >
                    Update odometer
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
      </Page>

      {logging && (
        <OdometerSheet
          vehicleId={logging.id}
          nickname={logging.nickname}
          currentKm={logging.currentOdometerKm}
          today={data.today}
          onClose={() => setLogging(null)}
        />
      )}
      {adding && <VehicleSheet onClose={() => setAdding(false)} />}
    </>
  );
}

/** Relative first, absolute second (spec 9). */
function odometerAge(days: number): string {
  if (days === 0) return "today";
  if (days === 1) return "yesterday";
  if (days < 30) return `${days} days ago`;
  return `about ${Math.round(days / 30)} months ago`;
}
