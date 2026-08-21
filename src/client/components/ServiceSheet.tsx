import { useState } from "react";
import {
  useLogService,
  useMaintenance,
  usePartTypes,
  useServiceTemplates,
  SERVICE_TYPES,
  type ServiceItemDraft,
  type ServiceTypeName,
} from "../api/hooks";
import { parseSen, toQuantityMilli, formatSen } from "@shared/money";
import { INPUT, Field, digitsOnly } from "./form";
import { formatKm } from "../lib/format";
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
  nickname,
  currentKm,
  today,
  onClose,
}: {
  vehicleId: string;
  nickname: string;
  currentKm: number;
  today: string;
  onClose: () => void;
}) {
  const partTypes = usePartTypes();
  const maintenance = useMaintenance(vehicleId);
  const templates = useServiceTemplates();
  const log = useLogService(vehicleId);

  const [servicedOn, setServicedOn] = useState(today);
  const [odometer, setOdometer] = useState(String(currentKm || ""));
  const [serviceType, setServiceType] = useState<ServiceTypeName | "">("");
  const [workshop, setWorkshop] = useState("");
  const [totalCost, setTotalCost] = useState("");
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
      ? row.configured_interval_km
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

  const partsSubtotal = items.reduce((sum, i) => {
    const unit = parseSen(i.unitCost);
    const qty = Number(i.quantity) > 0 ? Number(i.quantity) : 1;
    return unit === null ? sum : sum + Math.round(unit * qty);
  }, 0);

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

      // Absolute figure in, interval out. Only when it differs from the
      // default, so an untouched field never writes a pointless override.
      const typed = i.nextDueKm === "" ? null : Number(i.nextDueKm);
      if (typed !== null && typed !== defaultNextDueKm(i.partTypeId)) {
        draft.intervalKmOverride = typed - odo;
      }
      return draft;
    });

    const total = parseSen(totalCost);
    log.mutate(
      {
        servicedOn,
        odometerKm: Math.round(odo),
        ...(serviceType ? { serviceType } : {}),
        ...(workshop.trim() ? { workshopName: workshop.trim() } : {}),
        ...(total !== null ? { totalCost: total } : {}),
        ...(notes.trim() ? { notes: notes.trim() } : {}),
        items: drafts,
      },
      { onSuccess: () => setSaved(items.map((i) => i.partName)) },
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end bg-black/40" onClick={onClose}>
      <div
        className="max-h-[92vh] w-full overflow-y-auto rounded-t-2xl bg-white p-5 pb-8"
        onClick={(e) => e.stopPropagation()}
      >
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

            <h3 className="mt-6 text-sm font-medium uppercase tracking-wide text-stone-500">
              Parts replaced
            </h3>
            {items.length === 0 ? (
              <p className="mt-2 text-sm text-stone-600">
                None yet. A visit with no parts is a valid record &mdash; it just resets no
                maintenance clocks.
              </p>
            ) : (
              <>
                {nextService !== undefined && (
                  <p className="mt-2 text-sm text-stone-700">
                    Next service at <strong>{formatKm(nextService)}</strong>
                  </p>
                )}
                <ul className="mt-2 space-y-2">
                  {items.map((item) => (
                    <ServiceItemRow
                      key={item.key}
                      item={item}
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

            <Field label="Total paid (RM)">
              <input
                type="text"
                inputMode="decimal"
                value={totalCost}
                onChange={(e) => setTotalCost(e.target.value.replace(/[^0-9.]/g, ""))}
                placeholder="0.00"
                className={INPUT + " tabular-nums"}
              />
            </Field>
            {partsSubtotal > 0 && (
              <p className="mt-1 text-xs text-stone-500">
                Parts add up to {formatSen(partsSubtotal)}. Labour and sundries are not line
                items, so the total is usually higher.
              </p>
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
              <p className="mt-2 text-sm text-red-700">{(log.error as Error).message}</p>
            )}

            <div className="mt-5 flex gap-3">
              <button
                onClick={onClose}
                className="flex-1 rounded-xl border border-stone-300 py-3 font-medium"
              >
                Cancel
              </button>
              <button
                onClick={save}
                disabled={!canSave || log.isPending}
                className="flex-1 rounded-xl bg-stone-900 py-3 font-medium text-white disabled:opacity-40"
              >
                {log.isPending ? "Saving…" : "Save"}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

/**
 * Spec 8.4 asks the save to confirm which clocks were reset. Saying "none"
 * plainly matters more than saying "two": a visit logged without line items
 * resets nothing by design, and the owner needs to see that now rather than
 * discover it as a stale due date months later.
 */
function SavedConfirmation({ parts, onClose }: { parts: string[]; onClose: () => void }) {
  return (
    <div>
      <h2 className="text-lg font-semibold">Service saved</h2>
      {parts.length === 0 ? (
        <p className="mt-2 text-sm text-stone-700">
          No parts were listed, so no maintenance clock was reset. Add the visit again with
          line items if it included replacements.
        </p>
      ) : (
        <>
          <p className="mt-2 text-sm text-stone-700">Clocks reset:</p>
          <ul className="mt-1 list-inside list-disc text-sm text-stone-700">
            {parts.map((p) => (
              <li key={p}>{p}</li>
            ))}
          </ul>
        </>
      )}
      <button
        onClick={onClose}
        className="mt-5 w-full rounded-xl bg-stone-900 py-3 font-medium text-white"
      >
        Done
      </button>
    </div>
  );
}
