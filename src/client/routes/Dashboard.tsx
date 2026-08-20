import { useState } from "react";
import { Link } from "react-router-dom";
import { useDashboard, type VehicleCard } from "../api/hooks";
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

  if (isLoading) return <p className="p-4 text-stone-500">Loading&hellip;</p>;
  if (isError || !data) return <p className="p-4 text-red-700">Could not load your fleet.</p>;

  return (
    <div className="mx-auto max-w-lg p-4 pb-24">
      <h1 className="text-2xl font-semibold">Fleet</h1>

      {data.staleOdometers.length > 0 && (
        // Spec 8.1 / 11.7: every projection decays silently without fresh
        // readings, so staleness is surfaced before the numbers go wrong
        // rather than after the user notices they cannot be trusted.
        <div className="mt-4 rounded-xl bg-amber-50 p-3 text-sm text-amber-900">
          {data.staleOdometers.map((s) => (
            <p key={s.vehicleId}>
              {s.nickname}&rsquo;s odometer is {s.daysSince} days old. Projections are
              drifting.
            </p>
          ))}
        </div>
      )}

      <section className="mt-6">
        <h2 className="text-sm font-medium uppercase tracking-wide text-stone-500">
          Needs attention
        </h2>

        {data.attention.length === 0 ? (
          // Empty states guide rather than showing a blank table (spec 9).
          <p className="mt-3 rounded-xl bg-white p-4 text-stone-600 ring-1 ring-stone-200">
            Nothing is due. Add a service record when you next have work done, and this
            list will start filling itself in.
          </p>
        ) : (
          <ul className="mt-3 space-y-2">
            {data.attention.map((item, i) => (
              <li
                key={item.kind + item.vehicleId + item.label + i}
                className="rounded-xl bg-white p-3 ring-1 ring-stone-200"
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="truncate font-medium">{item.label}</p>
                    <p className="text-sm text-stone-600">{item.nickname}</p>
                  </div>
                  <StatusPill status={item.status} />
                </div>
                <p className="mt-2 text-sm text-stone-700">
                  {relativeDays(item.daysRemaining)}
                  {item.dueDate && <span className="text-stone-500"> &middot; {item.dueDate}</span>}
                  {item.lowConfidence && <span className="text-stone-500"> &middot; estimated</span>}
                </p>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="mt-8">
        <div className="flex items-baseline justify-between">
          <h2 className="text-sm font-medium uppercase tracking-wide text-stone-500">Vehicles</h2>
          {data.vehicles.length > 0 && (
            <button onClick={() => setAdding(true)} className="text-sm font-medium underline">
              Add
            </button>
          )}
        </div>

        {data.vehicles.length === 0 && (
          // Without this the heading sits above an empty list, which reads as
          // a broken screen rather than an empty one (spec 9).
          <div className="mt-3 rounded-xl bg-white p-4 ring-1 ring-stone-200">
            <p className="text-stone-600">
              No vehicles yet. Add your first one and its maintenance schedule is built
              from the seeded defaults.
            </p>
            <button
              onClick={() => setAdding(true)}
              className="mt-4 w-full rounded-xl bg-stone-900 py-3 font-medium text-white"
            >
              Add a vehicle
            </button>
          </div>
        )}

        <ul className="mt-3 space-y-2">
          {data.vehicles.map((v) => (
            <li key={v.id} className="rounded-xl bg-white p-3 ring-1 ring-stone-200">
              <div className="flex items-start justify-between gap-2">
                <Link to={"/vehicles/" + v.id} className="min-w-0">
                  <p className="truncate font-medium">{v.nickname}</p>
                  <p className="text-sm text-stone-600">
                    {formatKm(v.currentOdometerKm)}
                    {v.odometerAgeDays !== null && (
                      <span className="text-stone-500"> &middot; {odometerAge(v.odometerAgeDays)}</span>
                    )}
                  </p>
                </Link>
                <StatusPill status={v.worstStatus} />
              </div>
              <button
                onClick={() => setLogging(v)}
                className="mt-3 w-full rounded-lg bg-stone-100 py-2 text-sm font-medium"
              >
                Update odometer
              </button>
            </li>
          ))}
        </ul>
      </section>

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
    </div>
  );
}

function odometerAge(days: number): string {
  if (days === 0) return "today";
  if (days === 1) return "yesterday";
  return days + " days ago";
}
