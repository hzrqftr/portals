import { useState } from "react";
import {
  useLogService,
  useMaintenance,
  usePartTypes,
  useServiceTemplates,
  SERVICE_TYPES,
  type ServiceItemDraft,
  type ServiceTypeName,
  type VehicleType,
} from "../api/hooks";
import { parseSen, toQuantityMilli, formatSen } from "@portals/core";
import { INPUT, Field, digitsOnly } from "@portals/core/client";
import { formatKm } from "../lib/format";
import { Sheet } from "@portals/core/client";
import { PartPicker } from "./PartPicker";
import { ServiceItemRow, type ItemDraft } from "./ServiceItemRow";

/**
 * Log a service. Spec 8.4 -- "the highest-friction flow, needing the most
 * care", and the one flow without which nothing else in the app has data.
 *
 * Two things here are not obvious from the layout:
 *
 * 1. "Next due at" is typed as an absolute odometer figure, because that is
 *    what the workshop sticker says, but it is SENT as an interval -- the gap
 *    from this service's odometer. The API never receives a due point, which
 *    is what keeps invariant 6 true structurally rather than by convention.
 * 2. Total cost is a separate field, not the sum of the lines. Labour and
 *    sundries are real money and are not parts, so the total legitimately
 *    exceeds the subtotal. Neither number is ever computed from the other.
 */
