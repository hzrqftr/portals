import { useState } from "react";
import {
  useLogService,
  useUpdateService,
  useMaintenance,
  usePartTypes,
  useServiceTemplates,
  uploadAttachment,
  type ServiceRecord,
  type ServiceTypeName,
  type VehicleType,
} from "../api/hooks";
import { Field, INPUT, Sheet } from "@portals/core/client";
import { useServiceDraft } from "./serviceDraft";
import { ServiceAttachments } from "./ServiceAttachments";
import { ServicePartsSection } from "./ServicePartsSection";
import { SavedConfirmation, Total } from "./ServiceSaved";
import { ServiceVisitFields } from "./ServiceVisitFields";
import {
  canSaveService,
  deriveTotals,
  makeDefaultNextDueKm,
  partsSettingASchedule,
  toItemDrafts,
} from "./serviceTotals";

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
 *
 * The arithmetic behind both of those is in serviceTotals.ts, where it can be
 * tested directly; the form state is in serviceDraft.ts, where seeding an edit
 * can be tested the same way. What is left here is the form itself.
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
  //
  // Two lists, not one. `scheduled` is the subset that actually put a part on
  // a schedule, and the confirmation needs both to tell "no parts at all" from
  // "parts, none of them tracked" -- see SavedConfirmation.
  const [saved, setSaved] = useState<{ parts: string[]; scheduled: string[] } | null>(null);

  // Also the sheet's phase rather than the form's content: opening the panel
  // changes nothing about the visit being logged, and closing it must not.
  const [addingCustom, setAddingCustom] = useState(false);

  // Receipts picked before the record exists. On a new visit there is no id to
  // upload against until the save comes back, so they are held here and sent
  // in the mutation's onSuccess. When editing, the id already exists and
  // ServiceAttachments uploads on pick instead -- pending stays empty.
  const [pendingFiles, setPendingFiles] = useState<File[]>([]);
  const [attachmentWarning, setAttachmentWarning] = useState<string | null>(null);

  const odo = odometer === "" ? null : Number(odometer);
  const nameOf = (id: string) => partTypes.data?.find((p) => p.id === id)?.name ?? "Part";

  const defaultNextDueKm = makeDefaultNextDueKm(odo, maintenance.data ?? [], partTypes.data ?? []);
  const { partsSubtotal, labourSen, grandTotal, nextService, badItem } = deriveTotals(
    items,
    labourCost,
    odo,
    defaultNextDueKm,
  );
  const canSave = canSaveService(odo, badItem);

  /**
   * `name` is only passed for a part type created seconds ago, whose fetch has
   * not landed yet. Everything else looks itself up.
   */
  function addPart(partTypeId: string, name?: string) {
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
                partName: name ?? nameOf(partTypeId),
                brand: "",
                spec: "",
                note: "",
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

  function save() {
    if (!canSave || odo === null) return;

    save_.mutate(
      {
        servicedOn,
        odometerKm: Math.round(odo),
        ...(serviceType ? { serviceType } : {}),
        ...(workshop.trim() ? { workshopName: workshop.trim() } : {}),
        ...(labourSen !== null ? { labourCost: labourSen } : {}),
        ...(notes.trim() ? { notes: notes.trim() } : {}),
        items: toItemDrafts(items, odo, defaultNextDueKm),
      },
      {
        onSuccess: async (result: { id: string }) => {
          // The record is saved by the time this runs. A receipt that fails
          // now is reported, NOT rolled back -- unwinding a correctly entered
          // service because a scan failed to upload is the worse of the two
          // outcomes, and the record is where the receipt can be retried from.
          const failed: string[] = [];
          for (const file of pendingFiles) {
            try {
              await uploadAttachment(result.id, file);
            } catch {
              failed.push(file.name);
            }
          }
          if (failed.length > 0) {
            setAttachmentWarning(
              `The service was saved, but ${failed.length === 1 ? "this receipt" : "these receipts"} did not upload: ${failed.join(", ")}. Add ${failed.length === 1 ? "it" : "them"} from the service in the history list.`,
            );
          }
          setSaved({
            parts: items.map((i) => i.partName),
            scheduled: partsSettingASchedule(items, odo, defaultNextDueKm),
          });
        },
      },
    );
  }

  const heading = `${editing ? "Edit" : "Log"} service — ${nickname}`;

  return (
    <Sheet title={heading} onClose={onClose} wide>
      {saved ? (
        <SavedConfirmation
          parts={saved.parts}
          scheduled={saved.scheduled}
          editing={editing}
          attachmentWarning={attachmentWarning}
          onClose={onClose}
        />
      ) : (
        <>
          <h2 className="text-lg font-semibold">{heading}</h2>

          <ServiceVisitFields
            servicedOn={servicedOn}
            odometer={odometer}
            serviceType={serviceType}
            workshop={workshop}
            editing={editing}
            onServicedOnChange={(v) => set("servicedOn", v)}
            onOdometerChange={(v) => set("odometer", v)}
            onServiceTypeChange={chooseType}
            onWorkshopChange={(v) => set("workshop", v)}
          />

          <ServicePartsSection
            items={items}
            partTypes={partTypes.data ?? []}
            maintenance={maintenance.data ?? []}
            odometerKm={odo}
            nextService={nextService}
            defaultNextDueKm={defaultNextDueKm}
            addingCustom={addingCustom}
            onAddingCustomChange={setAddingCustom}
            onAddPart={addPart}
            onChangeItem={(next) =>
              setDraft((prev) => ({
                ...prev,
                items: prev.items.map((p) => (p.key === next.key ? next : p)),
              }))
            }
            onRemoveItem={(key) =>
              setDraft((prev) => ({
                ...prev,
                items: prev.items.filter((p) => p.key !== key),
              }))
            }
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

          <ServiceAttachments
            serviceId={record?.id ?? null}
            pending={pendingFiles}
            onPendingChange={setPendingFiles}
          />

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
