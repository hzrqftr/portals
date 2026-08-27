import { useState } from "react";
import {
  useCreateVehicle,
  useUpdateVehicle,
  type VehicleDraft,
  type VehicleDetails,
  type VehicleType,
} from "../api/hooks";
import { INPUT, Field, Choice, digitsOnly } from "./form";
import { VEHICLE_TYPES } from "../lib/vehicleType";
import { Sheet, SheetActions } from "./Sheet";

/**
 * Spec 10, Phase 1: vehicle CRUD. This is the first thing a new user must be
 * able to do, so it asks for one required field and treats everything else as
 * optional -- a half-filled vehicle is far more useful than an abandoned form.
 *
 * Fuel type is the one optional field worth encouraging: the server seeds
 * maintenance intervals filtered by it, so an EV entered without it inherits
 * oil and filter schedules it will never need.
 */

const FUEL_TYPES = [
  { value: "petrol", label: "Petrol" },
  { value: "diesel", label: "Diesel" },
  { value: "hybrid", label: "Hybrid" },
  { value: "ev", label: "Electric" },
] as const;

const TRANSMISSIONS = [
  { value: "auto", label: "Automatic" },
  { value: "manual", label: "Manual" },
] as const;

type Fuel = NonNullable<VehicleDraft["fuelType"]>;
type Gearbox = NonNullable<VehicleDraft["transmission"]>;

/**
 * Add a vehicle, or edit one that exists. Pass `vehicle` to edit.
 *
 * One component for both because the fields are identical and the alternative
 * is two forms that drift apart -- the spec you can enter at creation has to
 * be the spec you can correct afterwards, or half of it becomes write-once.
 */
