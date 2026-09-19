import { useState } from "react";
import { INPUT, DATE_INPUT, Field, Sheet, SheetActions } from "@portals/core/client";
import {
  grantDocuments,
  useUpdateVehicle,
  type VehicleDetails,
  type VehicleDraft,
} from "../api/hooks";
import { Attachments } from "./Attachments";

/**
 * The vehicle grant (geran): its vehicle details, and the document itself.
 *
 * ONLY the vehicle's details become fields. The grant also names the
 * registered owner -- name, IC number, address -- and those deliberately stay
 * inside the PDF (owner decision, 2026-09-19). Every field is copied into the
 * nightly backup file and the CSV export, and a garage can be shared; the PDF
 * is served only through the garage-scoped download route and is not in the
 * backup at all. See migrations/0018.
 */
export function GrantCard({ vehicle }: { vehicle: VehicleDetails }) {
  const [editing, setEditing] = useState(false);
  const rows: [string, string | null][] = [
    ["Chassis no.", vehicle.vin],
    ["Engine no.", vehicle.engineNo],
    ["Registered", vehicle.registeredOn],
    ["Colour", vehicle.colour],
  ];

  return (
    <div className="mt-3 rounded-xl border border-edge bg-surface p-4">
      <div className="flex items-center justify-between gap-3">
        <h3 className="font-medium text-ink">Grant (geran)</h3>
        <button
          onClick={() => setEditing(true)}
          className="rounded-lg border border-edge px-3 py-2 text-sm text-ink-muted hover:text-ink"
        >
          Edit
        </button>
      </div>
      <dl className="mt-3 grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
        {rows.map(([label, value]) => (
          <div key={label} className="flex justify-between gap-4 border-b border-edge/50 pb-2">
            <dt className="text-ink-faint">{label}</dt>
            <dd className={"min-w-0 truncate " + (value === null ? "text-ink-faint" : "text-ink")}>
              {value ?? "Not set"}
            </dd>
          </div>
        ))}
      </dl>

      <Attachments
        target={grantDocuments(vehicle.id)}
        title="Document"
        emptyHint="Attach the grant. Owner name, IC and address stay in the file — they are never copied into a field."
        addLabel="Add the grant (PDF or photo)"
      />

      {editing && <GrantSheet vehicle={vehicle} onClose={() => setEditing(false)} />}
    </div>
  );
}

function GrantSheet({ vehicle, onClose }: { vehicle: VehicleDetails; onClose: () => void }) {
  const [vin, setVin] = useState(vehicle.vin ?? "");
  const [engineNo, setEngineNo] = useState(vehicle.engineNo ?? "");
  const [registeredOn, setRegisteredOn] = useState(vehicle.registeredOn ?? "");
  const [colour, setColour] = useState(vehicle.colour ?? "");
  const update = useUpdateVehicle(vehicle.id);

  function save() {
    // An emptied box travels as an explicit null, or the PATCH would read it
    // as "leave alone" and the clear would silently not happen.
    const patch: VehicleDraft = {
      nickname: vehicle.nickname,
      vin: vin.trim() ? vin.trim().toUpperCase() : null,
      engineNo: engineNo.trim() ? engineNo.trim().toUpperCase() : null,
      registeredOn: registeredOn || null,
      colour: colour.trim() || null,
    };
    update.mutate(patch, { onSuccess: onClose });
  }

  return (
    <Sheet title="Grant details" onClose={onClose}>
      <h2 className="pr-9 text-lg font-semibold">Grant details</h2>
      <p className="mt-1 text-sm text-ink-muted">
        The vehicle&rsquo;s details as printed on the grant. The owner&rsquo;s details are not
        asked for on purpose.
      </p>
      <Field label="Chassis no. (VIN)">
        <input
          value={vin}
          onChange={(e) => setVin(e.target.value)}
          maxLength={32}
          className={INPUT + " uppercase"}
        />
      </Field>
      <Field label="Engine no.">
        <input
          value={engineNo}
          onChange={(e) => setEngineNo(e.target.value)}
          maxLength={32}
          className={INPUT + " uppercase"}
        />
      </Field>
      <div className="grid gap-x-3 sm:grid-cols-2">
        <Field label="Registration date">
          <input
            type="date"
            value={registeredOn}
            onChange={(e) => setRegisteredOn(e.target.value)}
            className={DATE_INPUT}
          />
        </Field>
        <Field label="Colour">
          <input
            value={colour}
            onChange={(e) => setColour(e.target.value)}
            maxLength={40}
            className={INPUT}
          />
        </Field>
      </div>
      {update.isError && (
        <p className="mt-3 text-sm text-status-overdue-fg">{(update.error as Error).message}</p>
      )}
      <SheetActions
        onCancel={onClose}
        onConfirm={save}
        confirmLabel="Save"
        busy={update.isPending}
      />
    </Sheet>
  );
}