export function ServiceSheet({
  vehicleId,
  vehicleType,
  nickname,
  currentKm,
  today,
  onClose,
}: {
  vehicleId: string;
  vehicleType: VehicleType;
  nickname: string;
  currentKm: number;
  today: string;
  onClose: () => void;
}) {
  const partTypes = usePartTypes(vehicleType);
  const maintenance = useMaintenance(vehicleId);
  const templates = useServiceTemplates();
  const log = useLogService(vehicleId);

  const [servicedOn, setServicedOn] = useState(today);
  const [odometer, setOdometer] = useState(String(currentKm || ""));
  const [serviceType, setServiceType] = useState<ServiceTypeName | "">("");
  const [workshop, setWorkshop] = useState("");
  const [labourCost, setLabourCost] = useState("");
  const [notes, setNotes] = useState("");
  const [items, setItems] = useState<ItemDraft[]>([]);
  const [saved, setSaved] = useState<string[] | null>(null);

  const odo = odometer === "" ? null : Number(odometer);
  const nameOf = (id: string) => partTypes.data?.find((p) => p.id === id)?.name ?? "Part";

  /** The vehicle's own interval wins over the part-type default. */
  function defaultNextDueKm(partTypeId: string): number | null {
    if (odo === null) return null;
    const row = maintenance.data?.find((r) => r.part_type_id === partTypeId);
    const interval = row
      ? row.interval_km
      : (partTypes.data?.find((p) => p.id === partTypeId)?.default_interval_km ?? null);
    return interval === null ? null : odo + interval;
  }

  function addPart(partTypeId: string) {
    setItems((prev) =>
      prev.some((i) => i.partTypeId === partTypeId)
        ? prev
        : [
            ...prev,
            {
              key: crypto.randomUUID(),
              partTypeId,
              partName: nameOf(partTypeId),
              brand: "",
              spec: "",
              quantity: "",
              unitCost: "",
              warrantyMonths: "",
              nextDueKm: "",
            },
          ],
    );
  }

  /**
   * Templates MERGE, never replace. Switching minor -> major after filling in
   * three lines must not throw that work away, and a part the user removed on
   * purpose must not silently reappear -- so the type change only ever adds
   * what is missing.
   */
  function chooseType(next: ServiceTypeName | "") {
    setServiceType(next);
    if (!next) return;
    for (const t of templates.data?.filter((t) => t.serviceType === next) ?? []) {
      addPart(t.partTypeId);
    }
  }

  // Sen throughout, rounded once per line (invariant 1). Mirrors the
  // line_total_cost generated column so the running total shown while typing
  // matches what the server computes on save, to the sen.
  const partsSubtotal = items.reduce((sum, i) => {
    const unit = parseSen(i.unitCost);
    const qty = Number(i.quantity) > 0 ? Number(i.quantity) : 1;
    return unit === null ? sum : sum + Math.round(unit * qty);
  }, 0);

  const labourSen = parseSen(labourCost);
  const grandTotal = partsSubtotal + (labourSen ?? 0);

  // The single headline the owner asked for, derived from the lines rather
  // than stored beside them: the soonest of whatever this visit set.
  const nextService = items
    .map((i) => (i.nextDueKm !== "" ? Number(i.nextDueKm) : defaultNextDueKm(i.partTypeId)))
    .filter((v): v is number => v !== null)
    .sort((a, b) => a - b)[0];

  const badItem = items.some((i) => {
    const typed = i.nextDueKm === "" ? null : Number(i.nextDueKm);
    return typed !== null && odo !== null && typed <= odo;
  });
  const canSave = odo !== null && Number.isFinite(odo) && odo >= 0 && !badItem;

  function save() {
    if (!canSave || odo === null) return;

    const drafts: ServiceItemDraft[] = items.map((i) => {
      const draft: ServiceItemDraft = {
        partTypeId: i.partTypeId,
        quantityMilli: Number(i.quantity) > 0 ? toQuantityMilli(Number(i.quantity)) : 1000,
      };
      if (i.brand.trim()) draft.brand = i.brand.trim();
      if (i.spec.trim()) draft.spec = i.spec.trim();
      const unit = parseSen(i.unitCost);
      if (unit !== null) draft.unitCost = unit;
      if (i.warrantyMonths !== "") draft.warrantyMonths = Number(i.warrantyMonths);

      // Absolute figure in, interval out -- and always, not only when it
      // differs from the default. Every service sets the schedule for its
      // part, so leaving the field at the pre-filled figure is an answer
      // ("same as before"), not an absence of one. Sending it every time is
      // what keeps one number in charge: the line item and the vehicle's
      // setting cannot drift apart if each service writes both.
      const due = i.nextDueKm === "" ? defaultNextDueKm(i.partTypeId) : Number(i.nextDueKm);
      if (due !== null && due > odo) {
        draft.intervalKmOverride = due - odo;
      }
      return draft;
    });


    log.mutate(
      {
        servicedOn,
        odometerKm: Math.round(odo),
        ...(serviceType ? { serviceType } : {}),
        ...(workshop.trim() ? { workshopName: workshop.trim() } : {}),
        ...(labourSen !== null ? { labourCost: labourSen } : {}),
        ...(notes.trim() ? { notes: notes.trim() } : {}),
        items: drafts,
      },
      { onSuccess: () => setSaved(items.map((i) => i.partName)) },
    );
  }

  return (
    <Sheet title={`Log service — ${nickname}`} onClose={onClose} wide>
      {saved ? (
        <SavedConfirmation parts={saved} onClose={onClose} />
      ) : (
        <>
          <h2 className="text-lg font-semibold">Log service &mdash; {nickname}</h2>

          <div className="grid grid-cols-2 gap-3">
            <Field label="Date">
              <input
                type="date"
                value={servicedOn}
                onChange={(e) => setServicedOn(e.target.value)}
                className={INPUT}
              />
            </Field>
            <Field label="Odometer (km)">
              <input
                type="text"
                inputMode="numeric"
                value={odometer}
                onChange={(e) => setOdometer(digitsOnly(e.target.value))}
                className={INPUT + " tabular-nums"}
              />
            </Field>
          </div>

          <Field label="Type of service">
            <select
              value={serviceType}
              onChange={(e) => chooseType(e.target.value as ServiceTypeName | "")}
              className={INPUT}
            >
              <option value="">Not specified</option>
              {SERVICE_TYPES.map((t) => (
                <option key={t.value} value={t.value}>
                  {t.label}
                </option>
              ))}
            </select>
          </Field>

          <Field label="Workshop">
            <input
              value={workshop}
              onChange={(e) => setWorkshop(e.target.value)}
              className={INPUT}
            />
          </Field>

          <h3 className="mt-6 text-sm font-medium uppercase tracking-wider text-ink-faint">
            Parts replaced
          </h3>
          {items.length === 0 ? (
            <p className="mt-2 text-sm text-ink-muted">
              None yet. A visit with no parts is a valid record &mdash; it just resets no
              maintenance clocks.
            </p>
          ) : (
            <>
              {nextService !== undefined && (
                <p className="mt-2 text-sm text-ink-muted">
                  Next service at <strong>{formatKm(nextService)}</strong>
                </p>
              )}
              <ul className="mt-2 space-y-2">
                {items.map((item) => (
                  <ServiceItemRow
                    key={item.key}
                    item={item}
                    partTypeCode={partTypes.data?.find((p) => p.id === item.partTypeId)?.code ?? ""}
                    odometerKm={odo}
                    defaultNextDueKm={defaultNextDueKm(item.partTypeId)}
                    onChange={(next) =>
                      setItems((prev) => prev.map((p) => (p.key === next.key ? next : p)))
                    }
                    onRemove={() =>
                      setItems((prev) => prev.filter((p) => p.key !== item.key))
                    }
                  />
                ))}
              </ul>
            </>
          )}

          <PartPicker
            partTypes={partTypes.data ?? []}
            maintenance={maintenance.data ?? []}
            exclude={items.map((i) => i.partTypeId)}
            onAdd={addPart}
          />

          <Field label="Labour (RM)">
            <input
              type="text"
              inputMode="decimal"
              value={labourCost}
              onChange={(e) => setLabourCost(e.target.value.replace(/[^0-9.]/g, ""))}
              placeholder="0.00"
              className={INPUT + " tabular-nums"}
            />
          </Field>
          <p className="mt-1 text-xs text-ink-faint">
            What the workshop charged for the work. Leave the part costs blank if you
            supplied the parts yourself.
          </p>

          {grandTotal > 0 && (
            // Shown, not typed. The total is parts + labour by definition, so
            // there is no third figure that can disagree with the other two.
            <dl className="mt-3 space-y-1 border-t border-edge pt-2 text-sm">
              <Total label="Parts" value={partsSubtotal} />
              <Total label="Labour" value={labourSen ?? 0} />
              <Total label="Total" value={grandTotal} strong />
            </dl>
          )}

          <Field label="Notes">
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={2}
              className={INPUT}
            />
          </Field>

          {log.isError && (
            <p className="mt-2 text-sm text-status-overdue-fg">{(log.error as Error).message}</p>
          )}

          <div className="mt-5 flex gap-3">
            <button
              onClick={onClose}
              className="flex-1 rounded-xl border border-edge py-3 font-medium text-ink-muted hover:text-ink"
            >
              Cancel
            </button>
            <button
              onClick={save}
              disabled={!canSave || log.isPending}
              className="flex-1 rounded-xl bg-ink py-3 font-medium text-page disabled:opacity-40"
            >
              {log.isPending ? "Saving…" : "Save"}
            </button>
          </div>
        </>
      )}
    </Sheet>
  );
}