export function VehicleSheet({
  vehicle,
  onClose,
}: {
  vehicle?: VehicleDetails;
  onClose: () => void;
}) {
  const editing = vehicle !== undefined;
  const str = (v: string | number | null | undefined) => (v == null ? "" : String(v));

  const [vType, setVType] = useState<VehicleType>(vehicle?.vehicleType ?? "car");
  const [nickname, setNickname] = useState(str(vehicle?.nickname));
  const [plate, setPlate] = useState(str(vehicle?.plate));
  const [make, setMake] = useState(str(vehicle?.make));
  const [model, setModel] = useState(str(vehicle?.model));
  const [year, setYear] = useState(str(vehicle?.year));
  // Odometer is seeded at creation only. Editing it here would write a
  // reading dated today for a number that may be months old, so the quick
  // odometer flow (spec 8.5) stays the only way to move it.
  const [odometer, setOdometer] = useState("");
  const [fuelType, setFuelType] = useState<Fuel | "">(vehicle?.fuelType ?? "");
  const [transmission, setTransmission] = useState<Gearbox | "">(vehicle?.transmission ?? "");

  const create = useCreateVehicle();
  const update = useUpdateVehicle(vehicle?.id ?? "");
  const save_ = editing ? update : create;
  const valid = nickname.trim().length > 0;

  function save() {
    if (!valid) return;

    // Omit blanks rather than sending empty strings: the column is nullable
    // and "" would later render as a plate that looks set but is not.
    const draft: VehicleDraft = { nickname: nickname.trim(), vehicleType: vType };
    if (plate.trim()) draft.plate = plate.trim().toUpperCase();
    if (make.trim()) draft.make = make.trim();
    if (model.trim()) draft.model = model.trim();
    if (fuelType) draft.fuelType = fuelType;
    if (transmission) draft.transmission = transmission;

    const parsedYear = Number(year);
    if (year && Number.isInteger(parsedYear) && parsedYear >= 1900 && parsedYear <= 2100) {
      draft.year = parsedYear;
    }

    if (editing) {
      // Clearing a field has to travel as an explicit null. A PATCH that
      // simply omits the key means "leave it alone", so emptying the Make box
      // and saving would otherwise look like it worked and change nothing.
      if (!plate.trim()) draft.plate = null;
      if (!make.trim()) draft.make = null;
      if (!model.trim()) draft.model = null;
      if (!year.trim()) draft.year = null;
      if (!fuelType) draft.fuelType = null;
      if (!transmission) draft.transmission = null;
    } else if (odometer !== "") {
      // Seeds the first odometer reading, which is what every projection is
      // measured from. Zero is legitimate, so test for "" not falsiness.
      draft.currentOdometerKm = Number(odometer);
    }

    save_.mutate(draft, { onSuccess: onClose });
  }

  return (
    <Sheet title={editing ? "Vehicle details" : "Add a vehicle"} onClose={onClose}>
      <h2 className="pr-9 text-lg font-semibold">
        {editing ? "Vehicle details" : "Add a vehicle"}
      </h2>
      <p className="mt-1 text-sm text-ink-muted">
        {editing
          ? "The spec for this vehicle. Clear a field to unset it."
          : "Only the name is required. You can fill in the rest later."}
      </p>

      {/*
        First, above the name, because it decides which parts the vehicle is
        seeded with -- a far harder thing to correct afterwards than a typo in
        the model. On an edit it is read-only for the same reason: changing it
        would not retro-seed or un-seed anything, so a control that appears to
        switch a car into a bike and silently leaves forty car parts behind
        would be lying.
      */}
      {editing ? (
        <Field label="Type">
          <p className={INPUT + " text-ink-muted"}>
            {VEHICLE_TYPES.find((t) => t.value === vType)?.label}
          </p>
        </Field>
      ) : (
        <Choice
          label="Type"
          value={vType}
          options={VEHICLE_TYPES}
          // Choice allows "" for the optional fields it was built for. A
          // vehicle is always one type or the other, so the blank is ignored
          // rather than given a meaning here.
          onChange={(next) => next && setVType(next)}
        />
      )}

      <Field label="Name">
        <input
          autoFocus
          value={nickname}
          onChange={(e) => setNickname(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && save()}
          placeholder="Myvi"
          maxLength={60}
          className={INPUT}
        />
      </Field>

      <Field label="Plate">
        <input
          value={plate}
          onChange={(e) => setPlate(e.target.value)}
          placeholder="WXY 1234"
          maxLength={20}
          className={INPUT + " uppercase"}
        />
      </Field>

      <div className="flex gap-3">
        <Field label="Make" className="flex-1">
          <input
            value={make}
            onChange={(e) => setMake(e.target.value)}
            placeholder="Perodua"
            maxLength={40}
            className={INPUT}
          />
        </Field>
        <Field label="Model" className="flex-1">
          <input
            value={model}
            onChange={(e) => setModel(e.target.value)}
            placeholder="Myvi 1.5"
            maxLength={60}
            className={INPUT}
          />
        </Field>
      </div>

      <div className="flex gap-3">
        <Field label="Year" className="flex-1">
          <input
            inputMode="numeric"
            value={year}
            onChange={(e) => setYear(digitsOnly(e.target.value).slice(0, 4))}
            placeholder="2019"
            className={INPUT + " tabular-nums"}
          />
        </Field>
        {/*
          Creation only. The odometer moves through readings (spec 8.5), and
          an editable box here would write a reading dated today for a number
          that might be months old. Showing a field that quietly does nothing
          on save is worse than not showing it.
        */}
        {!editing && (
          <Field label="Odometer now (km)" className="flex-1">
            <input
              inputMode="numeric"
              value={odometer}
              onChange={(e) => setOdometer(digitsOnly(e.target.value))}
              placeholder="86000"
              className={INPUT + " tabular-nums"}
            />
          </Field>
        )}
      </div>

      <Choice label="Fuel" value={fuelType} options={FUEL_TYPES} onChange={setFuelType} />
      <Choice
        label="Transmission"
        value={transmission}
        options={TRANSMISSIONS}
        onChange={setTransmission}
      />

      {save_.isError && (
        <p className="mt-3 text-sm text-status-overdue-fg">{(save_.error as Error).message}</p>
      )}

      <SheetActions
        onCancel={onClose}
        onConfirm={save}
        confirmLabel="Save"
        busy={save_.isPending}
        disabled={!valid}
      />
    </Sheet>
  );
}
