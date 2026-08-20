import { useState } from "react";
import { useCreateVehicle, type VehicleDraft } from "../api/hooks";
import { INPUT, Field, Choice, digitsOnly } from "./form";

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

export function VehicleSheet({ onClose }: { onClose: () => void }) {
  const [nickname, setNickname] = useState("");
  const [plate, setPlate] = useState("");
  const [make, setMake] = useState("");
  const [model, setModel] = useState("");
  const [year, setYear] = useState("");
  const [odometer, setOdometer] = useState("");
  const [fuelType, setFuelType] = useState<Fuel | "">("");
  const [transmission, setTransmission] = useState<Gearbox | "">("");

  const create = useCreateVehicle();
  const valid = nickname.trim().length > 0;

  function save() {
    if (!valid) return;

    // Omit blanks rather than sending empty strings: the column is nullable
    // and "" would later render as a plate that looks set but is not.
    const draft: VehicleDraft = { nickname: nickname.trim() };
    if (plate.trim()) draft.plate = plate.trim().toUpperCase();
    if (make.trim()) draft.make = make.trim();
    if (model.trim()) draft.model = model.trim();
    if (fuelType) draft.fuelType = fuelType;
    if (transmission) draft.transmission = transmission;

    const parsedYear = Number(year);
    if (year && Number.isInteger(parsedYear) && parsedYear >= 1900 && parsedYear <= 2100) {
      draft.year = parsedYear;
    }

    // Seeds the first odometer reading, which is what every projection is
    // measured from. Zero is a legitimate value, so test for "" not falsiness.
    if (odometer !== "") draft.currentOdometerKm = Number(odometer);

    create.mutate(draft, { onSuccess: onClose });
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end bg-black/40" onClick={onClose}>
      <div
        className="max-h-[88vh] w-full overflow-y-auto rounded-t-2xl bg-white p-5 pb-8"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="text-lg font-semibold">Add a vehicle</h2>
        <p className="mt-1 text-sm text-stone-600">
          Only the name is required. You can fill in the rest later.
        </p>

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
          <Field label="Odometer now (km)" className="flex-1">
            <input
              inputMode="numeric"
              value={odometer}
              onChange={(e) => setOdometer(digitsOnly(e.target.value))}
              placeholder="86000"
              className={INPUT + " tabular-nums"}
            />
          </Field>
        </div>

        <Choice label="Fuel" value={fuelType} options={FUEL_TYPES} onChange={setFuelType} />
        <Choice
          label="Transmission"
          value={transmission}
          options={TRANSMISSIONS}
          onChange={setTransmission}
        />

        {create.isError && (
          <p className="mt-3 text-sm text-red-700">{(create.error as Error).message}</p>
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
            disabled={!valid || create.isPending}
            className="flex-1 rounded-xl bg-stone-900 py-3 font-medium text-white disabled:opacity-40"
          >
            {create.isPending ? "Saving…" : "Save"}
          </button>
        </div>
      </div>
    </div>
  );
}
