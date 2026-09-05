import { useState } from "react";
import {
  useLogService,
  useUpdateService,
  useMaintenance,
  usePartTypes,
  useServiceTemplates,
  SERVICE_TYPES,
  type ServiceItemDraft,
  type ServiceRecord,
  type ServiceTypeName,
  type VehicleType,
} from "../api/hooks";
import { parseSen, toQuantityMilli } from "@portals/core";
import { Field, INPUT, Select, digitsOnly } from "@portals/core/client";
import { formatKm } from "../lib/format";
import { Sheet } from "@portals/core/client";
import { PartPicker } from "./PartPicker";
import { ServiceItemRow } from "./ServiceItemRow";
import { useServiceDraft } from "./serviceDraft";
import { SavedConfirmation, Total } from "./ServiceSaved";

/**
 * Log a service, or correct one already logged. Spec 8.4 -- "the
 * highest-friction flow, needing the most care", and the one flow without
 * which nothing else in the app has data.
 *
 * ONE component for both, as VehicleSheet is for vehicles, and for the same
 * reason: two forms drift apart, and every field the second one forgets
 * becomes write-once. That was literally the state of this flow until now -- a
 * service logged with the wrong odometer could never be corrected.
 *
 * Two things here are not obvious from the layout:
 *
 * 1. "Next due at" is typed as an absolute odometer figure, because that is
 *    what the workshop sticker says, but it is SENT as an interval -- the gap
 *    from this service's odometer. The API never receives a due point, which
 *    is what keeps invariant 6 true structurally rather than by convention.
 * 2. Total cost is shown, never typed. It is parts + labour by definition, so
 *    there is no third figure that can disagree with the other two.
 */
export function ServiceSheet({
  vehicleId,
  vehicleType,
  nickname,
  currentKm,
  today,
  record,
  onClose,
}: {
  vehicleId: string;
  vehicleType: VehicleType;
  nickname: string;
  currentKm: number;
  today: string;
  /** Pass a record to EDIT it. Omit to log a new visit. */
  record?: ServiceRecord;
  onClose: () => void;
}) {
  const editing = record !== undefined;

  const partTypes = usePartTypes(vehicleType);
  const maintenance = useMaintenance(vehicleId);
  const templates = useServiceTemplates();

  const log = useLogService(vehicleId);
  const update = useUpdateService(vehicleId, record?.id ?? "");
  const save_ = editing ? update : log;

  const [draft, set, setDraft] = useServiceDraft(record, today, currentKm);
  const { servicedOn, odometer, serviceType, workshop, labourCost, notes, items } = draft;

  // The sheet's phase rather than the form's content, so it stays out of the
  // draft: null while editing, the part names once the save has come back.
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
    setDraft((prev) =>
      prev.items.some((i) => i.partTypeId === partTypeId)
        ? prev
        : {
            ...prev,
            items: [
              ...prev.items,
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
          },
    );
  }

  /**
   * Templates MERGE, never replace. Switching minor -> major after filling in
   * three lines must not throw that work away, and a part the user removed on
   * purpose must not silently reappear -- so the type change only ever adds
   * what is missing.
   *
   * This matters more when editing than when logging: picking a type on a
   * saved record must not quietly discard the parts that record already holds.
   */
  function chooseType(next: ServiceTypeName | "") {
    set("serviceType", next);
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

    save_.mutate(
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

  const heading = `${editing ? "Edit" : "Log"} service — ${nickname}`;

  return (
    <Sheet title={heading} onClose={onClose} wide>
      {saved ? (
        <SavedConfirmation parts={saved} editing={editing} onClose={onClose} />
      ) : (
        <>
          <h2 className="text-lg font-semibold">{heading}</h2>

          <div className="grid grid-cols-2 gap-3">
            <Field label="Date">
              <input
                type="date"
                value={servicedOn}
                onChange={(e) => set("servicedOn", e.target.value)}
                className={INPUT}
              />
            </Field>
            <Field label="Odometer (km)">
              <input
                type="text"
                inputMode="numeric"
                value={odometer}
                onChange={(e) => set("odometer", digitsOnly(e.target.value))}
                className={INPUT + " tabular-nums"}
              />
            </Field>
          </div>

          {editing && (
            // Said here rather than discovered afterwards. Correcting the date
            // or odometer also moves every maintenance due point derived from
            // this visit -- invariant 6 working correctly, and alarming if it
            // arrives unannounced.
            <p className="mt-1 text-xs text-ink-faint">
              Correcting the date or odometer also corrects the reading this visit
              recorded, and moves anything due from it.
            </p>
          )}

          <Field label="Type of service">
            <Select
              className="mt-1"
              value={serviceType}
              onChange={(e) => chooseType(e.target.value as ServiceTypeName | "")}
            >
              <option value="">Not specified</option>
              {SERVICE_TYPES.map((t) => (
                <option key={t.value} value={t.value}>
                  {t.label}
                </option>
              ))}
            </Select>
          </Field>

          <Field label="Workshop">
            <input
              value={workshop}
              onChange={(e) => set("workshop", e.target.value)}
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
                      setDraft((prev) => ({
                        ...prev,
                        items: prev.items.map((p) => (p.key === next.key ? next : p)),
                      }))
                    }
                    onRemove={() =>
                      setDraft((prev) => ({
                        ...prev,
                        items: prev.items.filter((p) => p.key !== item.key),
                      }))
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
              onChange={(e) => set("labourCost", e.target.value.replace(/[^0-9.]/g, ""))}
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
              onChange={(e) => set("notes", e.target.value)}
              rows={2}
              className={INPUT}
            />
          </Field>

          {save_.isError && (
            <p className="mt-2 text-sm text-status-overdue-fg">
              {(save_.error as Error).message}
            </p>
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
              disabled={!canSave || save_.isPending}
              className="flex-1 rounded-xl bg-ink py-3 font-medium text-page disabled:opacity-40"
            >
              {save_.isPending ? "Saving…" : "Save"}
            </button>
          </div>
        </>
      )}
    </Sheet>
  );
}