/**
 * Spec 8.4 asks the save to confirm which clocks were reset. Saying "none"
 * plainly matters more than saying "two": a visit logged without line items
 * resets nothing by design, and the owner needs to see that now rather than
 * discover it as a stale due date months later.
 */
/** One line of the running cost breakdown. Read-only by design. */
function Total({ label, value, strong }: { label: string; value: number; strong?: boolean }) {
  return (
    <div className={"flex justify-between gap-4" + (strong ? " font-medium text-ink" : "")}>
      <dt className={strong ? "" : "text-ink-faint"}>{label}</dt>
      <dd className="tabular-nums">{formatSen(value)}</dd>
    </div>
  );
}

function SavedConfirmation({ parts, onClose }: { parts: string[]; onClose: () => void }) {
  return (
    <div>
      <h2 className="text-lg font-semibold">Service saved</h2>
      {parts.length === 0 ? (
        <p className="mt-2 text-sm text-ink-muted">
          No parts were listed, so no maintenance clock was reset. Add the visit again with
          line items if it included replacements.
        </p>
      ) : (
        <>
          <p className="mt-2 text-sm text-ink-muted">Clocks reset:</p>
          <ul className="mt-1 list-inside list-disc text-sm text-ink-muted">
            {parts.map((p) => (
              <li key={p}>{p}</li>
            ))}
          </ul>
        </>
      )}
      <button
        onClick={onClose}
        className="mt-5 w-full rounded-xl bg-ink py-3 font-medium text-page"
      >
        Done
      </button>
    </div>
  );
}
