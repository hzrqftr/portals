import { useState } from "react";
import { useServices, SERVICE_TYPES, type ServiceRecord } from "../api/hooks";
import { formatSen, fromQuantityMilli } from "@portals/core";
import { formatKm } from "../lib/format";

/**
 * Service history, reverse chronological, expandable to line items
 * (spec 8.2). Warranty is shown here and nowhere else: it is a fact to look
 * up when a part fails, not a deadline to act on, so it gets a badge rather
 * than a place in the attention list.
 */
export function ServiceHistory({ vehicleId, today }: { vehicleId: string; today: string }) {
  const services = useServices(vehicleId);

  if (services.isLoading) return <p className="mt-3 text-sm text-ink-faint">Loading&hellip;</p>;
  if (!services.data?.length) {
    return (
      <p className="mt-3 text-sm text-ink-muted">
        Nothing logged yet. Every maintenance clock stays &ldquo;not set up&rdquo; until a
        service records the part that starts it.
      </p>
    );
  }

  return (
    <ul className="mt-3 space-y-2">
      {services.data.map((record) => (
        <RecordRow key={record.id} record={record} today={today} />
      ))}
    </ul>
  );
}

function RecordRow({ record, today }: { record: ServiceRecord; today: string }) {
  const [open, setOpen] = useState(false);
  const typeLabel = SERVICE_TYPES.find((t) => t.value === record.serviceType)?.label;

  return (
    <li className="rounded-xl border border-edge bg-surface p-3">
      <button onClick={() => setOpen(!open)} className="flex w-full items-start gap-2 text-left">
        <div className="min-w-0 flex-1">
          <p className="font-medium">
            {record.servicedOn}
            {typeLabel && <span className="text-ink-faint"> &middot; {typeLabel}</span>}
          </p>
          <p className="text-sm text-ink-muted">
            {formatKm(record.odometerKm)}
            {record.workshopName && <> &middot; {record.workshopName}</>}
          </p>
        </div>
        <span className="shrink-0 tabular-nums">{formatSen(record.totalCost)}</span>
      </button>

      {open && (
        <div className="mt-3 border-t border-edge pt-3">
          {record.items.length === 0 ? (
            <p className="text-sm text-ink-muted">
              No parts listed, so this visit reset no maintenance clocks.
            </p>
          ) : (
            <ul className="space-y-2">
              {record.items.map((item) => (
                <li key={item.id} className="text-sm">
                  <div className="flex justify-between gap-2">
                    <span className="font-medium">{item.partName}</span>
                    <span className="tabular-nums text-ink-muted">
                      {formatSen(item.lineTotalCost)}
                    </span>
                  </div>
                  <p className="text-ink-muted">
                    {[
                      item.brand,
                      item.spec,
                      item.quantityMilli !== 1000
                        ? `${fromQuantityMilli(item.quantityMilli)}×`
                        : null,
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </p>
                  {item.nextDueKm !== null && (
                    <p className="text-ink-faint">
                      Next due at {formatKm(item.nextDueKm)} &mdash; set on this visit
                    </p>
                  )}
                  {item.warrantyExpiresOn && <WarrantyBadge until={item.warrantyExpiresOn} today={today} />}
                </li>
              ))}
            </ul>
          )}
          <CostBreakdown record={record} />

          {record.notes && <p className="mt-2 text-sm text-ink-muted">{record.notes}</p>}
        </div>
      )}
    </li>
  );
}

/**
 * Parts, labour, total. Spelled out rather than left as one figure, because
 * "what did the fitting cost me" is the question the owner actually asks --
 * they often buy the parts themselves and pay a workshop for the work alone.
 *
 * Shown only when something was recorded. A visit with no costs entered gets
 * no breakdown rather than three RM 0.00 lines.
 */
function CostBreakdown({ record }: { record: ServiceRecord }) {
  if (record.totalCost === null) return null;

  return (
    <dl className="mt-3 space-y-1 border-t border-edge pt-2 text-sm">
      {record.partsCost !== null && (
        <Line label="Parts" value={record.partsCost} />
      )}
      {record.labourCost !== null && <Line label="Labour" value={record.labourCost} />}
      <Line label="Total" value={record.totalCost} strong />
    </dl>
  );
}

function Line({ label, value, strong }: { label: string; value: number; strong?: boolean }) {
  return (
    <div className={"flex justify-between gap-4" + (strong ? " font-medium text-ink" : "")}>
      <dt className={strong ? "" : "text-ink-faint"}>{label}</dt>
      <dd className="tabular-nums">{formatSen(value)}</dd>
    </div>
  );
}

/**
 * Calendar-date comparison, not a Date round trip. `today` comes from the
 * server already computed in the owner's timezone, and both strings are
 * YYYY-MM-DD, so a lexical compare is the correct one (invariant 5).
 */
function WarrantyBadge({ until, today }: { until: string; today: string }) {
  const expired = until < today;
  return (
    <span
      className={
        "mt-1 inline-flex rounded-full px-2 py-0.5 text-xs " +
        (expired ? "bg-inset text-ink-faint" : "bg-sky-950 text-sky-300")
      }
    >
      {expired ? `Warranty ended ${until}` : `Under warranty until ${until}`}
    </span>
  );
}
